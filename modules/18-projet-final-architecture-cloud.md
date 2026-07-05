---
titre: "Projet final — concevoir l'architecture cloud de TribuZen"
cours: 12-aws-cloud
notions: ["cahier des charges vers architecture", "choix de service par couche", "trade-offs (coût / latence / opérabilité)", "serverless vs conteneurs", "assemblage Cognito + API Gateway + Lambda + DynamoDB", "S3 + CloudFront pour le front", "messaging (SQS/SNS/EventBridge/Streams)", "observabilité (CloudWatch + X-Ray)", "sécurité (moindre privilège, KMS, Secrets Manager, WAF)", "IaC en stacks CDK découplées", "CI/CD OIDC vers AWS", "estimation de coût par service", "Well-Architected (5 piliers)", "ADR (architecture decision record)", "RemovalPolicy et cycle de vie des données"]
outcomes:
  - sait traduire un cahier des charges TribuZen en une architecture AWS complète, service par couche, avec justification
  - sait arbitrer les trade-offs (serverless vs conteneurs, on-demand vs provisioned, coût vs latence) sur des faits, pas des intuitions
  - sait découper l'infra en stacks CDK cohérentes et faire circuler les références entre elles
  - sait estimer l'ordre de grandeur du coût mensuel par service et le comparer à une archi traditionnelle
  - sait rédiger une décision d'architecture (ADR) et cocher une checklist de production readiness
prerequis: ["Modules 00-17 du cours 12-aws-cloud (IAM, VPC, S3, CDK, Lambda, API Gateway, DynamoDB, messaging, Cognito, CloudFront, observabilité, sécurité, architectures serverless, CI/CD)"]
next: 19-deployer-nuxt-next-aws
libs: []
tribuzen: "infra cloud TribuZen — architecture serverless complète de bout en bout (Cognito, API Gateway + Lambda, DynamoDB, S3 + CloudFront, messaging, observabilité, sécu), assemblée et déployée en CDK"
last-reviewed: 2026-07
---

# Projet final — concevoir l'architecture cloud de TribuZen

> **Outcomes — tu sauras FAIRE :** traduire un cahier des charges en architecture AWS complète (service par couche, avec trade-offs), arbitrer serverless vs conteneurs et on-demand vs provisioned sur des faits, découper l'infra en stacks CDK, estimer le coût mensuel, et rédiger une décision d'architecture (ADR).
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module ne t'apprend **aucune notion neuve** — il **assemble** tout ce que tu as vu aux modules 00-17. C'est un module de **conception** : on part d'un besoin produit et on descend jusqu'à une architecture déployable, en **justifiant chaque choix** (trade-off, limite de service, coût). Le **déploiement d'une app Nuxt/Next** front est le sujet du **module 19**. Ici on conçoit l'**infra backend + distribution** de TribuZen.

## 1. Cas concret d'abord

On te confie l'architecture cloud de **TribuZen** (réseau privé familial : les familles publient un **feed** de messages, uploadent des **avatars/photos**, reçoivent des **notifications**). Voici le brief, littéralement griffonné en réunion :

> « Faut que les familles se connectent (email + mot de passe, plus tard Google). Elles postent des messages dans un feed par famille, elles uploadent des photos. Quand quelqu'un poste, les autres membres reçoivent une notif. Le front est une SPA. On est 3 devs, pas d'équipe ops. Budget serré au début (quelques centaines de familles), mais ça doit tenir si ça décolle. Livrable : un schéma d'archi, les choix justifiés, une estimation de coût, et surtout **du CDK qu'on déploie**, pas des slides. »

Tu ne peux pas répondre « je mets tout sur un EC2 » ni « je colle 15 services parce que c'est joli sur le diagramme ». Chaque brique doit répondre à une **exigence** et son coût/complexité doit être **justifié**. Les questions concrètes qui t'attendent :

