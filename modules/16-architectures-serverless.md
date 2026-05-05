# 16 — Architectures Serverless Avancees

> **Duree estimee** : 5h00
> **Difficulte** : 4/5
> **Prerequis** : Module 05 (Lambda), Module 07 (DynamoDB), Module 08 (SQS/SNS/EventBridge)
> **Objectifs** :
> - Maitriser **Step Functions** (machine a etats, types d'etats)
> - Implementer des patterns **event-driven** (CQRS, Saga)
> - Construire des APIs temps reel avec **WebSocket API**
> - Decouvrir **AppSync** pour les APIs GraphQL
> - Optimiser les **couts** des architectures serverless

---

## Step Functions

### Pourquoi un orchestrateur ?

Quand une operation metier implique plusieurs etapes, les enchainer dans une seule Lambda devient vite complexe :

```typescript
// Anti-pattern : Lambda monolithique
export async function handler() {
  const order = await validateOrder();     // etape 1
  const payment = await processPayment();  // etape 2
  await updateInventory();                 // etape 3
  await sendConfirmation();                // etape 4
  // Que faire si l'etape 3 echoue ?
  // Comment reprendre apres une panne ?
  // Comment gerer les timeouts ?
}
```

**Step Functions** est un orchestrateur visuel qui gere :
- L'**enchainement** des etapes
- Les **erreurs** et les **retries**
- Les **branches conditionnelles**
- Le **parallelisme**
- L'**etat** entre les etapes (pas besoin de base de donnees intermediaire)

### Machine a etats

Une **state machine** (machine a etats) definit un workflow sous forme de JSON (Amazon States Language) :

```json
{
  "Comment": "Traitement de commande",
  "StartAt": "ValidateOrder",
  "States": {
    "ValidateOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:eu-west-1:123:function:validate-order",
      "Next": "ProcessPayment",
      "Catch": [
        {
          "ErrorEquals": ["ValidationError"],
          "Next": "OrderFailed"
        }
      ]
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:eu-west-1:123:function:process-payment",
      "Retry": [
        {
          "ErrorEquals": ["PaymentTimeout"],
          "IntervalSeconds": 5,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        }
      ],
      "Next": "OrderSuccess"
    },
    "OrderSuccess": {
      "Type": "Succeed"
    },
    "OrderFailed": {
      "Type": "Fail",
      "Error": "OrderProcessingFailed",
      "Cause": "La commande n'a pas pu etre traitee"
    }
  }
}
```

### Types d'etats

| Type | Description | Cas d'usage |
|------|-------------|-------------|
| **Task** | Execute une action (Lambda, API AWS, HTTP) | Appeler une fonction, ecrire en DynamoDB |
| **Choice** | Branche conditionnelle (if/else) | Router selon le montant, le pays... |
| **Parallel** | Execute plusieurs branches en parallele | Envoyer email ET SMS en meme temps |
| **Map** | Itere sur une liste (forEach) | Traiter chaque item d'une commande |
| **Wait** | Pause pendant une duree ou jusqu'a une date | Attendre 24h avant un rappel |
| **Pass** | Transforme les donnees (sans action) | Reformater le JSON entre deux etapes |
| **Succeed** | Termine avec succes | Fin du workflow |
| **Fail** | Termine en erreur | Echec definitif |

### Etat Choice — branchement conditionnel

```json
{
  "Type": "Choice",
  "Choices": [
    {
      "Variable": "$.orderTotal",
      "NumericGreaterThan": 1000,
      "Next": "RequireApproval"
    },
    {
      "Variable": "$.customerType",
      "StringEquals": "VIP",
      "Next": "PriorityProcessing"
    }
  ],
  "Default": "StandardProcessing"
}
```

### Etat Parallel — execution simultanee

```json
{
  "Type": "Parallel",
  "Branches": [
    {
      "StartAt": "SendEmail",
      "States": {
        "SendEmail": {
          "Type": "Task",
          "Resource": "arn:aws:lambda:...:send-email",
          "End": true
        }
      }
    },
    {
      "StartAt": "SendSMS",
      "States": {
        "SendSMS": {
          "Type": "Task",
          "Resource": "arn:aws:lambda:...:send-sms",
          "End": true
        }
      }
    }
  ],
  "Next": "AllNotificationsSent"
}
```

Le resultat est un tableau avec les sorties de chaque branche.

### Etat Map — iteration

```json
{
  "Type": "Map",
  "ItemsPath": "$.orderItems",
  "MaxConcurrency": 10,
  "ItemProcessor": {
    "ProcessorConfig": {
      "Mode": "INLINE"
    },
    "StartAt": "ProcessItem",
    "States": {
      "ProcessItem": {
        "Type": "Task",
        "Resource": "arn:aws:lambda:...:process-item",
        "End": true
      }
    }
  },
  "Next": "OrderComplete"
}
```

### Standard vs Express

| Critere | Standard | Express |
|---------|----------|---------|
| **Duree max** | 1 an | 5 minutes |
| **Execution** | Exactement une fois | Au moins une fois |
| **Prix** | Par transition d'etat | Par execution + duree |
| **Historique** | Complet (console) | CloudWatch Logs |
| **Cas d'usage** | Workflows longs (commandes, approbations) | Traitement haute frequence (IoT, streaming) |

### Parametres de depart recommandes

Pour eviter les configurations arbitraires, voici une base simple a appliquer puis ajuster avec la production :

| Sujet | Point de depart |
|---|---|
| Retry Task Step Functions | `MaxAttempts: 3`, `IntervalSeconds: 2`, `BackoffRate: 2.0` |
| Timeout d'une Lambda metier | 10-30 s (eviter 120+ s par defaut) |
| DLQ / destination d'echec async | Activee systematiquement |
| Correlation ID | Propage de l'entree API jusqu'aux events |
| Alarme erreurs | seuil initial a 1% sur 5 min |

L'idee n'est pas d'etre parfait du premier coup, mais d'avoir une baseline mesurable et defendable.

---

## Step Functions + Lambda + DynamoDB

### Pattern courant : workflow CRUD

```
API Gateway → Step Functions → Lambda (validate) → DynamoDB (write)
                                    ↓
                              Lambda (notify) → SNS
                                    ↓
                              Lambda (audit) → CloudWatch
```

### Integration directe (SDK Integration)

Step Functions peut appeler des services AWS **directement**, sans Lambda intermediaire :

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::dynamodb:putItem",
  "Parameters": {
    "TableName": "Orders",
    "Item": {
      "orderId": { "S.$": "$.orderId" },
      "status": { "S": "CREATED" },
      "createdAt": { "S.$": "$$.State.EnteredTime" }
    }
  },
  "Next": "SendNotification"
}
```

Services integrables directement :
- **DynamoDB** : GetItem, PutItem, UpdateItem, DeleteItem, Query
- **SQS** : SendMessage
- **SNS** : Publish
- **EventBridge** : PutEvents
- **ECS** : RunTask
- **Lambda** : Invoke
- **HTTP** : Appels API externes

---

## Patterns Event-Driven

### CQRS avec DynamoDB Streams

**CQRS** (Command Query Responsibility Segregation) separe les operations d'ecriture (commands) et de lecture (queries) :

```
Ecriture (Command) :
  API POST /orders → Lambda → DynamoDB (table Orders)
                                    ↓
                              DynamoDB Streams
                                    ↓
                              Lambda (projector)
                                    ↓
                    DynamoDB (table OrdersByCustomer)  ← vue optimisee
                    DynamoDB (table OrdersByDate)      ← vue optimisee
                    ElastiCache (cache)                ← vue optimisee

