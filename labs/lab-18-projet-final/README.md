# Lab 18 — PROJET FINAL : concevoir et déployer une tranche verticale de TribuZen

> **Outcome :** à la fin, tu as **conçu puis déployé pour de vrai**, en CDK, une architecture TribuZen minimale mais **complète et fonctionnelle** — Cognito (auth) + API Gateway HTTP API + Lambda + DynamoDB + S3 — et tu l'as **prouvée de bout en bout au curl** : un utilisateur s'inscrit, obtient un JWT, poste un message authentifié (écrit en DynamoDB), le relit, et obtient une URL presignée pour uploader une photo dans S3. Puis tu **détruis tout**.
> **Vrai outil :** AWS CDK (`aws-cdk-lib`, `NodejsFunction`, constructs Cognito/DynamoDB/HTTP API) + AWS CLI v2 (`cognito-idp`, `curl`, `aws dynamodb`, `aws s3`). **Aucun harnais de test simulé.** L'oracle, ce sont les **ressources réellement déployées** et les **réponses HTTP réelles**.
> **Feedback :** le coach valide en session (lecture des stacks CDK + déroulé live du parcours curl : sign-up → token → POST /messages → GET /feed → presigned S3). Pas de test-runner auto-correcteur.
>
> ⚠️ **Coût / Free Tier :** l'archi tient **très largement dans le Free Tier** à l'échelle d'un lab (quelques dizaines de requêtes). Cognito : 10 000 MAU gratuits ; Lambda : 1 M req + 400 k Go-s ; DynamoDB on-demand + S3 : centimes. Seul risque : **oublier de détruire** (CloudWatch Logs et NAT/WAF s'accumulent). **Teardown obligatoire** (`cdk destroy`, section dédiée). Région conseillée : `eu-west-3` (Paris).

---

## Prérequis

- Compte AWS avec un **user admin IAM** (pas root), MFA activé — module 00.
- **AWS CLI v2** configurée (`aws configure`), région `eu-west-3`.
- **Node.js 20+**, **npm**, **AWS CDK** (`npm install -g aws-cdk`), compte **bootstrappé** (`cdk bootstrap` — module 05).
- `curl` et `jq` (pour lire les réponses JSON confortablement).

Vérifie ton identité :

```bash
aws sts get-caller-identity   # note l'Account ID (12 chiffres)
```

---

## Énoncé

Tu livres la **tranche verticale** du feed TribuZen : le chemin complet « une famille s'inscrit et poste un message ». Le périmètre est volontairement **resserré à 4 services assemblés** (le reste de l'archi — CloudFront, Streams, thumbnails, WAF — est hors périmètre du lab mais tu sais où il se branche, cf. module 18).

**Ce que le système déployé doit faire (le contrat, à valider au curl) :**

1. **S'inscrire** : un utilisateur crée un compte via Cognito (email + mot de passe), le confirme, se connecte, récupère un **access token** (JWT).
2. **Poster** : `POST /messages` avec `Authorization: Bearer <token>` et `{ "text": "..." }` → la Lambda extrait le `sub` du JWT (claims Cognito), écrit un item dans DynamoDB `TribuZenFeed` (`PK=USER#<sub>`, `SK=TS#<horodatage>`), renvoie `201` + l'item créé.
3. **Relire** : `GET /feed` (authentifié) → la Lambda `Query` la table sur `PK=USER#<sub>`, renvoie les messages de l'utilisateur par ordre chronologique.
4. **Uploader une photo** : `GET /avatar-url` (authentifié) → renvoie une **presigned URL PUT** sur `tribuzen-lab-avatars/<sub>/<uuid>.jpg` valable 5 min ; un `curl -T` réel dépose un fichier dans S3.
5. **Sécurité** : sans token valide, l'API répond **401**. Chaque Lambda a un **rôle de moindre privilège** (généré par les `grant*` du CDK), pas de `*`.

**Découpage IaC imposé** (comme au module 18) :