1. **Auth** : User Pool Cognito ou rouler ton propre service ? Quel flow ? Où sont vérifiés les JWT ?
2. **API** : REST ou HTTP API ? Un monolithe Lambda ou une fonction par route ? Comment la protéger avec Cognito ?
3. **Données** : DynamoDB ou RDS pour le feed ? Une table ou plusieurs ? Quelle clé de partition ?
4. **Fichiers** : les photos passent-elles par la Lambda (donc par l'API) ou directement vers S3 ?
5. **Notifications** : comment déclencher une notif « sans » ajouter un serveur qui tourne ?
6. **Distribution** : comment servir la SPA en HTTPS, rapide, pas cher ?
7. **Opérabilité** : 3 devs, zéro ops → tout doit être en **IaC**, observable, et **déployé par un pipeline**.
8. **Coût** : combien ça coûte à 300 familles ? à 30 000 ?

À la fin de ce module, tu sais dérouler ce brief en une architecture **serverless** cohérente, poser chaque choix sur un **fait** (limite de service, coût, trade-off), la découper en **stacks CDK**, et défendre tes décisions comme en entretien d'architecte. Le **lab est le projet final** : tu déploies réellement une version minimale mais complète de cette archi.

---

## 2. Théorie complète, concise

Concevoir une archi, ce n'est pas empiler des services : c'est une **méthode**. On part des exigences, on choisit un service **par couche** avec son trade-off, on assemble, on chiffre, on rend opérable.

### 2.1 La méthode : de l'exigence au service

Pour **chaque** fonctionnalité du brief, pose trois questions dans l'ordre :

1. **Quelle exigence non-fonctionnelle domine ?** (latence, coût, pic de charge, durabilité, conformité)
2. **Quel service AWS y répond le plus simplement ?** (le plus managé qui fait le job — pas le plus puissant)
3. **Qu'est-ce que ce choix me coûte** (prix + complexité opérationnelle) **et qu'est-ce qu'il m'interdit** (limites, couplage) ?

Le fil conducteur de TribuZen : **charge variable, petite équipe, budget qui suit l'usage** → biais **serverless** (payer à l'usage, zéro serveur à patcher). On dérogera seulement là où un fait l'impose.

### 2.2 Couche par couche — le choix et son trade-off

| Couche | Besoin TribuZen | Choix | Trade-off assumé (pourquoi, et le rival écarté) |
|--------|-----------------|-------|--------------------------------------------------|
| **Auth** | login email/mdp, plus tard Google, JWT | **Cognito User Pool** (module 11) | Managé, JWT vérifiables, MFA/fédération inclus. Rival écarté : rouler son propre auth = risque sécu + maintenance pour zéro valeur produit. |
| **API** | routes CRUD feed, protégées | **API Gateway HTTP API + Lambda** (07, 06) | HTTP API : moins cher et plus rapide que REST API, autorizer JWT Cognito natif. REST API écarté (features WAF/edge/usage-plans pas nécessaires ici). |
| **Compute** | logique métier, pics | **Lambda** (06) | Scale à zéro, paiement à l'invocation. Rival écarté : ECS/Fargate (12) — un conteneur qui tourne 24/7 est du gâchis à ce volume. On y reviendra à fort trafic constant. |
| **Données** | feed par famille, lecture par ordre chrono | **DynamoDB** (09) | Clé-valeur managé, pay-per-request, latence stable, Streams pour l'event-driven. RDS (08) écarté : pas de jointures complexes ici, on ne veut pas gérer un moteur SQL. |
| **Fichiers** | avatars/photos, gros objets | **S3** (04) + **presigned URLs** | Upload **direct** navigateur→S3 (presigned) : ne fait pas transiter les Mo par la Lambda (limite payload 6 MB, coût, latence). |
| **Traitement image** | miniature à l'upload | **Lambda déclenchée par S3** (06) | Asynchrone, découplé de l'API. Bucket source ≠ destination (anti-boucle). |
| **Notifications** | prévenir les membres à chaque post | **DynamoDB Streams → Lambda → SNS/EventBridge** (10) | Event-driven : le feed est la source de vérité, la notif est un effet de bord découplé. Pas de polling. |
| **Distribution front** | SPA HTTPS rapide | **S3 (privé) + CloudFront + OAC** (13) | CDN au edge, HTTPS via ACM, bucket **jamais** public. |
| **Sécurité périmètre** | anti-abus, WAF | **WAF sur CloudFront/API** (15) | Managed rule sets + rate-limit. Optionnel au démarrage (coût fixe), à activer avant l'ouverture publique. |
| **Secrets** | clés tierces (mailer, etc.) | **Secrets Manager / SSM** (15) | Jamais de secret en variable d'env en clair ni dans le code. |
| **Observabilité** | logs, métriques, traces, alarmes | **CloudWatch + X-Ray** (14) | Logs structurés, alarmes → SNS email, traces distribuées end-to-end. |
| **IaC** | tout reproductible | **CDK** (05) | Stacks TypeScript, `cdk deploy/diff/destroy`, revues en PR. Zéro ressource cliquée à la main. |
| **CI/CD** | déployer sans clés | **GitHub Actions + OIDC** (17) | Rôle assumé via OIDC, **aucune clé IAM long terme**, staging puis prod gated. |

