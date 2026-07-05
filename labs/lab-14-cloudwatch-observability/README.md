# Lab 14 — Rendre une Lambda observable (CloudWatch + X-Ray)

> **Outcome :** à la fin, tu sais instrumenter une **vraie** Lambda déployée dans ton compte AWS — logs structurés JSON, métrique custom via `PutMetricData`, alarme à seuil branchée sur SNS, tracing X-Ray actif — puis la requêter avec **Logs Insights** et lire son **service map**.
> **Vrai outil :** AWS CLI + Console AWS (CloudWatch, X-Ray) sur **ton** compte. Aucun harnais simulé, aucune mock : tu déploies, tu invoques, tu observes du vrai signal.
> **Feedback :** le coach valide en session (captures console + sortie CLI). Pas de test-runner auto-correcteur.

---

> ⚠️ **Ce lab crée des ressources facturables.** Tout reste dans le **Free Tier** si tu suis les étapes (quelques invocations, une poignée de points de métrique, une alarme). **Le teardown final est OBLIGATOIRE** — la section dédiée en fin de lab détruit tout. Ne pars pas en laissant une alarme et un log group « Never expire » derrière toi.

## Prérequis

- AWS CLI configuré (`aws sts get-caller-identity` répond) — module 00.
- Node.js 20 local pour builder le zip de la Lambda.
- Une région de travail fixée (ce lab utilise `eu-west-1` ; adapte si besoin).
- Un accès Console pour lire le **service map** X-Ray (l'affichage graphique n'a pas d'équivalent CLI lisible).

---

## Énoncé

Tu reprends la fonction **aveugle** du module (`postFeedMessage` : elle logue `start` / `done` en texte libre, sans métrique, sans trace). Objectif : la déployer **instrumentée** dans ton compte et prouver, signal à l'appui, que tu peux passer de « ça rame » à la ligne exacte.

Tu dois, avec le vrai outil AWS :

1. Déployer une Lambda `tribuzen-lab-feed` (Node 20) qui, à chaque invocation :
   - logue un event **JSON structuré** contenant `level`, `msg`, `requestId`, `familyId`, `durationMs` ;
   - publie une **métrique custom** `MessagesPostes` dans le namespace `TribuZen/Feed` via `PutMetricData` ;
   - génère une **trace X-Ray** avec une **annotation** `familyId` (indexée, filtrable).
2. Activer l'**Active tracing** X-Ray sur la fonction.
3. Poser une **rétention** de 7 jours sur son log group (jamais « Never expire »).
4. Créer un topic **SNS** `tribuzen-lab-oncall` avec ton email, et une **alarme à seuil** sur `MessagesPostes` qui passe **ALARM** quand tu invoques en rafale, et te notifie.
5. Invoquer réellement la fonction, puis :
   - écrire une requête **Logs Insights** qui donne le p99 de `durationMs` et le compte par famille ;
   - ouvrir le **service map** X-Ray et lire la trace (segment Lambda + subsegment de l'appel AWS).

**Pas de gap-fill** — tu écris le handler complet et tu enchaînes les commandes CLI toi-même à partir du starter ci-dessous.

### Starter minimal

Crée un dossier `lab-feed/` avec deux fichiers.

`package.json` :

```json
{
  "name": "tribuzen-lab-feed",
  "type": "module",
  "dependencies": {
    "aws-xray-sdk-core": "^3.10.0"
  }
}
```

`index.mjs` — squelette à compléter :

```javascript
// index.mjs — starter
// À compléter :
//  - enrober le client CloudWatch avec X-Ray (captureAWSv3Client)
//  - logger un JSON structuré { level, msg, requestId, familyId, durationMs }
//  - publier la métrique MessagesPostes (PutMetricData)
//  - poser l'annotation familyId sur le segment X-Ray

export const handler = async (event, context) => {
  // À toi
};
```

> Remarque : `@aws-sdk/client-cloudwatch` est **fourni par le runtime Node 20** de Lambda — pas besoin de l'installer. Seul `aws-xray-sdk-core` doit être bundlé dans le zip.

---

## Étapes (en friction)

1. **Écris le handler** `index.mjs` : mesure `t0`, parse `event.body` (ou `event` direct si invocation CLI), fais un travail tracé (un appel AWS réel enrobé par X-Ray suffit — voir corrigé), logue le JSON, publie la métrique, pose l'annotation `familyId`. Sur payload invalide → logue `level: "error"` et `throw` (produira un Fault X-Ray).
2. **Build le zip** : `npm install` dans `lab-feed/`, puis zippe `index.mjs` + `node_modules`.
3. **Crée le role d'exécution** : trust policy Lambda, puis attache les policies managées `AWSLambdaBasicExecutionRole` (logs), `AWSXRayDaemonWriteAccess` (X-Ray), et une inline pour `cloudwatch:PutMetricData`.
4. **Crée la fonction** avec `--tracing-config Mode=Active`.
5. **Pose la rétention** 7 j sur le log group `/aws/lambda/tribuzen-lab-feed`.
6. **Crée le topic SNS** + abonne ton email + **confirme le mail**.
7. **Pose l'alarme** à seuil sur `MessagesPostes` (Sum) branchée sur le topic.
8. **Invoque** la fonction plusieurs fois (payloads valides + un invalide pour voir le Fault).
9. **Logs Insights** : écris la requête p99 + compte par famille sur le log group.
10. **X-Ray** : ouvre le service map dans la Console, filtre une trace en faute, lis le subsegment et l'annotation `familyId`.
11. **Déclenche l'alarme** en rafale d'invocations → vérifie le mail SNS + l'état `ALARM`.
12. **Teardown** (section obligatoire en fin de lab).

---

## Critères de réussite

- [ ] La fonction est déployée avec **Active tracing** (`aws lambda get-function-configuration` montre `TracingConfig: { Mode: "Active" }`).
- [ ] Les logs du log group sont du **JSON** (pas de `start`/`done` en texte libre) et contiennent `requestId` + `durationMs`.
- [ ] La métrique `TribuZen/Feed / MessagesPostes` apparaît dans CloudWatch Metrics après invocation.
- [ ] Le log group a une **rétention finie** (7 j), pas « Never expire ».
- [ ] La requête **Logs Insights** renvoie un p99 et un compte par `familyId`.
- [ ] Le **service map** montre le nœud Lambda et un **subsegment** pour l'appel AWS tracé ; une invocation invalide apparaît en **Fault**.
- [ ] L'alarme passe **ALARM** en rafale et l'**email SNS** arrive.
- [ ] Le **teardown** est exécuté : plus aucune ressource du lab ne subsiste.

---

## Corrigé complet commenté

> Commandes en syntaxe bash/AWS CLI. Sous PowerShell, remplace les `\` de continuation de ligne par un backtick `` ` ``, et calcule l'epoch avec `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`.

### 1. Le handler — `index.mjs`

```javascript
// index.mjs — corrigé
import AWSXRay from 'aws-xray-sdk-core';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

// ── INIT (hors handler) : client réutilisé entre invocations ──
// captureAWSv3Client enrobe le client → l'appel PutMetricData devient
// un SUBSEGMENT X-Ray réel (nœud CloudWatch visible dans le service map).
// Un seul vrai appel AWS sert donc à la fois la métrique ET la trace.
const cw = AWSXRay.captureAWSv3Client(new CloudWatchClient({}));

export const handler = async (event, context) => {
  const t0 = Date.now();

  // Invocation CLI directe → event est déjà l'objet ; via API GW → event.body est une string.
  const payload = typeof event.body === 'string' ? JSON.parse(event.body) : event;
  const { familyId, text } = payload ?? {};

  // Annotation X-Ray : INDEXÉE → filtrable dans la console (annotation.familyId = "...").
  // getSegment() peut être null en test local ; garde-fou optionnel.
  const seg = AWSXRay.getSegment();
  if (seg && familyId) seg.addAnnotation('familyId', familyId);

  try {
    if (!familyId || !text) {
      throw new Error('familyId et text sont requis');
    }

    // Métrique métier : 1 message posté. Appel AWS réel → tracé par X-Ray.
    await cw.send(new PutMetricDataCommand({
      Namespace: 'TribuZen/Feed',
      MetricData: [{
        MetricName: 'MessagesPostes',
        Value: 1,
        Unit: 'Count',
        Dimensions: [{ Name: 'Env', Value: 'lab' }],
        // StorageResolution: 1,  // décommenter SEULEMENT pour du sub-minute réel (plus cher)
      }],
    }));

    const durationMs = Date.now() - t0;

    // Log structuré JSON : chaque clé devient un champ requêtable dans Logs Insights.
    // requestId relie ce log à l'invocation (corrélation log ↔ trace ↔ métrique).
    console.log(JSON.stringify({
      level: 'info', msg: 'feed_posted',
      requestId: context.awsRequestId, familyId, durationMs,
    }));

    return { statusCode: 201, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    // Log d'erreur structuré → captable par un metric filter { $.level = "error" }.
    console.log(JSON.stringify({
      level: 'error', msg: 'feed_post_failed',
      requestId: context.awsRequestId, familyId, error: e.message,
    }));
    throw e; // relève → X-Ray marque un Fault, la métrique AWS/Lambda Errors s'incrémente
  }
};
```

**Pourquoi ce corrigé est correct :**
- `captureAWSv3Client` sur le client CloudWatch : l'unique appel AWS réel (`PutMetricData`) génère le subsegment X-Ray — pas besoin de provisionner une table DynamoDB pour avoir une trace non triviale (Free Tier friendly, teardown minimal).
- Le log JSON porte `requestId` et `durationMs` : c'est ce qui rend la requête Logs Insights de l'étape 9 possible.
- Le `throw` sur payload invalide est **conservé** : il produit un Fault X-Ray et incrémente `AWS/Lambda Errors` — signal réel, pas simulé.
- L'annotation (indexée) porte `familyId` ; on ne met **pas** le payload complet en annotation (ça irait en metadata) — cf. piège #5 du module.

### 2. Build le zip

```bash
cd lab-feed
npm install
# zippe le CONTENU du dossier (index.mjs à la racine du zip, pas dans un sous-dossier)
zip -r ../function.zip index.mjs node_modules
cd ..
```

> Sous PowerShell : `Compress-Archive -Path index.mjs, node_modules -DestinationPath ..\function.zip`.

### 3. Role d'exécution

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# trust policy : autorise le service Lambda à assumer ce role
cat > trust.json <<'JSON'
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow",
  "Principal": { "Service": "lambda.amazonaws.com" },
  "Action": "sts:AssumeRole" }] }