- `StorageStack` — table DynamoDB + bucket avatars (`RemovalPolicy.DESTROY` **ici** car c'est un lab jetable ; en prod ce serait `RETAIN`).
- `AuthStack` — User Pool + App Client Cognito.
- `ApiStack` — HTTP API + 3 Lambdas + authorizer JWT, reçoit table/bucket/userPool par **props**.

**Contrainte :** tu écris les stacks et les handlers **toi-même** à partir du squelette. Pas de gap-fill, pas de copier-coller aveugle du corrigé avant d'avoir essayé.

### Squelette de départ (structure à créer)

```
lab18/
  bin/tribuzen-lab.ts       ← App CDK : instancie les 3 stacks, passe les références
  lib/
    storage-stack.ts        ← DynamoDB + S3
    auth-stack.ts           ← Cognito
    api-stack.ts            ← HTTP API + Lambdas + authorizer
  lambda/
    post-message.mjs        ← écrit un message (PutItem)
    get-feed.mjs            ← lit les messages (Query)
    get-avatar-url.mjs      ← signe une presigned PUT
  cdk.json, package.json    ← générés par `cdk init app --language typescript`
```

Démarre par : `mkdir lab18 && cd lab18 && cdk init app --language typescript`, puis installe les modules d'intégration HTTP API :

```bash
npm install @aws-cdk/aws-apigatewayv2-alpha @aws-cdk/aws-apigatewayv2-authorizers-alpha \
            @aws-cdk/aws-apigatewayv2-integrations-alpha
# NB : selon ta version d'aws-cdk-lib, HTTP API peut être STABLE (aws-cdk-lib/aws-apigatewayv2*)
#      ou en module -alpha séparé. Vérifie avec `cdk --version` et adapte les imports.
```

<!-- FLAG-DOC: statut (stable vs -alpha) des constructs L2 apigatewayv2 (HttpApi, HttpUserPoolAuthorizer, HttpLambdaIntegration) dépend de la version d'aws-cdk-lib installée — vérifier sur docs.aws.amazon.com/cdk et adapter le chemin d'import. Le corrigé montre la forme stable aws-cdk-lib/aws-apigatewayv2*. -->

---

## Étapes (en friction)

### Phase 1 — Concevoir (10 min, sur papier)

Avant une ligne de CDK, écris **3 ADR courts** (contexte → options → décision → conséquences) :
1. Base du feed : DynamoDB on-demand vs RDS.
2. API : HTTP API vs REST API.
3. Upload photo : presigned S3 vs body de l'API.

C'est le livrable « architecte » — le coach le lit en premier.

### Phase 2 — StorageStack + AuthStack

1. **StorageStack** : table `TribuZenFeed` (`PK` string, `SK` string, `BillingMode.PAY_PER_REQUEST`), bucket `tribuzen-lab-avatars-<account>` (`blockPublicAccess: BLOCK_ALL`). Expose `feedTable` et `avatarBucket` en `public readonly`.
2. **AuthStack** : `UserPool` (`signInAliases: { email: true }`, `selfSignUpEnabled: true`, `autoVerify: { email: true }`), `UserPoolClient` avec `authFlows: { userPassword: true }` (simplifie le login au CLI). Expose `userPool` et `userPoolClient`.
3. `cdk deploy TribuZen-Storage TribuZen-Auth`. Note les **CfnOutput** (table name, bucket name, user pool id, client id).

### Phase 3 — ApiStack + handlers

4. Écris les **3 handlers** toi-même (voir contrat ci-dessus). Rappel : **init des clients hors handler**, nom de table/bucket via `process.env`, `sub` lu dans `event.requestContext.authorizer.jwt.claims.sub`.
5. Écris `ApiStack` : 3 `NodejsFunction`, un `HttpUserPoolAuthorizer`, un `HttpApi` avec `defaultAuthorizer`, 3 routes. **grant** minimal : `grantWriteData` pour post, `grantReadData` pour feed, `grantPut` (bucket) pour avatar-url.
6. `cdk deploy TribuZen-Api`. Note l'**ApiUrl**.

### Phase 4 — Prouver au curl (l'oracle)

7. **Crée et confirme un utilisateur** :
   ```bash
   CLIENT_ID=<client-id>       # depuis les outputs AuthStack
   POOL_ID=<user-pool-id>
   aws cognito-idp sign-up --client-id $CLIENT_ID \
     --username famille@test.dev --password 'Tribu!Pass123' \
     --user-attributes Name=email,Value=famille@test.dev
   # confirmation admin (évite de gérer le code email en lab) :
   aws cognito-idp admin-confirm-sign-up --user-pool-id $POOL_ID --username famille@test.dev
   ```
8. **Connexion → token** :
   ```bash
   TOKEN=$(aws cognito-idp initiate-auth --client-id $CLIENT_ID \
     --auth-flow USER_PASSWORD_AUTH \
     --auth-parameters USERNAME=famille@test.dev,PASSWORD='Tribu!Pass123' \
     --query 'AuthenticationResult.AccessToken' --output text)
   echo $TOKEN | cut -c1-30    # doit afficher un début de JWT
   ```
9. **Poster, relire, signer** :
   ```bash
   API=<ApiUrl>                # depuis les outputs ApiStack

   # sans token → 401 attendu
   curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/messages -d '{"text":"nope"}'

   # avec token → 201 + item
   curl -s -X POST $API/messages -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"text":"Bonjour la tribu"}' | jq

   # relire son feed
   curl -s $API/feed -H "Authorization: Bearer $TOKEN" | jq

   # presigned URL puis upload réel
   URL=$(curl -s $API/avatar-url -H "Authorization: Bearer $TOKEN" | jq -r .url)
   echo "photo de test" > avatar.jpg
   curl -s -o /dev/null -w "%{http_code}\n" -X PUT -T avatar.jpg "$URL"   # 200 attendu
   ```
10. **Vérifie côté services** (l'oracle final) :
    ```bash
    aws dynamodb scan --table-name TribuZenFeed --query 'Items' | jq
    aws s3 ls s3://<avatar-bucket>/ --recursive
    ```

Si les 3 codes HTTP sont `401` / `201` / `200`, que le `scan` montre ton message et que `s3 ls` montre l'objet → **le système fonctionne de bout en bout**. C'est la validation, pas un test simulé.

---

## Corrigé complet commenté

> Forme **stable** des imports (`aws-cdk-lib/aws-apigatewayv2*`). Si ta version expose ces constructs en `-alpha`, adapte le chemin (cf. FLAG-DOC ci-dessus) — la logique est identique.

### `bin/tribuzen-lab.ts` — l'App assemble et fait circuler les références

```typescript
import { App } from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';

const app = new App();
const env = { region: 'eu-west-3' };

const storage = new StorageStack(app, 'TribuZen-Storage', { env });
const auth = new AuthStack(app, 'TribuZen-Auth', { env });

new ApiStack(app, 'TribuZen-Api', {
  env,
  table: storage.feedTable,       // références croisées par props (pas de global)
  bucket: storage.avatarBucket,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});
```

### `lib/storage-stack.ts` — données (DESTROY car lab jetable)

```typescript
import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';

export class StorageStack extends Stack {
  public readonly feedTable: Table;
  public readonly avatarBucket: Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Feed : PK=USER#<sub>, SK=TS#<horodatage> → Query par utilisateur, tri chrono natif
    this.feedTable = new Table(this, 'FeedTable', {
      tableName: 'TribuZenFeed',
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST, // pas de capacity à dimensionner
      removalPolicy: RemovalPolicy.DESTROY,     // LAB : jetable. En prod → RETAIN + PITR
    });

    this.avatarBucket = new Bucket(this, 'AvatarBucket', {
      bucketName: `tribuzen-lab-avatars-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL, // jamais public
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,                        // LAB : vide le bucket au destroy
    });

    new CfnOutput(this, 'TableName', { value: this.feedTable.tableName });
    new CfnOutput(this, 'BucketName', { value: this.avatarBucket.bucketName });
  }
}
```

### `lib/auth-stack.ts` — Cognito

```typescript
import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: 'tribuzen-lab-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      removalPolicy: RemovalPolicy.DESTROY, // LAB
    });

    this.userPoolClient = new UserPoolClient(this, 'WebClient', {
      userPool: this.userPool,
      // USER_PASSWORD_AUTH : simplifie le login au CLI pour le lab.
      // En prod, préférer USER_SRP_AUTH (le mot de passe ne transite pas).
      authFlows: { userPassword: true },
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'ClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
```

### `lib/api-stack.ts` — HTTP API + Lambdas + authorizer JWT

```typescript
import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Bucket } from 'aws-cdk-lib/aws-s3';
import type { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

interface ApiStackProps extends StackProps {
  table: Table;
  bucket: Bucket;
  userPool: UserPool;
  userPoolClient: UserPoolClient;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const common = {
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,     // moins cher
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        FEED_TABLE: props.table.tableName,   // injecté, jamais codé en dur
        AVATAR_BUCKET: props.bucket.bucketName,
      },
    };

    const postFn = new NodejsFunction(this, 'PostFn', { ...common, entry: 'lambda/post-message.mjs' });
    const feedFn = new NodejsFunction(this, 'FeedFn', { ...common, entry: 'lambda/get-feed.mjs' });
    const avatarFn = new NodejsFunction(this, 'AvatarFn', { ...common, entry: 'lambda/get-avatar-url.mjs' });

    // Moindre privilège : chaque Lambda n'obtient QUE ce dont elle a besoin
    props.table.grantWriteData(postFn);   // PutItem seulement
    props.table.grantReadData(feedFn);    // Query/GetItem seulement
    props.bucket.grantPut(avatarFn);      // PutObject (pour signer une URL PUT valide)

    const authorizer = new HttpUserPoolAuthorizer('CognitoAuth', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const api = new HttpApi(this, 'Api', {
      apiName: 'tribuzen-lab-api',
      defaultAuthorizer: authorizer,       // toutes les routes protégées par défaut
    });

    api.addRoutes({ path: '/messages', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('P', postFn) });
    api.addRoutes({ path: '/feed', methods: [HttpMethod.GET], integration: new HttpLambdaIntegration('F', feedFn) });
    api.addRoutes({ path: '/avatar-url', methods: [HttpMethod.GET], integration: new HttpLambdaIntegration('A', avatarFn) });

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
  }
}
```

### `lambda/post-message.mjs`

```javascript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Init hors handler → réutilisé sur les warm starts
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());
const TABLE = process.env.FEED_TABLE;

