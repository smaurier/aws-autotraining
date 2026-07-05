---
titre: Lambda — fonctions serverless, handler et cycle d'exécution
cours: 12-aws-cloud
notions: [fonction Lambda, handler, "convention index.handler", runtimes managés, "signature (event, context)", async vs callback, objet event, objet context, "getRemainingTimeInMillis()", triggers, "invocation synchrone vs asynchrone", cold start, warm start, "phase Init / Invoke / Shutdown", réutilisation d'environnement, mémoire, "1769 MB = 1 vCPU", timeout, "concurrency (RPS x durée)", concurrence réservée, concurrence provisionnée, throttling, layers, variables d'environnement]
outcomes:
  - sait écrire un handler Node.js Lambda et configurer la propriété Handler (index.handler)
  - sait lire l'objet event selon le trigger et exploiter le context (getRemainingTimeInMillis, awsRequestId)
  - sait expliquer cold start vs warm start via les phases Init/Invoke/Shutdown et placer l'init des clients hors du handler
  - sait choisir mémoire, timeout et concurrence (réservée/provisionnée) à partir des limites réelles du service
prerequis: [Module 00 — compte, régions, CLI, Module 01 — IAM roles, Module 04 — S3, Module 05 — CDK]
next: 07-api-gateway
libs: []
tribuzen: infra cloud TribuZen — Lambda de traitement (miniatures d'avatars S3, écriture feed DynamoDB) portée par un role de moindre privilège
last-reviewed: 2026-07
---

# Lambda — fonctions serverless, handler et cycle d'exécution

> **Outcomes — tu sauras FAIRE :** écrire un handler Node.js et configurer sa propriété Handler, lire `event`/`context` selon le trigger, expliquer cold start vs warm start via les phases Init/Invoke/Shutdown, dimensionner mémoire/timeout/concurrence à partir des limites réelles.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **Lambda seul** — la fonction, son handler, son cycle d'exécution, ses limites, sa concurrence. **Exposer** une Lambda en HTTP (REST/HTTP API, autorisers, stages) est le sujet du **module 07 (API Gateway)**. **Enchaîner** plusieurs Lambdas en workflow (Step Functions, patterns event-driven) est le sujet du **module 16 (architectures serverless)**. Ici on répond à une seule question : *comment une fonction Lambda s'exécute, et comment la configurer correctement ?*

## 1. Cas concret d'abord

Tu montes l'infra AWS de TribuZen. Un parent poste une photo de famille : elle atterrit dans le bucket S3 `tribuzen-avatars`. Il faut en générer une **miniature** de façon automatique, sans serveur qui tourne 24/7 pour ça. C'est le cas d'école serverless : une fonction déclenchée par l'événement « objet créé dans S3 ».

Un collègue te tend ce premier jet de handler `generateThumbnail` :

```javascript
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

export const handler = async (event) => {
  const s3 = new S3Client();                       // (1) client recréé à CHAQUE invocation
  const bucket = event.Records[0].s3.bucket.name;
  const key = event.Records[0].s3.object.key;

  const original = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buffer = Buffer.from(await original.Body.transformToByteArray());
  const thumb = await sharp(buffer).resize(200, 200).toBuffer();  // (2) sharp = grosse dépendance

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `thumbnails/${key}`,                        // (3) réécrit dans le MÊME bucket que le trigger
    Body: thumb,
  }));
};
```

Il te dit : « configure la fonction sur 128 Mo, timeout 3 s, et déploie ». Quatre problèmes concrets qui vont te sauter à la figure en production :

1. Le `new S3Client()` est **dans** le handler : il est reconstruit à chaque invocation au lieu d'être réutilisé entre deux appels sur un environnement chaud. Tu paies de la latence pour rien.
2. `sharp` est une dépendance native lourde : à 128 Mo, le redimensionnement d'une photo peut dépasser 3 s → **timeout**, et le CPU est proportionnel à la mémoire (128 Mo = une fraction de vCPU).
3. Écrire la miniature `thumbnails/...` dans le **même** bucket qui déclenche la fonction crée une **boucle d'invocation** : la miniature re-déclenche la fonction, qui re-crée une miniature… facture qui explose.
4. Personne n'a réfléchi au **cold start** ni à la **concurrence** : que se passe-t-il si 500 photos arrivent en même temps ?

À la fin de ce module, tu sais écrire ce handler correctement (init hors handler, préfixe filtré, mémoire/timeout dimensionnés) et expliquer *pourquoi* chaque choix évite un problème réel — chiffres du service à l'appui, pas au doigt mouillé.

---

## 2. Théorie complète, concise

### 2.1 Ce qu'est une fonction Lambda

**AWS Lambda** est un service de calcul **serverless** : tu fournis du code, AWS fournit et gère l'environnement d'exécution (OS, runtime, scaling, disponibilité). Tu ne gères aucun serveur. Tu paies uniquement le **nombre d'invocations** + la **durée × mémoire** consommées — zéro coût quand la fonction ne tourne pas.

Une fonction Lambda = **du code** (ton handler + ses dépendances) + **une configuration** (runtime, mémoire, timeout, variables d'environnement, role IAM, triggers). Elle est **stateless** : rien ne doit être supposé persistant entre deux invocations (voir 2.6).

### 2.2 Le handler — le point d'entrée

Le **handler** est la méthode que Lambda appelle pour chaque événement. En Node.js, c'est une fonction exportée :

```javascript
// index.mjs
export const handler = async (event, context) => {
  // ta logique
  return { ok: true };
};
```

La **propriété `Handler`** de la configuration désigne ce point d'entrée au format `fichier.méthodeExportée`. La valeur par défaut (console + doc AWS) est **`index.handler`** : la méthode `handler` exportée depuis `index.js` ou `index.mjs`. Si tu nommes ton fichier `thumbnail.js` et ta fonction `run`, la propriété Handler doit valoir `thumbnail.run`.

**CommonJS vs ES modules** : Lambda supporte les deux. AWS **recommande les ES modules** (`.mjs`, ou `"type": "module"` dans `package.json`) car ils permettent le **top-level await** — utile pour finir une tâche asynchrone d'initialisation (voir 2.6). CommonJS utilise `exports.handler = ...`, ES modules `export const handler = ...`.

### 2.3 Signatures valides et async vs callback

AWS **recommande le pattern async/await**. Signatures valides pour un handler Node.js (doc officielle) :

```javascript
export const handler = async (event) => { /* ... */ };            // async, event seul
export const handler = async (event, context) => { /* ... */ };   // async, event + context (recommandé)
export const handler = (event) => { /* ... */ };                  // synchrone (aucune tâche async)
export const handler = (event, context, callback) => { /* ... */ }; // style callback (hérité)
```

Le style **callback** (`callback(err, result)`) est **hérité** : il n'est supporté que **jusqu'à Node.js 22**. À partir de **Node.js 24**, les tâches asynchrones doivent passer par un handler `async`. Retiens : en 2026, écris toujours un handler `async` et fais `return` de ta réponse (ou `throw` en cas d'erreur).

### 2.4 L'objet `event` — dépend du trigger

`event` contient les données de l'événement déclencheur, en **JSON**. Sa **forme dépend de la source** qui invoque la fonction :

| Trigger | Forme de `event` (extrait) | Ce qu'on y lit |
|---------|----------------------------|----------------|
| S3 | `event.Records[].s3.bucket.name`, `.s3.object.key` | bucket + clé de l'objet créé/supprimé |
| SQS | `event.Records[].body`, `.messageId` | corps et id de chaque message |
| DynamoDB Streams | `event.Records[].dynamodb.NewImage` / `.OldImage` | image avant/après d'un item |
| SNS | `event.Records[].Sns.Message` | message publié |
| EventBridge (planifié) | `event.time`, `event.detail` | horodatage, charge utile |
| API Gateway (proxy) | `event.httpMethod`, `event.path`, `event.body` | requête HTTP — **détaillé au module 07** |
| Invocation directe (CLI/SDK) | le JSON exact que tu passes | ce que tu veux |

Note S3 : la **clé** arrive URL-encodée, avec les espaces en `+` — il faut la décoder (`decodeURIComponent(key.replace(/\+/g, ' '))`).

### 2.5 L'objet `context` — métadonnées de l'invocation

`context` décrit l'invocation, la fonction et l'environnement. Propriétés et méthodes utiles :

```javascript
export const handler = async (event, context) => {
  context.functionName;               // nom de la fonction
  context.functionVersion;            // version en cours ($LATEST ou numéro)
  context.awsRequestId;               // id unique de CETTE invocation (à logger, traçable)
  context.memoryLimitInMB;            // mémoire allouée (string)
  context.logGroupName;               // groupe CloudWatch Logs
  context.getRemainingTimeInMillis(); // ms restantes avant le timeout — décroît en temps réel
};
```

`getRemainingTimeInMillis()` est le plus précieux : il te permet d'**abandonner proprement** (checkpoint, flush) avant que Lambda ne coupe brutalement la fonction au timeout.

### 2.6 Le cycle d'exécution : Init, Invoke, Shutdown

Lambda exécute ta fonction dans un **environnement d'exécution** isolé, dont le cycle de vie a trois phases (doc « execution environment lifecycle ») :

1. **Init** — Lambda télécharge le code, démarre le runtime, puis exécute ton **code statique** (tout ce qui est *hors* du handler : imports, création des clients SDK). Cette phase est **limitée à 10 secondes** pour une fonction on-demand standard (au-delà, Lambda réessaie l'init à la première invocation avec le timeout configuré). Elle ne se produit **qu'une fois par environnement**.
2. **Invoke** — Lambda appelle ton handler avec `event` et `context`. La durée totale est plafonnée par le **timeout** configuré. Cette phase se répète à chaque requête.
3. **Shutdown** — quand Lambda décide de recycler l'environnement (inactivité, maintenance), il l'arrête. Lambda **termine les environnements toutes les quelques heures** même sous charge continue : ne suppose jamais un environnement éternel.

Entre deux invocations, l'environnement est **gelé** (frozen) puis **dégelé** (thawed) pour la requête suivante. C'est le fondement de la **réutilisation** : tout objet déclaré hors du handler (client SDK, connexion DB, cache en `/tmp`) **survit** au gel et peut être réutilisé — d'où le piège #1 du cas concret.

### 2.7 Cold start vs warm start

- **Cold start** : Lambda doit **créer un nouvel environnement** (Init + Invoke). Le téléchargement du code + le démarrage du runtime + ton init statique ajoutent de la **latence** à cette première invocation. D'après la doc AWS, les cold starts touchent **typiquement moins de 1 % des invocations**, avec une durée allant de **moins de 100 ms à plus d'une seconde** — plus fréquents en dev/test (fonctions peu appelées) qu'en prod.
- **Warm start** : l'environnement existe déjà et est disponible → Lambda saute l'Init et exécute directement le handler. Nettement plus rapide.

Leviers pour réduire le cold start (doc « cold starts and latency » / « optimizing static initialization ») :

| Levier | Effet |
|--------|-------|
| Init des clients **hors** du handler | réutilisés sur les warm starts, plus recréés |
| Bundle **minifié**, dépendances minimales | code plus petit → download + parse plus rapides |
| Importer **seulement** les clients SDK utiles (`@aws-sdk/client-s3`) | moins de code à charger à l'init |
| Plus de **mémoire** | plus de CPU → init plus rapide |
| **Concurrence provisionnée** (2.9) | environnements pré-chauffés → cold start éliminé (payant) |

### 2.8 Mémoire, CPU, timeout (limites réelles — vérifiées doc)

| Paramètre | Valeur (quota Lambda) |
|-----------|------------------------|
| Mémoire | **128 MB à 10 240 MB**, par incréments de 1 MB |
| CPU | **proportionnel à la mémoire** — à **1 769 MB**, la fonction a l'équivalent d'**1 vCPU** |
| Timeout | **900 s (15 min)** maximum |
| Stockage `/tmp` | **512 MB à 10 240 MB**, par incréments de 1 MB |
| Variables d'environnement | **4 KB** au total (toutes variables agrégées) |
| Package de déploiement (.zip) | **50 MB** zippé (via API/SDK/console), **250 MB** décompressé (code + layers) |
| Payload d'invocation | **6 MB** en requête **et** en réponse (**synchrone**) ; **1 MB** (**asynchrone**) |

Point clé souvent mal compris : **on ne règle pas le CPU directement**. On augmente la mémoire, et le CPU suit. Une fonction CPU-bound (redimensionnement d'image, comme le cas concret) va souvent **plus vite ET moins cher** à 512–1024 MB qu'à 128 MB, parce qu'elle finit bien plus tôt.

Règle de pouce timeout : **timeout ≈ 3 × la durée moyenne d'exécution**. Trop court → coupures ; trop long → une fonction bloquée facture jusqu'à la limite.

### 2.9 Concurrence

La **concurrency** est le **nombre de requêtes traitées simultanément**. Pour chaque requête concurrente, Lambda provisionne un environnement séparé. Formule officielle :

```
Concurrency = (requêtes par seconde moyennes) × (durée moyenne d'une requête en secondes)
```

Exemple : 100 req/s à 500 ms chacune → `100 × 0,5 = 50` environnements concurrents.

Quotas et contrôles (doc « function scaling ») :

- **Limite de compte par défaut : 1 000** exécutions concurrentes, partagées par toutes les fonctions d'une région (augmentable sur demande).
- **Vitesse de montée en charge** : chaque fonction peut créer au plus **1 000 environnements toutes les 10 secondes** (ou 10 000 req/s toutes les 10 s).
- **Limite req/s** = **10 × la concurrence** du compte (défaut 1 000 → 10 000 req/s).
- **Concurrence réservée** : réserve une part du pool à une fonction (borne **max ET min**). Aucune autre fonction ne peut l'utiliser ; la fonction ne peut pas dépasser cette borne.
- **Concurrence provisionnée** : **pré-initialise** N environnements → pas de cold start (payant). N'est pas la même chose que la réservée.
- **Throttling** : quand la concurrence disponible est épuisée, Lambda **jette** les requêtes. En invocation **synchrone**, l'appelant reçoit **429 TooManyRequestsException** ; en invocation **asynchrone**, Lambda **réessaie** automatiquement.

### 2.10 Triggers et modes d'invocation

Un **trigger** relie une source d'événements à ta fonction. Deux modes d'invocation structurants :

- **Synchrone** : l'appelant attend la réponse (ex. API Gateway, invocation directe `RequestResponse`). Le throttling remonte une erreur ; ta gestion d'erreur compte.
- **Asynchrone** : Lambda met l'événement en file et répond immédiatement à l'appelant (ex. S3, SNS, EventBridge). Lambda **réessaie** en cas d'échec et peut router les échecs vers une **Dead Letter Queue** ou une destination.

Les sources de flux (SQS, DynamoDB/Kinesis Streams) utilisent un **event source mapping** : Lambda *poll* la source et invoque la fonction par **batches** de records.

### 2.11 Layers et variables d'environnement

- Un **layer** est une archive réutilisable (bibliothèques, runtime custom, données de référence) montée dans `/opt`, partagée entre plusieurs fonctions. **Maximum 5 layers** par fonction ; le total décompressé (code + layers) reste plafonné à **250 MB**.
- Les **variables d'environnement** (`process.env.MA_VAR`) passent des paramètres à la fonction **sans recompiler** (nom de table, niveau de log, stage). Plafond **4 KB** agrégé. Ne jamais y mettre de secret en clair : préférer **SSM Parameter Store** ou **Secrets Manager** (chargés à l'init, chiffrés — sujet approfondi au module 15).

### 2.12 Runtimes managés

Lambda fournit des runtimes managés (Node.js 20/22, Python 3.13, Java 21, .NET 8…) et des **custom runtimes** (`provided.al2023`) pour Go, Rust, etc. TypeScript n'est **pas** exécuté nativement : on **transpile/bundle** vers du JavaScript (esbuild, ou `NodejsFunction` du CDK qui bundle automatiquement) avant de déployer. Détail de packaging au lab et au module 05 (CDK).

---

## 3. Worked examples

### Exemple 1 — Réécrire le handler de miniatures du cas concret

Objectif : corriger les 4 problèmes. On reste sur du JavaScript déployable tel quel.

```javascript
// index.mjs — handler generateThumbnail (corrigé)
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

// ── Phase INIT (une seule fois par environnement) ──
// Client créé HORS du handler : réutilisé sur tous les warm starts.
const s3 = new S3Client();
const THUMB_BUCKET = process.env.THUMB_BUCKET; // bucket SÉPARÉ → pas de boucle

// ── Phase INVOKE (à chaque événement S3) ──
export const handler = async (event, context) => {
  for (const record of event.Records) {
    const srcBucket = record.s3.bucket.name;
    // la clé S3 arrive URL-encodée, espaces en '+'
    const srcKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    const original = await s3.send(new GetObjectCommand({ Bucket: srcBucket, Key: srcKey }));
    const buffer = Buffer.from(await original.Body.transformToByteArray());
    const thumb = await sharp(buffer).resize(200, 200).toBuffer();

    await s3.send(new PutObjectCommand({
      Bucket: THUMB_BUCKET,            // écrit AILLEURS → aucune ré-invocation
      Key: `thumbnails/${srcKey}`,
      Body: thumb,
      ContentType: original.ContentType,
    }));

    // log traçable : l'awsRequestId relie ce log à l'invocation dans CloudWatch
    console.log(JSON.stringify({ requestId: context.awsRequestId, srcKey, done: true }));
  }
};
```

Configuration associée (CLI) :

```bash
aws lambda update-function-configuration \
  --function-name tribuzen-generate-thumbnail \
  --memory-size 1024 \   # plus de CPU pour sharp → finit en ~300 ms au lieu de timeout
  --timeout 15 \         # ~3x la durée observée, marge pour les grosses images
  --environment '{"Variables":{"THUMB_BUCKET":"tribuzen-thumbnails"}}'
```

Ce qui a changé, et pourquoi :

- **Client hors handler** : sur un warm start, on ne recrée plus `S3Client` → moins de latence.
- **Bucket de destination séparé** (`THUMB_BUCKET`) : la miniature n'atterrit pas dans le bucket qui déclenche la fonction → la **boucle d'invocation** est cassée.
- **Mémoire 1024 MB** : le CPU monte avec la mémoire, `sharp` finit largement sous le timeout.
- **Timeout 15 s** : ~3× la durée réelle observée, avec marge — pas 3 s « au hasard ».
- **`awsRequestId` loggé** : chaque traitement est traçable dans CloudWatch Logs.

### Exemple 2 — Dimensionner la concurrence pour un pic de photos

Le dimanche soir, les familles postent en masse : on observe un pic de **300 photos/seconde**, et le handler corrigé tourne en **~0,3 s**.

Concurrence nécessaire :

```
Concurrency = 300 req/s × 0,3 s = 90 environnements simultanés
```

90 est bien en-dessous de la limite de compte par défaut (1 000) → **aucun throttling** attendu, aucune réservation nécessaire. Mais :

- Le trigger S3 est **asynchrone** : en cas de pic au-delà du disponible, Lambda **réessaie** au lieu de perdre l'événement — la file absorbe la rafale.
- La **vitesse de montée** (1 000 environnements/10 s) couvre largement une montée de 0 à 90.
- Si cette fonction était **critique** et partageait le compte avec d'autres gourmandes, on lui donnerait une **concurrence réservée** (ex. 150) pour garantir sa capacité. Si la **latence** du premier appel après une accalmie était inacceptable, on ajouterait de la **concurrence provisionnée** — mais c'est payant, et pour un traitement d'image asynchrone la latence du cold start n'a aucune importance : **on ne provisionne pas ici**.

Conclusion chiffrée : mémoire 1024 MB, timeout 15 s, pas de concurrence réservée/provisionnée. Chaque décision découle d'un nombre, pas d'une intuition.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Initialiser les clients SDK dans le handler

Créer `new S3Client()` (ou une connexion DB) **à l'intérieur** du handler le reconstruit à **chaque** invocation, y compris sur un environnement chaud où l'ancien était réutilisable. Le correct : déclarer les clients **hors** du handler (phase Init) pour profiter de la réutilisation d'environnement. Nuance : ne stocke **jamais** de données utilisateur dans ce scope global — elles fuiteraient d'une invocation à l'autre.

### PIÈGE #2 — Croire qu'un environnement (ou `/tmp`) est un stockage fiable

Lambda est **stateless**. Un environnement peut être recyclé à tout moment, et Lambda en **termine toutes les quelques heures** même sous charge. `/tmp` survit *tant que* l'environnement est chaud, mais c'est un **cache opportuniste**, pas une base. Ne compte jamais dessus pour de la persistance : la source de vérité est S3/DynamoDB.

### PIÈGE #3 — Régler le CPU… qui n'existe pas comme réglage

Il n'y a pas de curseur CPU. Le CPU est **proportionnel à la mémoire** (1 vCPU à 1 769 MB). Laisser une fonction CPU-bound à 128 MB « pour économiser » est un faux calcul : elle tourne plus longtemps, coûte souvent **autant ou plus**, et risque le timeout. Augmenter la mémoire peut réduire la facture.

### PIÈGE #4 — Confondre concurrence réservée et provisionnée

- **Réservée** : borne la concurrence (max **et** min) d'une fonction, prise sur le pool du compte. **Gratuite.** Ne supprime **pas** les cold starts.
- **Provisionnée** : **pré-chauffe** N environnements → supprime le cold start. **Payante.**

On confond souvent « réserver » et « pré-chauffer » : réserver garantit de la *capacité*, provisionner garantit de la *latence*. Ce sont deux réglages distincts, combinables.

### PIÈGE #5 — Payload asynchrone à 256 Ko

Non : la limite de payload **asynchrone est de 1 MB** (et **6 MB** en synchrone, requête comme réponse). L'ancienne valeur de 256 Ko traîne dans de vieux cours. Un event S3/SNS qui dépasse est rare, mais un gros JSON passé en invocation asynchrone directe peut cogner ce **1 MB**.

### PIÈGE #6 — Écrire le résultat dans le bucket qui déclenche la fonction

Une Lambda déclenchée par « objet créé dans le bucket X » qui **réécrit** dans le bucket X **se re-déclenche elle-même** → boucle infinie et facture galopante. Solutions : bucket de destination **séparé**, ou **filtre de préfixe/suffixe** sur le trigger (ne déclencher que sur `uploads/`, écrire dans `thumbnails/`).

### PIÈGE #7 — Le style callback « marche encore »

Le handler `callback(err, res)` n'est supporté que **jusqu'à Node.js 22** ; **Node.js 24** exige un handler `async`. Écris toujours `export const handler = async (event) => { ... }` et `return` ta réponse : c'est le pattern recommandé et le seul pérenne.

---

## 5. Ancrage TribuZen

Lambda est le **calcul événementiel** de TribuZen : pas de serveur qui tourne pour rien, une fonction par tâche, déclenchée par un événement.

| Fonction TribuZen | Trigger | Invocation | Ce qu'elle fait |
|-------------------|---------|------------|-----------------|
| `generateThumbnail` | S3 (objet créé dans `tribuzen-avatars`) | asynchrone | miniature 200×200 → bucket `tribuzen-thumbnails` |
| `postFeedMessage` | API Gateway (module 07) | synchrone | écrit un message dans DynamoDB `TribuZenFeed` |
| `notifyFamily` | DynamoDB Streams sur `TribuZenFeed` | asynchrone (stream) | publie une notif (SNS) quand un message est ajouté |
| `dailyDigest` | EventBridge (cron quotidien) | asynchrone | agrège l'activité de la journée par famille |

Principes appliqués côté TribuZen :

- **Un role IAM de moindre privilège par fonction** (module 01) : `generateThumbnail` n'a que `s3:GetObject` sur `tribuzen-avatars/*` et `s3:PutObject` sur `tribuzen-thumbnails/*`. Aucune access key dans le code.
- **Init hors handler** systématique : clients `@aws-sdk/client-*` réutilisés entre invocations.
- **Mémoire/timeout dimensionnés par mesure** : image → 1024 MB / 15 s ; écriture DynamoDB → 256 MB / 10 s.
- **Variables d'environnement** pour les noms de ressources (`THUMB_BUCKET`, `FEED_TABLE`) — jamais codés en dur, injectés par le **CDK** (module 05). Les secrets vont dans Secrets Manager (module 15).
- **Bucket source ≠ bucket destination** pour la miniature : pas de boucle d'invocation.

> Exposer `postFeedMessage` en HTTP (routes, autorisers Cognito, stages) = **module 07**. Orchestrer `generateThumbnail` → modération → notification en un workflow = **module 16**. Ici, chaque Lambda est vue **isolément**.

---

## 6. Points clés

1. Lambda = calcul **serverless** : tu fournis un handler + une config, AWS gère l'exécution ; paiement à l'invocation + durée × mémoire, zéro coût à l'arrêt.
2. Le **handler** est le point d'entrée ; la propriété **`Handler`** vaut `fichier.méthode` (défaut **`index.handler`**). Pattern **`async`** recommandé ; le **callback** n'existe que jusqu'à Node.js 22.
3. **`event`** dépend du **trigger** (S3, SQS, DynamoDB Streams, SNS, EventBridge, API Gateway, direct) ; **`context`** porte `awsRequestId`, `memoryLimitInMB`, `getRemainingTimeInMillis()`.
4. Cycle **Init / Invoke / Shutdown** : l'Init (≤ 10 s, code hors handler) ne tourne qu'une fois par environnement, puis l'environnement est **réutilisé** — d'où l'init des clients **hors** du handler.
5. **Cold start** (nouvel environnement, < 1 % des invocations, ~100 ms à > 1 s) vs **warm start** ; réduits par init hors handler, bundle minimal, plus de mémoire, ou concurrence provisionnée.
6. Limites réelles : mémoire **128–10 240 MB** (CPU proportionnel, **1 vCPU à 1 769 MB**), timeout **900 s**, `/tmp` **512–10 240 MB**, env vars **4 KB**, package **50 MB zip / 250 MB décompressé**, payload **6 MB sync / 1 MB async**.
7. **Concurrency = req/s × durée** ; défaut **1 000/région**, montée **1 000 env/10 s** par fonction ; **réservée** (borne, gratuite) ≠ **provisionnée** (pré-chauffée, payante) ; throttling → **429** en synchrone, **retry** en asynchrone.
8. **5 layers** max (250 MB total décompressé) ; **variables d'environnement** pour la config, jamais de secret en clair (→ SSM/Secrets Manager).

---

## 7. Seeds Anki

```
Que vaut la propriété Handler par défaut d'une fonction Lambda Node.js, et que signifie-t-elle ?|index.handler : la méthode "handler" exportée depuis le fichier index.js ou index.mjs. Format général : fichier.méthodeExportée.
Pourquoi initialiser un client SDK HORS du handler Lambda ?|Le code hors handler s'exécute en phase Init, une seule fois par environnement, et l'objet survit au gel/dégel. Il est donc réutilisé sur les warm starts au lieu d'être recréé à chaque invocation.
Cold start vs warm start Lambda ?|Cold start : Lambda crée un nouvel environnement (download code + démarrage runtime + init statique) → latence ajoutée, < 1 % des invocations, ~100 ms à > 1 s. Warm start : environnement déjà chaud réutilisé, l'Init est sauté.
Comment le CPU d'une Lambda est-il déterminé ?|Il n'y a pas de réglage CPU direct : le CPU est proportionnel à la mémoire allouée. À 1 769 MB, la fonction dispose de l'équivalent d'1 vCPU.
Quelles sont les limites clés de Lambda (mémoire, timeout, payload) ?|Mémoire 128 à 10 240 MB (1 MB d'incrément), timeout max 900 s (15 min), payload 6 MB en synchrone (requête et réponse) et 1 MB en asynchrone, env vars 4 KB au total.
Formule de la concurrence Lambda, et limite par défaut ?|Concurrency = requêtes par seconde × durée moyenne en secondes. Limite de compte par défaut : 1 000 exécutions concurrentes par région (augmentable).
Concurrence réservée vs provisionnée ?|Réservée : borne max et min de concurrence d'une fonction, prise sur le pool du compte, gratuite, ne supprime pas les cold starts. Provisionnée : environnements pré-initialisés, supprime les cold starts, payante.
Que se passe-t-il quand une Lambda dépasse sa concurrence disponible ?|En invocation synchrone, l'appelant reçoit 429 TooManyRequestsException. En invocation asynchrone, Lambda met en file et réessaie automatiquement.
Pourquoi ne faut-il pas écrire le résultat dans le bucket S3 qui déclenche la fonction ?|Écrire dans le bucket source re-déclenche la fonction (boucle d'invocation infinie, facture galopante). Solution : bucket de destination séparé ou filtre de préfixe/suffixe sur le trigger.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-06-lambda/README.md`. Tu déploies une **vraie** Lambda Node.js dans ton compte AWS (via CDK `NodejsFunction` ou la CLI), tu l'**invoques** réellement, tu observes cold vs warm start et les logs CloudWatch, tu ajustes mémoire/timeout — puis tu **détruis** tout (teardown). Corrigé complet, feedback coach, variante J+30.