JSON

aws iam create-role --role-name tribuzen-lab-feed-role \
  --assume-role-policy-document file://trust.json

# logs (CloudWatch Logs) + écriture X-Ray, via policies managées
aws iam attach-role-policy --role-name tribuzen-lab-feed-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam attach-role-policy --role-name tribuzen-lab-feed-role \
  --policy-arn arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess

# permission métrique custom (inline, moindre privilège)
aws iam put-role-policy --role-name tribuzen-lab-feed-role \
  --policy-name PutFeedMetric \
  --policy-document '{ "Version":"2012-10-17","Statement":[{
    "Effect":"Allow","Action":"cloudwatch:PutMetricData","Resource":"*" }] }'
```

### 4. Créer la fonction (tracing actif)

```bash
aws lambda create-function \
  --function-name tribuzen-lab-feed \
  --runtime nodejs20.x --handler index.handler \
  --role arn:aws:iam::$ACCOUNT:role/tribuzen-lab-feed-role \
  --zip-file fileb://function.zip \
  --tracing-config Mode=Active \
  --timeout 10 --region eu-west-1
```

> Le role vient d'être créé : si `create-function` échoue sur un role « not assumable », attends ~10 s (propagation IAM) et relance.

### 5. Rétention du log group

```bash
# le log group naît à la 1re invocation ; invoque une fois puis pose la rétention
aws lambda invoke --function-name tribuzen-lab-feed \
  --payload '{"familyId":"fam-42","text":"bonjour"}' --cli-binary-format raw-in-base64-out \
  out.json --region eu-west-1