Lecture (Query) :
  API GET /customers/:id/orders → Lambda → DynamoDB (OrdersByCustomer)
  API GET /orders/today → Lambda → DynamoDB (OrdersByDate)
```

**Avantages** :
- Les lectures sont **ultra-rapides** (vues pre-calculees)
- Les ecritures ne sont pas ralenties par des index complexes
- Chaque vue est optimisee pour un **pattern d'acces** specifique

### Pattern Saga

Le **Saga pattern** gere les transactions distribuees quand plusieurs services doivent rester coherents :

```
Commande e-commerce :
  1. Reserver le stock      (Inventaire)
  2. Debiter le paiement    (Paiement)
  3. Creer l'expedition     (Expedition)

Si l'etape 3 echoue :
  3c. Annuler l'expedition  (compensation)
  2c. Rembourser le client  (compensation)
  1c. Liberer le stock      (compensation)
```

Implementation avec Step Functions :

```json
{
  "StartAt": "ReserveStock",
  "States": {
    "ReserveStock": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:reserve-stock",
      "Next": "ProcessPayment",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "SagaFailed" }]
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:process-payment",
      "Next": "CreateShipment",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "CompensateStock" }]
    },
    "CreateShipment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:create-shipment",
      "Next": "OrderComplete",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "CompensatePayment" }]
    },
    "CompensatePayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:refund-payment",
      "Next": "CompensateStock"
    },
    "CompensateStock": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:release-stock",
      "Next": "SagaFailed"
    },
    "OrderComplete": { "Type": "Succeed" },
    "SagaFailed": { "Type": "Fail", "Error": "SagaFailed" }
  }
}
```

### API Composition

L'**API Composition** pattern agrege les donnees de plusieurs microservices pour repondre a une seule requete :

```
Client : GET /dashboard
       ↓