Retiens le principe : **le service le plus managé qui satisfait l'exigence**, et on ne monte en complexité (conteneurs, provisioned, multi-région) que quand un **fait chiffré** l'exige.

### 2.3 Le flux de bout en bout (le chemin d'une requête)

Pour « un parent poste un message », l'architecture s'enchaîne ainsi :

```
Navigateur (SPA servie par CloudFront)
  │  1. login → Cognito User Pool → renvoie ID/access token (JWT)
  │  2. POST /messages  (Authorization: Bearer <access token>)
  ▼
API Gateway (HTTP API)
  │  3. JWT authorizer Cognito : vérifie signature (JWKS), iss, aud, exp → claims (sub, cognito:groups)
  ▼
Lambda postMessage  (role IAM moindre privilège : PutItem sur la seule table Feed)
  │  4. PutItem { PK: FAMILY#<id>, SK: TS#<horodatage>, author, text }
  ▼
DynamoDB TribuZenFeed  ── Stream (NEW_IMAGE) ──►  Lambda notifyFamily
                                                    │  5. publie sur SNS/EventBridge → notif membres
Photos : navigateur ──(presigned PUT)──► S3 tribuzen-avatars ──(ObjectCreated)──► Lambda generateThumbnail ──► S3 tribuzen-thumbnails
```

Chaque flèche est un **service vu en module**, assemblé. Point clé : la requête HTTP **synchrone** (poster) est **découplée** de ses effets **asynchrones** (notifier, vignetter) — c'est ce qui rend le système élastique et pas cher.

### 2.4 Découper l'IaC en stacks CDK

Une seule stack géante est ingérable (un `cdk deploy` risqué qui touche tout). On découpe par **rythme de changement** et par **cycle de vie de la donnée** :

| Stack | Contenu | Pourquoi séparée |
|-------|---------|------------------|
| `StorageStack` | table DynamoDB, buckets S3 (avatars, thumbnails), clé KMS | **Données** : change rarement, `RemovalPolicy.RETAIN`, ne doit jamais être détruite par erreur. |
| `AuthStack` | User Pool + App Client Cognito | Auth : cycle de vie propre, référencé par l'API. |
| `ApiStack` | HTTP API + Lambdas + authorizer | **Code** : change souvent (déploiements fréquents). |
| `EventStack` | Lambdas Stream/S3, SNS/EventBridge | Traitements asynchrones. |
| `FrontendStack` | bucket SPA + CloudFront + OAC (+ WAF) | Distribution : `RemovalPolicy.DESTROY` (rien de précieux, rebuild). |
| `MonitoringStack` | alarmes, dashboard, topic SNS d'alerte | Observabilité transverse. |

Les stacks **partagent des références** en passant les constructs (ou leurs attributs) via les props du constructeur — l'exemple 1 le montre. Règle d'or : **les données (RETAIN) vivent dans une stack qu'on ne détruit pas** ; le code (DESTROY) dans des stacks qu'on recrée sans douleur.