aws logs put-retention-policy \
  --log-group-name /aws/lambda/tribuzen-lab-feed \
  --retention-in-days 7 --region eu-west-1
```

### 6. Topic SNS + abonnement

```bash
TOPIC=$(aws sns create-topic --name tribuzen-lab-oncall \
  --query TopicArn --output text --region eu-west-1)

aws sns subscribe --topic-arn $TOPIC --protocol email \
  --notification-endpoint ton.email@exemple.com --region eu-west-1
# → ouvre ta boîte mail et CLIQUE le lien de confirmation avant de continuer
```

### 7. Alarme à seuil sur la métrique custom

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name tribuzen-lab-feed-burst \
  --namespace TribuZen/Feed --metric-name MessagesPostes \
  --dimensions Name=Env,Value=lab \
  --statistic Sum --period 60 \
  --threshold 3 --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching \
  --alarm-actions $TOPIC --region eu-west-1
```

> `--treat-missing-data notBreaching` : sans données (fonction au repos), l'alarme reste `OK` au lieu de `INSUFFICIENT_DATA` — sinon tu recevrais des transitions parasites entre les rafales.

### 8. Invoquer (dont un payload invalide → Fault)

```bash
for i in 1 2 3 4 5; do
  aws lambda invoke --function-name tribuzen-lab-feed \
    --payload '{"familyId":"fam-42","text":"msg '$i'"}' \
    --cli-binary-format raw-in-base64-out out.json --region eu-west-1
done

# payload invalide → error loggé + Fault X-Ray
aws lambda invoke --function-name tribuzen-lab-feed \
  --payload '{"familyId":"fam-42"}' \
  --cli-binary-format raw-in-base64-out out.json --region eu-west-1
```

