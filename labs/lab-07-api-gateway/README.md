# Lab 07 — API Gateway : exposer une Lambda en HTTP API

> **Outcome :** à la fin, tu sais déployer une **HTTP API** devant une **vraie** fonction Lambda, appeler son endpoint au `curl`, diagnostiquer un `502` de format proxy, et tout détruire proprement.
> **Vrai outil :** compte AWS réel + **AWS CLI v2** + Console API Gateway. Zéro harnais simulé, zéro mock — tu appelles une URL `execute-api` qui existe vraiment.
> **Feedback :** le coach valide en session (réponses `curl`, logs CloudWatch, teardown vérifié) — pas de test-runner auto-correcteur.

> ⚠️ **Coût & Free Tier :** API Gateway et Lambda sont dans le **Free Tier** pour de tout petits volumes. Ce lab fait quelques dizaines d'appels : coût ~0. **Mais** rien ne doit rester debout après la session → la dernière étape (**teardown**) est **obligatoire**. Travaille dans une région proche (ex. `eu-west-3` Paris) et note tous les IDs créés.

---

## Énoncé

Au module 06, TribuZen a une Lambda `postFeedMessage`. Ici, tu la rends **appelable en HTTP** via une HTTP API `tribuzen-api`, sur une route `POST /messages`, stage `$default` (auto-deploy). Tu vérifies le format de réponse proxy, tu casses volontairement le format pour observer le **502**, puis tu répares.

**Contrat exact :**

1. Créer une Lambda `postFeedMessage` (Node.js) qui, en **intégration proxy**, renvoie le bon format et écho le message reçu.
2. Créer une **HTTP API** `tribuzen-api` avec la route `POST /messages` → intégration Lambda proxy vers cette Lambda.
3. Appeler l'endpoint au `curl` et obtenir un **201** avec le message écho.
4. Provoquer un **502** (réponse mal formée), lire les logs, puis corriger.
5. **Teardown** : supprimer l'API, la Lambda et le role.

**Pas de gap-fill** : tu écris les commandes et le handler toi-même à partir du starter ci-dessous.

### Prérequis

- AWS CLI v2 configurée (`aws sts get-caller-identity` répond ton compte).
- Un role d'exécution Lambda de base (le lab 01 + module 06 t'en ont fait un). On le suppose nommé `tribuzen-lambda-basic-role` avec la policy managée `AWSLambdaBasicExecutionRole`. Sinon, crée-le d'abord (rappel en fin d'énoncé).

### Starter — le handler (volontairement incomplet)

`index.mjs` :

```javascript
// postFeedMessage — intégration Lambda proxy (HTTP API, payload v2)
export const handler = async (event) => {
  // TODO 1 : event.body arrive en CHAÎNE (ou undefined) → parse-le en sécurité
  // TODO 2 : si pas de champ "text" (string), renvoyer 400 au format proxy (sans throw)
  // TODO 3 : sinon renvoyer 201 avec { id, text } — body STRINGIFIÉ
}
```

Zippe-le : `zip function.zip index.mjs`.

---

## Étapes (en friction)

> Remplace `<ACCOUNT_ID>`, `<REGION>` (ex. `eu-west-3`) et les IDs au fur et à mesure. Tu produis les commandes — ne copie pas le corrigé avant d'avoir essayé.

