# Module 06 — Lambda : Serverless

> **Objectif** : Maîtriser AWS Lambda : modèle d'exécution, handlers TypeScript, intégrations avec les services AWS, gestion de la concurrence, et appliquer les bonnes pratiques serverless.
> **Difficulté** : ⭐⭐⭐
> **Prérequis** : Module 01, Module 04
> **Durée estimée** : 5 heures

---

## Table des matières

1. [Qu'est-ce que Lambda ?](#quest-ce-que-lambda)
2. [Modèle d'exécution](#modèle-dexécution)
3. [Cold start vs warm start](#cold-start-vs-warm-start)
4. [Handler, event, context](#handler-event-context)
5. [Runtimes et environnement d'exécution](#runtimes-et-environnement-dexécution)
6. [Layers](#layers)
7. [Versions et aliases](#versions-et-aliases)
8. [Concurrence](#concurrence)
9. [Intégrations principales](#intégrations-principales)
10. [TypeScript handlers avec AWS SDK v3](#typescript-handlers-avec-aws-sdk-v3)
11. [Variables d'environnement et configuration](#variables-denvironnement-et-configuration)
12. [Bonnes pratiques](#bonnes-pratiques)

---

## Qu'est-ce que Lambda ?

**AWS Lambda** est un service de calcul serverless : vous déployez du code, AWS gère l'infrastructure (serveurs, mise à l'échelle, haute disponibilité).

**Analogie** : Lambda est comme un **restaurant à la demande**. Au lieu de louer une cuisine permanente (EC2), vous n'utilisez un chef (fonction) que quand un client commande (événement). Pas de client → pas de cuisine active → pas de facture. Cent clients en même temps ? Cent cuisines s'ouvrent automatiquement.

### Caractéristiques clés

| Caractéristique | Valeur |
|-----------------|--------|
| Durée max d'exécution | 15 minutes (900 secondes) |
| Mémoire | 128 Mo à 10 240 Mo (par incréments de 1 Mo) |
| CPU | Proportionnel à la mémoire (1 769 Mo ≈ 1 vCPU) |
| Stockage éphémère (`/tmp`) | 512 Mo à 10 240 Mo |
| Taille du package (zip) | 50 Mo compressé, 250 Mo décompressé |
| Taille avec layers | 250 Mo total décompressé |
| Variables d'environnement | 4 Ko total |
| Concurrence par défaut | 1 000 par région (augmentable) |

### Tarification

Lambda facture deux composants :
- **Requêtes** : 0,20 $ par million d'invocations
- **Durée** : 0,0000166667 $ par Go-seconde

**Offre gratuite** (toujours incluse) : 1 million de requêtes + 400 000 Go-secondes par mois.

```
Exemple : 3 millions d'invocations/mois, 256 Mo, 200 ms en moyenne
  Requêtes : 3M × 0,20 $/M = 0,60 $
  Durée : 3M × 0,2s × 0,25 Go × 0,0000166667 $ = 2,50 $
  Total ≈ 3,10 $/mois
```

---

## Modèle d'exécution

### Cycle de vie d'une invocation

```
1. Événement déclenché (API Gateway, S3, SQS, etc.)
        │
2. Lambda Service reçoit l'événement
        │
3. Environnement d'exécution disponible ?
        │
   ┌────┴────┐
   │ Non     │ Oui
   │         │
   │    Réutiliser        ← WARM START (rapide)
   │    l'environnement
   │
   Créer un nouvel        ← COLD START (lent)
   environnement
   │
   ├── Télécharger le code
   ├── Démarrer le runtime
   ├── Exécuter le code d'initialisation
   │   (en dehors du handler)
   │
4. Exécuter le handler(event, context)
        │
5. Retourner la réponse
        │
6. L'environnement reste actif (~5-15 min)
   pour les prochaines invocations
```

### Ce qui se passe hors du handler (phase INIT)

```typescript
// ──── Phase INIT (exécutée une seule fois par cold start) ────
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

// Ces clients sont créés UNE SEULE FOIS et réutilisés
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.TABLE_NAME!;

// ──── Phase INVOKE (exécutée à chaque invocation) ────
export async function handler(event: unknown) {
  // Utilise le client déjà initialisé (warm)
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { id: '123' },
  }));
  return result.Item;
}
```

---

## Cold start vs warm start

### Comprendre le cold start

Un **cold start** se produit quand Lambda doit créer un nouvel environnement d'exécution. Il ajoute de la latence à la première invocation.

### Durées typiques

| Runtime | Cold start typique | Warm start |
|---------|-------------------|------------|
| Node.js / TypeScript | 100-500 ms | < 5 ms |
| Python | 100-500 ms | < 5 ms |
| Go | 50-200 ms | < 1 ms |
| Java | 500 ms – 5 s | < 5 ms |
| .NET | 300 ms – 2 s | < 5 ms |

### Facteurs qui augmentent le cold start

| Facteur | Impact | Solution |
|---------|--------|----------|
| Taille du package | ++ | Bundle minifié, tree shaking |
| VPC | +++ (avant 2019) / + (maintenant) | Hyperplane ENI (automatique) |
| Mémoire allouée | + (plus de mémoire = init plus rapide) | Augmenter la mémoire |
| Runtime | ++ (Java, .NET lents) | Node.js/Go, ou SnapStart (Java) |
| SDK imports | ++ | N'importer que les clients nécessaires |

### Réduire le cold start

```typescript
// ❌ Import du SDK complet (lourd)
import AWS from 'aws-sdk';

// ✅ Import modulaire (AWS SDK v3)
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
```

```bash
# Augmenter la mémoire (accélère aussi le CPU et l'init)
aws lambda update-function-configuration \
  --function-name ma-fonction \
  --memory-size 1769  # ≈ 1 vCPU complet
```

---

## Handler, event, context

### Structure du handler

```typescript
import { Context } from 'aws-lambda';

// Le handler est le point d'entrée de votre fonction
export async function handler(
  event: EventType,    // Les données de l'événement déclencheur
  context: Context     // Métadonnées sur l'invocation
): Promise<ResponseType> {
  // Votre logique ici
  return response;
}
```

### L'objet `event`

Le format de `event` dépend du **déclencheur** :

| Déclencheur | Type TypeScript | Contenu principal |
|-------------|----------------|-------------------|
| API Gateway | `APIGatewayProxyEvent` | method, path, headers, body |
| S3 | `S3Event` | bucket, key, size, eventName |
| SQS | `SQSEvent` | records[].body, messageId |
| DynamoDB Streams | `DynamoDBStreamEvent` | records[].dynamodb (NewImage, OldImage) |
| Scheduled (EventBridge) | `ScheduledEvent` | time, detail-type |
| SNS | `SNSEvent` | records[].Sns.Message |

### L'objet `context`

```typescript
export async function handler(event: unknown, context: Context) {
  console.log('Function name:', context.functionName);
  console.log('Function version:', context.functionVersion);
  console.log('Request ID:', context.awsRequestId);
  console.log('Temps restant:', context.getRemainingTimeInMillis(), 'ms');
  console.log('Mémoire allouée:', context.memoryLimitInMB, 'Mo');
  console.log('Log group:', context.logGroupName);
  console.log('Log stream:', context.logStreamName);
}
```

### Callback vs async/await

```typescript
// ✅ Recommandé : async/await
export async function handler(event: unknown) {
  const result = await doWork();
  return { statusCode: 200, body: JSON.stringify(result) };
}

// ❌ Ancien style : callback (à éviter)
export function handler(event: unknown, context: Context, callback: Function) {
  doWork()
    .then(result => callback(null, result))
    .catch(err => callback(err));
}
```

---

## Runtimes et environnement d'exécution

### Runtimes managés

| Runtime | Identifiant | Statut |
|---------|------------|--------|
| Node.js 22 | `nodejs22.x` | Actif |
| Node.js 20 | `nodejs20.x` | Actif |
| Python 3.13 | `python3.13` | Actif |
| Java 21 | `java21` | Actif |
| .NET 8 | `dotnet8` | Actif |
| Go | `provided.al2023` | Via custom runtime |
| Rust | `provided.al2023` | Via custom runtime |

### Runtime pour TypeScript

Lambda ne supporte pas TypeScript nativement. Deux approches :

#### 1. Bundle avec esbuild (recommandé)

```bash
# Installer esbuild
npm install -D esbuild

# Build le handler
npx esbuild src/handler.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile=dist/handler.js \
  --minify \
  --sourcemap \
  --external:@aws-sdk/*  # Déjà disponible dans le runtime Lambda
```

#### 2. AWS CDK avec NodejsFunction

```typescript
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

new NodejsFunction(this, 'MyFunction', {
  entry: 'src/handler.ts',  // CDK bundle automatiquement avec esbuild
  handler: 'handler',
  runtime: Runtime.NODEJS_20_X,
  memorySize: 512,
  timeout: Duration.seconds(30),
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ['@aws-sdk/*'],
  },
});
```

### Système de fichiers de l'environnement

```
/var/task/         ← Votre code (lecture seule)
/var/runtime/      ← Runtime Lambda
/tmp/              ← Stockage éphémère (512 Mo – 10 Go, persistant entre invocations warm)
/opt/              ← Layers
```

---

## Layers

Un **Layer** est un package réutilisable (bibliothèques, runtime custom, données) qui se superpose à votre fonction.

### Cas d'usage

- Bibliothèques partagées entre plusieurs fonctions
- Runtime personnalisé
- Données de référence (modèles ML, certificats)

### Création

```bash
# Structure du layer
mkdir -p layer/nodejs
cd layer/nodejs
npm init -y
npm install sharp   # Exemple : bibliothèque de traitement d'image

# Packager le layer
cd ..
zip -r sharp-layer.zip nodejs/

# Publier le layer
aws lambda publish-layer-version \
  --layer-name sharp-image-processing \
  --description "Sharp v0.33 pour le traitement d'images" \
  --zip-file fileb://sharp-layer.zip \
  --compatible-runtimes nodejs20.x nodejs22.x \
  --compatible-architectures x86_64 arm64
```

### Utilisation

```bash
# Attacher un layer à une fonction
aws lambda update-function-configuration \
  --function-name ma-fonction \
  --layers arn:aws:lambda:eu-west-3:123456789012:layer:sharp-image-processing:1
```

### Limites

- Maximum **5 layers** par fonction
- Taille totale décompressée (code + layers) : **250 Mo**
- Les layers sont extraits dans `/opt/`

---

## Versions et aliases

### Versions

Une **version** est un snapshot immuable de votre code + configuration.

```bash
# Publier une version
aws lambda publish-version \
  --function-name ma-fonction \
  --description "v1.2.0 - ajout validation email"

# $LATEST est toujours la version mutable (en développement)
# Les versions publiées (1, 2, 3...) sont immuables
```

### Aliases

Un **alias** est un pointeur nommé vers une version. Idéal pour le déploiement progressif.

```bash
# Créer un alias "prod" pointant vers la version 3
aws lambda create-alias \
  --function-name ma-fonction \
  --name prod \
  --function-version 3

# Déploiement canary : 90% version 3, 10% version 4
aws lambda update-alias \
  --function-name ma-fonction \
  --name prod \
  --function-version 4 \
  --routing-config '{"AdditionalVersionWeights": {"3": 0.9}}'
```

### Flux de déploiement

```
$LATEST (dev) → publish → Version 4 → alias "staging"
                                     → alias "prod" (canary 10% v4, 90% v3)
                                     → validation OK → alias "prod" (100% v4)
```

---

## Concurrence

### Types de concurrence

| Type | Description | Coût |
|------|------------|------|
| **Non réservée** | Pool partagé (1 000 par région par défaut) | Inclus |
| **Réservée** | Garantit N instances pour cette fonction | Inclus |
| **Provisionnée** | N instances pré-chauffées (pas de cold start) | Supplément |

### Concurrence réservée

Réserve une partie du pool pour une fonction critique (les autres fonctions ne peuvent pas l'utiliser) :

```bash
# Réserver 100 instances concurrentes
aws lambda put-function-concurrency \
  --function-name ma-fonction-critique \
  --reserved-concurrent-executions 100
```

**Attention** : la concurrence réservée réduit le pool disponible pour les autres fonctions.

### Concurrence provisionnée

Pré-chauffe des environnements pour éliminer les cold starts :

```bash
# Provisionner 50 instances warm sur l'alias prod
aws lambda put-provisioned-concurrency-config \
  --function-name ma-fonction \
  --qualifier prod \
  --provisioned-concurrent-executions 50
```

### Auto Scaling de la concurrence provisionnée

```bash
# Créer une cible Application Auto Scaling
aws application-autoscaling register-scalable-target \
  --service-namespace lambda \
  --resource-id "function:ma-fonction:prod" \
  --scalable-dimension "lambda:function:ProvisionedConcurrency" \
  --min-capacity 10 \
  --max-capacity 100

# Target tracking : maintenir 70% d'utilisation
aws application-autoscaling put-scaling-policy \
  --service-namespace lambda \
  --resource-id "function:ma-fonction:prod" \
  --scalable-dimension "lambda:function:ProvisionedConcurrency" \
  --policy-name "concurrency-utilization-70" \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "LambdaProvisionedConcurrencyUtilization"
    },
    "TargetValue": 0.7
  }'
```

### Throttling

Quand la concurrence maximale est atteinte, Lambda renvoie une erreur **429 TooManyRequestsException** (invocation synchrone) ou **réessaie** automatiquement (invocation asynchrone).

---

## Intégrations principales

### API Gateway → Lambda

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const { httpMethod, path, pathParameters, queryStringParameters, body } = event;

  if (httpMethod === 'GET' && path === '/users') {
    const users = await fetchUsers();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(users),
    };
  }

  if (httpMethod === 'POST' && path === '/users') {
    const userData = JSON.parse(body ?? '{}');
    const newUser = await createUser(userData);
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    };
  }

  return { statusCode: 404, body: 'Not Found' };
}
```

### S3 → Lambda

```typescript
import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export async function handler(event: S3Event) {
  for (const record of event.Records) {
    const srcBucket = record.s3.bucket.name;
    const srcKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    console.log(`Traitement : s3://${srcBucket}/${srcKey}`);

    // Lire l'objet source
    const { Body, ContentType } = await s3.send(new GetObjectCommand({
      Bucket: srcBucket,
      Key: srcKey,
    }));

    // Traiter (ex: générer une miniature)
    const processed = await processImage(Body);

    // Écrire le résultat
    await s3.send(new PutObjectCommand({
      Bucket: srcBucket,
      Key: `thumbnails/${srcKey}`,
      Body: processed,
      ContentType,
    }));
  }
}
```

### DynamoDB Streams → Lambda

```typescript
import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

export async function handler(event: DynamoDBStreamEvent) {
  for (const record of event.Records) {
    const eventName = record.eventName; // INSERT, MODIFY, REMOVE

    if (eventName === 'INSERT' || eventName === 'MODIFY') {
      const newImage = unmarshall(
        record.dynamodb!.NewImage as Record<string, AttributeValue>
      );
      console.log(`${eventName} :`, newImage);

      if (eventName === 'MODIFY') {
        const oldImage = unmarshall(
          record.dynamodb!.OldImage as Record<string, AttributeValue>
        );
        console.log('Ancienne valeur :', oldImage);
      }
    }

    if (eventName === 'REMOVE') {
      const deletedItem = unmarshall(
        record.dynamodb!.OldImage as Record<string, AttributeValue>
      );
      console.log('Supprimé :', deletedItem);
    }
  }
}
```

### SQS → Lambda

```typescript
import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      console.log(`Traitement message ${record.messageId} :`, message);

      await processMessage(message);
    } catch (error) {
      console.error(`Erreur message ${record.messageId} :`, error);
      // Partial batch failure : seul ce message sera réessayé
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
```

**Important** : activez le **Report Batch Item Failures** pour que seuls les messages en erreur soient réessayés (pas tout le batch).

### Scheduled (EventBridge) → Lambda

```typescript
import { ScheduledEvent } from 'aws-lambda';

export async function handler(event: ScheduledEvent) {
  console.log(`Exécution planifiée à ${event.time}`);

  // Nettoyage quotidien, rapport, etc.
  await generateDailyReport();
  await cleanupExpiredSessions();
}
```

```bash
# Créer une règle EventBridge (cron tous les jours à 2h UTC)
aws events put-rule \
  --name daily-cleanup \
  --schedule-expression "cron(0 2 * * ? *)"

aws events put-targets \
  --rule daily-cleanup \
  --targets "Id=cleanup-lambda,Arn=arn:aws:lambda:eu-west-3:123456789012:function:cleanup"
```

---

## TypeScript handlers avec AWS SDK v3

### Pattern complet : API CRUD

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

// Phase INIT — exécutée une seule fois
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME!;

// Helper pour les réponses HTTP
function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const { httpMethod, pathParameters, body } = event;
    const id = pathParameters?.id;

    // GET /items
    if (httpMethod === 'GET' && !id) {
      const result = await docClient.send(new ScanCommand({ TableName: TABLE }));
      return jsonResponse(200, result.Items);
    }

    // GET /items/:id
    if (httpMethod === 'GET' && id) {
      const result = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { id },
      }));
      if (!result.Item) return jsonResponse(404, { error: 'Not found' });
      return jsonResponse(200, result.Item);
    }

    // POST /items
    if (httpMethod === 'POST') {
      const data = JSON.parse(body ?? '{}');
      const item = { id: randomUUID(), ...data, createdAt: new Date().toISOString() };
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
      return jsonResponse(201, item);
    }

    // DELETE /items/:id
    if (httpMethod === 'DELETE' && id) {
      await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
      return jsonResponse(204, null);
    }

    return jsonResponse(400, { error: 'Unsupported operation' });
  } catch (error) {
    console.error('Handler error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
}
```

---

## Variables d'environnement et configuration

### Variables d'environnement

```bash
# Configurer les variables
aws lambda update-function-configuration \
  --function-name ma-fonction \
  --environment '{
    "Variables": {
      "TABLE_NAME": "users-production",
      "LOG_LEVEL": "info",
      "REGION": "eu-west-3",
      "STAGE": "production"
    }
  }'
```

### Variables réservées par Lambda

| Variable | Description |
|----------|------------|
| `AWS_REGION` | Région d'exécution |
| `AWS_LAMBDA_FUNCTION_NAME` | Nom de la fonction |
| `AWS_LAMBDA_FUNCTION_VERSION` | Version en cours |
| `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` | Mémoire allouée (Mo) |
| `AWS_LAMBDA_LOG_GROUP_NAME` | Groupe CloudWatch Logs |
| `_HANDLER` | Point d'entrée (ex: `handler.handler`) |

### Secrets avec SSM Parameter Store ou Secrets Manager

```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

// Charger le secret au démarrage (phase INIT)
let dbPassword: string;

async function getSecret(): Promise<string> {
  if (dbPassword) return dbPassword;

  const response = await ssm.send(new GetParameterCommand({
    Name: '/prod/database/password',
    WithDecryption: true,
  }));

  dbPassword = response.Parameter!.Value!;
  return dbPassword;
}

export async function handler(event: unknown) {
  const password = await getSecret(); // Cached après le 1er appel
  // ...
}
```

---

## Bonnes pratiques

### 1. Taille du bundle

```bash
# ❌ Package de 50 Mo avec tout node_modules
zip -r function.zip .

# ✅ Bundle minifié avec esbuild (~500 Ko)
npx esbuild src/handler.ts \
  --bundle --minify --platform=node --target=node20 \
  --external:@aws-sdk/* \
  --outfile=dist/handler.js

cd dist && zip function.zip handler.js
```

**Exclure `@aws-sdk/*`** : il est déjà disponible dans le runtime Lambda Node.js. L'exclure réduit la taille du bundle de 80%.

### 2. Timeout et mémoire

```bash
# Règle : timeout = 3× le temps moyen d'exécution
# Si votre fonction prend 2s en moyenne → timeout de 6s

aws lambda update-function-configuration \
  --function-name ma-fonction \
  --timeout 10 \
  --memory-size 512
```

| Scénario | Mémoire recommandée | Timeout |
|----------|-------------------|---------|
| API simple (DynamoDB) | 256 Mo | 10 s |
| Traitement d'image | 1 024 Mo | 30 s |
| Traitement de données | 2 048 Mo | 60 s |
| ETL lourd | 4 096 – 10 240 Mo | 300 s |

### 3. Initialisation des clients

```typescript
// ✅ Client initialisé en dehors du handler (réutilisé entre invocations)
const s3 = new S3Client({});

export async function handler(event: unknown) {
  await s3.send(new GetObjectCommand({ /* ... */ }));
}

// ❌ Client recréé à chaque invocation (lent)
export async function handler(event: unknown) {
  const s3 = new S3Client({});  // Nouveau client à chaque fois !
  await s3.send(new GetObjectCommand({ /* ... */ }));
}
```

### 4. Gestion des erreurs

```typescript
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'ERROR',
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
```

### 5. Structured logging

```typescript
function log(level: string, message: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

export async function handler(event: APIGatewayProxyEvent) {
  log('INFO', 'Requête reçue', {
    method: event.httpMethod,
    path: event.path,
    requestId: event.requestContext.requestId,
  });

  // ...

  log('INFO', 'Réponse envoyée', { statusCode: 200, duration: elapsed });
}
```

### 6. Power Tuning

Utilisez **AWS Lambda Power Tuning** (outil open-source) pour trouver le ratio mémoire/coût optimal :

```
128 Mo  → 2 000 ms → 0,004 $ par invocation
256 Mo  → 1 000 ms → 0,004 $ (même coût, 2× plus rapide)
512 Mo  →   500 ms → 0,004 $ (même coût, 4× plus rapide !)
1024 Mo →   480 ms → 0,008 $ (plus cher, pas beaucoup plus rapide)

→ Optimal : 512 Mo
```

### Checklist complète

1. **Performance**
   - [ ] Bundle minifié avec esbuild, `@aws-sdk/*` externe
   - [ ] Clients SDK initialisés hors du handler
   - [ ] Mémoire optimisée avec Power Tuning
   - [ ] Concurrence provisionnée pour les API latence-sensibles

2. **Sécurité**
   - [ ] Rôle IAM avec moindre privilège
   - [ ] Secrets dans SSM/Secrets Manager (pas en variables d'environnement)
   - [ ] VPC uniquement si nécessaire (accès RDS, ElastiCache)
   - [ ] Variables d'environnement chiffrées avec KMS

3. **Fiabilité**
   - [ ] Dead Letter Queue (DLQ) pour les invocations asynchrones
   - [ ] Partial batch failure pour SQS
   - [ ] Timeouts adaptés (3× le temps moyen)
   - [ ] Retry avec backoff exponentiel pour les appels externes

4. **Coûts**
   - [ ] Offre gratuite (1M requêtes/mois)
   - [ ] ARM64 (Graviton) : 20% moins cher, 34% plus rapide
   - [ ] Supprimer les fonctions et versions inutilisées

```bash
# Utiliser l'architecture ARM64 (Graviton)
aws lambda create-function \
  --function-name ma-fonction \
  --runtime nodejs20.x \
  --architectures arm64 \
  --handler handler.handler \
  --role arn:aws:iam::123456789012:role/lambda-role \
  --zip-file fileb://function.zip
```

---

## Résumé du module

| Concept | Points clés |
|---------|-------------|
| Modèle | Événement → Handler → Réponse, paiement à l'usage |
| Cold start | 100-500 ms (Node.js), réductible avec bundle, mémoire, provisioned |
| Handler | `async handler(event, context)`, event varie selon le déclencheur |
| Layers | Bibliothèques partagées, max 5, total 250 Mo |
| Versions/Aliases | Versions immuables, alias pour déploiement canary |
| Concurrence | Réservée (garantie), provisionnée (warm, payant) |
| Intégrations | API GW, S3, DynamoDB Streams, SQS, EventBridge |
| TypeScript | Bundle esbuild, SDK v3 modulaire, `@aws-sdk/*` externe |

---

## Pour aller plus loin

- [Lambda Developer Guide (AWS)](https://docs.aws.amazon.com/lambda/latest/dg/)
- [Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
- [Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning)
- [Serverless Land — Patterns](https://serverlessland.com/patterns)
- [Lambda Powertools TypeScript](https://docs.powertools.aws.dev/lambda/typescript/latest/)