La rafale de 5 en < 60 s fait passer `MessagesPostes` (Sum) ≥ 3 → l'alarme bascule **ALARM** et tu reçois l'email SNS en 1-2 min.

### 9. Logs Insights — p99 et compte par famille

```bash
NOW=$(date +%s); AGO=$((NOW-3600))

QID=$(aws logs start-query \
  --log-group-name /aws/lambda/tribuzen-lab-feed \
  --start-time $AGO --end-time $NOW \
  --query-string 'fields durationMs, familyId
    | filter msg = "feed_posted"
    | stats pct(durationMs, 99) as p99, count(*) as posts by familyId
    | sort posts desc' \
  --query queryId --output text --region eu-west-1)

# les résultats ne sont pas synchrones : laisse ~5 s puis lis
aws logs get-query-results --query-id $QID --region eu-west-1
```

> `--start-time` / `--end-time` sont en **epoch secondes**. En Console (Logs Insights), colle la même requête et lance-la sur le log group : plus lisible, et le résultat s'épingle sur un dashboard.

### 10. X-Ray — service map et trace

```bash
# résumés de traces sur la dernière heure (start/end en epoch secondes, décimal accepté)
aws xray get-trace-summaries \
  --start-time $AGO --end-time $NOW \
  --filter-expression 'fault = true' --region eu-west-1
```

Puis en **Console** → CloudWatch → X-Ray traces → **Service map** :
- nœud `tribuzen-lab-feed` (segment Lambda) → arête vers **CloudWatch** (le subsegment `PutMetricData`) ;
- filtre `annotation.familyId = "fam-42"` pour retrouver tes traces ;
- la trace du payload invalide est marquée **Fault** (rouge). Depuis elle, tu sautes aux logs par `requestId`.

**Conclusion à formuler au coach :** montre la chaîne complète — métrique `MessagesPostes` → alarme `ALARM` → email SNS → Logs Insights (p99 par famille) → trace X-Ray (subsegment + Fault). C'est le passage de « ça rame » à la ligne exacte, sur du vrai signal.

---

## Feedback coach

En session, le coach vérifie (captures + sortie CLI, pas de runner auto) :

