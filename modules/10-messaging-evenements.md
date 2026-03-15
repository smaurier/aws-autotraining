# Module 10 — SQS, SNS & EventBridge — Messaging et événements

> **Objectif** : Comprendre les trois services de messaging AWS, savoir quand utiliser SQS, SNS ou EventBridge, implémenter les patterns courants (queue worker, fan-out, event-driven) et utiliser le SDK TypeScript v3.
>
> **Difficulté** : ⭐⭐⭐ (avancé)
>
> **Prérequis** : Module 05 (Lambda), Module 07 (DynamoDB)
>
> **Durée estimée** : 3h30

---

## Table des matières

1. [Introduction au messaging](#1-introduction-au-messaging)
2. [SQS — Simple Queue Service](#2-sqs--simple-queue-service)
3. [SNS — Simple Notification Service](#3-sns--simple-notification-service)
4. [EventBridge](#4-eventbridge)
5. [Comparaison SQS vs SNS vs EventBridge](#5-comparaison-sqs-vs-sns-vs-eventbridge)
6. [Patterns d'architecture](#6-patterns-darchitecture)
7. [TypeScript SDK v3](#7-typescript-sdk-v3)
8. [Bonnes pratiques](#8-bonnes-pratiques)
9. [Récapitulatif](#9-récapitulatif)

---

## 1. Introduction au messaging

### 1.1 Pourquoi le messaging ?

Dans une architecture monolithique, les composants s'appellent directement (appels de fonction synchrones). Si un composant tombe, tout le système tombe. Le messaging introduit un **découplage asynchrone** entre les composants.

```
Synchrone (couplé) :
  API → Traitement → Email → Réponse au client (5s)

Asynchrone (découplé) :
  API → File d'attente → Réponse au client (200ms)
                ↓
          Worker → Email (en arrière-plan)
```

> **Analogie** : Le messaging, c'est comme le courrier postal. Au lieu de vous déplacer personnellement pour remettre un message (appel synchrone), vous le déposez dans une boîte aux lettres (queue). Le facteur (worker) le distribuera quand il sera disponible. Si le destinataire est absent, le courrier attend dans la boîte — rien n'est perdu.

### 1.2 Les trois piliers du messaging AWS

| Service | Modèle | Analogie |
|---|---|---|
| **SQS** | File d'attente (queue) | Boîte aux lettres : un seul destinataire |
| **SNS** | Publication/abonnement (pub/sub) | Mégaphone : tous les abonnés reçoivent le message |
| **EventBridge** | Bus d'événements (event bus) | Standard téléphonique intelligent : route selon le contenu |

---

## 2. SQS — Simple Queue Service

### 2.1 Concept

SQS est une **file d'attente de messages** entièrement managée. Un producteur envoie un message dans la queue, un consommateur le récupère, le traite, puis le supprime.

```
Producteur → [SQS Queue] → Consommateur
              message 1
              message 2
              message 3
```

### 2.2 Standard vs FIFO

| Caractéristique | Standard | FIFO |
|---|---|---|
| **Ordre** | Best-effort (pas garanti) | Strictement FIFO |
| **Débit** | Illimité | 3 000 msg/s (avec batching) |
| **Duplication** | Possible (at-least-once) | Exactement une fois (exactly-once) |
| **Nom de la queue** | Libre | Doit finir par `.fifo` |
| **Coût** | 0,40 $/million req | 0,50 $/million req |
| **Cas d'usage** | Tâches en arrière-plan, déclencher des workers | Commandes e-commerce, transactions financières |

### 2.3 Cycle de vie d'un message

```
1. Le producteur envoie un message → la queue le stocke
2. Le consommateur appelle ReceiveMessage → le message devient "invisible"
3. Le consommateur traite le message
4. Le consommateur appelle DeleteMessage → le message est supprimé
   (si pas supprimé avant le timeout → le message redevient visible)
```

### 2.4 Visibility Timeout

Le **Visibility Timeout** est la durée pendant laquelle un message est invisible aux autres consommateurs après avoir été reçu. Par défaut : **30 secondes**.

- Si le consommateur traite le message et le supprime avant le timeout → tout va bien
- Si le consommateur plante → le message redevient visible et un autre consommateur le traite
- Ajustez le timeout selon la durée de traitement de vos messages

```bash
# Créer une queue avec un visibility timeout de 60 secondes
aws sqs create-queue \
  --queue-name order-processing \
  --attributes VisibilityTimeout=60
```

### 2.5 Dead Letter Queue (DLQ)

Quand un message échoue plusieurs fois (dépassement de `maxReceiveCount`), il est déplacé vers une **Dead Letter Queue**. Cela empêche les messages "poison pill" de bloquer la queue.

```bash
# Créer la DLQ
aws sqs create-queue --queue-name order-processing-dlq

# Configurer la redrive policy sur la queue principale
aws sqs set-queue-attributes \
  --queue-url https://sqs.eu-west-1.amazonaws.com/123456789/order-processing \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-1:123456789:order-processing-dlq\",\"maxReceiveCount\":\"3\"}"
  }'
```

### 2.6 Long Polling vs Short Polling

| Mode | Comportement | Coût |
|---|---|---|
| **Short Polling** (défaut) | Retourne immédiatement, même si la queue est vide | Plus de requêtes = plus cher |
| **Long Polling** | Attend jusqu'à 20s qu'un message arrive | Moins de requêtes vides |

```bash
# Activer le long polling (WaitTimeSeconds = 20)
aws sqs receive-message \
  --queue-url https://sqs.eu-west-1.amazonaws.com/123456789/order-processing \
  --wait-time-seconds 20
```

### 2.7 Commandes CLI essentielles

```bash
# Envoyer un message
aws sqs send-message \
  --queue-url https://sqs.eu-west-1.amazonaws.com/123456789/order-processing \
  --message-body '{"orderId": "ord-001", "action": "process"}'

# Envoyer un message FIFO
aws sqs send-message \
  --queue-url https://sqs.eu-west-1.amazonaws.com/123456789/order-processing.fifo \
  --message-body '{"orderId": "ord-001"}' \
  --message-group-id "customer-42" \
  --message-deduplication-id "ord-001-v1"

# Purger une queue (supprimer tous les messages)
aws sqs purge-queue \
  --queue-url https://sqs.eu-west-1.amazonaws.com/123456789/order-processing
```

---

## 3. SNS — Simple Notification Service

### 3.1 Concept

SNS est un service de **publication/abonnement** (pub/sub). Un éditeur publie un message sur un **topic**, et tous les **abonnés** du topic reçoivent le message.

```
Éditeur → [SNS Topic: order-events]
              ├── Abonné 1 : SQS Queue (traitement)
              ├── Abonné 2 : Lambda (email)
              ├── Abonné 3 : HTTP endpoint (webhook)
              └── Abonné 4 : Email (notification admin)
```

### 3.2 Types d'abonnés supportés

| Protocole | Description |
|---|---|
| **SQS** | Envoie le message dans une queue |
| **Lambda** | Invoque une fonction Lambda |
| **HTTP/HTTPS** | Appelle un endpoint HTTP |
| **Email** | Envoie un email (texte brut) |
| **Email-JSON** | Envoie un email au format JSON |
| **SMS** | Envoie un SMS |
| **Kinesis Data Firehose** | Écrit dans un flux Firehose |

### 3.3 Création d'un topic et abonnements

```bash
# Créer un topic
aws sns create-topic --name order-events
# → Retourne le TopicArn

# Abonner une queue SQS
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-west-1:123456789:order-events \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:eu-west-1:123456789:order-processing

# Abonner une Lambda
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-west-1:123456789:order-events \
  --protocol lambda \
  --notification-endpoint arn:aws:lambda:eu-west-1:123456789:function:send-email

# Publier un message
aws sns publish \
  --topic-arn arn:aws:sns:eu-west-1:123456789:order-events \
  --message '{"orderId": "ord-001", "status": "confirmed"}' \
  --subject "Nouvelle commande"
```

### 3.4 Message Filtering

SNS permet de filtrer les messages côté abonné grâce aux **filter policies**. Chaque abonné ne reçoit que les messages qui correspondent à sa politique de filtrage.

```bash
# L'abonné ne reçoit que les commandes de type "premium"
aws sns set-subscription-attributes \
  --subscription-arn arn:aws:sns:eu-west-1:123456789:order-events:sub-abc \
  --attribute-name FilterPolicy \
  --attribute-value '{"orderType": ["premium"]}'
```

### 3.5 SNS FIFO

Comme SQS, SNS propose des topics **FIFO** qui garantissent l'ordre et la déduplication. Un topic SNS FIFO ne peut envoyer qu'à des queues SQS FIFO.

---

## 4. EventBridge

### 4.1 Concept

EventBridge est un **bus d'événements serverless** qui route les événements selon des **règles** vers des **cibles**. C'est l'évolution de CloudWatch Events, avec un support natif pour les événements SaaS et les schémas.

```
Source d'événement → [Event Bus] → Règle 1 → Cible (Lambda)
                                  → Règle 2 → Cible (SQS)
                                  → Règle 3 → Cible (Step Functions)
```

> **Analogie** : EventBridge est comme un aiguillage ferroviaire intelligent. Les trains (événements) arrivent sur les voies, et l'aiguillage les dirige vers la bonne destination en fonction de leur contenu (type de marchandise, destination, priorité).

### 4.2 Composants clés

| Composant | Description |
|---|---|
| **Event Bus** | Canal qui reçoit les événements (default bus, custom bus, partner bus) |
| **Rule** | Filtre qui matche les événements selon un pattern |
| **Target** | Destination de l'événement (Lambda, SQS, SNS, Step Functions, etc.) |
| **Schema** | Structure de l'événement (découverte automatique possible) |
| **Archive** | Stockage d'événements pour replay |

### 4.3 Structure d'un événement

```json
{
  "version": "0",
  "id": "12345678-1234-1234-1234-123456789012",
  "source": "com.myapp.orders",
  "detail-type": "OrderPlaced",
  "account": "123456789012",
  "time": "2025-03-14T10:30:00Z",
  "region": "eu-west-1",
  "detail": {
    "orderId": "ord-001",
    "customerId": "cust-42",
    "total": 149.99,
    "items": ["item-a", "item-b"]
  }
}
```

### 4.4 Création de règles

```bash
# Créer un event bus custom
aws events create-event-bus --name my-app-bus

# Créer une règle qui matche les événements "OrderPlaced"
aws events put-rule \
  --name order-placed-rule \
  --event-bus-name my-app-bus \
  --event-pattern '{
    "source": ["com.myapp.orders"],
    "detail-type": ["OrderPlaced"]
  }'

# Ajouter une cible Lambda
aws events put-targets \
  --rule order-placed-rule \
  --event-bus-name my-app-bus \
  --targets '[{
    "Id": "send-confirmation",
    "Arn": "arn:aws:lambda:eu-west-1:123456789:function:send-order-confirmation"
  }]'

# Publier un événement
aws events put-events \
  --entries '[{
    "Source": "com.myapp.orders",
    "DetailType": "OrderPlaced",
    "Detail": "{\"orderId\": \"ord-001\", \"total\": 149.99}",
    "EventBusName": "my-app-bus"
  }]'
```

### 4.5 Event Patterns avancés

```json
// Commandes de plus de 100 € provenant de clients premium
{
  "source": ["com.myapp.orders"],
  "detail-type": ["OrderPlaced"],
  "detail": {
    "total": [{ "numeric": [">", 100] }],
    "customerTier": ["premium"]
  }
}
```

Opérateurs disponibles : `prefix`, `suffix`, `anything-but`, `numeric`, `exists`, `cidr`.

### 4.6 Scheduled Rules (CRON)

EventBridge remplace CloudWatch Events pour les tâches planifiées :

```bash
# Exécuter une Lambda tous les jours à 8h UTC
aws events put-rule \
  --name daily-cleanup \
  --schedule-expression "cron(0 8 * * ? *)"

# Exécuter toutes les 5 minutes
aws events put-rule \
  --name health-check \
  --schedule-expression "rate(5 minutes)"
```

---

## 5. Comparaison SQS vs SNS vs EventBridge

| Critère | SQS | SNS | EventBridge |
|---|---|---|---|
| **Modèle** | Queue (point-to-point) | Pub/Sub (fan-out) | Event Bus (routage intelligent) |
| **Consommateurs** | 1 consommateur par message | N abonnés par topic | N cibles par règle |
| **Rétention** | Jusqu'à 14 jours | Pas de rétention | Archive + replay |
| **Filtrage** | Côté consommateur | Filter policies (attributs) | Event patterns (contenu) |
| **Ordre** | FIFO disponible | FIFO disponible | Best-effort |
| **Latence** | ~10-50 ms | ~20-100 ms | ~500 ms |
| **Intégrations natives** | Lambda, EC2 | Lambda, SQS, HTTP, Email | 20+ cibles AWS |
| **Coût** | 0,40 $/M req | 0,50 $/M notifications | 1,00 $/M événements |
| **Cas d'usage** | Workers, buffers, découplage | Notifications, fan-out | Event-driven, SaaS, CRON |

### Arbre de décision

```
Besoin de découpler A et B ?
  ├── Un seul consommateur → SQS
  ├── Plusieurs consommateurs en même temps ?
  │     ├── Filtrage simple par attributs → SNS + SQS
  │     └── Filtrage avancé par contenu → EventBridge
  └── Tâche planifiée (CRON) → EventBridge Scheduler
```

---

## 6. Patterns d'architecture

### 6.1 Queue Worker Pattern

Le pattern le plus simple : une Lambda (ou un service) consomme les messages d'une queue SQS.

```
API Gateway → Lambda (API) → SQS Queue → Lambda (Worker)
                                              ↓
                                         Traitement lourd
                                         (resize image, envoi email, etc.)
```

### 6.2 Fan-out Pattern (SNS + SQS)

Un message unique est distribué à plusieurs consommateurs indépendants.

```
Événement "CommandeConfirmée"
    ↓
  SNS Topic
    ├── SQS → Lambda : Envoi email de confirmation
    ├── SQS → Lambda : Mise à jour du stock
    ├── SQS → Lambda : Envoi au système comptable
    └── SQS → Lambda : Notification Slack
```

Chaque queue SQS agit comme un **buffer indépendant**. Si le service email tombe, les messages s'accumulent dans sa queue sans affecter les autres.

### 6.3 Event-Driven Architecture (EventBridge)

Architecture complète où chaque service émet des événements et réagit aux événements des autres.

```
Service Commandes → EventBridge ← Service Stock
                         ↑↓
                    Service Paiement
                         ↑↓
                    Service Notification
```

Chaque service est indépendant, communique via des événements, et peut être déployé, scalé et mis à jour séparément.

### 6.4 Saga Pattern (SQS + SNS)

Pour les transactions distribuées sans ACID global :

```
1. Service Commande → crée la commande (status: PENDING)
2. → SQS → Service Paiement → débite le compte
3.   → succès → SNS → Service Stock → réserve le stock
4.     → succès → SNS → Service Commande → status: CONFIRMED
4.     → échec  → SNS → Service Paiement → rembourse (compensation)
```

---

## 7. TypeScript SDK v3

### 7.1 Installation

```bash
pnpm add @aws-sdk/client-sqs @aws-sdk/client-sns @aws-sdk/client-eventbridge
```

### 7.2 SQS — Envoyer et recevoir des messages

```typescript
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs'

const sqs = new SQSClient({ region: 'eu-west-1' })
const queueUrl = 'https://sqs.eu-west-1.amazonaws.com/123456789/order-processing'

// Envoyer un message
await sqs.send(new SendMessageCommand({
  QueueUrl: queueUrl,
  MessageBody: JSON.stringify({ orderId: 'ord-001', action: 'process' }),
  DelaySeconds: 10, // délai de livraison optionnel
  MessageAttributes: {
    orderType: { DataType: 'String', StringValue: 'premium' },
  },
}))

// Recevoir des messages (long polling)
const { Messages } = await sqs.send(new ReceiveMessageCommand({
  QueueUrl: queueUrl,
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20,
  MessageAttributeNames: ['All'],
}))

if (Messages) {
  for (const msg of Messages) {
    const body = JSON.parse(msg.Body!)
    console.log('Traitement de la commande :', body.orderId)

    // Supprimer le message après traitement
    await sqs.send(new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: msg.ReceiptHandle!,
    }))
  }
}
```

### 7.3 SNS — Publier un message

```typescript
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'

const sns = new SNSClient({ region: 'eu-west-1' })

await sns.send(new PublishCommand({
  TopicArn: 'arn:aws:sns:eu-west-1:123456789:order-events',
  Message: JSON.stringify({
    orderId: 'ord-001',
    status: 'confirmed',
    total: 149.99,
  }),
  MessageAttributes: {
    orderType: { DataType: 'String', StringValue: 'premium' },
  },
}))
```

### 7.4 EventBridge — Émettre un événement

```typescript
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge'

const eb = new EventBridgeClient({ region: 'eu-west-1' })

const result = await eb.send(new PutEventsCommand({
  Entries: [
    {
      Source: 'com.myapp.orders',
      DetailType: 'OrderPlaced',
      Detail: JSON.stringify({
        orderId: 'ord-001',
        customerId: 'cust-42',
        total: 149.99,
      }),
      EventBusName: 'my-app-bus',
    },
  ],
}))

console.log('Événements échoués :', result.FailedEntryCount)
```

### 7.5 Lambda handler pour SQS

```typescript
import type { SQSHandler } from 'aws-lambda'

export const handler: SQSHandler = async (event) => {
  const failedIds: string[] = []

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body)
      console.log('Traitement :', body.orderId)
      // ... logique métier
    } catch (error) {
      console.error('Échec pour le message :', record.messageId, error)
      failedIds.push(record.messageId)
    }
  }

  // Partial batch failure : ne retente que les messages échoués
  return {
    batchItemFailures: failedIds.map((id) => ({
      itemIdentifier: id,
    })),
  }
}
```

---

## 8. Bonnes pratiques

1. **Toujours ajouter une DLQ** sur vos queues SQS pour capturer les messages en échec
2. **Activez le long polling** (`WaitTimeSeconds: 20`) pour réduire les coûts SQS
3. **Utilisez le partial batch failure** dans vos Lambdas SQS pour ne retenter que les messages échoués
4. **Préférez EventBridge** pour le routage basé sur le contenu des événements
5. **Utilisez SNS + SQS** pour le fan-out avec buffer de rétention
6. **Idempotence** : vos consommateurs doivent pouvoir traiter le même message 2 fois sans effet de bord
7. **Surveillez les DLQ** avec des alarmes CloudWatch — un message en DLQ signale un problème
8. **Limitez la taille des messages** : 256 Ko max pour SQS/SNS. Pour des payloads plus gros, stockez dans S3 et passez l'URL dans le message.

---

## 9. Récapitulatif

| Service | Modèle | Cas d'usage principal |
|---|---|---|
| **SQS Standard** | Queue, at-least-once | Découplage, workers, buffers |
| **SQS FIFO** | Queue, exactly-once, ordonné | Transactions, commandes séquentielles |
| **SNS** | Pub/Sub, fan-out | Notifications multi-abonnés |
| **EventBridge** | Event Bus, routage intelligent | Architectures event-driven, CRON, SaaS |

| Pattern | Services impliqués |
|---|---|
| Queue Worker | SQS → Lambda |
| Fan-out | SNS → N x SQS → N x Lambda |
| Event-driven | EventBridge → Lambda / SQS / Step Functions |
| Saga (compensations) | SQS + SNS, orchestrées par Step Functions |