1. **Écris le handler** en respectant les 3 TODO. Le point qui coince : `body` est une **chaîne**, la réponse doit avoir `statusCode` + `body: JSON.stringify(...)`.
2. **Crée la Lambda** avec `aws lambda create-function` (runtime `nodejs20.x`, handler `index.handler`, `--zip-file fileb://function.zip`, `--role` ton role d'exécution). Note l'`FunctionArn`.
3. **Crée l'HTTP API** avec `aws apigatewayv2 create-api` (`--protocol-type HTTP`). Note l'`ApiId` et l'`ApiEndpoint`.
4. **Crée l'intégration** proxy Lambda (`aws apigatewayv2 create-integration`, `--integration-type AWS_PROXY`, `--payload-format-version 2.0`, `--integration-uri <FunctionArn>`). Note l'`IntegrationId`.
5. **Crée la route** `POST /messages` (`aws apigatewayv2 create-route`, `--route-key "POST /messages"`, `--target integrations/<IntegrationId>`).
6. **Autorise API Gateway à invoquer la Lambda** (`aws lambda add-permission`, `--principal apigateway.amazonaws.com`, `--action lambda:InvokeFunction`). Sans ça → `500`/`403` à l'appel.
7. **Appelle l'endpoint** : `curl -X POST <ApiEndpoint>/messages -H 'Content-Type: application/json' -d '{"text":"Coucou"}'`. Attendu : **201** + écho.
8. **Provoque un 502** : modifie le handler pour faire `return { id: '42', text }` (objet brut, sans `statusCode`), redéploie (`aws lambda update-function-code`), rappelle → observe **`502 Bad Gateway`**. Lis les logs (`aws logs tail /aws/lambda/postFeedMessage --follow`) : la Lambda a bien tourné, c'est **le format** qui casse.
9. **Répare** : remets le format proxy correct, redéploie, revérifie le 201.
10. **Teardown** (obligatoire) : supprime la route, l'intégration, l'API, la Lambda, et la permission — voir section dédiée.

---

## Corrigé complet commenté

### Handler correct (`index.mjs`)

```javascript
// postFeedMessage — intégration Lambda proxy
export const handler = async (event) => {
  // TODO 1 — event.body est une CHAÎNE (ou undefined). JSON.parse échoue sur undefined,
  //          on garde-fou avant de parser.
  let input = {}
  try {
    input = event.body ? JSON.parse(event.body) : {}
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid JSON body' }),
    }
  }

  // TODO 2 — erreur client : on RENVOIE un 400 au format proxy, on ne throw PAS
  //          (un throw donnerait une 500 générique, pas notre message).
  if (typeof input.text !== 'string' || input.text.length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'text is required' }),
    }
  }

  // TODO 3 — succès : statusCode obligatoire, body STRINGIFIÉ (jamais un objet brut).
  const created = { id: '42', text: input.text }
  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(created),
  }
}
```

### Les commandes (AWS CLI v2)

```bash
# 0. Contexte
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=eu-west-3
ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/tribuzen-lambda-basic-role

# 1. Packager + créer la Lambda
zip function.zip index.mjs
aws lambda create-function \
  --function-name postFeedMessage \
  --runtime nodejs20.x \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --role "$ROLE_ARN" \
  --region "$REGION"

FN_ARN=$(aws lambda get-function --function-name postFeedMessage \
  --region "$REGION" --query 'Configuration.FunctionArn' --output text)

# 2. Créer l'HTTP API
API_ID=$(aws apigatewayv2 create-api \
  --name tribuzen-api \
  --protocol-type HTTP \
  --region "$REGION" \
  --query ApiId --output text)

# 3. Intégration Lambda proxy (payload v2 = format HTTP API)
INTEG_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$FN_ARN" \
  --payload-format-version 2.0 \
  --region "$REGION" \
  --query IntegrationId --output text)

# 4. Route POST /messages → intégration
aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key "POST /messages" \
  --target "integrations/$INTEG_ID" \
  --region "$REGION"

# 5. Autoriser API Gateway à invoquer la Lambda
aws lambda add-permission \
  --function-name postFeedMessage \
  --statement-id apigw-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/messages" \
  --region "$REGION"

# 6. L'endpoint ($default stage auto-deployé pour une HTTP API créée ainsi)
ENDPOINT=$(aws apigatewayv2 get-api --api-id "$API_ID" \
  --region "$REGION" --query ApiEndpoint --output text)

# 7. Appel → attendu 201
curl -i -X POST "$ENDPOINT/messages" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Coucou la famille"}'
```

**Pourquoi ce corrigé est correct :**
- `--payload-format-version 2.0` : le format d'event/réponse **HTTP API** (v2). Avec la v2, une réponse `{ statusCode, body }` reste valide ; on garde donc le même contrat proxy que le module.
- `add-permission` avec `source-arn` scopé à `/*/*/messages` : API Gateway peut invoquer la Lambda **uniquement** via cette API et cette route (moindre privilège — lab 01).
- Le handler **parse** `event.body` (chaîne) et **stringifie** `body` en sortie : c'est ce couple qui fait qu'on obtient un 201 et pas un 502.
- Les erreurs client sont des **`return` 400**, pas des `throw` : on maîtrise le code et le message renvoyés.

### Étape 8 — provoquer et lire le 502

Remplace le `return` de succès par un objet brut, redéploie, rappelle :

```bash
# handler cassé : return { id: '42', text: input.text }   ← pas de statusCode, body non stringifié
zip function.zip index.mjs
aws lambda update-function-code \
  --function-name postFeedMessage --zip-file fileb://function.zip --region "$REGION"

curl -i -X POST "$ENDPOINT/messages" -H 'Content-Type: application/json' -d '{"text":"x"}'
# → HTTP/2 502  {"message":"Internal Server Error"}

aws logs tail /aws/lambda/postFeedMessage --follow --region "$REGION"
# → la Lambda s'exécute SANS erreur : le 502 vient du FORMAT de réponse, pas d'un crash.
```

Diagnostic à ancrer : **502 en Lambda proxy = la Lambda a répondu dans le mauvais format** (ici : objet brut au lieu de `{ statusCode, body: string }`). On répare en remettant le format proxy (étape 9), on redéploie, on revérifie le 201.

### Teardown (OBLIGATOIRE — rien ne reste debout)

```bash
# Supprimer l'API (route + intégration + stage $default partent avec)
aws apigatewayv2 delete-api --api-id "$API_ID" --region "$REGION"

# Supprimer la Lambda (la permission part avec la fonction)
aws lambda delete-function --function-name postFeedMessage --region "$REGION"

# Vérifs : les deux doivent échouer en NotFound
aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION"        # NotFoundException attendu
aws lambda get-function --function-name postFeedMessage --region "$REGION"  # ResourceNotFound attendu
```

> Le role `tribuzen-lambda-basic-role` peut être conservé pour les autres labs. Si tu l'as créé juste pour ce lab, supprime-le aussi (`aws iam delete-role`, après avoir détaché ses policies). Vérifie dans la Console API Gateway qu'aucune API `tribuzen-api` ne subsiste.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, en 30 minutes, sans rouvrir ce corrigé ni le module :**

1. Ajoute une **deuxième route** `GET /messages/{id}` vers une nouvelle Lambda `getMessage` qui lit `event.pathParameters.id` (HTTP API v2 : `event.pathParameters`) et renvoie `{ id, text: 'stub' }` au bon format.
2. Fais échouer volontairement l'appel avec un **id manquant** géré en **404** (au format proxy, pas un throw).
3. **Sans notes** : reconstitue de mémoire la chaîne `create-api → create-integration → create-route → add-permission → curl`.

**Critère de réussite :** `GET /messages/7` renvoie 200 avec `id=7` ; l'endpoint mal formé renvoie **502** (et tu sais dire pourquoi) ; teardown complet vérifié.

---

## Application TribuZen

Dans le vrai produit, **on ne crée pas l'API à la main** : tout est décrit en **CDK** (module 05). Le lab CLI sert à *comprendre* les briques ; le CDK sert à les *produire* de façon reproductible.

Équivalent CDK (aperçu, construit au module 05 / 16) :

```
tribuzen-infra/
  lib/
    api-stack.ts   ← HttpApi + HttpLambdaIntegration + addRoutes('POST /messages')
    lambda-stack.ts
```

**Différences avec le lab :**
- L'autorisation d'invocation (`add-permission`) et le stage `$default` sont **gérés automatiquement** par les constructs CDK `HttpApi` / `HttpLambdaIntegration`.
- La route sera protégée par un **autoriseur JWT** branché sur le User Pool Cognito (**module 11**) — dans le lab, la route est ouverte pour se concentrer sur l'intégration.
- Le CORS sera configuré **au niveau de l'HTTP API** (`corsPreflight`) pour autoriser `app.tribuzen.com`.

**Commit cible :**
```
feat(api): HTTP API TribuZen — route POST /messages -> Lambda postFeedMessage (proxy v2)
```