Lambda (composer) :
  ├── appel parallele → Service Utilisateur → profil
  ├── appel parallele → Service Commandes   → dernieres commandes
  └── appel parallele → Service Analytics   → statistiques
       ↓
  Agrement les resultats → reponse unifiee au client
```

Avec Step Functions (Parallel) :

```json
{
  "Type": "Parallel",
  "Branches": [
    { "StartAt": "GetProfile", "States": { "GetProfile": { "Type": "Task", "Resource": "...:get-profile", "End": true } } },
    { "StartAt": "GetOrders", "States": { "GetOrders": { "Type": "Task", "Resource": "...:get-orders", "End": true } } },
    { "StartAt": "GetStats", "States": { "GetStats": { "Type": "Task", "Resource": "...:get-stats", "End": true } } }
  ],
  "Next": "MergeResults"
}
```

---

## WebSocket API

### APIs temps reel

L'API REST classique est **request-response** : le client envoie une requete et attend une reponse. Mais certains cas necessitent une communication **bidirectionnelle** en temps reel :
- Chat en direct
- Notifications push
- Tableaux de bord en temps reel
- Jeux multijoueurs

### WebSocket API avec API Gateway

```
Client ←──WebSocket──→ API Gateway WebSocket
                              ↓
                    Routes :
                      $connect    → Lambda (connexion)
                      $disconnect → Lambda (deconnexion)
                      $default    → Lambda (messages non routes)
                      sendMessage → Lambda (envoyer un message)
```

### Gestion des connexions

```typescript
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient, PutItemCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({});

// $connect : stocker la connexion
export async function connectHandler(event: any) {
  const connectionId = event.requestContext.connectionId;
  await dynamodb.send(new PutItemCommand({
    TableName: 'WebSocketConnections',
    Item: {
      connectionId: { S: connectionId },
      connectedAt: { S: new Date().toISOString() }
    }
  }));
  return { statusCode: 200 };
}

// $disconnect : supprimer la connexion
export async function disconnectHandler(event: any) {
  const connectionId = event.requestContext.connectionId;
  await dynamodb.send(new DeleteItemCommand({
    TableName: 'WebSocketConnections',
    Key: { connectionId: { S: connectionId } }
  }));
  return { statusCode: 200 };
}

