---
titre: Architectures serverless — event-driven, Step Functions et coordination
cours: 12-aws-cloud
notions: [architecture serverless, event-driven, "assemblage API Gateway + Lambda + DynamoDB", orchestration, chorégraphie, "Step Functions (state machine)", "Amazon States Language (ASL)", "état Task", "état Choice", "état Parallel", "état Map", "état Wait / Pass / Succeed / Fail", "Retry / Catch", "intégrations directes (arn:aws:states:::dynamodb:putItem)", workflow Standard, workflow Express, "exactly-once vs at-least-once", idempotence, "clé d'idempotence", saga, transaction compensatoire, DLQ]
outcomes:
  - sait assembler API Gateway + Lambda + DynamoDB + messaging en une architecture serverless event-driven cohérente
  - sait distinguer orchestration (Step Functions) et chorégraphie (events) et choisir selon le couplage voulu
  - sait écrire une state machine ASL avec Task/Choice/Parallel/Map, Retry et Catch, et choisir Standard vs Express sur des faits (durée, sémantique, prix)
  - sait rendre un handler idempotent et esquisser une saga avec transactions compensatoires
prerequis: [Modules 00 à 15 du cours 12-aws-cloud, Module 06 — Lambda, Module 07 — API Gateway, Module 09 — DynamoDB, Module 10 — messaging (SQS/SNS/EventBridge)]
next: 17-cicd-devops
libs: []
tribuzen: infra cloud TribuZen — workflow serverless de traitement d'un upload d'avatar (S3 → validation → miniature → écriture feed → notification), orchestré par Step Functions
last-reviewed: 2026-07
---

# Architectures serverless — event-driven, Step Functions et coordination

> **Outcomes — tu sauras FAIRE :** assembler API Gateway + Lambda + DynamoDB + messaging en une architecture event-driven, distinguer orchestration et chorégraphie, écrire une state machine ASL (Task/Choice/Parallel/Map + Retry/Catch) et choisir Standard vs Express, rendre un handler idempotent et esquisser une saga.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module **n'introduit aucun service nouveau** — il **assemble** ceux que tu connais déjà : Lambda (module 06), API Gateway (module 07), DynamoDB (module 09), SQS/SNS/EventBridge (module 10). La seule brique inédite est **Step Functions**, l'orchestrateur qui coordonne ces briques. On répond à une question : *comment enchaîner plusieurs Lambdas et services en un workflow fiable, sans boucle `while` maison ni Lambda monolithique ?* Le déploiement automatisé de tout ça (CodePipeline, GitHub Actions → AWS) est le sujet du **module 17**.

## 1. Cas concret d'abord

Tu montes l'infra AWS de TribuZen. Un parent poste une photo de famille dans le bucket `tribuzen-avatars`. Pour que cette photo devienne un avatar utilisable, il faut enchaîner **quatre étapes** :

1. **Valider** le fichier (type MIME image, taille < 5 Mo, pas de contenu interdit).
2. **Générer** une miniature 200×200 (la Lambda `generateThumbnail` du module 06).
3. **Écrire** l'entrée dans DynamoDB `TribuZenFeed` (« Alice a changé sa photo »).
4. **Notifier** la famille (SNS → module 10).

Un collègue te tend ce premier jet : **une seule Lambda** qui fait tout à la chaîne.

```javascript
// handler processAvatar — anti-pattern : la Lambda monolithique
export const handler = async (event) => {
  const valid = await validate(event);        // étape 1
  if (!valid) return;                          // et si c'est invalide, on notifie qui ?
  const thumb = await generateThumbnail(event); // étape 2 — peut durer 10 s
  await writeFeed(event, thumb);               // étape 3
  await notifyFamily(event);                   // étape 4
  // Si l'étape 3 échoue APRÈS la miniature : on a une miniature orpheline.
  // Si l'invocation timeout à l'étape 2 : Lambda REJOUE tout depuis le début
  //   → deuxième miniature, deuxième entrée feed, deuxième notification. Doublons.
};
```

