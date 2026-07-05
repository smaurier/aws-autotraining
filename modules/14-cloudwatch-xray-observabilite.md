---
titre: CloudWatch & X-Ray — observer l'infra AWS de TribuZen
cours: 12-aws-cloud
notions: [CloudWatch Logs, log event, log stream, log group, "convention /aws/lambda/<fn>", rétention de logs, metric filter, logs structurés JSON, CloudWatch Metrics, "namespace AWS/<service>", dimension, métrique custom, "PutMetricData", résolution standard vs haute, "StorageResolution à 1", période, statistiques, percentiles p99, rétention des métriques, CloudWatch Alarms, "états OK / ALARM / INSUFFICIENT_DATA", alarme à seuil, alarme d'anomalie, alarme composite, action SNS, Dashboards, Logs Insights, X-Ray, segment, subsegment, trace, service map, annotations vs metadata, sampling, "header X-Amzn-Trace-Id", corrélation logs/traces]
outcomes:
  - sait structurer les logs Lambda en JSON et les requêter avec Logs Insights (filter, stats, bin)
  - sait publier une métrique custom via PutMetricData et poser une alarme à seuil qui notifie via SNS
  - sait activer le tracing X-Ray, lire un service map et distinguer segment, subsegment, annotation et metadata
  - sait corréler un log et une trace via le request id / trace id pour localiser un goulot
prerequis: [Modules 00-13 du cours 12-aws-cloud — compte/IAM/CLI, Lambda (06), API Gateway (07), DynamoDB (09), messaging SNS (10), ECS/Fargate (12), CloudFront (13)]
next: 15-securite-aws-avancee
libs: []
tribuzen: "infra cloud TribuZen — observabilité de l'API feed (Lambda + API Gateway + DynamoDB) ; logs structurés, métrique custom, alarme SNS, trace X-Ray de bout en bout"
last-reviewed: 2026-07
---

# CloudWatch & X-Ray — observer l'infra AWS de TribuZen

> **Outcomes — tu sauras FAIRE :** structurer les logs Lambda en JSON et les requêter avec Logs Insights, publier une métrique custom et poser une alarme SNS, activer X-Ray et lire un service map, corréler un log et une trace pour localiser un goulot.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **deux outils AWS** — **CloudWatch** (Logs, Metrics, Alarms, Dashboards, Logs Insights) et **X-Ray** (tracing distribué). C'est le **volet AWS** de l'observabilité : quelles ressources activer, quelles API appeler, comment lire les consoles. La **théorie générale** de l'observabilité et du SRE (SLI/SLO/SLA, budgets d'erreur, on-call, les « trois piliers » comme discipline) est le sujet du **cours 16 (observability-sre)**. Ici on répond à une seule question : *comment instrumenter et observer l'infra TribuZen déployée sur AWS, avec les outils AWS ?*

## 1. Cas concret d'abord

Tu es d'astreinte sur TribuZen. Dimanche 20h, un parent écrit au support : « le fil de la famille rame, parfois ça poste, parfois non ». Tu ouvres la console AWS. La Lambda `postFeedMessage` (derrière API Gateway, qui écrit dans DynamoDB `TribuZenFeed`) est **verte** : ni erreur, ni throttle visible dans les métriques standard. Et pourtant ça rame.

Tu ouvres les logs de la fonction. Voici ce que le handler écrit aujourd'hui :

```javascript
export const handler = async (event) => {
  console.log('start');                         // (1) aucun contexte
  const body = JSON.parse(event.body);
  await ddb.send(new PutItemCommand({ /* ... */ }));
  console.log('done');                          // (2) pas de durée, pas d'id
  return { statusCode: 201 };
};
```

Face à la panne, tu es **aveugle**, pour quatre raisons concrètes :

1. Les logs sont du **texte libre** (`start`, `done`) : impossible de les agréger, de filtrer les lents, de compter les échecs. Logs Insights ne peut rien en tirer.
2. Aucune **métrique métier** : tu vois `Invocations` et `Duration` d'AWS, mais pas « combien de messages postés », ni « combien ont dépassé 1 s ».
3. Aucune **alarme** : personne n'a été prévenu. Tu apprends la panne par un utilisateur, 40 minutes après le début.
4. Aucune **trace** : quand une requête est lente, tu ne sais pas *où* — dans la Lambda ? dans l'appel DynamoDB ? dans un cold start ? Les logs de chaque service sont séparés.