// sendMessage : broadcaster a tous les connectes
export async function sendMessageHandler(event: any) {
  const body = JSON.parse(event.body);
  const { connectionId: senderId } = event.requestContext;

  // Recuperer toutes les connexions
  const connections = await dynamodb.send(new ScanCommand({
    TableName: 'WebSocketConnections'
  }));

  const api = new ApiGatewayManagementApiClient({
    endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
  });

  // Envoyer a chaque connexion
  for (const conn of connections.Items || []) {
    try {
      await api.send(new PostToConnectionCommand({
        ConnectionId: conn.connectionId.S!,
        Data: JSON.stringify({
          from: senderId,
          message: body.message
        })
      }));
    } catch (e: any) {
      if (e.statusCode === 410) {
        // Connexion fermee, nettoyer
        await dynamodb.send(new DeleteItemCommand({
          TableName: 'WebSocketConnections',
          Key: { connectionId: conn.connectionId }
        }));
      }
    }
  }

  return { statusCode: 200 };
}
```

---

## AppSync — GraphQL

### Pourquoi GraphQL ?

REST a des limites pour les applications complexes :
- **Over-fetching** : GET `/users/123` retourne tous les champs meme si on veut juste le nom
- **Under-fetching** : il faut 3 appels pour avoir user + commandes + adresses
- **N+1** : obtenir une liste de commandes puis les details de chaque produit

**GraphQL** resout ces problemes avec un seul endpoint et des requetes flexibles.

### AppSync

**AppSync** est le service manage AWS pour GraphQL :

```
Client → AppSync (GraphQL endpoint)
              ↓
         Resolvers :
           Query.getUser → DynamoDB
           Query.listOrders → Lambda
           Mutation.createOrder → Lambda + DynamoDB
           Subscription.onNewOrder → WebSocket temps reel
```

### Schema exemple

```graphql
type User {
  id: ID!
  name: String!
  email: String!
  orders: [Order!]!
}

type Order {
  id: ID!
  total: Float!
  status: OrderStatus!
  items: [OrderItem!]!
  createdAt: String!
}

enum OrderStatus {
  PENDING
  PROCESSING
  SHIPPED
  DELIVERED
}

type Query {
  getUser(id: ID!): User
  listOrders(userId: ID!, limit: Int): [Order!]!
}

type Mutation {
  createOrder(input: CreateOrderInput!): Order!
}

type Subscription {
  onNewOrder(userId: ID!): Order
    @aws_subscribe(mutations: ["createOrder"])
}
```

### Sources de donnees

AppSync peut se connecter a :
- **DynamoDB** (resolvers directs via VTL ou JavaScript)
- **Lambda** (logique custom)
- **RDS** (via Data API)
- **HTTP** (APIs externes)
- **OpenSearch** (recherche)
- **EventBridge** (evenements)

### Avantages d'AppSync

| Avantage | Description |
|----------|-------------|
| **Subscriptions** | Temps reel natif via WebSocket |
| **Caching** | Cache integre au niveau du resolver |
| **Offline** | Sync offline avec Amplify DataStore |
| **Auth** | Cognito, IAM, API Key, OIDC |
| **Batching** | Resolution N+1 optimisee |

---

## Optimisation des couts serverless

### Lambda

| Optimisation | Economie |
|-------------|----------|
| **Memoire** | Trouver le sweet spot (256-512 Mo souvent optimal) |
| **Architecture ARM** | 20% moins cher que x86 |
| **Provisioned Concurrency** | Evite les cold starts mais coute en permanence |
| **Reserved Concurrency** | Gratuit, limite le nombre max d'invocations |
| **Duration** | Optimiser le code pour reduire le temps d'execution |

### Step Functions

| Optimisation | Detail |
|-------------|--------|
| **Express** | 90% moins cher que Standard pour les workflows courts |
| **SDK Integrations** | Appel direct DynamoDB/SQS au lieu de Lambda intermediaire |
| **Reduce transitions** | Chaque transition coute, minimiser les etats Pass |

### DynamoDB

| Optimisation | Detail |
|-------------|--------|
| **On-Demand** | Pour les charges impredictibles |
| **Provisioned** | Pour les charges stables (+ Reserved Capacity = -75%) |
| **TTL** | Supprimer automatiquement les donnees expirees |
| **Single-table** | Reduire le nombre de tables (moins d'overhead) |

### API Gateway

| Optimisation | Detail |
|-------------|--------|
| **HTTP API** | 70% moins cher que REST API pour les cas simples |
| **Caching** | Reduire les invocations Lambda |
| **Compression** | Reduire le volume de donnees transferees |

### Calcul de cout exemple

```
Application : 1M requetes/mois, 200ms moyenne, 256 Mo memoire