Quatre problèmes concrets qui vont te sauter à la figure en production :

1. **Aucune visibilité** : si ça casse, tu ne sais pas à *quelle* étape. Tu lis des logs CloudWatch à la main.
2. **Pas de retry ciblé** : l'étape 2 (image) échoue de temps en temps ? Tout le workflow rejoue, y compris la validation déjà réussie.
3. **Pas de compensation** : une miniature créée puis un échec en étape 3 laisse un fichier orphelin. Personne ne nettoie.
4. **Rejeu = doublons** : Lambda asynchrone **réessaie** en cas d'échec (module 06). Sans **idempotence**, on écrit deux fois dans le feed et on notifie deux fois.

À la fin de ce module, tu remplaces cette Lambda monolithique par une **state machine Step Functions** : chaque étape est un état isolé, avec son propre `Retry`, un `Catch` qui déclenche une **compensation**, et des handlers **idempotents**. Tu sauras aussi *quand* Step Functions est le bon outil (orchestration) et quand un simple chaînage d'**events** suffit (chorégraphie).

---

## 2. Théorie complète, concise

### 2.1 Ce qu'est une architecture serverless

Une **architecture serverless** compose des services **managés** qui scalent à zéro et se facturent à l'usage : Lambda (calcul), API Gateway (HTTP), DynamoDB (données), S3 (objets), SQS/SNS/EventBridge (messages). Aucun serveur à patcher, aucune capacité à provisionner en permanence. Ce module ne t'apprend pas ces briques — tu les connais — il t'apprend à les **assembler** proprement.

Le fil conducteur est l'**event-driven** : un composant émet un **événement** (objet créé dans S3, message publié sur SNS, item modifié dans un DynamoDB Stream), un autre y **réagit**. Le producteur ne connaît pas le consommateur. C'est le contraire d'un appel synchrone en cascade.

### 2.2 Le pattern de base : API + Lambda + DynamoDB

La colonne vertébrale de la plupart des back-ends serverless :

```
Client → API Gateway (HTTP API) → Lambda (handler) → DynamoDB (table)
```

- **API Gateway** (module 07) reçoit la requête HTTP, l'authentifie (autoriser Cognito), route vers la Lambda.
- **Lambda** (module 06) exécute la logique métier, stateless.
- **DynamoDB** (module 09) persiste, sans serveur de base à gérer.

Ce triptyque suffit pour un CRUD. Dès qu'une **opération métier fait plusieurs étapes** (valider → transformer → écrire → notifier), on ne les empile pas dans une seule Lambda (le cas concret) : on **coordonne**. Deux façons de coordonner — c'est le cœur du module.

### 2.3 Orchestration vs chorégraphie

Ce sont les **deux styles de coordination** d'un système distribué.

- **Orchestration** : un **chef d'orchestre central** (une state machine Step Functions) connaît toutes les étapes, les appelle dans l'ordre, gère les erreurs et l'état. Flux **explicite**, visible d'un coup d'œil. Couplage plus fort au chef d'orchestre.
- **Chorégraphie** : **pas de chef**. Chaque service émet des **events** ; les autres s'abonnent et réagissent. Flux **implicite**, distribué. Couplage faible, mais aucune vue d'ensemble : comprendre le parcours d'un event demande de lire N abonnements.

| Critère | Orchestration (Step Functions) | Chorégraphie (EventBridge/SNS/Streams) |
|---------|-------------------------------|----------------------------------------|
| Contrôle du flux | Central, explicite | Distribué, implicite |
| Visibilité | Une console visuelle, un historique | Éparpillée dans les abonnements |
| Couplage | Plus fort (au workflow) | Faible (par events) |
| Gestion d'erreur / retry / compensation | Native (Retry/Catch) | À la charge de chaque consommateur |
| Bon pour | Un processus métier ordonné, à état | Réactions découplées, fan-out |

