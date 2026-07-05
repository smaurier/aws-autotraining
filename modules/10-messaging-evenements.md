---
titre: Messaging et événements — SQS, SNS, EventBridge
cours: 12-aws-cloud
notions: [SQS standard, SQS FIFO, "at-least-once (doublons possibles)", exactly-once, "ordre best-effort vs strict FIFO", visibility timeout, in-flight messages, long polling, Dead Letter Queue, redrive policy, maxReceiveCount, "SNS pub/sub", topic, subscription, filter policy, "fan-out SNS vers SQS", SNS FIFO, EventBridge, event bus, "règle (rule)", target, event pattern, detail-type, "message group ID", "deduplication ID"]
outcomes:
  - sait choisir entre SQS, SNS et EventBridge selon le besoin de découplage
  - sait distinguer une queue SQS standard (at-least-once, ordre best-effort) d'une queue FIFO (exactly-once, ordre strict) et configurer visibility timeout et DLQ
  - sait câbler un fan-out SNS vers plusieurs queues SQS et le tester au CLI
  - sait router un événement métier avec un event bus EventBridge, une règle et un event pattern
prerequis: [Modules 00-09 — compte, IAM, Lambda (module 06) comme consumer, DynamoDB (module 09)]
next: 11-cognito-authentification
libs: []
tribuzen: infra cloud TribuZen — diffusion des événements métier (nouvelle sortie familiale, nouveau message feed) vers email, push et projections, via fan-out SNS vers SQS et bus EventBridge
last-reviewed: 2026-07
---

# Messaging et événements — SQS, SNS, EventBridge

> **Outcomes — tu sauras FAIRE :** choisir entre SQS / SNS / EventBridge, configurer une queue (standard vs FIFO, visibility timeout, DLQ), câbler un fan-out SNS→SQS, router un événement avec EventBridge.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre le **messaging et les événements** — files (SQS), publication/abonnement (SNS), bus d'événements (EventBridge) et leurs patterns (fan-out, DLQ). La **Lambda** qui consomme une queue est vue au **module 06** : ici elle n'est qu'un *consumer* au bout du tuyau. L'**orchestration** de plusieurs étapes avec état (Step Functions, saga orchestrée) est le sujet du **module 16 (architectures serverless)**. Ici on répond à une seule question : *comment faire communiquer deux composants sans les coupler ?*

## 1. Cas concret d'abord

Tu montes le back de TribuZen. Un parent publie une **nouvelle sortie familiale** (« Rando dimanche 10h »). Au moment du clic « Publier », il faut :

1. envoyer un **email** aux membres de la famille,
2. envoyer une **notification push** aux mobiles,
3. mettre à jour une **projection** (le compteur « sorties à venir » du tableau de bord),
4. écrire une ligne dans le **journal d'audit**.

Le collègue propose ce handler « pour aller vite » — tout en synchrone dans la Lambda qui reçoit le POST :

```ts
// postOuting — version couplée, tout en synchrone (à NE PAS faire)
export async function handler(event) {
  const outing = JSON.parse(event.body)
  await db.putOuting(outing)          // 40 ms
  await sendEmails(outing)            // 1 200 ms — dépend d'un SMTP externe
  await sendPush(outing)             // 800 ms  — dépend d'APNs/FCM
  await updateDashboard(outing)       // 60 ms
  await writeAudit(outing)            // 30 ms
  return { statusCode: 201 }          // total ~2,1 s, et si l'email plante, TOUT plante
}
```

Trois problèmes concrets :

1. **Latence** : le parent attend ~2 s pour un « OK, publié » qui ne devrait prendre que le temps d'écrire en base.
2. **Couplage à la panne** : si le fournisseur d'email est down, l'`await sendEmails` jette → la sortie n'est **pas** enregistrée, alors qu'elle n'a rien à voir avec l'email.
3. **Pas de reprise** : un push raté est perdu. Aucun mécanisme ne le rejoue.

Ce qu'on veut : la Lambda **enregistre la sortie**, **émet un événement** « SortieCréée », et rend la main en ~50 ms. Email, push, projection et audit réagissent **chacun de leur côté**, en asynchrone, avec reprise sur panne. À la fin de ce module, tu sais câbler exactement ça — et choisir, à chaque flèche, entre SQS, SNS et EventBridge.