API Gateway (HTTP API) :
  1M × $1.00/M = $1.00

Lambda :
  1M invocations × $0.20/M = $0.20
  1M × 200ms × 256Mo = 51,200 Go-s × $0.0000166667 = $0.85

DynamoDB (On-Demand) :
  1M writes × $1.25/M = $1.25
  2M reads × $0.25/M = $0.50

Total : ~$3.80/mois pour 1M requetes
```

Comparaison avec un serveur EC2 (t3.small 24/7) : ~$15/mois — et le serverless scale a zero.

---

## SST (Serverless Stack) — Le framework serverless TypeScript-first

[SST](https://sst.dev) est un framework open-source qui simplifie le développement serverless avec TypeScript. Il s'appuie sur CDK (ou Pulumi via SST Ion v3) mais ajoute des fonctionnalités cruciales pour le DX.

### Pourquoi SST vs CDK pur ?

| Feature | CDK | SST |
|---------|-----|-----|
| Langage | TypeScript/Python/Java | TypeScript uniquement |
| Live Lambda Dev | Non (redéploiement à chaque changement) | **Oui** (hot reload en ~1s) |
| Constructs haut niveau | L2/L3 génériques | Spécialisés web (Api, NextjsSite, etc.) |
| Console de debug | CloudWatch | **SST Console** (temps réel, invocations, logs) |
| Courbe d'apprentissage | Raide | Plus douce |

### Constructs SST

```typescript
// sst.config.ts
import { Api, Function, Table, StaticSite, NextjsSite } from 'sst/constructs';

export default {
  config() {
    return { name: 'my-app', region: 'eu-west-1' };
  },
  stacks(app) {
    app.stack(function MyStack({ stack }) {
      // API + Lambda en 3 lignes
      const api = new Api(stack, 'api', {
        routes: {
          'GET /users': 'packages/functions/src/users.list',
          'POST /users': 'packages/functions/src/users.create',
        },
      });

      // DynamoDB
      const table = new Table(stack, 'users', {
        fields: { userId: 'string' },
        primaryIndex: { partitionKey: 'userId' },
      });

      // Next.js deployé sur Lambda@Edge + S3 + CloudFront
      new NextjsSite(stack, 'site', {
        path: 'packages/web',
        environment: { API_URL: api.url },
      });
    });
  },
};
```

### Live Lambda Development

La killer feature de SST : modifier le code d'une Lambda, sauvegarder, et voir le résultat en ~1 seconde — sans redéployer la stack.

```bash
npx sst dev  # Lance le mode développement
```

SST redirige les invocations Lambda de votre compte AWS vers votre machine locale via WebSocket. Le code s'exécute localement avec accès aux vraies ressources AWS.

### SST Ion (v3) — Transition vers Pulumi

SST v3 ("Ion") abandonne CDK pour Pulumi/Terraform, offrant :
- Déploiement 10-100x plus rapide (pas de CloudFormation)
- Support multi-cloud (AWS, Cloudflare, Vercel)
- Même API développeur

### Quand utiliser SST vs CDK ?

- **SST** : projets web (API + frontend), rapid prototyping, équipes petites/moyennes
- **CDK** : infrastructure complexe, besoins multi-langage, entreprises avec standards CDK existants
- **SAM** : projets serverless simples, déjà dans l'écosystème AWS officiel

---

## Recapitulatif

| Concept | A retenir |
|---------|-----------|
| **Step Functions** | Orchestrateur visuel de workflows (machine a etats) |
| **Task/Choice/Parallel/Map** | Types d'etats pour actions, conditions, parallelisme, iterations |
| **Standard vs Express** | Long workflows vs haute frequence |
| **CQRS** | Separer ecritures et lectures avec des vues optimisees |
| **Saga** | Transactions distribuees avec compensations |
| **API Composition** | Agreger plusieurs services en une seule reponse |
| **WebSocket API** | Communication bidirectionnelle temps reel |
| **AppSync** | GraphQL manage avec subscriptions temps reel |
| **Cout serverless** | Scale a zero, paiement a l'usage, optimiser memoire/duree |