Règle pratique : **workflow à étapes ordonnées avec état et erreurs à gérer → orchestration**. **Réactions indépendantes et découplées → chorégraphie**. Les deux se combinent (une étape orchestrée peut émettre un event qui déclenche une chorégraphie ailleurs).

### 2.4 Step Functions — l'orchestrateur

**AWS Step Functions** est un orchestrateur serverless. Tu définis un **workflow** sous forme de **machine à états** (*state machine*) : une suite d'états, chacun fait une chose et pointe vers le suivant. Step Functions gère pour toi l'**enchaînement**, l'**état** transporté entre les étapes (pas besoin de table intermédiaire), les **retries**, les **branches** et le **parallélisme**. Il s'intègre nativement à Lambda et à des centaines d'API AWS.

Une state machine se décrit en **Amazon States Language (ASL)** — du JSON. Champs communs à (presque) tous les états :

- `Type` : le type d'état (voir 2.5).
- `Next` : l'état suivant. Un état terminal met plutôt `End: true`, ou est un `Succeed`/`Fail`.
- `Comment` : description humaine optionnelle.

Squelette minimal :

```json
{
  "Comment": "Traitement d'un avatar TribuZen",
  "StartAt": "ValidateUpload",
  "States": {
    "ValidateUpload": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:eu-west-1:123456789012:function:tribuzen-validate",
      "Next": "GenerateThumbnail"
    },
    "GenerateThumbnail": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:eu-west-1:123456789012:function:tribuzen-thumbnail",
      "End": true
    }
  }
}
```

### 2.5 Les types d'états ASL

Step Functions distingue les **Task states** (font un travail) et sept **Flow states** (dirigent le flux) :

| Type | Rôle | Exemple TribuZen |
|------|------|------------------|
| **Task** | Une unité de travail : invoquer une Lambda, appeler une API AWS, un endpoint HTTP | valider le fichier, générer la miniature |
| **Choice** | Branche conditionnelle (if/else) | image lourde → chemin async, sinon direct |
| **Parallel** | Plusieurs branches **en même temps**, résultat = tableau des sorties | écrire feed **ET** logguer l'audit |
| **Map** | Itère les mêmes étapes sur **chaque élément** d'un tableau | traiter plusieurs photos d'un même post |
| **Wait** | Pause : une durée, ou jusqu'à une date | attendre 24 h avant un rappel |
| **Pass** | Passe l'entrée en sortie (option : transformer/injecter) | reformater le JSON entre deux étapes |
| **Succeed** | Termine le workflow en succès | fin nominale |
| **Fail** | Termine le workflow en échec (`Error`, `Cause`) | échec définitif |

`Map` diffère de `Parallel` : `Parallel` lance des branches **différentes** simultanément ; `Map` lance les **mêmes** étapes sur les éléments d'un tableau.

### 2.6 Retry et Catch — la robustesse déclarative

Chaque `Task` peut déclarer, **en JSON**, comment réagir aux erreurs — sans code de retry dans la Lambda.

- **`Retry`** : réessaie l'étape en cas d'erreur, avec backoff.
- **`Catch`** : route vers un autre état si l'erreur persiste (le filet de sécurité).

```json
"GenerateThumbnail": {
  "Type": "Task",
  "Resource": "arn:aws:lambda:eu-west-1:123456789012:function:tribuzen-thumbnail",
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed"],
      "IntervalSeconds": 2,
      "MaxAttempts": 3,
      "BackoffRate": 2.0
    }
  ],
  "Catch": [
    { "ErrorEquals": ["States.ALL"], "Next": "CleanupAndFail" }
  ],
  "Next": "WriteFeed"
}
```

`IntervalSeconds` = délai initial, `MaxAttempts` = nombre de reprises, `BackoffRate` = multiplicateur entre reprises (2.0 → 2 s, 4 s, 8 s). `States.ALL` attrape toute erreur. Baseline raisonnable : `MaxAttempts: 3`, `IntervalSeconds: 2`, `BackoffRate: 2.0`.