### 2.5 Chiffrer le coût (méthode, pas au doigt mouillé)

On estime **par service**, à partir du **volume** attendu, avec le **modèle de prix** de chaque service (paiement à l'usage sur du serverless). Ordre de grandeur pour TribuZen à **~300 familles actives** (trafic faible et sporadique) :

| Service | Volume estimé | Modèle | Coût — ordre de grandeur |
|---------|---------------|--------|--------------------------|
| Cognito | ~1 000 MAU | 10 000 MAU gratuits (tier Essentials/Lite) | **0 €** (sous le free tier) |
| Lambda | ~100 k invocations/mois | free tier 1 M req + 400 k Go-s | **~0 €** |
| API Gateway (HTTP API) | ~100 k requêtes/mois | ~1,00–1,20 $/million | **< 1 €** |
| DynamoDB (on-demand) | quelques 100 k lectures/écritures | pay-per-request + stockage | **~1–3 €** |
| S3 + CloudFront | quelques Go stockés + transfert | stockage + transfert sortant | **~1–3 €** |
| CloudWatch/X-Ray | logs + métriques + quelques traces | ingestion logs | **~2–5 €** |
| **Total** | | | **~5–15 €/mois** |

<!-- FLAG-DOC: prix unitaires AWS (API GW, DynamoDB, S3, CloudFront, CloudWatch) volatils et region-dependent — chiffrer au cas réel avec AWS Pricing Calculator (calculator.aws) avant tout engagement. Les ordres de grandeur ci-dessus sont indicatifs, région eu-west-3. -->

À **~30 000 familles** (100× le trafic), la même archi **suit** sans rien changer : Cognito bascule en payant au MAU, Lambda/DynamoDB/API scalent linéairement à l'usage → on reste dans les **dizaines à bas centaines d'euros/mois**, toujours sans serveur à opérer. **C'est ça le pari serverless** : le coût suit l'usage au lieu d'être payé d'avance. Le point de bascule vers du conteneurisé (ECS/Fargate + éventuellement RDS) n'arrive que si le trafic devient **constant et très élevé** (Lambda facturée en continu finit par coûter plus qu'un conteneur toujours chaud) — ce n'est pas le profil de TribuZen.

### 2.6 Well-Architected : la grille de relecture

Le **framework Well-Architected** d'AWS relit une archi selon **5 piliers**. C'est ta checklist de conception :

1. **Excellence opérationnelle** — tout en IaC, déploiement automatisé, observable.
2. **Sécurité** — moindre privilège par Lambda, chiffrement (KMS/S3/DynamoDB), pas de secret en clair, WAF avant l'ouverture.
3. **Fiabilité** — retries/DLQ sur l'asynchrone, PITR DynamoDB, RemovalPolicy.RETAIN sur les données.
4. **Efficience de performance** — Lambda ARM64, mémoire dimensionnée par mesure, cache CloudFront, DynamoDB on-demand.
5. **Optimisation des coûts** — serverless pay-per-use, log retention finie, pas de sur-provisionnement.

### 2.7 Décider et tracer : l'ADR

Un **ADR** (Architecture Decision Record) est une note courte qui fige **une** décision : *contexte → options → décision → conséquences*. Exemple pour TribuZen :

```
ADR-003 : Base de données du feed
Contexte  : feed par famille, lecture chronologique, pics d'écriture, petite équipe.
Options   : (A) DynamoDB on-demand  (B) RDS PostgreSQL Multi-AZ.
Décision  : DynamoDB on-demand, single-table (PK=FAMILY#id, SK=TS#horodatage).
Conséquences : pas de jointures SQL (assumé) ; scaling et coût suivent l'usage ;
               pas de moteur à patcher ; requêtes pensées d'avance via la clé.
```

L'ADR rend tes choix **défendables à froid** (en entretien, en revue) et évite de re-débattre six mois plus tard.

---

## 3. Worked examples

### Exemple 1 — Câbler Auth + API + Données en 3 stacks CDK