---

## 2. Théorie complète, concise

### 2.1 Le point commun : découpler avec de l'asynchrone

Un appel **synchrone** (`await autreService()`) crée un couplage temporel : l'appelant est bloqué et tombe si l'appelé tombe. Le messaging insère un **intermédiaire managé** entre producteur et consommateur : le producteur dépose le message et rend la main ; le consommateur le traite à son rythme. Trois services AWS, trois modèles :

| Service | Modèle | En une phrase |
|---------|--------|---------------|
| **SQS** | file d'attente (queue) | un message → **un** consommateur le prend, le traite, le supprime |
| **SNS** | publication/abonnement (pub/sub) | un message → **tous** les abonnés du topic en reçoivent une copie |
| **EventBridge** | bus d'événements | un événement → routé vers des cibles selon des **règles** qui filtrent son **contenu** |

### 2.2 SQS — la file d'attente

Un **producteur** envoie un message dans la queue (`SendMessage`). Un **consommateur** le récupère (`ReceiveMessage`), le traite, puis le supprime (`DeleteMessage`). Tant qu'il n'est pas supprimé, le message reste dans la queue — rien n'est perdu si le consommateur plante.

**Standard vs FIFO** (comparaison vérifiée sur la doc SQS) :

| Caractéristique | Standard | FIFO |
|-----------------|----------|------|
| **Ordre** | best-effort (non garanti) | strict FIFO garanti (par `message group ID`) |
| **Livraison** | **at-least-once** — un message peut être livré **plus d'une fois** (doublons possibles) | **exactly-once** — déduplication intégrée |
| **Débit** | illimité | jusqu'à **300 msg/s** sans batching, **3 000 msg/s** avec batching (mode high-throughput au-delà) |
| **Nom de la queue** | libre | doit se terminer par **`.fifo`** |

Corollaire pédagogique majeur : sur une queue **standard**, ton consommateur **doit être idempotent** (traiter deux fois le même message sans double effet). La queue FIFO garantit l'ordre *dans un même* `message group ID` et déduplique via un `deduplication ID` (fenêtre de déduplication de 5 minutes).

### 2.3 Visibility timeout — le mécanisme central de SQS

Quand un consommateur reçoit un message, celui-ci **reste dans la queue** mais devient **temporairement invisible** aux autres consommateurs : c'est le **visibility timeout** (doc SQS). Objectif : empêcher deux consommateurs de traiter le même message en parallèle.

- **Défaut : 30 secondes.** Le compte à rebours démarre **dès la livraison** du message.
- Si le consommateur **traite puis supprime** (`DeleteMessage`) avant l'expiration → le message disparaît. Bien.
- Si le consommateur **plante ou dépasse le délai** → le message **redevient visible** et un autre consommateur le reprend. C'est la reprise sur panne.
- Règle : **cale le visibility timeout sur le temps max de traitement.** Trop court → un message lent est repris et traité en double. Trop long → un message raté met longtemps à réapparaître.
- On peut l'allonger en cours de traitement avec `ChangeMessageVisibility` (pattern *heartbeat*), et le mettre à `0` pour rendre le message immédiatement visible. **Maximum : 12 heures** à partir de la première réception (l'allonger ne remet pas ce plafond à zéro).
- Même avec un visibility timeout, le modèle **at-least-once** de SQS ne garantit **pas** qu'un message ne sera jamais livré deux fois → idempotence obligatoire côté consommateur.

Les messages reçus mais pas encore supprimés sont dits **in-flight**. Une queue standard en supporte environ **120 000** simultanément ; au-delà, `ReceiveMessage` renvoie `OverLimit` (en short polling).

### 2.4 Long polling vs short polling

`ReceiveMessage` peut attendre qu'un message arrive au lieu de répondre « vide » immédiatement :