export const handler = async (event) => {
  const sub = event.requestContext.authorizer.jwt.claims.sub; // identité prouvée par le JWT
  const { text } = JSON.parse(event.body ?? '{}');
  if (!text) return res(400, { message: 'text requis' });

  const now = new Date().toISOString();
  const item = { PK: `USER#${sub}`, SK: `TS#${now}`, author: sub, text, createdAt: now };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return res(201, item);
};

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```

### `lambda/get-feed.mjs`

```javascript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());
const TABLE = process.env.FEED_TABLE;

export const handler = async (event) => {
  const sub = event.requestContext.authorizer.jwt.claims.sub;

  // Query par clé de partition = efficace (≠ Scan). Tri chrono natif via SK.
  const out = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `USER#${sub}` },
    ScanIndexForward: true, // ordre croissant des SK (horodatages)
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(out.Items ?? []),
  };
};
```

### `lambda/get-avatar-url.mjs`

```javascript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client();
const BUCKET = process.env.AVATAR_BUCKET;

export const handler = async (event) => {
  const sub = event.requestContext.authorizer.jwt.claims.sub;
  const key = `${sub}/${randomUUID()}.jpg`;

  // La Lambda ne touche jamais au fichier : elle signe une URL PUT scopée + expirante.
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: 'image/jpeg' }),
    { expiresIn: 300 },
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, key }),
  };
};
```

### Ce que tu dois OBSERVER (et pourquoi c'est correct)

| Observation | Attendu | Pourquoi |
|-------------|---------|----------|
| `POST /messages` sans token | **401** | `defaultAuthorizer` rejette : pas de JWT valide, la Lambda n'est jamais appelée |
| `POST /messages` avec token | **201** + item | le JWT est vérifié par l'authorizer, le `sub` arrive dans les claims |
| `GET /feed` | liste avec ton message | `Query` sur `PK=USER#<sub>` — chaque user ne voit que ses items |
| `PUT` sur l'URL presignée | **200** | l'URL porte une signature valide (bucket, clé, expiration) générée par la Lambda |
| `dynamodb scan` | montre l'item posté | preuve d'écriture réelle, pas simulée |
| `s3 ls` | montre `<sub>/<uuid>.jpg` | preuve d'upload direct navigateur→S3 |
| policies IAM des 3 rôles | aucune `*`, scopées | les `grant*` génèrent le moindre privilège exact |

