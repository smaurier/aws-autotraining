# Lab 06 — Lambda : déployer, invoquer, observer cold vs warm start

> **Outcome :** à la fin, tu as déployé une **vraie** fonction Lambda Node.js dans ton compte AWS, tu l'as **invoquée** réellement, tu as **observé** la différence cold start / warm start dans les logs CloudWatch, tu as **corrigé** un cold start en déplaçant l'init hors du handler et ajusté mémoire/timeout — puis tout détruit.
> **Vrai outil :** AWS CDK (`aws-cdk-lib`, `NodejsFunction`) + AWS CLI v2 (`aws lambda invoke`, `aws logs`). Alternative CLI pure fournie plus bas. Aucun harnais de test simulé.
> **Feedback :** le coach valide en session (lecture du handler + des lignes `REPORT`/`Init Duration` dans CloudWatch). Pas de test-runner auto-correcteur.
>
> ⚠️ **Coût / Free Tier :** Lambda inclut **1 M de requêtes + 400 000 Go-secondes gratuits par mois** — ce lab reste **très largement** dans le Free Tier (quelques dizaines d'invocations à 256 MB). Les seuls coûts possibles viennent de CloudWatch Logs (négligeable). **Teardown obligatoire** en fin de lab (section dédiée).

---

## Prérequis

- Un compte AWS avec un **user admin IAM** (pas le root) et le MFA activé — module 00.
- **AWS CLI v2** configurée (`aws configure`) sur la région `eu-west-3` (Paris).
- **Node.js 20+** et **npm**. Pour la voie CDK : `npm install -g aws-cdk` et un compte **bootstrappé** (`cdk bootstrap` — vu au module 05).

Vérifie ton identité :

```bash
aws sts get-caller-identity   # note l'Account ID (12 chiffres)
```

---

## Énoncé

Tu poses la **Lambda de traitement** de TribuZen, version simplifiée pour se concentrer sur le **cycle d'exécution** (pas encore S3/DynamoDB). La fonction `tribuzen-lab-echo` :

1. Reçoit un `event` JSON `{ "familyId": "...", "message": "..." }` (invocation directe).
2. Retourne un objet `{ requestId, familyId, message, coldStart, remainingMs }` où :
   - `requestId` vient de `context.awsRequestId` ;
   - `remainingMs` vient de `context.getRemainingTimeInMillis()` ;
   - `coldStart` vaut `true` **uniquement à la première invocation d'un environnement**, `false` ensuite.
3. Fait une **init statique volontairement observable** (un compteur incrémenté hors handler) pour **prouver** la réutilisation d'environnement entre invocations.

Ensuite tu **mesures** cold vs warm start, tu **ajustes** mémoire/timeout, et tu **détruis**.

**Contrainte :** tu écris le handler **toi-même** à partir du starter. Pas de gap-fill.

### Détecter un cold start — le truc

Un flag déclaré **hors** du handler est initialisé une seule fois par environnement. Le handler le lit puis le passe à `false` : la **première** invocation d'un environnement le voit `true`, les suivantes `false`. C'est la preuve de la réutilisation d'environnement.

### Starter (à compléter)

```javascript
// index.mjs — starter, à compléter toi-même
// Phase INIT (hors handler) : ne tourne qu'une fois par environnement
let isCold = true;
let initCount = 0; // combien de fois l'Init a tourné pour CET environnement

// TODO : à toi d'écrire le handler async (event, context) qui :
//  - capture la valeur courante de isCold, puis met isCold = false
//  - retourne { requestId, familyId, message, coldStart, remainingMs, initCount }
export const handler = async (event, context) => {
  // ...
};
```

---

## Étapes (en friction)

### Voie A — CDK (recommandée, celle de TribuZen)

1. **Écris le handler** `lambda/index.mjs` (complète le starter toi-même).
2. **Écris la stack CDK** qui crée la fonction avec `NodejsFunction`, `memorySize: 256`, `timeout: Duration.seconds(10)`, une variable d'environnement `STAGE=lab`.
3. `cdk deploy` — note le nom de fonction créé.
4. **Invoque deux fois de suite** et compare `coldStart` :
   ```bash
   aws lambda invoke --function-name <NomFonction> \
     --payload '{"familyId":"fam-42","message":"Bonjour la tribu"}' \
     --cli-binary-format raw-in-base64-out out.json && cat out.json
   # 1re fois : coldStart=true ; relance tout de suite : coldStart=false
   ```
5. **Lis les logs CloudWatch** et repère la ligne `REPORT ... Init Duration: ...` (présente au cold start uniquement) :
   ```bash
   aws logs tail /aws/lambda/<NomFonction> --since 5m --format short
   ```
6. **Force un nouveau cold start** en modifiant la config (toute update recycle les environnements), puis ré-invoque : `coldStart` repasse à `true`.
7. **Ajuste** `memorySize` à 512 dans la stack, `cdk deploy`, ré-invoque, compare la `Duration` et la `Billed Duration` dans le `REPORT`.

### Voie B — CLI pure (sans CDK)

1. Écris `index.mjs` (même handler).
2. Zippe et crée la fonction (il te faut un **role d'exécution** — réutilise/crée un role avec la policy managée `AWSLambdaBasicExecutionRole`) :
   ```bash
   zip function.zip index.mjs
   aws lambda create-function \
     --function-name tribuzen-lab-echo \
     --runtime nodejs20.x \
     --handler index.handler \
     --role arn:aws:iam::<ACCOUNT_ID>:role/<ton-role-lambda> \
     --zip-file fileb://function.zip \
     --memory-size 256 --timeout 10 \
     --environment '{"Variables":{"STAGE":"lab"}}'
   ```
3. Invoque, lis les logs, ajuste (`update-function-configuration --memory-size 512`), ré-invoque — mêmes observations qu'en voie A.

---

## Corrigé complet commenté

### `lambda/index.mjs` — le handler

```javascript
// index.mjs — handler tribuzen-lab-echo (corrigé)

// ── Phase INIT : hors handler, une seule fois par environnement ──
// isCold prouve la réutilisation : true au 1er invoke d'un env, false ensuite.
let isCold = true;
// initCount démontre que ce bloc ne re-tourne PAS sur un warm start (reste à 1).
let initCount = 0;
initCount += 1;

// ── Phase INVOKE : à chaque événement ──
export const handler = async (event, context) => {
  const coldStart = isCold; // capture AVANT de basculer
  isCold = false;           // les invocations suivantes sur cet env verront false

  const { familyId, message } = event;

  return {
    requestId: context.awsRequestId,               // id unique de l'invocation, traçable
    familyId,
    message,
    coldStart,                                      // true seulement au 1er invoke de l'env
    remainingMs: context.getRemainingTimeInMillis(),// ms restantes avant timeout
    initCount,                                      // reste 1 sur un même env → Init non rejoué
  };
};
```

### Stack CDK — `lib/lab06-stack.ts`

```typescript
import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export class Lab06Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const fn = new NodejsFunction(this, 'EchoFn', {
      functionName: 'tribuzen-lab-echo',
      entry: 'lambda/index.mjs',   // CDK bundle automatiquement avec esbuild
      handler: 'handler',          // -> propriété Handler = index.handler
      runtime: Runtime.NODEJS_20_X,
      memorySize: 256,             // CPU proportionnel ; passe à 512 à l'étape 7
      timeout: Duration.seconds(10),
      environment: { STAGE: 'lab' },
    });

    // Le CDK crée d'office un role d'exécution avec AWSLambdaBasicExecutionRole
    // (droit d'écrire dans CloudWatch Logs) — moindre privilège par défaut.
    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
  }
}
```

### Ce que tu dois OBSERVER (et pourquoi c'est correct)

| Observation | Attendu | Explication |
|-------------|---------|-------------|
| 1re invocation | `coldStart: true` | environnement neuf : Init exécuté, `isCold` vaut `true` |
| 2e invocation immédiate | `coldStart: false` | même environnement réutilisé (warm), l'Init n'a pas rejoué |
| `initCount` | **toujours 1** | le bloc hors handler ne tourne qu'une fois par environnement |
| Ligne `REPORT` au cold start | contient `Init Duration:` | AWS ne loggue l'`Init Duration` que quand l'Init a réellement eu lieu |
| Après `update` de config | `coldStart` repasse à `true` | toute modif de config recycle les environnements |
| 256 → 512 MB | `Duration` plus courte | le CPU monte avec la mémoire |

> Le `coldStart: false` n'est **pas** garanti si tu attends trop longtemps entre deux invocations (l'environnement peut avoir été recyclé). Invoque les deux appels **coup sur coup** pour voir le warm start.

**Pourquoi ce corrigé est correct :** le flag hors handler capture l'état d'initialisation de l'environnement ; le handler prouve, sans aucun test simulé, la mécanique Init/Invoke/réutilisation du module. C'est le cycle d'exécution **observé sur une vraie fonction**, pas supposé.

---

## Teardown (obligatoire)

Ne laisse **jamais** traîner une fonction de test (surface d'attaque + bruit + logs qui s'accumulent).

**Voie A (CDK) :**

```bash
cdk destroy   # supprime la fonction, son role et sa log group gérés par la stack
```

**Voie B (CLI) :**

```bash
aws lambda delete-function --function-name tribuzen-lab-echo
# supprime aussi le log group créé automatiquement :
aws logs delete-log-group --log-group-name /aws/lambda/tribuzen-lab-echo
# si tu as créé un role dédié pour ce lab, détache sa policy puis supprime-le :
# aws iam detach-role-policy --role-name <ton-role-lambda> \
#   --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
# aws iam delete-role --role-name <ton-role-lambda>
```

Vérifie :

```bash
aws lambda list-functions --query "Functions[?FunctionName=='tribuzen-lab-echo']"
# → doit renvoyer [] (liste vide)
```

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. En **25 minutes**, redéploie la fonction mais fais-lui faire un **vrai travail I/O** : à l'init (hors handler), **charge une valeur** depuis une variable d'environnement `GREETING` ; dans le handler, retourne `` `${GREETING}, ${familyId}` ``.
2. Configure la fonction avec une **concurrence réservée de 2** (`aws lambda put-function-concurrency --reserved-concurrent-executions 2`) et **prouve le throttling** : lance 5 invocations **synchrones** en parallèle et observe au moins une **429 TooManyRequestsException**.
3. Trouve, **de mémoire**, la mémoire minimale qui garde ta `Duration` sous 200 ms.
4. Fais le **teardown complet** de mémoire (n'oublie pas de retirer la concurrence réservée avant, ou `cdk destroy`).

**Critère de réussite :** tu obtiens une vraie `TooManyRequestsException` sous charge, et `aws lambda list-functions` renvoie `[]` après teardown.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette fonction devient la **vraie Lambda de traitement** — pas un echo :

```
tribuzen/
  infra/
    lib/
      thumbnail-stack.ts     ← NodejsFunction generateThumbnail (trigger S3)
    lambda/
      generate-thumbnail.mjs ← handler réel (GetObject → sharp → PutObject)
```

**Ce que tu portes du lab vers le produit :**

- Le réflexe **init hors handler** : clients `@aws-sdk/client-*` créés en phase Init, réutilisés sur les warm starts.
- Le **dimensionnement par mesure** : on lit la `Duration` réelle dans CloudWatch avant de fixer mémoire/timeout — jamais de valeur au hasard.
- Le **role d'exécution de moindre privilège** (module 01) attaché par le CDK, pas d'access key.
- Le **réflexe teardown** : toute ressource de lab est détruite en fin de session (`cdk destroy`).

**Commit cible :**
```
feat(lambda): generateThumbnail — handler S3, init hors handler, mémoire/timeout mesurés
```