- **Short polling** : réponse immédiate, même si la queue est vide → beaucoup de requêtes vides, plus coûteux.
- **Long polling** (`WaitTimeSeconds` jusqu'à **20 s**) : la requête attend qu'un message arrive (ou 20 s) → moins de requêtes vides. **À activer par défaut.**

### 2.5 Dead Letter Queue (DLQ) et redrive

Un message « poison » (mal formé, qui fait toujours planter le consommateur) reviendrait indéfiniment après chaque visibility timeout, bloquant la queue. La **Dead Letter Queue** l'isole (doc SQS DLQ) :

- Sur la queue source, on configure une **redrive policy** avec un **`maxReceiveCount`** : le nombre de fois qu'un message peut être reçu **sans être supprimé** avant d'être déplacé vers la DLQ. Ex. `maxReceiveCount = 3` → après 3 échecs, direction DLQ.
- La DLQ sert au **debug** : on inspecte les messages non consommés pour comprendre *pourquoi* le traitement a échoué. On peut ensuite les **redrive** (renvoyer vers la source) une fois le bug corrigé.
- Contraintes vérifiées : **la DLQ doit être dans le même compte et la même région** que la source, et **du même type** — une queue FIFO cible une DLQ FIFO, une standard une DLQ standard.
- Bonne pratique : **rétention de la DLQ plus longue** que celle de la source (l'horodatage d'enqueue d'origine est conservé sur une queue standard), et **alarme CloudWatch** sur la profondeur de la DLQ — un message en DLQ = un problème à regarder.

### 2.6 SNS — publication / abonnement (fan-out)

SNS délivre des messages de **publishers** vers des **subscribers** de façon asynchrone via un **topic** (« logical access point and communication channel », doc SNS). Le publisher publie **une fois** ; **chaque abonné** reçoit sa copie. Types d'endpoints d'abonnement (doc SNS) : **Amazon SQS, Lambda, HTTP(S), email, mobile push, SMS, Amazon Data Firehose**, et certains fournisseurs tiers.

Le pattern phare est le **fan-out** : un message publié sur un topic est **répliqué** vers plusieurs endpoints (queues SQS, Lambda, HTTP…) pour un traitement **parallèle et asynchrone** (scénario « Fanout » de la doc SNS). En pratique, on branche **SNS → plusieurs queues SQS**, et chaque queue est consommée par sa propre Lambda. Chaque queue agit comme un **buffer indépendant** : si le service email est down, ses messages s'accumulent dans *sa* queue sans affecter le push ni la projection.

**Filter policy** : par défaut un abonné reçoit **tous** les messages du topic. Une **filter policy** (JSON) sur l'abonnement fait que celui-ci ne reçoit **que** les messages correspondants — filtrage sur les **attributs** du message ou sur le **corps** JSON selon le `FilterPolicyScope` (doc SNS filtering).

**SNS FIFO** : comme SQS, SNS propose des topics **FIFO** (ordre + déduplication) conçus pour s'intégrer aux **queues SQS FIFO** — l'ordre strict de bout en bout n'est garanti que si les abonnés sont des queues **SQS FIFO** (doc SNS FIFO).

### 2.7 EventBridge — le bus d'événements

EventBridge est un service **serverless** qui « uses events to connect application components together » (doc EventBridge). Un **event bus** est un routeur qui reçoit des **événements** et les délivre à zéro ou plusieurs **targets**, en fonction de **règles**.

| Composant | Rôle |
|-----------|------|
| **Event bus** | canal qui reçoit les événements. **default bus** (événements des services AWS), **custom bus** (tes événements applicatifs), **partner bus** (SaaS tiers) |
| **Rule** | associe un **event pattern** (ou une planification) à une ou plusieurs targets |
| **Target** | destination : Lambda, SQS, SNS, Step Functions, autre bus… |
| **Event pattern** | filtre **sur le contenu** de l'événement |

**Structure d'un événement** (doc EventBridge, format vérifié) :

```json
{
  "version": "0",
  "id": "6a7e8feb-b491-4cf7-a9f1-bf3703467718",
  "detail-type": "OutingCreated",
  "source": "tribuzen.outings",
  "account": "111122223333",
  "time": "2026-07-03T09:00:00Z",
  "region": "eu-west-3",
  "resources": [],
  "detail": { "outingId": "out-42", "familyId": "fam-7", "startsAt": "2026-07-06T10:00:00Z" }
}
```

Quand tu émets ton propre événement via **`PutEvents`**, tu fournis **`Source`**, **`DetailType`** et **`Detail`** ; `EventBusName` est optionnel (défaut : `default`). EventBridge génère automatiquement `version`, `id`, `time`, `account`, `region` (doc PutEvents).

Un **event pattern** matche le contenu. Ex. « sorties créées dans le futur » :

```json
{
  "source": ["tribuzen.outings"],
  "detail-type": ["OutingCreated"],
  "detail": { "familyId": [{ "exists": true }] }
}
```

EventBridge fournit aussi un **scheduler** (expressions `cron(...)` et `rate(...)`) pour les tâches planifiées — il remplace l'ancien CloudWatch Events.

### 2.8 Quand utiliser quoi — l'arbre de décision

```
Besoin de découpler A et B ?
├── Un seul consommateur, buffer/reprise/back-pressure ......... SQS
├── Plusieurs consommateurs reçoivent le MÊME message ..........  SNS (fan-out),
│     souvent SNS → plusieurs SQS (buffer par consommateur)
└── Routage selon le CONTENU, écosystème événementiel,
      événements de services AWS ou SaaS, planification CRON ....  EventBridge
```

Repères de discrimination :

- **SQS = tampon 1-vers-1.** Absorbe les pics, garantit la reprise, un consommateur par message.
- **SNS = diffusion 1-vers-N.** Filtrage simple par **attributs**, latence faible, endpoints variés (email/SMS/push inclus).
- **EventBridge = routage riche 1-vers-N** par **contenu**, avec catalogue de cibles AWS, intégrations SaaS, archive/replay et planification. Latence un peu plus élevée que SNS.

Combinaison fréquente : **EventBridge** décide *quoi* réagit à un événement métier, et derrière chaque cible on met une **SQS** pour bufferiser le consommateur.

---

## 3. Worked examples

### Exemple 1 — Fan-out « SortieCréée » : SNS → 3 queues SQS + DLQ (TribuZen)

On reprend le cas concret. La Lambda `postOuting` enregistre la sortie puis **publie un seul message** sur un topic SNS. Trois queues SQS y sont abonnées (email, push, projection), chacune consommée par sa Lambda, chacune protégée par une DLQ.

```
postOuting (Lambda) ──publish──▶ SNS topic  tribuzen-outing-events
                                     ├──▶ SQS  outing-email       ──▶ Lambda email      (+ DLQ)
                                     ├──▶ SQS  outing-push        ──▶ Lambda push       (+ DLQ)
                                     └──▶ SQS  outing-projection  ──▶ Lambda projection (+ DLQ)
```

**Étape 1 — créer le topic et les queues (AWS CLI) :**

```bash
# Topic SNS
aws sns create-topic --name tribuzen-outing-events
# → note le TopicArn renvoyé

# Une queue par consommateur (ici la queue email)
aws sqs create-queue --queue-name outing-email
aws sqs create-queue --queue-name outing-email-dlq
```

**Étape 2 — brancher la DLQ sur la queue email (redrive policy, maxReceiveCount=3) :**

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.eu-west-3.amazonaws.com/111122223333/outing-email \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-3:111122223333:outing-email-dlq\",\"maxReceiveCount\":\"3\"}",
    "VisibilityTimeout": "60"
  }'
```

- `maxReceiveCount: 3` : après 3 réceptions **sans suppression**, le message part en DLQ (isole le message poison).
- `VisibilityTimeout: 60` : cale l'invisibilité sur ~60 s, le temps qu'un envoi d'email lent aboutisse.

**Étape 3 — abonner la queue au topic :**

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-west-3:111122223333:tribuzen-outing-events \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:eu-west-3:111122223333:outing-email
```

(Il faut aussi une policy sur la queue autorisant le topic à y écrire — voir le lab.)

**Étape 4 — publier UN événement, vérifier qu'il arrive dans CHAQUE queue :**

```bash
aws sns publish \
  --topic-arn arn:aws:sns:eu-west-3:111122223333:tribuzen-outing-events \
  --message '{"outingId":"out-42","familyId":"fam-7","startsAt":"2026-07-06T10:00:00Z"}'

# Le même message est apparu dans les 3 queues :
aws sqs receive-message \
  --queue-url https://sqs.eu-west-3.amazonaws.com/111122223333/outing-email \
  --wait-time-seconds 20
```

**Analyse.** La Lambda `postOuting` a fait **un seul** `publish` et rendu la main en ~50 ms. Le fan-out SNS a répliqué le message dans les trois queues. Si la Lambda email échoue 3 fois (SMTP down), son message tombe en DLQ **sans** toucher au push ni à la projection — les deux autres flux avancent normalement. C'est exactement le découplage que le cas concret réclamait.

### Exemple 2 — Router le même événement métier avec EventBridge

Autre approche du même besoin : au lieu de publier sur un topic dédié, `postOuting` émet un **événement métier** sur un **custom bus**, et des **règles** décident quelles cibles réagissent. Avantage : ajouter un nouveau consommateur = ajouter une **règle**, sans toucher au producteur.

```bash
# 1. Bus custom
aws events create-event-bus --name tribuzen-bus

# 2. Règle : matcher les sorties créées
aws events put-rule \
  --name outing-created-rule \
  --event-bus-name tribuzen-bus \
  --event-pattern '{
    "source": ["tribuzen.outings"],
    "detail-type": ["OutingCreated"]
  }'

# 3. Cible : la Lambda de notification (Detail requis, Source/DetailType requis)
aws events put-targets \
  --rule outing-created-rule \
  --event-bus-name tribuzen-bus \
  --targets '[{"Id":"notify","Arn":"arn:aws:lambda:eu-west-3:111122223333:function:notify-family"}]'

# 4. Émettre l'événement métier
aws events put-events \
  --entries '[{
    "Source": "tribuzen.outings",
    "DetailType": "OutingCreated",
    "Detail": "{\"outingId\":\"out-42\",\"familyId\":\"fam-7\"}",
    "EventBusName": "tribuzen-bus"
  }]'
```

**Analyse.** `postOuting` ne connaît **aucun** consommateur : il émet `OutingCreated` sur le bus, point. La règle `outing-created-rule` matche le pattern et déclenche `notify-family`. Demain, si on veut aussi indexer la sortie dans un moteur de recherche, on ajoute une **deuxième règle** avec une cible SQS → nouvelle Lambda, **sans modifier le producteur**. C'est la différence clé avec SNS : EventBridge filtre sur le **contenu** (`detail.familyId`, `detail.startsAt`…) et route selon des règles, là où SNS diffuse à tous les abonnés (filtrés au mieux par attributs).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'une queue standard préserve l'ordre / ne double jamais

Une queue **standard** est **best-effort** sur l'ordre et **at-least-once** sur la livraison : un message peut arriver **dans le désordre** et être livré **plusieurs fois**. Si ton traitement suppose l'ordre ou n'est pas idempotent, tu auras des bugs intermittents en prod. Solutions : rendre le consommateur **idempotent** (clé d'idempotence), ou passer en **FIFO** si l'ordre strict et l'exactly-once sont vraiment nécessaires (au prix du débit).