**Pourquoi ce corrigé est correct :** chaque exigence du brief (module 18) est satisfaite par le **service managé le plus simple**, assemblé en 3 stacks découplées, avec moindre privilège déclaratif et sécurité par défaut. L'oracle n'est pas un mock : ce sont de **vraies ressources** répondant à de **vraies requêtes HTTP**. C'est l'architecture du module, **déployée**.

---

## Teardown (OBLIGATOIRE)

Ne laisse **jamais** traîner une archi de lab (surface d'attaque + logs qui s'accumulent + User Pool actif).

```bash
# Détruit les 3 stacks. Ordre inverse des dépendances (l'API d'abord).
cdk destroy TribuZen-Api TribuZen-Auth TribuZen-Storage
# autoDeleteObjects vide le bucket avatars ; RemovalPolicy.DESTROY supprime table + pool.
```

Supprime aussi les **log groups** créés automatiquement pour les Lambdas (CDK ne les gère pas toujours) :

```bash
aws logs describe-log-groups --query "logGroups[?starts_with(logGroupName,'/aws/lambda/TribuZen-Api')].logGroupName" --output text
# puis pour chacun : aws logs delete-log-group --log-group-name <nom>
```

Vérifie que tout est parti :

```bash
aws dynamodb list-tables --query "TableNames[?@=='TribuZenFeed']"   # → []
aws cognito-idp list-user-pools --max-results 20 \
  --query "UserPools[?Name=='tribuzen-lab-users']"                  # → []
aws cloudformation list-stacks \
  --query "StackSummaries[?starts_with(StackName,'TribuZen-') && StackStatus!='DELETE_COMPLETE'].StackName"  # → []
```