Objectif : montrer comment les stacks **se passent des références**. On ne redonne pas chaque construct en détail (vus aux modules 09/11/07) — on montre l'**assemblage**.

```typescript
// bin/tribuzen.ts — l'App assemble les stacks et fait circuler les références
import { App } from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';

const app = new App();
const env = { region: 'eu-west-3' }; // Paris

// 1. Données d'abord (RETAIN) — elles ne dépendent de personne
const storage = new StorageStack(app, 'TribuZen-Storage', { env });

// 2. Auth — indépendante
const auth = new AuthStack(app, 'TribuZen-Auth', { env });

// 3. API — dépend des deux : on lui PASSE la table et le user pool
new ApiStack(app, 'TribuZen-Api', {
  env,
  table: storage.feedTable,     // référence croisée entre stacks
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});
```

```typescript
// lib/api-stack.ts — assemble HTTP API + Lambda + authorizer Cognito
import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

interface ApiStackProps extends StackProps {
  table: Table;
  userPool: UserPool;
  userPoolClient: UserPoolClient;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Lambda métier — ARM64 (moins cher), X-Ray, mémoire dimensionnée par mesure
    const postMessage = new NodejsFunction(this, 'PostMessageFn', {
      entry: 'lambda/post-message.mjs',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      tracing: Tracing.ACTIVE,
      environment: { FEED_TABLE: props.table.tableName }, // injecté, jamais codé en dur
    });

    // Moindre privilège : cette Lambda n'a QUE le droit d'écrire dans cette table
    props.table.grantWriteData(postMessage);

    // Authorizer JWT Cognito : vérifie le token contre le User Pool
    const authorizer = new HttpUserPoolAuthorizer('CognitoAuth', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const api = new HttpApi(this, 'TribuZenHttpApi', {
      apiName: 'tribuzen-api',
      defaultAuthorizer: authorizer, // toutes les routes protégées par défaut
    });

    api.addRoutes({
      path: '/messages',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('PostInteg', postMessage),
    });

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
  }
}
```

**Ce que cet exemple prouve :**
- Les stacks **ne partagent pas de globales** : `ApiStack` reçoit `table` et `userPool` par ses **props**. CDK crée automatiquement les exports/imports CloudFormation nécessaires.
- Le **moindre privilège** est déclaratif : `grantWriteData` génère la policy IAM exacte — pas de `dynamodb:*`.
- La sécurité est **par défaut** : `defaultAuthorizer` protège toutes les routes ; on n'oublie pas d'en protéger une.
- Le nom de table passe par **variable d'environnement** injectée par le CDK — le code Lambda ne connaît aucun nom en dur.

### Exemple 2 — Justifier un arbitrage : upload de photo, direct S3 vs via l'API

Un dev propose : « la photo arrive dans le body de `POST /avatar`, la Lambda la met dans S3 ». Tu instruis le choix avec des **faits** :