### 2.7 Intégrations directes (SDK integrations)

Un `Task` n'a pas besoin d'une Lambda pour toucher un service AWS. Step Functions appelle **directement** DynamoDB, SNS, SQS, EventBridge… via un ARN de service. Ça **supprime une Lambda intermédiaire** (moins de code, moins de coût, moins de latence) :

```json
"WriteFeed": {
  "Type": "Task",
  "Resource": "arn:aws:states:::dynamodb:putItem",
  "Parameters": {
    "TableName": "TribuZenFeed",
    "Item": {
      "pk":        { "S.$": "$.familyId" },
      "sk":        { "S.$": "$.uploadId" },
      "type":      { "S": "AVATAR_UPDATED" },
      "createdAt": { "S.$": "$$.State.EnteredTime" }
    }
  },
  "Next": "NotifyFamily"
}
```

`$.familyId` lit l'entrée du workflow ; `$$.State.EnteredTime` lit le **contexte d'exécution** (double `$$`). Services directement intégrables courants : `dynamodb:putItem/getItem/updateItem`, `sns:publish`, `sqs:sendMessage`, `events:putEvents`, `lambda:invoke`.

### 2.8 Standard vs Express — le choix structurant

Le **type de workflow** se choisit à la création et **ne peut plus changer** (immuable). Faits vérifiés (doc AWS) :

| Critère | **Standard** | **Express** |
|---------|-------------|-------------|
| Durée max | **1 an** | **5 minutes** |
| Sémantique d'exécution | **exactly-once** | **at-least-once** (async) / **at-most-once** (sync) |
| État persisté entre transitions | Oui (durable, reprenable) | Non |
| Facturation | par **transition d'état** | par **nombre d'exécutions + durée + mémoire** |
| Historique | API + console visuelle, conservé **90 jours** | Uniquement via **CloudWatch Logs** (à activer) |
| Débit de transitions | plafonné (quotas) | **illimité** |
| Bon pour | workflows longs, auditables, actions **non-idempotentes** (paiement) | haut volume, court, actions **idempotentes** (transformation de données) |

Points à ne pas confondre :

- **exactly-once (Standard)** : une étape ne tourne jamais deux fois, sauf `Retry` explicite → adapté aux actions **non-idempotentes** (débiter un paiement, démarrer un cluster).
- **at-least-once (Express async)** : une exécution peut tourner **plus d'une fois** → n'utilise Express **que** pour des actions **idempotentes**.
- Express **ne supporte pas** les patterns `.sync` (Job-run) ni `.waitForTaskToken` (Callback), ni le Distributed Map.

### 2.9 Idempotence — le prérequis non négociable de l'event-driven

Un système event-driven **rejoue** : Lambda asynchrone réessaie (module 06), SQS livre **au moins une fois**, Express est at-least-once. Donc **le même event peut arriver deux fois**. Un handler est **idempotent** si le traiter N fois produit le **même état final** qu'une seule fois.

Technique standard : une **clé d'idempotence** (un identifiant unique de l'opération — `uploadId`, `messageId`) + une écriture conditionnelle.

```javascript
// Écriture DynamoDB idempotente : n'insère QUE si la clé n'existe pas déjà
await ddb.send(new PutItemCommand({
  TableName: 'TribuZenFeed',
  Item: { pk: { S: familyId }, sk: { S: uploadId }, type: { S: 'AVATAR_UPDATED' } },
  ConditionExpression: 'attribute_not_exists(sk)', // rejeu → ConditionalCheckFailed, pas de doublon
}));
```

Le deuxième passage lève `ConditionalCheckFailedException` : tu l'attrapes et tu considères l'opération **déjà faite**. Aucun doublon dans le feed, aucune double notification.

### 2.10 Saga et transactions compensatoires (survol)

