# Module 09 — DynamoDB — Base de données NoSQL haute performance

> **Objectif** : Maîtriser le modèle de données DynamoDB, concevoir des tables efficaces avec les bons patterns d'accès, utiliser le SDK TypeScript v3, et comprendre les fonctionnalités avancées (Streams, TTL, DAX, Transactions).
>
> **Difficulté** : ⭐⭐⭐ (avancé)
>
> **Prérequis** : Module 05 (Lambda), notions de bases de données
>
> **Durée estimée** : 4h

---

## Table des matières

1. [Pourquoi DynamoDB](#1-pourquoi-dynamodb)
2. [Modèle de données](#2-modèle-de-données)
3. [Clés primaires et index](#3-clés-primaires-et-index)
4. [Modes de capacité](#4-modes-de-capacité)
5. [Opérations CRUD](#5-opérations-crud)
6. [Query vs Scan](#6-query-vs-scan)
7. [TypeScript SDK v3](#7-typescript-sdk-v3)
8. [DynamoDB Streams](#8-dynamodb-streams)
9. [Single-Table Design](#9-single-table-design)
10. [TTL, DAX et Transactions](#10-ttl-dax-et-transactions)
11. [Bonnes pratiques](#11-bonnes-pratiques)
12. [Récapitulatif](#12-récapitulatif)

---

## 1. Pourquoi DynamoDB

### 1.1 Le problème qu'il résout

Les bases de données relationnelles (RDS, PostgreSQL) excellent pour les requêtes complexes avec jointures. Mais quand votre application atteint des millions de requêtes par seconde avec des temps de réponse inférieurs à 10 ms, le modèle relationnel atteint ses limites de scalabilité.

DynamoDB est une base de données **NoSQL clé-valeur et documentaire**, entièrement managée par AWS, conçue pour :

- Des **latences inférieures à 10 ms** quelle que soit l'échelle
- Un **scaling automatique** de 0 à des millions de requêtes/seconde
- Zéro administration de serveur, patching ou réplication
- Une **haute disponibilité** (réplication sur 3 AZ par défaut)

> **Analogie** : Imaginez DynamoDB comme un immense classeur de bureau. Chaque tiroir (partition) contient des dossiers (items) triés par étiquette. Vous accédez toujours directement au bon tiroir grâce à la clé — pas besoin de fouiller tout le classeur.

### 1.2 Quand utiliser DynamoDB vs RDS

| Critère | DynamoDB | RDS (PostgreSQL/MySQL) |
|---|---|---|
| **Modèle** | NoSQL clé-valeur / document | Relationnel (SQL) |
| **Latence** | < 10 ms constant | Variable (5-50 ms) |
| **Scaling** | Automatique, horizontal | Vertical (instance plus grosse) |
| **Jointures** | Non supportées | Natives |
| **Transactions** | Oui (limitées, 100 items) | Complètes (ACID) |
| **Schéma** | Flexible (schema-less) | Rigide (schema-on-write) |
| **Coût à faible usage** | Pay-per-request possible | Instance minimum ~30$/mois |
| **Cas d'usage** | Sessions, IoT, gaming, e-commerce | ERP, reporting, relations complexes |

---

## 2. Modèle de données

### 2.1 Concepts fondamentaux

DynamoDB organise les données en trois niveaux :

```
Table
  └── Item (équivalent d'une ligne SQL)
        └── Attribut (équivalent d'une colonne SQL)
```

**Différences clés avec le relationnel** :

- Chaque item peut avoir des **attributs différents** (pas de schéma fixe)
- La taille maximale d'un item est de **400 Ko**
- Il n'y a **pas de jointures** — vous dénormalisez les données
- Les types supportés : `String`, `Number`, `Binary`, `Boolean`, `Null`, `List`, `Map`, `Set`

### 2.2 Exemple de table `Users`

```
┌──────────────┬───────────────┬─────────────────┬──────────┐
│ PK (userId)  │ email         │ name            │ age      │
├──────────────┼───────────────┼─────────────────┼──────────┤
│ user-001     │ alice@ex.com  │ Alice Dupont    │ 32       │
│ user-002     │ bob@ex.com    │ Bob Martin      │ (absent) │
│ user-003     │ claire@ex.com │ Claire Fontaine │ 28       │
└──────────────┴───────────────┴─────────────────┴──────────┘
```

Remarquez que `user-002` n'a pas d'attribut `age` — c'est parfaitement valide en NoSQL.

---

## 3. Clés primaires et index

### 3.1 Clé primaire simple (Partition Key)

La **Partition Key** (PK) identifie de manière unique chaque item. DynamoDB utilise un algorithme de hachage sur la PK pour déterminer sur quelle partition physique stocker l'item.

```
Table: Users
  Partition Key: userId (String)
```

### 3.2 Clé primaire composite (Partition Key + Sort Key)

La **Sort Key** (SK) permet de stocker plusieurs items sous la même partition, triés par la SK. La combinaison PK + SK doit être unique.

```
Table: Orders
  Partition Key: customerId (String)
  Sort Key: orderDate (String)
```

Cela permet de récupérer toutes les commandes d'un client, triées par date, en une seule requête.

> **Analogie** : La PK est le numéro du tiroir du classeur, la SK est l'onglet qui trie les dossiers à l'intérieur du tiroir. Vous ouvrez le bon tiroir (PK), puis vous parcourez les onglets (SK) pour trouver ce que vous cherchez.

### 3.3 Global Secondary Index (GSI)

Un GSI est un **index avec une PK et SK différentes** de la table principale. Il permet de requêter les données selon un autre pattern d'accès.

```
Table: Orders (PK: customerId, SK: orderDate)
  GSI: StatusIndex (PK: status, SK: orderDate)
  → Permet de requêter toutes les commandes par statut
```

Caractéristiques des GSI :
- Projection des attributs choisie (`ALL`, `KEYS_ONLY`, `INCLUDE`)
- Capacité de lecture/écriture **indépendante** de la table
- Jusqu'à **20 GSI** par table
- **Eventually consistent** uniquement

### 3.4 Local Secondary Index (LSI)

Un LSI partage la **même PK** que la table mais avec une **SK différente**. Il doit être créé à la création de la table.

```
Table: Orders (PK: customerId, SK: orderDate)
  LSI: AmountIndex (PK: customerId, SK: totalAmount)
  → Permet de requêter les commandes d'un client triées par montant
```

| Caractéristique | GSI | LSI |
|---|---|---|
| PK | Différente de la table | Même que la table |
| SK | Différente de la table | Différente de la table |
| Création | À tout moment | À la création uniquement |
| Consistance | Eventually consistent | Eventually ou Strongly consistent |
| Limite | 20 par table | 5 par table |

---

## 4. Modes de capacité

### 4.1 Mode On-Demand (pay-per-request)

Vous payez **uniquement pour les lectures/écritures effectuées**. DynamoDB ajuste automatiquement la capacité.

```bash
aws dynamodb create-table \
  --table-name Orders \
  --attribute-definitions \
    AttributeName=customerId,AttributeType=S \
    AttributeName=orderDate,AttributeType=S \
  --key-schema \
    AttributeName=customerId,KeyType=HASH \
    AttributeName=orderDate,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

**Avantages** : Zéro gestion de capacité, idéal pour les charges imprévisibles.
**Coût** : ~1,25 $ par million d'écritures, ~0,25 $ par million de lectures.

### 4.2 Mode Provisioned

Vous définissez un nombre fixe de **Read Capacity Units (RCU)** et **Write Capacity Units (WCU)**.

- **1 RCU** = 1 lecture fortement consistante de 4 Ko/s (ou 2 lectures eventually consistent)
- **1 WCU** = 1 écriture de 1 Ko/s

```bash
aws dynamodb create-table \
  --table-name Orders \
  --attribute-definitions \
    AttributeName=customerId,AttributeType=S \
    AttributeName=orderDate,AttributeType=S \
  --key-schema \
    AttributeName=customerId,KeyType=HASH \
    AttributeName=orderDate,KeyType=RANGE \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=10,WriteCapacityUnits=5
```

**Avantages** : Moins cher pour des charges prévisibles. Peut utiliser l'Auto Scaling.

| Charge de travail | Mode recommandé |
|---|---|
| Imprévisible, spiky | On-Demand |
| Stable, prévisible | Provisioned |
| Nouveau projet, phase de dev | On-Demand |
| Production à fort trafic stable | Provisioned + Auto Scaling |

---

## 5. Opérations CRUD

### 5.1 PutItem — Créer ou remplacer un item

```bash
aws dynamodb put-item \
  --table-name Users \
  --item '{
    "userId": {"S": "user-001"},
    "email": {"S": "alice@example.com"},
    "name": {"S": "Alice Dupont"},
    "age": {"N": "32"}
  }'
```

### 5.2 GetItem — Lire un item par sa clé

```bash
aws dynamodb get-item \
  --table-name Users \
  --key '{"userId": {"S": "user-001"}}' \
  --consistent-read
```

L'option `--consistent-read` force une lecture **fortement consistante** (coûte 2x plus de RCU).

### 5.3 UpdateItem — Modifier des attributs

```bash
aws dynamodb update-item \
  --table-name Users \
  --key '{"userId": {"S": "user-001"}}' \
  --update-expression "SET age = :newAge, #n = :newName" \
  --expression-attribute-names '{"#n": "name"}' \
  --expression-attribute-values '{":newAge": {"N": "33"}, ":newName": {"S": "Alice Martin"}}' \
  --return-values UPDATED_NEW
```

> `#n` est un alias car `name` est un mot réservé DynamoDB.

### 5.4 DeleteItem — Supprimer un item

```bash
aws dynamodb delete-item \
  --table-name Users \
  --key '{"userId": {"S": "user-001"}}' \
  --condition-expression "attribute_exists(userId)"
```

---

## 6. Query vs Scan

### 6.1 Query — Recherche efficace

`Query` utilise la **clé primaire** (PK obligatoire, SK optionnelle) pour lire un ensemble d'items. C'est l'opération la plus efficace.

```bash
# Toutes les commandes d'un client en 2025
aws dynamodb query \
  --table-name Orders \
  --key-condition-expression "customerId = :cid AND begins_with(orderDate, :year)" \
  --expression-attribute-values '{":cid": {"S": "cust-42"}, ":year": {"S": "2025"}}'
```

### 6.2 Scan — Parcours complet de la table

`Scan` lit **tous les items** de la table puis filtre. C'est coûteux et lent sur de grosses tables.

```bash
# Tous les utilisateurs de plus de 30 ans (SCAN — à éviter en production)
aws dynamodb scan \
  --table-name Users \
  --filter-expression "age > :minAge" \
  --expression-attribute-values '{":minAge": {"N": "30"}}'
```

> **Règle d'or** : Concevez toujours vos tables pour utiliser `Query` plutôt que `Scan`. Si vous avez besoin d'un `Scan`, c'est probablement un signe que votre modèle de données doit être revu.

---

## 7. TypeScript SDK v3

### 7.1 Installation

```bash
pnpm add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

Le package `@aws-sdk/lib-dynamodb` fournit le **DynamoDBDocumentClient** qui simplifie la sérialisation (pas besoin de `{"S": "..."}`, `{"N": "..."}`).

### 7.2 Configuration du client

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const rawClient = new DynamoDBClient({ region: 'eu-west-1' })

const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true, // supprime les attributs undefined
    convertEmptyValues: false,
  },
})
```

### 7.3 PutItem

```typescript
import { PutCommand } from '@aws-sdk/lib-dynamodb'

await docClient.send(new PutCommand({
  TableName: 'Users',
  Item: {
    userId: 'user-001',
    email: 'alice@example.com',
    name: 'Alice Dupont',
    age: 32,
    createdAt: new Date().toISOString(),
  },
  ConditionExpression: 'attribute_not_exists(userId)', // empêche l'écrasement
}))
```

### 7.4 GetItem

```typescript
import { GetCommand } from '@aws-sdk/lib-dynamodb'

const { Item } = await docClient.send(new GetCommand({
  TableName: 'Users',
  Key: { userId: 'user-001' },
  ConsistentRead: true,
}))

console.log(Item) // { userId: 'user-001', email: 'alice@example.com', ... }
```

### 7.5 Query

```typescript
import { QueryCommand } from '@aws-sdk/lib-dynamodb'

const { Items } = await docClient.send(new QueryCommand({
  TableName: 'Orders',
  KeyConditionExpression: 'customerId = :cid AND begins_with(orderDate, :year)',
  ExpressionAttributeValues: {
    ':cid': 'cust-42',
    ':year': '2025',
  },
  ScanIndexForward: false, // tri décroissant sur la SK
  Limit: 20,
}))
```

### 7.6 UpdateItem

```typescript
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'

const { Attributes } = await docClient.send(new UpdateCommand({
  TableName: 'Users',
  Key: { userId: 'user-001' },
  UpdateExpression: 'SET age = :newAge, updatedAt = :now',
  ExpressionAttributeValues: {
    ':newAge': 33,
    ':now': new Date().toISOString(),
  },
  ReturnValues: 'UPDATED_NEW',
}))
```

### 7.7 BatchWrite (écriture par lots)

```typescript
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb'

await docClient.send(new BatchWriteCommand({
  RequestItems: {
    Users: [
      { PutRequest: { Item: { userId: 'user-010', name: 'Jean' } } },
      { PutRequest: { Item: { userId: 'user-011', name: 'Marie' } } },
      { DeleteRequest: { Key: { userId: 'user-003' } } },
    ],
  },
}))
```

> **Limite** : 25 items maximum par `BatchWrite`, 16 Mo maximum.

---

## 8. DynamoDB Streams

### 8.1 Concept

DynamoDB Streams capture un **flux ordonné de modifications** (INSERT, MODIFY, REMOVE) sur une table. Chaque enregistrement du stream contient l'image de l'item avant et/ou après la modification.

```
Table: Orders
  → Stream → Lambda (mise à jour d'un index Elasticsearch)
  → Stream → Lambda (envoi d'email de confirmation)
```

### 8.2 Types de vues

| StreamViewType | Contenu de l'enregistrement |
|---|---|
| `KEYS_ONLY` | Clés de l'item modifié uniquement |
| `NEW_IMAGE` | Item complet après modification |
| `OLD_IMAGE` | Item complet avant modification |
| `NEW_AND_OLD_IMAGES` | Les deux images (avant et après) |

### 8.3 Activation via CLI

```bash
aws dynamodb update-table \
  --table-name Orders \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES
```

### 8.4 Lambda trigger sur un Stream

```typescript
import type { DynamoDBStreamHandler } from 'aws-lambda'

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    console.log('Événement :', record.eventName) // INSERT | MODIFY | REMOVE
    console.log('Nouvelle image :', record.dynamodb?.NewImage)
    console.log('Ancienne image :', record.dynamodb?.OldImage)

    if (record.eventName === 'INSERT') {
      // Envoyer un email de bienvenue, indexer dans Elasticsearch, etc.
    }
  }
}
```

---

## 9. Single-Table Design

### 9.1 Le principe

Au lieu de créer une table par entité (Users, Orders, Products), on stocke **toutes les entités dans une seule table** en utilisant des clés génériques (`PK`, `SK`). C'est le pattern recommandé par AWS pour les applications complexes.

### 9.2 Exemple e-commerce

```
┌─────────────────┬──────────────────────┬──────────────┬────────────┐
│ PK              │ SK                   │ GSI1PK       │ data       │
├─────────────────┼──────────────────────┼──────────────┼────────────┤
│ CUSTOMER#c001   │ PROFILE              │ EMAIL#a@b.c  │ {name, ..} │
│ CUSTOMER#c001   │ ORDER#2025-01-15#o01 │ STATUS#open  │ {total,..} │
│ CUSTOMER#c001   │ ORDER#2025-02-20#o02 │ STATUS#paid  │ {total,..} │
│ PRODUCT#p001    │ METADATA             │ CAT#elec     │ {price,..} │
│ PRODUCT#p001    │ REVIEW#c001          │              │ {rating,..}│
└─────────────────┴──────────────────────┴──────────────┴────────────┘
```

### 9.3 Patterns d'accès résolus

| Pattern d'accès | Requête |
|---|---|
| Profil d'un client | `Query PK = CUSTOMER#c001, SK = PROFILE` |
| Commandes d'un client | `Query PK = CUSTOMER#c001, SK begins_with ORDER#` |
| Commandes par statut | `Query GSI1PK = STATUS#open` (via GSI) |
| Avis sur un produit | `Query PK = PRODUCT#p001, SK begins_with REVIEW#` |

### 9.4 Avantages et inconvénients

| Avantages | Inconvénients |
|---|---|
| Une seule table à gérer | Modèle difficile à comprendre au début |
| Requêtes très efficaces | Nécessite de connaître les patterns d'accès à l'avance |
| Moins de GSI nécessaires | Migration de schéma plus complexe |
| Coût réduit (une seule table) | Debugging plus difficile dans la console |

---

## 10. TTL, DAX et Transactions

### 10.1 TTL (Time To Live)

Le TTL permet de **supprimer automatiquement** les items expirés. Vous définissez un attribut contenant un timestamp Unix (en secondes). DynamoDB supprime l'item dans les 48h après expiration (gratuit).

```bash
# Activer le TTL sur l'attribut "expiresAt"
aws dynamodb update-time-to-live \
  --table-name Sessions \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt
```

```typescript
// Créer un item avec TTL de 24h
await docClient.send(new PutCommand({
  TableName: 'Sessions',
  Item: {
    sessionId: 'sess-abc',
    userId: 'user-001',
    expiresAt: Math.floor(Date.now() / 1000) + 86400, // +24h
  },
}))
```

### 10.2 DAX (DynamoDB Accelerator)

DAX est un **cache en mémoire** compatible DynamoDB qui réduit la latence de lecture à **microsecondes** (< 1 ms).

```
Application → DAX Cluster (cache) → DynamoDB
              ↑ cache hit = µs     ↑ cache miss = ms
```

- Transparent pour le code (même API que DynamoDB)
- Idéal pour les lectures répétitives (catalogues, configurations)
- **Ne met pas en cache** les écritures ni les Scans

### 10.3 Transactions

DynamoDB supporte les transactions ACID sur **jusqu'à 100 items** dans plusieurs tables.

```typescript
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb'

await docClient.send(new TransactWriteCommand({
  TransactItems: [
    {
      Update: {
        TableName: 'Accounts',
        Key: { accountId: 'acc-001' },
        UpdateExpression: 'SET balance = balance - :amount',
        ConditionExpression: 'balance >= :amount',
        ExpressionAttributeValues: { ':amount': 100 },
      },
    },
    {
      Update: {
        TableName: 'Accounts',
        Key: { accountId: 'acc-002' },
        UpdateExpression: 'SET balance = balance + :amount',
        ExpressionAttributeValues: { ':amount': 100 },
      },
    },
  ],
}))
```

> Les transactions consomment **2x les WCU/RCU** normales.

---

## 11. Bonnes pratiques

1. **Concevez à partir des patterns d'accès** — Listez vos requêtes avant de modéliser la table
2. **Distribuez les Partition Keys** — Évitez les "hot partitions" (ex: `PK = "admin"` pour 90% des requêtes)
3. **Préférez Query à Scan** — Un Scan lit toute la table, un Query lit une partition
4. **Utilisez les projections** pour ne récupérer que les attributs nécessaires
5. **Activez le TTL** pour les données temporaires (sessions, caches, logs)
6. **Utilisez le DynamoDBDocumentClient** et non le client raw pour simplifier le marshalling
7. **Gérez les erreurs de throttling** avec un backoff exponentiel
8. **Surveillez avec CloudWatch** : `ConsumedReadCapacityUnits`, `ThrottledRequests`

---

## 12. Récapitulatif

| Concept | Description |
|---|---|
| **Table** | Collection d'items, identifiée par un nom |
| **Partition Key** | Clé de hachage, distribue les données sur les partitions |
| **Sort Key** | Clé de tri, organise les items dans une partition |
| **GSI** | Index global avec PK/SK différentes, eventually consistent |
| **LSI** | Index local avec SK différente, même PK |
| **On-Demand** | Pay-per-request, scaling automatique |
| **Provisioned** | Capacité fixe (RCU/WCU), moins cher si prévisible |
| **Query** | Lecture efficace par PK (+SK optionnelle) |
| **Scan** | Lecture complète de la table (coûteux) |
| **Streams** | Flux de changements (CDC) pour triggers Lambda |
| **Single-Table** | Toutes les entités dans une table, clés génériques |
| **TTL** | Suppression automatique des items expirés |
| **DAX** | Cache en mémoire, latence < 1 ms |
| **Transactions** | ACID sur max 100 items, coût 2x |