### PIÈGE #2 — Régler le visibility timeout plus court que le traitement

Si le traitement prend 90 s mais que le visibility timeout est à 30 s (le défaut), le message **redevient visible** à 30 s alors qu'il est encore en cours → un second consommateur le reprend, et tu traites **deux fois** le même message. Cale toujours le visibility timeout sur le **temps max** de traitement (ou allonge-le en vol via `ChangeMessageVisibility`).

### PIÈGE #3 — Confondre SNS et EventBridge « parce que les deux font du 1-vers-N »

- **SNS** : pub/sub, filtrage par **attributs** de message, endpoints A2P inclus (email, SMS, push), latence faible. On **s'abonne** à un topic.
- **EventBridge** : bus qui route par **event pattern sur le contenu**, catalogue de cibles AWS, intégrations SaaS, archive/replay, planification. On écrit des **règles**.
Choisir SNS quand tu veux juste diffuser vite à N abonnés (souvent des queues) ; EventBridge quand tu veux **router selon le contenu** et brancher/débrancher des consommateurs sans toucher au producteur.

### PIÈGE #4 — Fan-out en abonnant directement des Lambdas au lieu de SNS→SQS→Lambda

Abonner une **Lambda directement** à SNS marche, mais si la Lambda échoue, il n'y a **pas de buffer** : SNS retente selon sa propre politique puis abandonne (ou envoie à une DLQ SNS). Le pattern robuste est **SNS → SQS → Lambda** : la queue SQS **bufferise**, applique un **visibility timeout** et une **DLQ SQS**, et absorbe les pics. Buffer par consommateur = panne isolée.