- **Logs vraiment structurés ?** Ouvre un log stream : si tu vois `start` / `done` ou du texte concaténé, c'est raté. Chaque event doit être un objet JSON avec `requestId` et `durationMs`.
- **Annotation vs metadata.** Demande-toi : `familyId` est-il **filtrable** dans le service map (`annotation.familyId = ...`) ? Si tu l'avais mis en metadata, non — piège #5 du module.
- **L'alarme dépend-elle d'un vrai signal ?** Le seuil porte sur **ta** métrique custom, pas sur une métrique AWS toute faite. Si tu n'as pas su la faire monter, tu n'as pas compris `PutMetricData`.
- **Rétention posée ?** `aws logs describe-log-groups` doit montrer `retentionInDays: 7`. « Never expire » = coût qui fuit (piège #3).
- **Sampling compris ?** Si une invocation précise n'a pas de trace, ce n'est pas un bug : X-Ray échantillonne (1/s + 5 %). Ne conclus pas « pas passé ».

Question de contrôle orale : « L'alarme est verte mais un parent dit que le feed rame. Par quoi tu commences ? » Réponse attendue : p99 de latence (métrique/Logs Insights), pas la moyenne, puis service map pour localiser le subsegment lent.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module, en 40 min :**

1. Remplace la métrique count par une **métrique de latence** : publie `durationMs` comme métrique `FeedLatencyMs` (Unit `Milliseconds`), et pose une alarme sur son **p99** (`--extended-statistic p99`, pas `--statistic`) au-delà de 500 ms.
2. Ajoute un **metric filter** sur le log group qui compte les events `{ $.level = "error" }` dans une métrique `TribuZen/Feed / FeedErrors` — **sans toucher au code** (via `aws logs put-metric-filter`).
3. Vérifie que forcer une erreur (payload invalide) fait monter `FeedErrors` **et** la latence, sans redéployer la Lambda.

**Critère de réussite :** deux métriques dérivées de sources différentes (code pour la latence, log pattern pour les erreurs), une alarme sur percentile qui bascule, le tout démontré en live. Puis **teardown**.

---

## Teardown OBLIGATOIRE

À exécuter **dès la fin de la session** — ne laisse rien derrière (l'alarme et le log group facturent en dormant).

```bash
aws cloudwatch delete-alarms --alarm-names tribuzen-lab-feed-burst --region eu-west-1
aws sns delete-topic --topic-arn $TOPIC --region eu-west-1
aws lambda delete-function --function-name tribuzen-lab-feed --region eu-west-1
aws logs delete-log-group --log-group-name /aws/lambda/tribuzen-lab-feed --region eu-west-1

# metric filter éventuel de la variante J+30
# aws logs delete-metric-filter --log-group-name /aws/lambda/tribuzen-lab-feed --filter-name feed-errors --region eu-west-1

aws iam delete-role-policy --role-name tribuzen-lab-feed-role --policy-name PutFeedMetric
aws iam detach-role-policy --role-name tribuzen-lab-feed-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam detach-role-policy --role-name tribuzen-lab-feed-role \
  --policy-arn arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
aws iam delete-role --role-name tribuzen-lab-feed-role
```

**Vérifie** : `aws cloudwatch describe-alarms` et `aws lambda list-functions` ne mentionnent plus rien du lab.

> Les **métriques custom** (`MessagesPostes`) ne se suppriment pas manuellement : elles **expirent seules** après 15 mois sans nouveau point (module §2.7). C'est normal, ça ne coûte rien au repos.

---

## Rappel Free Tier

Ce lab reste gratuit si tu ne t'éloignes pas du script :

- **Lambda** : 1 M requêtes/mois offertes — tu en fais une dizaine.
- **CloudWatch** : 10 métriques custom + 1 M appels API + 5 Go de logs offerts/mois ; **10 alarmes** standard offertes. Reste sous ces seuils.
- **X-Ray** : 100 000 traces enregistrées/mois offertes.
- **SNS** : 1 000 notifications email offertes/mois.

Le seul poste qui fuit si tu oublies le teardown : le **log group « Never expire »** (stockage à vie) et l'**alarme** qui persiste. D'où la rétention 7 j + le teardown ci-dessus.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette instrumentation ne se pose **pas** à la main : elle est définie en **CDK** (module 05), pour que log groups, rétention, alarmes et tracing soient versionnés et reproductibles.

**Différences par rapport au lab :**

- La Lambda `post-feed` écrit réellement dans DynamoDB `TribuZenFeed` : le client DynamoDB est enrobé par `captureAWSv3Client`, donc le service map montre le **vrai** subsegment DynamoDB (latence d'écriture isolée) plutôt que l'appel CloudWatch du lab.
- L'alarme prod ne porte pas sur un count de démo mais sur `5XXError` (API Gateway), `ThrottledRequests` (DynamoDB) et la **latence p99** — reliées à un topic SNS `tribuzen-oncall`, avec une alarme **composite** pour ne pas réveiller l'astreinte pendant un déploiement.
- Le webhook Slack de l'alerting vit dans **Secrets Manager** (module 15) ; la discipline SLO/on-call autour de ces alarmes est le **cours 16**.

**Commit cible :**
```
feat(obs): instrumente post-feed — logs JSON, métrique MessagesPostes, alarme SNS, tracing X-Ray
```