À la fin de ce module, tu sais transformer cette fonction aveugle en fonction **observable** : logs structurés JSON requêtables, une métrique custom `MessagesPostes` + une alarme SNS qui te réveille *avant* l'utilisateur, et une trace X-Ray qui te montre en un coup d'œil que les 800 ms « perdues » sont l'appel DynamoDB — chiffres et API du service à l'appui.

---

## 2. Théorie complète, concise

### 2.1 CloudWatch Logs — event, stream, group

**CloudWatch Logs** ingère et stocke les logs. Trois niveaux :

| Concept | Définition | Exemple TribuZen |
|---------|-----------|------------------|
| **Log event** | une entrée : un timestamp + un message | `{"level":"info","msg":"feed posted"}` |
| **Log stream** | une séquence d'events d'**une même source** | une instance d'exécution Lambda |
| **Log group** | une collection de streams du **même type**, où se règlent rétention et permissions | `/aws/lambda/tribuzen-post-feed` |

Chaque service pose ses logs dans un groupe à convention fixe : Lambda écrit dans **`/aws/lambda/<nom-fonction>`** ; API Gateway et ECS ont leurs propres groupes. `console.log` dans une Lambda part automatiquement dans son log group (le role d'exécution a la permission par défaut).

### 2.2 Rétention — à configurer, toujours

Par défaut, un log group conserve ses events **indéfiniment** (**Never expire**) — et tu paies le stockage à vie. Il faut **fixer une rétention** sur chaque groupe :

```bash
aws logs put-retention-policy \
  --log-group-name /aws/lambda/tribuzen-post-feed \
  --retention-in-days 30
```

Valeurs valides : 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653 jours (entre autres). Repère : **dev 7 j**, **prod applicatif 30 j**, **audit/compliance 365 j+**.

### 2.3 Logs structurés JSON — le prérequis de tout le reste

Un log en **texte libre** (`console.log('done')`) n'est pas exploitable. Un log **structuré JSON** l'est : chaque champ devient requêtable et agrégeable.

```javascript
// ❌ texte libre — Logs Insights ne peut pas filtrer sur "durée"
console.log('done in', ms, 'ms');

// ✅ JSON structuré — chaque clé est un champ requêtable
console.log(JSON.stringify({
  level: 'info',
  msg: 'feed_posted',
  requestId: context.awsRequestId,   // relie ce log à l'invocation
  familyId,
  durationMs: ms,
}));
```

Logs Insights **découvre automatiquement** les champs d'un event JSON (`familyId`, `durationMs`…). C'est ce qui rend possible les requêtes de la section 2.8.

### 2.4 Metric filters — transformer un pattern de log en métrique

Un **metric filter** attaché à un log group incrémente une métrique CloudWatch à chaque event qui matche un pattern. Utile pour compter des erreurs sans toucher au code :

```
Log group : /aws/lambda/tribuzen-post-feed
Pattern    : { $.level = "error" }        # event JSON dont level = error
Métrique   : TribuZen/FeedErrors  (+1 par match)
```

Patterns courants : `"ERROR"` (le mot brut), `{ $.level = "error" }` (champ JSON), `{ $.durationMs > 1000 }` (numérique). Le metric filter est une alternative *sans code* à `PutMetricData` (2.6) quand la donnée est déjà dans le log.

### 2.5 CloudWatch Metrics — namespace, dimensions, résolution

Une **métrique** est une série temporelle de points (timestamp + valeur + unité). Elle est identifiée par :

- un **namespace** (conteneur) : les services AWS utilisent la convention **`AWS/<service>`** (`AWS/Lambda`, `AWS/ApiGateway`…) ; tes métriques custom prennent un namespace à toi (`TribuZen/Feed`) ;
- un **nom** (`Duration`, `MessagesPostes`) ;
- **0 à 30 dimensions** — des paires nom/valeur (`FunctionName=tribuzen-post-feed`, `Env=prod`). Chaque combinaison unique de dimensions est une métrique distincte.

**Résolution** (vérifié doc) :

- **standard** = granularité **1 minute** (toutes les métriques AWS, par défaut) ;
- **haute résolution** = granularité **1 seconde**, via `StorageResolution` à 1 sur le point publié. Lisible à 1, 5, 10, 30 s ou multiple de 60. Plus cher (chaque `PutMetricData` est facturé) — à réserver aux cas sub-minute réels.

Un timestamp de point peut être jusqu'à **2 semaines dans le passé** et **2 heures dans le futur**.

### 2.6 Publier une métrique custom — `PutMetricData`

Les métriques AWS ne connaissent pas ton métier. Pour « nombre de messages postés », tu publies toi-même via l'API `PutMetricData` :

```javascript
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
const cw = new CloudWatchClient({});          // hors handler (réutilisé)

await cw.send(new PutMetricDataCommand({
  Namespace: 'TribuZen/Feed',
  MetricData: [{
    MetricName: 'MessagesPostes',
    Value: 1,
    Unit: 'Count',
    Dimensions: [{ Name: 'Env', Value: 'prod' }],
    // StorageResolution: 1,                   // décommenter pour de la haute résolution
  }],
}));
```

Alternative recommandée à fort volume : le format **EMF** (Embedded Metric Format) — tu écris un JSON spécial dans les logs et CloudWatch en extrait la métrique, sans appel API synchrone. Le role de la fonction doit porter `cloudwatch:PutMetricData` pour l'appel direct.

### 2.7 Périodes, statistiques, percentiles, rétention

Quand tu **lis** une métrique, tu choisis une **période** (durée d'agrégation d'un point) et une **statistique** :

- **Périodes valides** : 1, 5, 10, 30, ou tout **multiple de 60** secondes. Défaut **60 s**. Sous-minute réservé aux métriques haute résolution.
- **Statistiques** : `Average` (latence typique), `Sum` (nb de requêtes/erreurs), `Minimum`/`Maximum`, `SampleCount`, et surtout les **percentiles** `p50`, `p90`, **`p99`** (jusqu'à 10 décimales, ex. `p95.5`).

> **Latence : lis le p99, pas la moyenne.** La moyenne noie les pics ; « p99 = 1,2 s » dit que 1 % des parents attendent plus de 1,2 s — c'est *eux* qui écrivent au support.

**Rétention des métriques** (agrégation automatique, vérifié doc) : points < 60 s → **3 h** ; 60 s → **15 jours** ; 300 s (5 min) → **63 jours** ; 3600 s (1 h) → **455 jours (15 mois)**. Une métrique sans nouveau point **expire au bout de 15 mois** ; les métriques ne se suppriment pas manuellement.

### 2.8 CloudWatch Logs Insights — requêter les logs

**Logs Insights** est un langage de requête sur un ou plusieurs log groups. Pipeline de commandes séparées par `|` : `fields`, `filter`, `parse`, `stats … by`, `sort`, `limit`, `bin()`.

```
# Les 20 dernières erreurs (logs JSON)
fields @timestamp, @message
| filter level = "error"
| sort @timestamp desc
| limit 20
```

```
# p99 de la durée métier par tranche de 5 min
fields durationMs
| filter ispresent(durationMs)
| stats pct(durationMs, 99) as p99, avg(durationMs) as moy, count(*) as n by bin(5m)
| sort bin(5m) desc
```

```
# Top des familles les plus actives sur la fenêtre
fields familyId
| filter msg = "feed_posted"
| stats count(*) as posts by familyId
| sort posts desc
| limit 10
```

`@timestamp` et `@message` sont des champs intégrés ; les autres (`durationMs`, `familyId`) viennent de tes logs JSON. Un résultat Logs Insights s'**épingle sur un dashboard**.

### 2.9 CloudWatch Alarms — seuil, anomalie, composite

Une **alarme** surveille **une** métrique sur une fenêtre et **change d'état** selon un seuil. Trois **états** : **`OK`**, **`ALARM`**, **`INSUFFICIENT_DATA`** (pas assez de points). L'alarme n'agit que sur un **changement d'état soutenu** (N périodes d'évaluation), pas à chaque point.

Trois types :

1. **À seuil (threshold)** — « métrique > X pendant N périodes ». Le plus courant.

   ```bash
   aws cloudwatch put-metric-alarm \
     --alarm-name tribuzen-feed-errors \
     --namespace TribuZen/Feed --metric-name FeedErrors \
     --statistic Sum --period 300 \
     --threshold 5 --comparison-operator GreaterThanThreshold \
     --evaluation-periods 1 \
     --alarm-actions arn:aws:sns:eu-west-1:123456789012:tribuzen-oncall
   ```

2. **Anomalie (anomaly detection)** — CloudWatch apprend une bande « normale » (patterns jour/nuit, semaine/week-end) et alerte hors bande. Utile pour un trafic saisonnier comme le feed (pics le dimanche soir).
3. **Composite** — combine plusieurs alarmes en logique booléenne (`AND`/`OR`/`NOT`), ex. `AlarmeErreurs AND NOT AlarmeMaintenance`, pour réduire les faux positifs.

**Actions** : une transition déclenche une **notification SNS** (email/SMS/Slack via Lambda), une **action Auto Scaling**, une **action EC2**, ou un incident Systems Manager. Sur une métrique **haute résolution**, l'alarme peut avoir une période de **10 s ou 30 s** (surcoût).

### 2.10 CloudWatch Dashboards

Un **dashboard** rassemble des **widgets** (courbe, nombre, jauge, barres, état d'alarmes, résultat Logs Insights) sur une page. Coût : les **3 premiers dashboards** (≤ 50 métriques chacun) sont **gratuits**, puis ~3 $/mois par dashboard. Un dashboard TribuZen type : requêtes/min, p99 de latence, taux d'erreur, état des alarmes, 10 dernières erreurs (widget Logs Insights).

### 2.11 X-Ray — le problème du tracing distribué

Une requête TribuZen traverse plusieurs services : API Gateway → Lambda `postFeedMessage` → DynamoDB (et parfois → SNS). Si elle est lente, **où** est le temps ? Les logs de chaque service sont **séparés** ; les métriques disent *combien*, pas *où*. **X-Ray** reconstitue le **parcours de bout en bout** d'une requête.

| Concept | Définition |
|---------|-----------|
| **Trace** | le parcours complet d'**une** requête ; identifiée par un **trace ID** propagé entre services (données conservées **30 jours**) |
| **Segment** | le travail d'**un** service (ex. la Lambda) ; document ≤ 64 ko |
| **Subsegment** | un détail dans un segment (ex. l'appel DynamoDB à l'intérieur de la Lambda) ; sert à générer des **segments inférés** pour les services non instrumentés (DynamoDB) |
| **Service map** | le graphe auto-généré des services (nœuds) et de leurs appels (arêtes), avec latence, taux d'erreur, volume par nœud |

### 2.12 X-Ray — activation, sampling, header, annotations

- **Activation** (par service) : Lambda → cocher **Active tracing** dans la config ; API Gateway → activer sur le **stage** ; ECS → **sidecar** X-Ray daemon ; EC2 → daemon installé. Le role doit porter les permissions X-Ray (`xray:PutTraceSegments`, `xray:PutTelemetryRecords`).
- **Sampling** : par défaut, le SDK trace la **première requête de chaque seconde** + **5 %** des suivantes — conservateur pour maîtriser le coût. Règles personnalisables (tout tracer pour les écritures, échantillonner bas les health-checks).
- **Header de propagation** : `X-Amzn-Trace-Id: Root=1-...;Parent=...;Sampled=1`. Le premier service X-Ray l'ajoute et le propage ; c'est lui qui relie les segments d'une même trace.
- **Annotations vs metadata** : les **annotations** sont des paires clé/valeur **indexées** et filtrables (`annotation.familyId = "fam-42"`), **jusqu'à 50 par trace** ; les **metadata** ne sont **pas indexées** (payloads, objets), non filtrables.
- **Erreurs** classées : **Error** (4xx), **Fault** (5xx), **Throttle** (429).

Instrumentation Node.js typique :

```javascript
import AWSXRay from 'aws-xray-sdk-core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// enveloppe le client → chaque appel DynamoDB devient un subsegment tracé
const ddb = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));

const seg = AWSXRay.getSegment();
const sub = seg.addNewSubsegment('write-feed');
try {
  await writeFeed(msg);
  sub.addAnnotation('familyId', msg.familyId); // indexé → filtrable dans la console
  sub.addMetadata('payload', msg);             // non indexé → contexte seulement
} catch (e) {
  sub.addError(e);
  throw e;
} finally {
  sub.close();
}
```

### 2.13 Corréler logs et traces

C'est le point qui transforme le debug. La console CloudWatch affiche désormais logs, métriques **et** traces X-Ray au même endroit. Le pont concret :

- log ↔ invocation : tu **logges le `context.awsRequestId`** dans ton JSON → Logs Insights retrouve tous les events d'une invocation ;
- trace ↔ log : tu **poses le trace ID en annotation** (ou tu le logges) → depuis une trace lente du service map, tu sautes aux logs correspondants, et inversement.

Résultat : une trace montre *« 800 ms dans le subsegment DynamoDB »*, l'annotation `familyId` te donne la famille, et Logs Insights sur ce `requestId` te donne le détail applicatif. Tu passes de « ça rame » à la ligne exacte.

> **Hors périmètre de ce module** (outils CloudWatch adjacents, cités pour situer) : **Synthetics canaries** (parcours simulés proactifs), **Container Insights** (métriques ECS/EKS détaillées), **RUM** (monitoring navigateur réel). Mêmes principes, pas nécessaires pour instrumenter l'API feed.

---

## 3. Worked examples

### Exemple 1 — Rendre `postFeedMessage` observable (logs + métrique + trace)

On reprend le handler aveugle du §1 et on l'instrumente entièrement.

```javascript
// index.mjs — postFeedMessage instrumenté
import AWSXRay from 'aws-xray-sdk-core';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

// ── INIT (hors handler) : clients réutilisés, DynamoDB enveloppé par X-Ray ──
const ddb = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const cw  = new CloudWatchClient({});
const TABLE = process.env.FEED_TABLE;

export const handler = async (event, context) => {
  const t0 = Date.now();
  const { familyId, text } = JSON.parse(event.body);

  try {
    // l'appel DynamoDB devient un subsegment X-Ray automatiquement
    await ddb.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: `FAM#${familyId}` },
        sk: { S: `MSG#${Date.now()}` },
        text: { S: text },
      },
    }));

    const durationMs = Date.now() - t0;

    // log structuré JSON : requestId (corrélation) + durée + famille
    console.log(JSON.stringify({
      level: 'info', msg: 'feed_posted',
      requestId: context.awsRequestId, familyId, durationMs,
    }));

    // métrique métier : 1 message posté
    await cw.send(new PutMetricDataCommand({
      Namespace: 'TribuZen/Feed',
      MetricData: [{ MetricName: 'MessagesPostes', Value: 1, Unit: 'Count',
        Dimensions: [{ Name: 'Env', Value: 'prod' }] }],
    }));

    return { statusCode: 201, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    // log d'erreur structuré → captable par un metric filter { $.level = "error" }
    console.log(JSON.stringify({
      level: 'error', msg: 'feed_post_failed',
      requestId: context.awsRequestId, familyId, error: e.message,
    }));
    throw e; // relève → X-Ray marque un Fault, la métrique Errors AWS s'incrémente
  }
};
```

Ce qui a changé, et pourquoi :

- **Logs JSON** avec `requestId` : chaque event est requêtable et relié à son invocation.
- **`captureAWSv3Client`** : l'appel DynamoDB apparaît comme **subsegment** → le service map montre la latence DynamoDB isolément.
- **Métrique `MessagesPostes`** : indicateur métier, base d'un dashboard et d'une alarme.
- **`throw` conservé** : X-Ray enregistre un **Fault**, et la métrique AWS `Errors` s'incrémente → l'alarme peut s'appuyer dessus.

Config à activer : **Active tracing** sur la Lambda, et role portant `dynamodb:PutItem`, `cloudwatch:PutMetricData`, `xray:PutTraceSegments`, `xray:PutTelemetryRecords`.

### Exemple 2 — De l'alarme à la cause en 3 requêtes

Scénario : l'alarme à seuil `tribuzen-feed-errors` (2.9) passe **ALARM** dimanche 20h04 et notifie l'astreinte par SNS. Déroulé du diagnostic :

**1) Confirmer l'ampleur** (Logs Insights, log group `/aws/lambda/tribuzen-post-feed`) :

```
fields @timestamp, error, familyId
| filter level = "error"
| stats count(*) as erreurs by bin(5m)
| sort bin(5m) desc
```

→ 37 erreurs sur la dernière tranche de 5 min, en hausse. Ce n'est pas un point isolé.

**2) Localiser où** (X-Ray → service map, filtre `fault = true`) : le nœud **DynamoDB** est **rouge**, subsegment `write-feed` à **820 ms** avec des `ProvisionedThroughputExceeded`. La Lambda et API Gateway sont verts. Le goulot est l'écriture DynamoDB, pas le code.

**3) Relier au métier** : sur une trace en faute, l'annotation `familyId` pointe une poignée de grosses familles ; Logs Insights sur leur `requestId` confirme des écritures en rafale. Cause : capacité DynamoDB sous-dimensionnée pour le pic du dimanche soir (→ on-demand ou autoscaling, module 09).

Sans instrumentation : 40 min d'aveuglement. Avec : **alarme en < 5 min**, cause localisée en 3 requêtes. La chaîne **métrique → alarme → logs → trace** a fait tout le travail.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « C'est vert, donc tout va bien »

Les métriques **standard AWS** (`Errors`, `Throttles`) ne voient que ce qu'AWS sait. Une requête *lente mais réussie*, une donnée métier fausse, un timeout côté client : invisibles. Il faut des **métriques custom** (`MessagesPostes`, latence métier) et des **logs structurés**. Le vert AWS ≠ l'utilisateur content.

### PIÈGE #2 — Logs en texte libre

`console.log('done')` est inexploitable : Logs Insights ne peut ni filtrer, ni agréger, ni tracer. **Toujours logger du JSON** (`JSON.stringify({ level, msg, requestId, ... })`) — c'est le prérequis de Logs Insights, des metric filters et de la corrélation.

### PIÈGE #3 — Rétention « Never expire » oubliée

Un log group sans **`put-retention-policy`** garde tout **à vie** et facture le stockage sans fin. Fixe une rétention sur **chaque** groupe (dev 7 j, prod 30 j, audit 365 j+). C'est l'oubli de coût n°1 de l'observabilité.

### PIÈGE #4 — Alarmer sur la moyenne de latence

La moyenne masque les pics : « moyenne 120 ms » peut cacher un p99 à 2 s. Sur la latence, alarme sur le **p99** (ou p95). La moyenne est utile pour le CPU, pas pour la douleur utilisateur.

### PIÈGE #5 — Confondre annotation et metadata (X-Ray)

- **Annotation** = clé/valeur **indexée**, **filtrable** (`annotation.familyId = "x"`), **≤ 50 par trace**. Pour les identifiants (familyId, userId, orderId).
- **Metadata** = **non indexée**, non filtrable, sans limite stricte. Pour les payloads/objets de contexte.

Mettre un payload volumineux en annotation sature l'index et ne sert à rien ; mettre un identifiant en metadata le rend introuvable par filtre.

### PIÈGE #6 — Croire que X-Ray trace 100 % des requêtes

Par défaut, le SDK échantillonne : **1 requête/seconde + 5 %** du reste. Une requête précise peut n'avoir **aucune trace** (`Sampled=0`). C'est voulu (coût). Pour un debug ciblé ou les écritures critiques, ajuste les **règles de sampling** — ne conclus pas « pas de trace = pas passé ».

### PIÈGE #7 — Métrique haute résolution par défaut

Publier tout en `StorageResolution: 1` (1 s) multiplie les appels `PutMetricData` facturés et n'a d'intérêt que pour du sub-minute réel (trading, temps réel). Pour le feed TribuZen, la **résolution standard (1 min)** suffit largement.

### PIÈGE #8 — Confondre metric filter et PutMetricData

Le **metric filter** dérive une métrique d'un **pattern de log** déjà présent (sans code, rétroactif possible). **`PutMetricData`** publie une métrique **depuis le code** (contrôle total, mais appel API facturé). Pour compter les erreurs déjà loggées → metric filter. Pour une valeur métier précise → PutMetricData (ou EMF).

---

## 5. Ancrage TribuZen

L'observabilité TribuZen se pose sur l'infra déjà déployée dans les modules précédents :

| Ressource TribuZen | Ce qu'on observe | Outil |
|--------------------|------------------|-------|
| Lambda `post-feed`, `generate-thumbnail` | logs JSON (`requestId`, `durationMs`), `Duration`, `Errors` | Logs + Metrics |
| API Gateway (stage prod) | `4XXError`, `5XXError`, `Latency`, trace du stage | Metrics + X-Ray |
| DynamoDB `TribuZenFeed` | `ThrottledRequests`, latence via subsegment X-Ray | Metrics + X-Ray |
| Métier | `MessagesPostes`, `AvatarsGeneres` (custom) | PutMetricData |
| Bout en bout | parcours API GW → Lambda → DynamoDB | X-Ray service map |

Mise en place TribuZen :

- **Logs structurés partout** : chaque handler logge `{ level, msg, requestId, familyId, durationMs }`. Rétention 30 j en prod, 7 j en staging.
- **Métriques custom** : `TribuZen/Feed:MessagesPostes`, `TribuZen/Media:AvatarsGeneres`, résolution standard.
- **Alarmes → SNS `tribuzen-oncall`** : `5XXError` API Gateway, `ThrottledRequests` DynamoDB, `Errors` Lambda, latence **p99** > 1 s. Alarme **composite** pour ne pas notifier pendant un déploiement.
- **X-Ray activé** sur API Gateway (stage) + Lambdas, `captureAWSv3Client` sur les clients DynamoDB/S3, annotation `familyId` sur chaque trace.
- **Dashboard `tribuzen-prod`** : requêtes/min, p99 latence, taux d'erreur, état des alarmes, 10 dernières erreurs (Logs Insights).
- **IaC** : tout est défini en **CDK** (module 05) — log groups + rétention, alarmes, tracing activé — jamais cliqué à la main.

> Les **secrets** de l'alerting (webhook Slack) vont dans Secrets Manager (module 15). La **discipline SLO/on-call/budget d'erreur** autour de ces alarmes = **cours 16**. Ici, on a posé les *outils AWS* qui produisent le signal.

---

## 6. Points clés

1. **CloudWatch Logs** : event → stream → **log group** (`/aws/lambda/<fn>`) ; la **rétention** se règle par groupe (jamais « Never expire » en prod).
2. **Logs structurés JSON** obligatoires : c'est ce qui rend Logs Insights, les metric filters et la corrélation possibles.
3. **Metrics** : namespace (`AWS/<service>` ou custom), **≤ 30 dimensions** ; résolution **standard 1 min** vs **haute 1 s** (`StorageResolution: 1`, plus cher).
4. **Métrique custom** via **`PutMetricData`** (ou EMF à fort volume) ; permission `cloudwatch:PutMetricData` requise.
5. **Périodes** 1/5/10/30 s ou multiple de 60 (défaut 60) ; alarme/lecture latence sur **p99**, pas la moyenne. Rétention des métriques : 3 h / 15 j / 63 j / 455 j selon la période, expiration à 15 mois.
6. **Logs Insights** : pipeline `fields | filter | stats … by bin() | sort | limit` ; épinglable sur dashboard.
7. **Alarmes** : états **OK / ALARM / INSUFFICIENT_DATA** ; types **seuil / anomalie / composite** ; actions **SNS**, Auto Scaling, EC2.
8. **X-Ray** : **trace** (30 j) = segments (≤ 64 ko) + subsegments ; **service map** = nœuds + arêtes avec latence/erreurs ; **sampling** 1/s + 5 % par défaut ; header **`X-Amzn-Trace-Id`**.
9. **Annotations** (indexées, filtrables, ≤ 50/trace) ≠ **metadata** (non indexées).
10. **Corrélation** : `awsRequestId` loggé + trace ID en annotation → de « ça rame » à la ligne exacte via métrique → alarme → logs → trace.

---

## 7. Seeds Anki

```
Quels sont les trois niveaux de CloudWatch Logs, et la convention de nom d'un log group Lambda ?|Log event (une entrée : timestamp + message) → log stream (events d'une même source) → log group (collection de streams, où se règlent rétention et permissions). Lambda écrit dans /aws/lambda/<nom-fonction>.
Pourquoi logger en JSON structuré plutôt qu'en texte libre dans une Lambda ?|Logs Insights découvre automatiquement les champs d'un event JSON (durationMs, familyId...) et peut alors filtrer, agréger et corréler. Un log texte libre (console.log('done')) n'est ni requêtable ni agrégeable.
Résolution standard vs haute résolution d'une métrique CloudWatch ?|Standard = granularité 1 minute (toutes les métriques AWS par défaut). Haute = 1 seconde via StorageResolution à 1 sur le point publié ; lisible à 1/5/10/30 s. Plus chère (chaque PutMetricData est facturé) — à réserver au sub-minute réel.
Comment publier une métrique métier custom à CloudWatch, et quelle permission faut-il ?|Via l'API PutMetricData (@aws-sdk/client-cloudwatch) : Namespace custom, MetricName, Value, Unit, Dimensions. Le role doit porter cloudwatch:PutMetricData. Alternative à fort volume : EMF (JSON spécial dans les logs).
Pour la latence, quelle statistique surveiller et pourquoi ?|Le p99 (ou p95), pas la moyenne. La moyenne masque les pics : p99 = 1,2 s signifie que 1 % des utilisateurs attendent plus de 1,2 s — ce sont eux qui se plaignent.
Quels sont les trois états d'une alarme CloudWatch et les trois types ?|États : OK, ALARM, INSUFFICIENT_DATA. Types : à seuil (métrique > X pendant N périodes), anomalie (bande normale apprise), composite (combinaison booléenne AND/OR/NOT d'alarmes). Actions : SNS, Auto Scaling, EC2.
Segment vs subsegment vs service map en X-Ray ?|Segment = travail d'un service (≤ 64 ko). Subsegment = détail dans un segment (ex. appel DynamoDB), sert à inférer les services non instrumentés. Service map = graphe auto-généré des services (nœuds) et appels (arêtes) avec latence/erreurs/volume. Traces conservées 30 jours.
Annotations vs metadata X-Ray ?|Annotations = paires clé/valeur INDEXÉES et filtrables (annotation.familyId = "x"), max 50 par trace, pour les identifiants. Metadata = NON indexées, non filtrables, sans limite stricte, pour les payloads/objets de contexte.
Comment X-Ray échantillonne-t-il par défaut, et pourquoi une requête peut n'avoir aucune trace ?|Par défaut : première requête de chaque seconde + 5 % des suivantes (conservateur pour le coût). Une requête non échantillonnée (Sampled=0) n'a aucune trace — c'est voulu, pas un bug. Ajustable via les règles de sampling.
Comment corréler un log et une trace pour localiser un goulot ?|Logger context.awsRequestId dans le JSON (retrouve tous les events d'une invocation) et poser le trace ID / des identifiants en annotation X-Ray. Depuis une trace lente du service map, on saute aux logs par requestId, et inversement — de « ça rame » à la ligne exacte.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-14-cloudwatch-observability/README.md`. Tu déploies une **vraie** Lambda instrumentée dans ton compte AWS : logs JSON, métrique custom `PutMetricData`, alarme à seuil branchée sur SNS, **tracing X-Ray actif**. Tu l'invoques réellement, tu écris une requête **Logs Insights**, tu lis le **service map**, tu déclenches l'alarme — puis tu **détruis** tout (teardown, Free Tier). Corrigé complet, feedback coach, variante J+30.