### PIÈGE #5 — Oublier la policy qui autorise SNS à écrire dans la queue SQS

Abonner une queue à un topic ne suffit pas : il faut une **policy sur la queue SQS** avec un `Principal` `sns.amazonaws.com` et une `Condition` `aws:SourceArn` = ARN du topic. Sans elle, l'abonnement se crée mais **aucun message n'arrive** dans la queue (les livraisons échouent silencieusement). Symptôme classique : « j'ai publié, la queue reste vide ».

### PIÈGE #6 — Utiliser une DLQ d'un autre type / région / compte

La DLQ doit être **du même type** (FIFO↔FIFO, standard↔standard), dans le **même compte** et la **même région** que la source (doc SQS). Une DLQ standard sur une source FIFO, ou dans une autre région, est **refusée** ou ne reçoit rien. Et attention : mettre une DLQ sur une queue **FIFO** casse l'ordre strict des messages déplacés (à éviter si l'ordre est critique).

---

## 5. Ancrage TribuZen

Le messaging est la colonne asynchrone de TribuZen : chaque événement métier (nouvelle sortie, nouveau message feed, invitation acceptée) est **émis une fois** et **consommé par plusieurs réactions indépendantes**.

| Flux TribuZen | Service | Pourquoi ce choix |
|---------------|---------|-------------------|
| « SortieCréée » → email + push + projection + audit | **SNS fan-out → 4× SQS → 4× Lambda** | un événement, N consommateurs indépendants, buffer + DLQ par consommateur |
| Envoi d'emails de rappel (traitement lourd, pics) | **SQS standard** | tampon 1-vers-1, reprise sur panne, back-pressure sur le SMTP |
| Débit/crédit du « pot commun » famille (ordre critique) | **SQS FIFO** | ordre strict + exactly-once sur les opérations d'argent (`message group ID` = familyId) |
| Routage des événements métier vers de nouveaux consommateurs sans toucher aux producteurs | **EventBridge** (`tribuzen-bus`) | règles + event pattern par contenu, brancher/débrancher sans redéploier le producteur |
| Job planifié « rappel des sorties de demain, 18h » | **EventBridge Scheduler** (`cron`) | planification serverless native |