| Critère | Via la Lambda (body) | Presigned URL (direct navigateur→S3) |
|---------|----------------------|--------------------------------------|
| Taille max | **6 MB** (limite payload API GW/Lambda synchrone) → une photo la dépasse vite | Taille S3 (jusqu'à 5 GB en single PUT) |
| Coût | on paie la Lambda + le transfert **deux fois** (in puis out) | Lambda ne fait que **signer une URL** (ms) |
| Latence | l'octet transite par la Lambda | navigateur → S3 en direct |
| Sécurité | Lambda voit le fichier | URL signée **scoppée** (bucket, clé, expiration, méthode) |

**Décision (ADR) :** presigned URL. La Lambda `getUploadUrl` reçoit le nom du fichier, génère une URL `PUT` signée valable 5 min sur `tribuzen-avatars/<userId>/<uuid>`, la renvoie ; le navigateur uploade **directement**. L'`ObjectCreated` déclenche ensuite `generateThumbnail` (asynchrone). Aucun octet de photo ne transite par l'API.

```javascript
// lambda/get-upload-url.mjs — signe une URL PUT, ne touche jamais au fichier
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client();                       // init hors handler (réutilisé)
const BUCKET = process.env.AVATAR_BUCKET;

export const handler = async (event) => {
  const userId = event.requestContext.authorizer.jwt.claims.sub; // claim Cognito
  const key = `${userId}/${randomUUID()}.jpg`;

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: 'image/jpeg' }),
    { expiresIn: 300 },                          // 5 min
  );

  return { statusCode: 200, body: JSON.stringify({ url, key }) };
};
```

Le trade-off est **tranché par un fait** (limite de 6 MB) et une **économie** (pas de double transfert) — c'est exactement le raisonnement attendu d'un architecte.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Sur-concevoir « parce que c'est propre »

Coller Step Functions, WAF, multi-région et provisioned concurrency **dès le jour 1** pour 300 familles, c'est payer de la complexité et du coût fixe pour un besoin qui n'existe pas. Le correct : **partir minimal** (Cognito + API + Lambda + DynamoDB + S3/CloudFront), et n'ajouter une brique **que** quand un fait la réclame (WAF avant ouverture publique, Step Functions quand le workflow a >3 étapes, provisioned quand la latence de cold start devient inacceptable). Une archi se **fait grandir**, elle ne naît pas maximale.

### PIÈGE #2 — Une seule stack CDK monolithique

Tout mettre dans une `MainStack` couple le cycle de vie des **données** (qu'on ne veut jamais détruire) à celui du **code** (déployé 10× par jour). Un `cdk destroy` malheureux emporte la table de prod. Le correct : **StorageStack** (`RETAIN`) séparée des stacks de code (`DESTROY`), références passées par props.

### PIÈGE #3 — Faire transiter les gros objets par la Lambda

Uploader une photo dans le body de la requête API cogne la **limite de 6 MB** (payload synchrone API GW/Lambda), double le transfert et gonfle la facture. Le correct : **presigned URL S3** (exemple 2) — le fichier va direct navigateur→S3, la Lambda ne fait que signer.

### PIÈGE #4 — Confondre `RemovalPolicy` et sauvegarde

`RemovalPolicy.RETAIN` empêche CloudFormation de **supprimer** la ressource au `destroy` — ce n'est **pas** une sauvegarde. Une donnée corrompue le reste. Le correct : `RETAIN` **plus** PITR (Point-In-Time Recovery) DynamoDB et **plus** versioning S3. Trois mécanismes distincts, complémentaires.

### PIÈGE #5 — Un seul rôle IAM « admin » partagé par toutes les Lambdas

Donner `dynamodb:*` + `s3:*` à un rôle unique réutilisé partout viole le moindre privilège : une Lambda de lecture compromise peut tout écrire/supprimer. Le correct : **un rôle par fonction**, permissions générées par les `grant*` du CDK (`grantReadData`, `grantWriteData`, `grantPut`), scopées à la ressource exacte.

### PIÈGE #6 — Choisir REST API par réflexe

REST API (API Gateway v1) est plus cher et plus lent que **HTTP API** (v2), pour des fonctionnalités (usage plans, edge-optimized, intégrations de mapping avancées) dont TribuZen n'a pas besoin. Le correct : **HTTP API** par défaut, avec authorizer JWT Cognito natif ; ne passer à REST API que si une de ses features exclusives est requise.

### PIÈGE #7 — Estimer le coût « au pif » ou oublier le transfert sortant

Le poste qui surprend n'est presque jamais le compute : c'est le **transfert de données sortant** (data egress, CloudFront) et l'**ingestion CloudWatch Logs** (rétention infinie qui s'accumule). Le correct : chiffrer avec **AWS Pricing Calculator**, poser une **log retention finie**, et surveiller le transfert. Ne jamais annoncer un coût sans l'avoir passé au calculateur.

---

## 5. Ancrage TribuZen

Ce module **est** l'infra TribuZen assemblée. Vue d'ensemble des ressources et de leur module d'origine :

| Ressource TribuZen | Service (module) | Rôle dans le produit |
|--------------------|------------------|----------------------|
| `tribuzen-users` | Cognito User Pool (11) | login des familles, JWT, MFA optionnel, fédération Google plus tard |
| `tribuzen-api` | HTTP API + authorizer JWT (07) | façade HTTP protégée du feed |
| `postMessage`, `getUploadUrl`, `getFeed` | Lambda (06) | logique métier, un rôle moindre privilège chacune |
| `TribuZenFeed` | DynamoDB (09) | feed par famille : `PK=FAMILY#id`, `SK=TS#horodatage` |
| `notifyFamily` | Lambda sur DynamoDB Streams (10) | notifie les membres à chaque nouveau message |
| `tribuzen-avatars` / `tribuzen-thumbnails` | S3 (04) | photos (upload presigned) + miniatures |
| `generateThumbnail` | Lambda sur `ObjectCreated` S3 (06) | vignette 200×200, bucket destination séparé |
| SPA + `d1234.cloudfront.net` | S3 privé + CloudFront + OAC (13) | distribution HTTPS de l'app front |
| clé KMS, Secrets Manager, WAF | sécurité (15) | chiffrement, secrets tiers, anti-abus |
| alarmes + dashboard + traces | CloudWatch + X-Ray (14) | observabilité, alerte email sur erreur |
| `StorageStack`/`AuthStack`/`ApiStack`/… | CDK (05) | tout en IaC, `cdk deploy` reproductible |
| workflow GitHub Actions OIDC | CI/CD (17) | déploiement gated staging → prod, zéro clé |

Arborescence cible dans `smaurier/tribuzen` :

```
tribuzen/
  infra/
    bin/tribuzen.ts            ← App CDK, assemble les stacks
    lib/
      storage-stack.ts         ← DynamoDB + S3 + KMS (RETAIN)
      auth-stack.ts            ← Cognito User Pool + client
      api-stack.ts             ← HTTP API + Lambdas + authorizer
      event-stack.ts           ← Lambdas Stream/S3 + SNS
      frontend-stack.ts        ← S3 SPA + CloudFront + OAC (+ WAF)
      monitoring-stack.ts      ← alarmes + dashboard
    lambda/
      post-message.mjs
      get-upload-url.mjs
      generate-thumbnail.mjs
      notify-family.mjs
  .github/workflows/deploy.yml ← OIDC → cdk deploy
  docs/adr/                    ← décisions d'architecture
```

> Ce module conçoit l'**infra**. Le **déploiement de l'app front Nuxt/Next** (SSR sur Lambda, ISR, adaptateurs) est le **module 19**. Le **lab de ce module est le projet final** : tu déploies réellement une tranche verticale de cette archi (Cognito + API + Lambda + DynamoDB + S3).

---

## 6. Points clés

1. Concevoir = **méthode** : pour chaque exigence, le **service managé le plus simple** qui la satisfait, puis on justifie coût + trade-off. On ne monte en complexité que sur un **fait chiffré**.
2. TribuZen = **serverless de bout en bout** : Cognito (auth) + API Gateway HTTP API + Lambda + DynamoDB + S3/CloudFront, messaging event-driven pour les effets de bord.
3. Le **synchrone** (poster) est **découplé** de l'**asynchrone** (notifier, vignetter) via Streams / triggers S3 — c'est ce qui rend le système élastique et pas cher.
4. **HTTP API > REST API** par défaut (moins cher, plus rapide, authorizer JWT natif) ; **presigned S3** pour les gros objets (jamais dans le body Lambda, limite 6 MB).
5. IaC **découpée en stacks** par cycle de vie : **données RETAIN** (StorageStack) isolées du **code DESTROY** — références passées par props ; un rôle IAM **par Lambda** via les `grant*`.
6. **Coût = usage** : ~5–15 €/mois à 300 familles, dizaines à bas centaines à 30 000 — chiffrer au **Pricing Calculator**, poser une log retention finie, surveiller l'egress.
7. Relire l'archi via **Well-Architected (5 piliers)** et tracer chaque choix majeur par un **ADR** (contexte / options / décision / conséquences).
8. Le point de bascule vers **conteneurs (ECS/Fargate) + RDS** n'arrive qu'à trafic **constant et élevé** — pas le profil de TribuZen au démarrage.

---

## 7. Seeds Anki

```
Quelle est la méthode pour passer d'une exigence à un choix de service AWS ?|Trois questions dans l'ordre : (1) quelle exigence non-fonctionnelle domine (latence/coût/pic/durabilité) ? (2) quel service managé y répond le plus simplement ? (3) qu'est-ce que ce choix coûte et interdit (limites, couplage) ? On ne monte en complexité que sur un fait chiffré.
Pourquoi une architecture serverless plutôt que des conteneurs pour TribuZen au démarrage ?|Charge variable + petite équipe + budget qui suit l'usage : Lambda/DynamoDB/API GW paient à l'usage et scalent à zéro. Un conteneur ECS/Fargate tourne 24/7 (gâchis à faible trafic). La bascule vers conteneurs n'arrive qu'à trafic constant et très élevé.
Pourquoi découper l'IaC en plusieurs stacks CDK plutôt qu'une seule ?|Pour séparer les cycles de vie : les données (StorageStack, RemovalPolicy.RETAIN, change rarement) ne doivent jamais être couplées au code (déployé souvent, RemovalPolicy.DESTROY). Un cdk destroy malheureux ne doit pas emporter la table de prod. Références passées par props.
Pourquoi uploader une photo via presigned URL S3 plutôt que dans le body de l'API ?|La limite de payload synchrone API Gateway/Lambda est 6 MB (une photo la dépasse), le transfert serait payé/latent deux fois. La Lambda ne fait que signer une URL PUT scopée (bucket, clé, expiration) ; le navigateur uploade direct vers S3.
RemovalPolicy.RETAIN suffit-il à protéger les données ?|Non. RETAIN empêche seulement CloudFormation de supprimer la ressource au destroy — ce n'est pas une sauvegarde. Il faut RETAIN + PITR DynamoDB + versioning S3 : trois mécanismes distincts et complémentaires.
HTTP API vs REST API sur API Gateway : lequel par défaut pour TribuZen ?|HTTP API (v2) : moins cher, plus rapide, authorizer JWT Cognito natif. REST API (v1) n'est justifié que pour ses features exclusives (usage plans, edge-optimized, mapping avancé) dont TribuZen n'a pas besoin.
Comment déclencher une notification à chaque nouveau message sans serveur qui tourne ?|Event-driven : DynamoDB Streams (NEW_IMAGE) sur la table du feed déclenche une Lambda notifyFamily qui publie sur SNS/EventBridge. Le feed reste la source de vérité ; la notif est un effet de bord découplé, pas du polling.
Qu'est-ce qu'un ADR et à quoi sert-il en architecture ?|Architecture Decision Record : note courte figeant une décision (contexte → options → décision → conséquences). Rend les choix défendables à froid (revue, entretien) et évite de re-débattre plus tard. Ex : DynamoDB on-demand plutôt que RDS pour le feed.
Quels sont les 5 piliers du framework Well-Architected ?|Excellence opérationnelle, Sécurité, Fiabilité, Efficience de performance, Optimisation des coûts. Grille de relecture d'une architecture avant mise en production.
Quel poste de coût AWS surprend le plus souvent, et comment l'éviter ?|Rarement le compute : c'est le transfert de données sortant (egress CloudFront) et l'ingestion CloudWatch Logs (rétention infinie qui s'accumule). Éviter : chiffrer au Pricing Calculator, poser une log retention finie, surveiller l'egress.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-18-projet-final/README.md` — **c'est le projet final**. Tu **conçois puis déploies réellement** en CDK une tranche verticale de l'archi TribuZen (Cognito + API Gateway + Lambda + DynamoDB + S3), tu la valides de bout en bout au **curl** (sign-up Cognito → token → appel API authentifié → écriture/lecture DynamoDB → presigned S3), puis tu **détruis tout** (`cdk destroy`). README-only, feedback coach, variante J+30.