---

## Variante J+30 (fading)

**Même projet, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. En **90 minutes**, redéploie la tranche verticale **de mémoire**, mais ajoute la **couche event-driven** vue au module 18 : active un **DynamoDB Stream** (`NEW_IMAGE`) sur `TribuZenFeed` et branche une 4ᵉ Lambda `notifyFamily` qui, à chaque nouveau message, **loggue** `"notif → <author> : <text>"` (un vrai SNS serait le prod ; ici le log CloudWatch suffit comme preuve).
2. Fais que `GET /feed` ne retourne **que les 10 derniers messages** (`Limit` + `ScanIndexForward: false`).
3. **Prouve la chaîne complète** : poste un message au curl, puis montre dans `aws logs tail` que `notifyFamily` a bien été déclenchée par le Stream — **sans polling**, uniquement par l'événement.
4. **Teardown complet de mémoire.**

**Critère de réussite :** un `POST /messages` provoque, en cascade, l'écriture DynamoDB **puis** l'apparition du log `notifyFamily` (déclenché par le Stream), et `list-tables`/`list-user-pools` renvoient `[]` après teardown.

---

## Application TribuZen

Ce lab **est** la fondation de l'infra `smaurier/tribuzen`. Tu portes la tranche verticale vers le vrai produit en la faisant grandir vers l'archi complète du module 18 :

```
tribuzen/
  infra/
    bin/tribuzen.ts
    lib/
      storage-stack.ts     ← identique au lab, mais RemovalPolicy.RETAIN + PITR + versioning S3
      auth-stack.ts        ← + fédération Google, MFA optionnel, USER_SRP_AUTH
      api-stack.ts         ← identique, + routes du feed familial (PK=FAMILY#id)
      event-stack.ts       ← Streams → notifyFamily (SNS), S3 → generateThumbnail
      frontend-stack.ts    ← S3 privé + CloudFront + OAC (module 13)
      monitoring-stack.ts  ← alarmes + dashboard (module 14)
    lambda/ ...
  .github/workflows/deploy.yml   ← OIDC → cdk deploy, staging puis prod (module 17)
  docs/adr/                      ← les 3 ADR du lab, versionnés
```

**Ce que tu portes du lab vers le produit :**
- Le **découpage en stacks par cycle de vie** (données RETAIN isolées du code DESTROY).
- Le **moindre privilège déclaratif** (`grant*`) — un rôle par Lambda, zéro `*`.
- La **sécurité par défaut** (`defaultAuthorizer`) et le **presigned S3** pour les gros objets.
- Le réflexe **valider au curl de bout en bout** avant de crier victoire, et **détruire** ce qui n'est plus utile.
- Les **ADR versionnés** : chaque choix d'archi est défendable à froid.

**Commit cible :**
```
feat(infra): tranche verticale TribuZen — Cognito + HTTP API + Lambda + DynamoDB + S3 en CDK
```