Pas de transaction ACID à travers plusieurs services serverless. Le **pattern saga** gère la cohérence d'un processus multi-étapes : si une étape échoue, on **compense** (on annule) les étapes déjà réussies, dans l'ordre inverse.

```
Upload avatar :  1. générer miniature   2. écrire feed   3. notifier
Échec en 2  →    1c. supprimer la miniature orpheline   (compensation)
```

Avec Step Functions, chaque `Task` a un `Catch` qui route vers son état de **compensation**. La state machine **est** l'implémentation de la saga : le `Catch` de `WriteFeed` déclenche `DeleteThumbnail` avant de finir en `Fail`. On n'implémente pas une saga complète ici (c'est un sujet d'architecture avancé) — retiens le principe : **pour chaque action, une compensation, déclenchée par un `Catch`**.

### 2.11 Dead Letter Queue — le dernier filet

Quand tout a échoué (retries épuisés, catch en `Fail`), l'event ne doit pas **disparaître**. On le route vers une **DLQ** (SQS, module 10) : file d'attente des échecs, qu'on inspecte et rejoue à la main. Une invocation Lambda asynchrone, une souscription SNS, une file SQS peuvent toutes déclarer une DLQ. Règle : **toute branche d'échec asynchrone a une DLQ**, sinon tu perds des données silencieusement.

---

## 3. Worked examples

### Exemple 1 — La state machine « traitement d'avatar » complète

On remplace la Lambda monolithique du cas concret par une orchestration : valider → miniature → (écrire feed **et** audit en parallèle) → notifier, avec compensation si la miniature échoue plus loin.

```json
{
  "Comment": "TribuZen — traitement d'un upload d'avatar (orchestration + compensation)",
  "StartAt": "ValidateUpload",
  "States": {
    "ValidateUpload": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:eu-west-1:123456789012:function:tribuzen-validate",
      "Catch": [
        { "ErrorEquals": ["ValidationError"], "Next": "RejectUpload" }
      ],
      "Next": "GenerateThumbnail"
    },
    "GenerateThumbnail": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:eu-west-1:123456789012:function:tribuzen-thumbnail",
      "Retry": [
        { "ErrorEquals": ["States.TaskFailed"], "IntervalSeconds": 2, "MaxAttempts": 3, "BackoffRate": 2.0 }
      ],
      "Catch": [
        { "ErrorEquals": ["States.ALL"], "Next": "Fail" }
      ],
      "Next": "PersistAndAudit"
    },
    "PersistAndAudit": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "WriteFeed",
          "States": {
            "WriteFeed": {
              "Type": "Task",
              "Resource": "arn:aws:states:::dynamodb:putItem",
              "Parameters": {
                "TableName": "TribuZenFeed",
                "Item": {
                  "pk":        { "S.$": "$.familyId" },
                  "sk":        { "S.$": "$.uploadId" },
                  "type":      { "S": "AVATAR_UPDATED" },
                  "createdAt": { "S.$": "$$.State.EnteredTime" }
                },
                "ConditionExpression": "attribute_not_exists(sk)"
              },
              "End": true
            }
          }
        },
        {
          "StartAt": "AuditLog",
          "States": {
            "AuditLog": {
              "Type": "Task",
              "Resource": "arn:aws:states:::sns:publish",
              "Parameters": { "TopicArn": "arn:aws:sns:eu-west-1:123456789012:tribuzen-audit", "Message.$": "$.uploadId" },
              "End": true
            }
          }
        }
      ],
      "Catch": [
        { "ErrorEquals": ["States.ALL"], "Next": "DeleteThumbnail" }
      ],
      "Next": "NotifyFamily"
    },
    "DeleteThumbnail": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:eu-west-1:123456789012:function:tribuzen-delete-thumbnail",
      "Comment": "Compensation : la miniature existe mais l'écriture a échoué -> on nettoie",
      "Next": "Fail"
    },
    "NotifyFamily": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": { "TopicArn": "arn:aws:sns:eu-west-1:123456789012:tribuzen-notify", "Message.$": "$.familyId" },
      "Next": "Success"
    },
    "RejectUpload": { "Type": "Fail", "Error": "ValidationError", "Cause": "Fichier refuse (type ou taille)" },
    "Fail":         { "Type": "Fail", "Error": "AvatarWorkflowFailed" },
    "Success":      { "Type": "Succeed" }
  }
}
```