Principes appliqués côté TribuZen :

- **Aucun `await` synchrone** entre deux domaines métier : on émet un événement, on rend la main.
- **Idempotence** systématique sur les consommateurs de queues standard (clé = `outingId` + type de réaction).
- **DLQ + alarme CloudWatch** sur chaque queue : un message en DLQ déclenche une alerte.
- Les ARN de topics/queues/bus seront produits par le **CDK** (module 05) et les roles des consommateurs suivent le **moindre privilège** (module 01) : la Lambda email n'a que `sqs:ReceiveMessage`/`DeleteMessage` sur *sa* queue.

> L'**orchestration** d'un flux multi-étapes avec état et compensation (réserver → payer → confirmer, avec rollback) relève des **Step Functions** au **module 16** — ici, chaque réaction est indépendante et sans coordination centrale.

---

## 6. Points clés

1. **SQS = file 1-vers-1** (buffer, reprise), **SNS = pub/sub 1-vers-N** (fan-out), **EventBridge = bus** qui route par contenu selon des règles.
2. **SQS standard** = **at-least-once** (doublons possibles) + ordre **best-effort** → consommateur **idempotent** obligatoire ; **SQS FIFO** = **exactly-once** + ordre **strict** (nom en `.fifo`, `message group ID`, `deduplication ID`), débit limité (300/s, 3 000/s avec batching).
3. **Visibility timeout** (défaut **30 s**, max **12 h**) rend un message invisible pendant le traitement ; s'il n'est pas supprimé à temps, il **redevient visible** → cale-le sur le temps de traitement.
4. **DLQ** via **redrive policy** + **`maxReceiveCount`** isole les messages poison ; même **type/compte/région** que la source ; surveiller avec une alarme CloudWatch.
5. **Long polling** (`WaitTimeSeconds` jusqu'à 20 s) réduit les requêtes vides — à activer par défaut.
6. **Fan-out** robuste = **SNS → plusieurs SQS → plusieurs Lambda** : un buffer + une DLQ par consommateur, pannes isolées ; ne pas oublier la **policy** autorisant SNS à écrire dans la queue.
7. **EventBridge** : `PutEvents` avec `Source`/`DetailType`/`Detail` requis ; **règle** + **event pattern** filtrent sur le **contenu** ; brancher un consommateur = ajouter une règle, sans toucher au producteur.
8. **SNS FIFO** préserve l'ordre de bout en bout **seulement** avec des abonnés **SQS FIFO**.

---

## 7. Seeds Anki

```
SQS standard : quelles garanties d'ordre et de livraison, et quelle conséquence pour le consommateur ?|Ordre best-effort (non garanti) et livraison at-least-once (doublons possibles). Conséquence : le consommateur DOIT être idempotent.
SQS FIFO vs standard : qu'apporte FIFO et à quel prix ?|FIFO garantit l'ordre strict (par message group ID) et l'exactly-once (déduplication via deduplication ID), au prix d'un débit limité (300 msg/s, 3 000 avec batching) et d'un nom finissant par .fifo.
Visibility timeout SQS : valeur par défaut, effet, et que se passe-t-il si le message n'est pas supprimé à temps ?|Défaut 30 s (max 12 h). Le message devient invisible dès la réception pour éviter un double traitement. S'il n'est pas supprimé avant l'expiration, il redevient visible et un autre consommateur le reprend.
À quoi sert une Dead Letter Queue et comment la déclenche-t-on ?|Elle isole les messages "poison" qui échouent en boucle. On configure une redrive policy avec maxReceiveCount sur la queue source : après ce nombre de réceptions sans suppression, le message part en DLQ. La DLQ doit être du même type/compte/région.
Différence entre SNS et EventBridge alors que les deux diffusent en 1-vers-N ?|SNS = pub/sub, filtrage par attributs, endpoints variés (SQS, Lambda, email, SMS, push), latence faible, on s'abonne à un topic. EventBridge = bus qui route par event pattern sur le CONTENU, catalogue de cibles AWS, intégrations SaaS, archive/replay, planification ; on écrit des règles.
Quel est le pattern de fan-out robuste et pourquoi pas abonner les Lambdas directement à SNS ?|SNS → plusieurs SQS → plusieurs Lambda. Chaque queue bufferise (visibility timeout + DLQ), isole les pannes et absorbe les pics. Abonner une Lambda directement à SNS n'offre pas ce buffer par consommateur.
Quels champs sont requis quand on émet un événement EventBridge via PutEvents ?|Source, DetailType et Detail. EventBridge génère automatiquement version, id, time, account et region ; EventBusName est optionnel (défaut : default).
On publie sur un topic SNS mais la queue SQS abonnée reste vide : cause la plus probable ?|Il manque la policy sur la queue SQS autorisant sns.amazonaws.com à y écrire (Principal SNS + Condition aws:SourceArn = ARN du topic). L'abonnement existe mais les livraisons échouent silencieusement.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-10-messaging/README.md`. Tu crées un vrai topic SNS et deux vraies queues SQS (avec DLQ + visibility timeout), tu câbles le fan-out, tu publies au CLI et tu vérifies que le message arrive dans **chaque** queue — puis tu détruis tout (teardown, Free Tier). Corrigé complet, feedback coach, variante J+30.