Ce qui a changé vs la Lambda monolithique, et pourquoi :

- **Chaque étape est isolée** : dans la console Step Functions, tu vois *exactement* où ça casse.
- **`Retry` ciblé sur la miniature** : seule l'étape 2 rejoue, pas la validation déjà réussie.
- **`Parallel`** : feed et audit s'écrivent en même temps → plus rapide.
- **`Catch` → `DeleteThumbnail`** : la saga en action, la miniature orpheline est supprimée avant l'échec.
- **`ConditionExpression`** sur le `putItem` : idempotent, un rejeu du workflow ne double pas le feed.

### Exemple 2 — Orchestration ou chorégraphie ? Deux besoins, deux choix

**Besoin A — le workflow ci-dessus (upload avatar).** Étapes **ordonnées**, avec **état** (l'`uploadId` circule), erreurs à **compenser**, besoin d'**audit**. → **Orchestration Step Functions**. Type **Standard** : durable, auditable 90 jours, et l'action « notifier » n'est pas critique à dédoublonner mais la lisibilité prime.

**Besoin B — « quand un message est posté dans le feed, mettre à jour le compteur de badges non-lus de chaque membre ».** Réaction **indépendante**, découplée, pas d'ordre à garantir, chaque consommateur fait son affaire. → **Chorégraphie** : DynamoDB Stream sur `TribuZenFeed` → EventBridge → Lambda `updateBadges`. Aucun chef d'orchestre : si demain on ajoute « envoyer un push mobile », on **ajoute un abonné** sans toucher au producteur.

Le piège serait de tout mettre en Step Functions (couplage inutile) **ou** tout en events (aucune visibilité sur un process métier ordonné). Le critère : **flux ordonné à état → orchestration ; réactions découplées → chorégraphie.**

---

## 4. Pièges & misconceptions

### PIÈGE #1 — La Lambda « orchestrateur » qui appelle les autres à la chaîne

Écrire une Lambda qui `invoke` séquentiellement d'autres Lambdas reproduit tous les défauts du cas concret : pas de visibilité par étape, retry global (rejoue tout), timeout de 15 min max, état à gérer soi-même. C'est exactement le trou que **Step Functions** comble. Une Lambda coordonne du code ; une state machine coordonne des **étapes**.

### PIÈGE #2 — Croire qu'Express est « juste un Standard moins cher »

Non : Express est **at-least-once** (async) et **ne persiste pas l'état** entre transitions. Un workflow Express peut **rejouer entièrement**. L'utiliser pour une action **non-idempotente** (débiter un paiement) peut débiter deux fois. Express = haut volume + court + **idempotent**. Standard = long, durable, exactly-once, actions non-idempotentes.

### PIÈGE #3 — Confondre `Parallel` et `Map`

`Parallel` lance des **branches différentes** simultanément (feed ET audit). `Map` lance les **mêmes étapes** sur chaque élément d'un **tableau** (traiter chaque photo). Utiliser `Parallel` pour itérer une liste de taille variable est impossible : le nombre de branches d'un `Parallel` est **fixe** dans l'ASL.

### PIÈGE #4 — « L'event-driven garantit une livraison unique »

Faux, et dangereux. SQS, SNS, Lambda async, Express : tous **au moins une fois**. Le même event **peut** arriver deux fois. Sans **idempotence** (clé + écriture conditionnelle), tu crées des doublons. L'idempotence n'est pas optionnelle en serverless — c'est le prix d'entrée.

### PIÈGE #5 — Oublier la branche d'échec (pas de Catch, pas de DLQ)

Un `Task` sans `Catch` qui échoue après ses retries fait **échouer tout le workflow** brutalement, sans compensation. Un event async sans **DLQ** disparaît après les retries. Résultat : miniatures orphelines, données perdues silencieusement. Règle : **chaque étape critique a un `Catch`**, **chaque branche async a une DLQ**.

### PIÈGE #6 — Type de workflow modifiable

Le type Standard/Express est **immuable** : on ne le change pas après création. Se tromper oblige à **recréer** la state machine (nouveau ARN, mettre à jour les triggers). Choisis le type **avant** de déployer, sur les faits du tableau 2.8.

### PIÈGE #7 — Tout orchestrer (ou tout chorégraphier)

Mettre un fan-out de notifications découplées dans une state machine = couplage inutile et coût par transition. Mettre un process métier ordonné à état en pur event = zéro visibilité, débogage cauchemar. Le bon réflexe : **orchestration pour l'ordre et l'état, chorégraphie pour le découplage**, et on **mixe**.

---

## 5. Ancrage TribuZen

L'infra TribuZen combine les deux styles selon le besoin.

| Processus TribuZen | Style | Implémentation |
|--------------------|-------|----------------|
| **Traitement d'un upload d'avatar** | Orchestration | Step Functions **Standard** : valider → miniature (Retry) → feed + audit (`Parallel`) → notifier, `Catch` → compensation (supprimer miniature) |
| **Compteur de badges non-lus** | Chorégraphie | DynamoDB Stream sur `TribuZenFeed` → EventBridge → Lambda `updateBadges` |
| **Digest quotidien par famille** | Orchestration légère | EventBridge cron → Step Functions **Express** (idempotent, haut volume, court) → agrège et envoie |
| **Modération d'un message signalé** | Orchestration | Step Functions : `Choice` (auto vs revue humaine via `.waitForTaskToken`) → action |

Principes appliqués :

- **API Gateway + Lambda + DynamoDB** (modules 07/06/09) = le CRUD de base du feed ; Step Functions n'intervient **que** pour les process multi-étapes.
- **Idempotence partout** : chaque écriture feed porte une `ConditionExpression` sur `uploadId`/`messageId`. Un rejeu ne double jamais une entrée.
- **DLQ systématique** (module 10) sur les invocations async et les souscriptions SNS.
- **Rôle IAM de moindre privilège** (module 01) par état et par Lambda : la state machine n'a que `states:StartExecution` et les permissions des Task qu'elle invoque.
- **Standard pour l'auditable**, **Express pour le volume idempotent** — choisi avant déploiement.

> Déployer cette state machine par CI/CD (CodePipeline, GitHub Actions → AWS via OIDC) = **module 17**. Concevoir l'archi cloud complète de TribuZen = capstone **module 18**.

---

## 6. Points clés

1. Une architecture serverless **assemble** des services managés (Lambda, API Gateway, DynamoDB, messaging) event-driven ; ce module coordonne, il n'introduit que **Step Functions**.
2. Pattern de base : **API Gateway → Lambda → DynamoDB**. Dès qu'une opération fait plusieurs étapes, on **coordonne** plutôt que d'empiler dans une Lambda.
3. **Orchestration** (chef central, flux explicite, Step Functions) vs **chorégraphie** (events, flux implicite, couplage faible) : ordre+état → orchestration, découplage → chorégraphie, et on mixe.
4. **Step Functions** décrit un workflow en **ASL** (JSON). États : **Task** (travail) + Flow states **Choice/Parallel/Map/Wait/Pass/Succeed/Fail**. `Parallel` = branches différentes, `Map` = mêmes étapes sur un tableau.
5. **Retry** (backoff) et **Catch** (route d'erreur) rendent la robustesse **déclarative**, sans code de retry. **Intégrations directes** (`arn:aws:states:::dynamodb:putItem`) suppriment les Lambdas intermédiaires.
6. **Standard** = 1 an, **exactly-once**, état persisté, audit 90 j, prix par transition, actions **non-idempotentes**. **Express** = 5 min, **at-least-once/at-most-once**, prix par exécution+durée, actions **idempotentes**. Type **immuable**.
7. L'event-driven **rejoue** : sans **idempotence** (clé + écriture conditionnelle) → doublons. Non négociable.
8. **Saga** = pour chaque action une **compensation**, déclenchée par un `Catch`. **DLQ** = dernier filet pour les échecs asynchrones.

---

## 7. Seeds Anki

```
Orchestration vs chorégraphie en serverless ?|Orchestration : un chef central (Step Functions) connaît toutes les étapes, flux explicite, gère erreurs/retry/compensation, couplage plus fort. Chorégraphie : pas de chef, chaque service émet des events, les autres réagissent, flux implicite, couplage faible mais aucune vue d'ensemble.
Quels sont les 7 Flow states de Step Functions (en plus de Task) ?|Choice (branche conditionnelle), Parallel (branches simultanées), Map (mêmes étapes sur chaque élément d'un tableau), Wait (pause), Pass (passe/transforme l'entrée), Succeed (fin succès), Fail (fin échec).
Différence entre l'état Parallel et l'état Map ?|Parallel lance des branches DIFFÉRENTES en même temps (nombre fixe). Map lance les MÊMES étapes sur chaque élément d'un tableau (nombre variable selon l'entrée).
À quoi servent Retry et Catch dans un Task ASL ?|Retry réessaie l'étape en cas d'erreur avec backoff (IntervalSeconds, MaxAttempts, BackoffRate). Catch route vers un autre état si l'erreur persiste (ErrorEquals, Next). La robustesse est déclarative, pas codée dans la Lambda.
Step Functions Standard vs Express : durée, sémantique, prix ?|Standard : jusqu'à 1 an, exactly-once, état persisté, prix par transition d'état, audit 90 jours, pour actions non-idempotentes. Express : jusqu'à 5 min, at-least-once (async) / at-most-once (sync), prix par exécutions+durée+mémoire, logs via CloudWatch, pour actions idempotentes haut volume.
Pourquoi l'idempotence est-elle obligatoire en event-driven ?|Parce que la livraison est "au moins une fois" (SQS, Lambda async, Express) : le même event peut arriver deux fois. Un handler idempotent produit le même état final quel que soit le nombre de traitements. Technique : clé d'idempotence + écriture conditionnelle (attribute_not_exists).
Qu'est-ce qu'une intégration directe (SDK integration) Step Functions ?|Un Task qui appelle directement une API AWS sans Lambda intermédiaire, via un ARN de service comme arn:aws:states:::dynamodb:putItem ou arn:aws:states:::sns:publish. Moins de code, moins de coût, moins de latence.
Qu'est-ce que le pattern saga et comment l'implémenter avec Step Functions ?|Une saga gère la cohérence d'un process multi-étapes sans transaction ACID distribuée : si une étape échoue, on compense (annule) les étapes déjà réussies en ordre inverse. Avec Step Functions : chaque Task a un Catch qui route vers son état de compensation.
Le type de workflow Step Functions est-il modifiable après création ?|Non, il est immuable. Choisir Standard ou Express avant de déployer ; se tromper oblige à recréer la state machine (nouvel ARN) et à mettre à jour les triggers.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-16-serverless-architecture/README.md`. Tu déploies une **vraie** state machine Step Functions dans ton compte AWS (Console Workflow Studio ou AWS CLI + ASL JSON), tu l'**invoques** réellement (`start-execution`), tu observes le graphe d'exécution étape par étape, tu forces un échec pour voir `Retry` et `Catch` agir — puis tu **détruis** tout (teardown). Corrigé ASL complet, feedback coach, variante J+30.
