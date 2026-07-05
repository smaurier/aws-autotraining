---
titre: API Gateway — exposer une Lambda en HTTP, sécurisée et throttlée
cours: 12-aws-cloud
notions: [REST API vs HTTP API, WebSocket API, routes et méthodes, ressource proxy, "intégration Lambda proxy (event + réponse)", "format de réponse (statusCode/headers/body string)", "502 Bad Gateway si réponse malformée", autoriseur IAM, "autoriseur JWT (HTTP API)", autoriseur Lambda, autoriseur Cognito, stages, "déploiement (REST) vs auto-deploy (HTTP)", variables de stage, throttling, "429 Too Many Requests", CORS]
outcomes:
  - sait choisir entre REST API et HTTP API selon les fonctionnalités réellement nécessaires
  - sait exposer une fonction Lambda en HTTP via une intégration Lambda proxy et respecter le format de réponse attendu
  - sait sécuriser une route avec le bon type d'autoriseur (IAM, JWT, Lambda, Cognito) sans confondre leurs usages
  - sait raisonner sur les stages, le throttling par défaut et la configuration CORS d'une API
prerequis: [Module 06 — Lambda serverless (handler, event, déploiement), notions HTTP/REST de base]
next: 08-rds-elasticache
libs: []
tribuzen: API TribuZen — la couche HTTP qui expose les Lambda métier (poster un message de feed, lister les membres) au front, avec autorisation JWT et CORS
last-reviewed: 2026-07
---

# API Gateway — exposer une Lambda en HTTP, sécurisée et throttlée

> **Outcomes — tu sauras FAIRE :** choisir REST vs HTTP API, exposer une Lambda via intégration proxy, sécuriser une route avec le bon autoriseur, raisonner sur stages / throttling / CORS.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **API Gateway seul** — la porte HTTP devant tes fonctions. La **Lambda** elle-même (handler, event, cold start) est le module 06 : ici on la suppose déjà écrite et on l'expose. L'**autoriseur Cognito** est juste *nommé* ici ; les User Pools, les flows et l'émission des JWT sont détaillés au **module 11 (Cognito)**. On répond à une seule question : *comment transformer une Lambda en endpoint HTTP appelable, sécurisé et protégé contre les pics ?*

## 1. Cas concret d'abord

Au module 06, tu as écrit la Lambda `postFeedMessage` de TribuZen : elle prend un message de famille et l'écrit dans DynamoDB. Elle marche… mais **rien ne peut l'appeler**. Une Lambda n'a pas d'URL HTTP par défaut : le front Vue de TribuZen ne peut pas faire un `fetch('...')` dessus. Il lui faut une **porte d'entrée HTTP**.

Ton premier réflexe pourrait être : « je génère une Function URL Lambda, ou j'expose la Lambda derrière un petit serveur Express ». Mais tu veux, en production :

- une **URL stable** par environnement (`/dev`, `/prod`) ;
- **valider le JWT** de l'utilisateur avant même d'exécuter la Lambda (pas de code d'auth dans chaque fonction) ;
- **protéger le backend** si quelqu'un envoie 50 000 requêtes/seconde ;
- autoriser le **front sur un autre domaine** à appeler l'API (CORS) ;
- router `POST /messages` vers cette Lambda, `GET /members` vers une autre, sans réécrire la logique HTTP à chaque fois.

C'est exactement le travail d'**API Gateway** : un service managé qui reçoit la requête HTTP, l'authentifie, la throttle, la route vers la bonne Lambda, et renvoie la réponse. À la fin de ce module, tu sais exposer `postFeedMessage` sur `POST /messages`, protégée par un autoriseur JWT et CORS, sur un stage `prod` — et tu sais *pourquoi* tu choisis une HTTP API plutôt qu'une REST API pour ce cas.

---

## 2. Théorie complète, concise

### 2.1 Trois produits sous un même nom

« API Gateway » regroupe trois types d'API distincts. On ne les mélange pas dans une même API :

| Type | Protocole | Pour quoi |
|------|-----------|-----------|
| **REST API** | HTTP/HTTPS requête→réponse | API riches : validation de requête, API keys, usage plans, cache, WAF, endpoints privés/edge |
| **HTTP API** | HTTP/HTTPS requête→réponse | API simples et bon marché : proxy vers Lambda, autoriseur JWT natif, moins de fonctionnalités |
| **WebSocket API** | WebSocket (connexion persistante) | Temps réel bidirectionnel : chat, notifications push, présence |

REST API et HTTP API font le **même métier** (exposer du HTTP requête/réponse). La doc AWS le dit : « REST APIs support more features than HTTP APIs, while HTTP APIs are designed with minimal features so that they can be offered at a lower price. » Autrement dit : **HTTP API = moins cher, moins de fonctionnalités**. La WebSocket API est un cas à part (pas de requête/réponse classique, mais des *routes* déclenchées par des messages sur une connexion ouverte) — on ne l'utilise que pour le temps réel.

### 2.2 REST vs HTTP API — le tableau qui décide (vérifié doc AWS)

C'est **le** point du module. Voici, d'après la doc officielle « Choose between REST APIs and HTTP APIs », les différences qui comptent :

| Fonctionnalité | REST API | HTTP API |
|----------------|:--------:|:--------:|
| Intégration Lambda | oui | oui |
| Autoriseur **IAM** (SigV4) | oui | oui |
| Autoriseur **Lambda** (custom) | oui | oui |
| Autoriseur **JWT** natif | **non** | **oui** |
| Autoriseur **Cognito** | oui | oui (via l'autoriseur JWT) |
| **Validation de requête** (JSON Schema) | oui | **non** |
| **API keys** / usage plans / rate-limit par client | oui | **non** |
| **Cache** de réponse | oui | **non** |
| **WAF** (pare-feu applicatif) | oui | **non** |
| Endpoints **edge-optimized** / **privés** | oui | **non** (Regional uniquement) |
| **CORS** | oui | oui |
| Déploiement | **manuel** (créer un déploiement) | **auto-deploy** possible |
| X-Ray, execution logs, canary | oui | **non** |

> **Règle de décision** : pars sur **HTTP API** par défaut (plus simple, moins cher, autoriseur JWT natif — idéal pour une Lambda derrière du Cognito). Bascule sur **REST API** *seulement si* tu as besoin d'une fonctionnalité de la colonne de gauche : API keys/usage plans, validation de requête, cache, WAF, ou endpoint privé/edge. Ne prends pas REST « par habitude » : tu paierais plus cher pour des fonctions que tu n'utilises pas.

Piège de vocabulaire : l'autoriseur **JWT natif** n'existe **que** sur HTTP API. Sur REST API, pour valider un JWT tu passes soit par un **autoriseur Cognito** (si le token vient d'un User Pool), soit par un **autoriseur Lambda** que tu codes.

### 2.3 L'anatomie d'une API : routes, méthodes, intégration

Une API expose des **routes** (chemins) associées à des **méthodes** HTTP. Le couple *méthode + chemin* est un **endpoint** :

```
POST   /messages          → Lambda postFeedMessage
GET    /members           → Lambda listMembers
GET    /members/{id}      → Lambda getMember      ({id} = paramètre de chemin)
```

Chaque route pointe vers une **intégration** : le backend qui traite la requête. L'intégration la plus courante est une **fonction Lambda**. (D'autres intégrations existent : endpoint HTTP, service AWS direct, mock — hors périmètre ici.)

Cas spécial, la **ressource proxy** : `ANY /{proxy+}` capte *toutes* les méthodes sur *tous* les sous-chemins et les envoie à une seule Lambda. Pratique pour faire tourner un routeur applicatif (Express/Fastify) dans une Lambda unique — mais tu perds le routage géré par la gateway.

### 2.4 L'intégration Lambda proxy — le format à respecter

En **intégration Lambda proxy**, API Gateway ne transforme presque rien : il passe **toute la requête** à ta Lambda dans un objet `event`, et attend une réponse dans un **format précis**. C'est le mode par défaut recommandé (pas de mapping template à écrire).

**Ce que ta Lambda reçoit** (`event`, champs utiles) :

```json
{
  "httpMethod": "POST",
  "path": "/messages",
  "pathParameters": { "id": "42" },
  "queryStringParameters": { "limit": "20" },
  "headers": { "Authorization": "Bearer eyJ...", "Content-Type": "application/json" },
  "body": "{\"text\":\"Coucou la famille\"}",
  "isBase64Encoded": false,
  "requestContext": { "stage": "prod", "requestId": "abc-123",
                      "authorizer": { "claims": null } }
}
```

**Ce que ta Lambda DOIT renvoyer** (format de sortie, vérifié doc AWS) :

```json
{
  "statusCode": 200,
  "headers": { "Content-Type": "application/json" },
  "body": "{\"id\":\"42\"}",
  "isBase64Encoded": false
}
```

Trois règles non négociables :

1. **`body` est une chaîne**, pas un objet. Tu fais `JSON.stringify(monObjet)`. Renvoyer un objet brut ne marche pas.
2. `statusCode` est **obligatoire**. `headers` et `isBase64Encoded` sont optionnels.
3. **Si la réponse est mal formée** (pas de `statusCode`, mauvais type…), API Gateway renvoie au client une erreur **`502 Bad Gateway`** — pas l'erreur de ta Lambda. C'est le symptôme n°1 à reconnaître : *502 = ma Lambda a répondu dans le mauvais format*.

Le `body` de la requête, lui aussi, arrive **en chaîne** : tu fais `JSON.parse(event.body)` (attention, `event.body` peut être `null`).

### 2.5 Autorisation — quatre portiers, quatre usages

L'autoriseur s'exécute **avant** ton intégration : si l'accès est refusé, ta Lambda n'est jamais invoquée. Quatre mécanismes, à ne pas confondre :

| Autoriseur | Comment | Cas d'usage typique |
|------------|---------|---------------------|
| **IAM** (SigV4) | le client signe la requête avec des credentials AWS | appels **service-à-service** internes AWS |
| **JWT** (HTTP API uniquement) | la gateway valide un JWT contre un émetteur OIDC (issuer + audience) | app web/mobile avec Cognito ou autre OIDC |
| **Cognito** (REST API) | la gateway valide le token d'un **User Pool** Cognito | app avec Cognito, côté REST API |
| **Lambda** (custom) | une Lambda que tu écris décide et renvoie une policy Allow/Deny | logique d'auth **sur mesure**, tokens tiers non-OIDC |

Points clés :

- **JWT vs Cognito** : ce sont deux implémentations du même besoin (« valide un token signé »). L'**autoriseur JWT** est natif **HTTP API** et marche avec n'importe quel émetteur OIDC (dont Cognito). L'**autoriseur Cognito** est le pendant côté **REST API**. Le détail du JWT (claims, expiration, User Pool) est le sujet du **module 11**.
- **Autoriseur Lambda** : la fonction reçoit le token (ou toute la requête) et renvoie une **policy IAM** `Allow`/`Deny` sur `execute-api:Invoke`. Son résultat est **mis en cache** (TTL configurable) pour éviter de la rappeler à chaque requête.
- **API keys ≠ authentification** : une API key (`x-api-key`, REST API seulement) sert à **identifier** un client pour le suivi d'usage et le quota, **pas** à l'authentifier. Ne jamais s'en servir comme unique barrière de sécurité.

### 2.6 Stages et déploiement

Un **stage** = un environnement déployé de l'API, avec sa propre URL :

```
https://abc123.execute-api.eu-west-3.amazonaws.com/dev
https://abc123.execute-api.eu-west-3.amazonaws.com/prod
```

Différence **REST vs HTTP** sur le déploiement (vérifiée doc) :

- **REST API** : les modifications ne sont **pas actives** tant que tu ne crées pas un **déploiement** vers le stage. Piège classique : « j'ai changé ma route mais rien ne bouge » → tu as oublié de re-déployer.
- **HTTP API** : supporte l'**auto-deploy** — le stage `$default` publie automatiquement les changements.

Les **variables de stage** (`event.requestContext` / config du stage) permettent des valeurs par environnement (ex. nom de table `feed-dev` vs `feed-prod`) sans dupliquer le code.

### 2.7 Throttling — la protection par défaut

API Gateway throttle avec l'algorithme du **token bucket** : un débit régulier (*rate*) + une capacité de rafale (*burst*). Quotas **par défaut, par compte et par région**, partagés entre **toutes** tes API (REST + HTTP + WebSocket) — vérifiés doc AWS :

- **Rate** : **10 000 requêtes/seconde** (RPS).
- **Burst** : capacité maximale du bucket de **5 000 requêtes**.
- Le **burst** est fixé par le service AWS et **n'est pas modifiable** par le client. Le rate peut être augmenté sur demande au support.
- Note régionale : quelques régions récentes (Le Cap, Milan, Jakarta, Spain, Zurich, UAE…) démarrent à **2 500 RPS / burst 1 250**.

Quand le trafic dépasse rate+burst, la gateway renvoie **`429 Too Many Requests`**. Le client doit réagir avec un **exponential backoff** (attendre 1 s, 2 s, 4 s…). Tu peux resserrer les limites par **stage** ou par **méthode**, et — en **REST API seulement** — par client via un usage plan.

> Ces limites sont des cibles « best-effort », pas des plafonds garantis au token près (dixit la doc).

### 2.8 CORS — laisser le front d'un autre domaine appeler l'API

Le navigateur bloque par défaut un appel *cross-origin* (front sur `app.tribuzen.com`, API sur `execute-api…`). **CORS** l'autorise via des en-têtes. Deux points :

1. Le navigateur envoie d'abord une requête **préflight** `OPTIONS` pour les requêtes « non simples ». La gateway doit y répondre avec les bons en-têtes CORS.
2. **Piège majeur en intégration Lambda proxy** : côté **REST API**, API Gateway n'ajoute **pas** automatiquement l'en-tête `Access-Control-Allow-Origin` sur tes réponses — **ta Lambda doit l'inclure elle-même** dans *chaque* réponse (y compris les erreurs). La doc AWS est explicite : « To enable CORS for the Lambda proxy integration, you must add `Access-Control-Allow-Origin` to the output `headers`. » Côté **HTTP API**, tu peux au contraire configurer le CORS **au niveau de l'API** (la gateway gère les en-têtes et le préflight pour toi).

---

## 3. Worked examples

### Exemple 1 — Exposer `postFeedMessage` en HTTP API + le format de réponse

Objectif : `POST /messages` → Lambda `postFeedMessage`, sur un stage `prod`, en **HTTP API** (choix par défaut : simple, JWT natif prévu pour plus tard).

**Étape 1 — le raisonnement de choix.** Ai-je besoin d'API keys, de validation de requête, de cache, de WAF, d'endpoint privé ? Non. Ai-je besoin d'un autoriseur JWT natif (Cognito arrive au module 11) ? Oui. → **HTTP API**.

**Étape 2 — le handler Lambda au bon format.** Le point le plus fragile : le `body` en entrée est une **chaîne**, et la réponse doit avoir `statusCode` + `body` **stringifié**.

```typescript
// handler de postFeedMessage — intégration Lambda proxy
export const handler = async (event: {
  body: string | null
  requestContext: { stage: string }
}) => {
  // event.body arrive en STRING (ou null) → il faut le parser
  const input = event.body ? JSON.parse(event.body) : {}

  if (!input.text || typeof input.text !== 'string') {
    // erreur client — on renvoie 400 SANS throw : format proxy respecté
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'text is required' }),
    }
  }

  // ... écriture DynamoDB (module 06/09) ...
  const created = { id: '42', text: input.text }

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    // body DOIT être une chaîne — stringify obligatoire
    body: JSON.stringify(created),
  }
}
```

**Étape 3 — appeler l'endpoint.**

```bash
curl -X POST \
  https://abc123.execute-api.eu-west-3.amazonaws.com/prod/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"Coucou la famille"}'
# → 201 {"id":"42","text":"Coucou la famille"}
```

Si j'avais renvoyé `return created` (l'objet brut, sans `statusCode` ni `body` stringifié), le client recevrait **`502 Bad Gateway`** : la Lambda s'exécute correctement mais la gateway ne sait pas interpréter sa sortie. C'est *le* réflexe de diagnostic à ancrer.

### Exemple 2 — Choisir l'autoriseur pour trois besoins différents

Trois routes de TribuZen, trois autoriseurs :

1. **`POST /messages`, appelée par le front après login Cognito.** Le front envoie `Authorization: Bearer <JWT Cognito>`. En **HTTP API** → **autoriseur JWT** natif : je configure l'*issuer* (l'URL du User Pool) et l'*audience* (le client ID). La gateway valide signature + expiration avant d'invoquer la Lambda. Zéro code d'auth dans `postFeedMessage`. (Le détail Cognito = module 11.)

2. **`POST /internal/reindex`, appelée par une autre Lambda backend.** Pas d'utilisateur humain, appel service-à-service dans AWS → **autoriseur IAM** : l'appelant signe la requête en SigV4 avec son role. Aucun token à gérer.

3. **`GET /partner/feed`, appelée par un partenaire B2B avec un token maison non-OIDC.** Ni Cognito, ni IAM → **autoriseur Lambda** : j'écris une fonction qui reçoit le token, le vérifie (base, service tiers), et renvoie une policy `Allow`/`Deny`. J'active un **cache** (TTL 300 s) pour ne pas la rappeler à chaque requête du même client.

Erreur à éviter : vouloir un **autoriseur JWT sur une REST API**. Il n'existe pas côté REST — il faudrait un autoriseur **Cognito** (token de User Pool) ou **Lambda**. Le JWT natif est une exclusivité HTTP API.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Renvoyer un objet au lieu du format proxy → 502

En intégration Lambda proxy, `return { id: 42 }` **n'est pas** une réponse valide. Il faut `{ statusCode, headers?, body: JSON.stringify(...) }`, avec `body` **en chaîne**. Une sortie malformée → **`502 Bad Gateway`** renvoyé au client (pas l'erreur de ta Lambda). Règle mnémo : *502 en Lambda proxy = format de réponse cassé*.

### PIÈGE #2 — Croire que HTTP API a un autoriseur JWT ET que REST API aussi

L'**autoriseur JWT natif** n'existe **que** sur **HTTP API**. Sur **REST API**, pour valider un JWT : autoriseur **Cognito** (token de User Pool) ou autoriseur **Lambda**. Choisir REST API « parce qu'on veut du JWT » est un contresens : c'est justement HTTP API qui l'offre nativement.

### PIÈGE #3 — Prendre REST API « par défaut »

REST API coûte plus cher et n'apporte que si tu utilises ses fonctions exclusives (API keys/usage plans, validation de requête, cache, WAF, endpoint privé/edge, X-Ray). Sans ce besoin, **HTTP API** est le bon défaut. Inversement, choisir HTTP API alors que tu as besoin d'API keys ou de validation de requête = tu ne les auras **pas** (indisponibles sur HTTP API).

### PIÈGE #4 — Oublier de re-déployer une REST API

Sur **REST API**, modifier une route/méthode ne suffit pas : tant que tu ne crées pas un **déploiement** vers le stage, le changement n'est pas actif (« ça ne bouge pas »). Sur **HTTP API**, l'**auto-deploy** du stage `$default` évite ce piège. Ne pas généraliser le comportement de l'un à l'autre.

### PIÈGE #5 — Compter sur la gateway pour les en-têtes CORS en Lambda proxy (REST)

En **REST API** + Lambda proxy, la gateway **n'injecte pas** `Access-Control-Allow-Origin` : ta Lambda doit l'ajouter dans **chaque** réponse, erreurs comprises. Symptôme : ça marche en `curl` mais le navigateur bloque avec une erreur CORS. En **HTTP API**, on configure le CORS au niveau de l'API et la gateway s'en charge — ne pas confondre les deux modèles.

### PIÈGE #6 — Confondre API key et authentification

Une **API key** (`x-api-key`, REST API seulement) **identifie** un client pour l'usage plan / le quota. Elle **n'authentifie pas** et ne protège pas une API à elle seule. La sécurité vient de l'autoriseur (IAM/JWT/Cognito/Lambda), pas de la clé.

### PIÈGE #7 — Croire que le throttling est par API

Le quota par défaut (**10 000 RPS, burst 5 000**) est **par compte et par région**, **partagé** entre toutes tes API. Une API bruyante peut throttler les autres. Pour isoler, on configure des limites par **stage/méthode** (et par client via usage plan en REST API). Le **burst n'est pas modifiable** par le client.

---

## 5. Ancrage TribuZen

API Gateway est la **couche HTTP** de TribuZen : tout ce que le front Vue appelle passe par elle avant d'atteindre une Lambda.

| Route TribuZen | Type d'API | Intégration | Autoriseur | Note |
|----------------|-----------|-------------|------------|------|
| `POST /messages` | HTTP API | Lambda `postFeedMessage` | JWT (Cognito, module 11) | body parsé, réponse 201 stringifiée |
| `GET /members` | HTTP API | Lambda `listMembers` | JWT | CORS configuré au niveau API |
| `GET /members/{id}` | HTTP API | Lambda `getMember` | JWT | `{id}` en `pathParameters` |
| `POST /internal/reindex` | HTTP API | Lambda backend | IAM (SigV4) | service-à-service, pas d'humain |

Décisions d'architecture pour TribuZen :

- **HTTP API par défaut** : TribuZen n'a besoin ni d'API keys, ni de validation JSON Schema côté gateway (la validation applicative est dans la Lambda), ni de cache, ni de WAF au lancement → HTTP API, moins cher, autoriseur **JWT** natif branché sur Cognito.
- **CORS au niveau de l'API** (avantage HTTP API) : le front `app.tribuzen.com` est autorisé une fois, la gateway gère le préflight `OPTIONS`.
- **Stages `dev` et `prod`**, chacun sa table DynamoDB via variables de stage ; l'**auto-deploy** du stage évite le piège du re-déploiement.
- **Throttling** : les limites par défaut suffisent au lancement ; en cas de campagne, on resserre par stage.
- L'API, les routes, l'intégration Lambda et l'autoriseur seront **définis en CDK** (module 05), pas cliqués à la main — la console sert à comprendre, le CDK à produire.

> Le JWT lui-même (User Pool, claims, expiration, refresh) relève du **module 11 (Cognito)** ; ici la gateway ne fait que *valider* le token que Cognito a émis. Le WAF devant l'API et le chiffrement relèvent du **module 15**.

---

## 6. Points clés

1. **API Gateway** = porte HTTP managée devant tes backends : reçoit, authentifie, throttle, route vers une Lambda, renvoie la réponse.
2. Trois types : **REST API** (riche), **HTTP API** (simple, moins cher), **WebSocket API** (temps réel). REST et HTTP font le même métier requête/réponse.
3. **REST vs HTTP** : API keys, validation de requête, cache, WAF, endpoint privé/edge, X-Ray = **REST seulement**. Autoriseur **JWT natif** = **HTTP seulement**. Défaut = HTTP API, REST si besoin d'une de ses fonctions exclusives.
4. **Intégration Lambda proxy** : la Lambda reçoit tout l'`event`, `body` en chaîne ; elle **doit** renvoyer `{ statusCode, headers?, body: JSON.stringify(...) }`. Réponse malformée → **`502 Bad Gateway`**.
5. **Autoriseurs** : IAM (service-à-service), JWT (HTTP API, OIDC/Cognito), Cognito (REST API), Lambda (custom, résultat caché). API key = identification, **pas** authentification.
6. **Stages** = environnements avec URL propre. REST : **re-déployer** pour activer un changement ; HTTP : **auto-deploy**.
7. **Throttling** par défaut : **10 000 RPS / burst 5 000**, par compte+région, partagé entre toutes les API ; dépassement → **`429 Too Many Requests`** (client : exponential backoff).
8. **CORS** : en REST API + Lambda proxy, **la Lambda** ajoute `Access-Control-Allow-Origin` sur chaque réponse ; en HTTP API, on configure le CORS au niveau de l'API.

---

## 7. Seeds Anki

```
API Gateway : quelle règle pour choisir entre REST API et HTTP API ?|HTTP API par défaut (plus simple, moins cher, autoriseur JWT natif). REST API seulement si besoin d'une de ses fonctions exclusives : API keys/usage plans, validation de requête, cache, WAF, endpoint privé/edge, X-Ray.
En intégration Lambda proxy, quel est le format de réponse obligatoire et que se passe-t-il s'il est mal formé ?|La Lambda doit renvoyer { statusCode, headers?, body } avec body en CHAÎNE (JSON.stringify). Si la sortie est malformée (ex. objet brut sans statusCode), API Gateway renvoie 502 Bad Gateway au client.
Quel type d'autoriseur JWT natif existe, et sur quel type d'API uniquement ?|L'autoriseur JWT natif existe uniquement sur HTTP API. Sur REST API, pour valider un JWT il faut un autoriseur Cognito (token de User Pool) ou un autoriseur Lambda.
Quels sont les quatre autoriseurs d'API Gateway et leur usage ?|IAM (SigV4, service-à-service) ; JWT (HTTP API, OIDC/Cognito) ; Cognito (REST API, User Pool) ; Lambda (logique custom, renvoie une policy Allow/Deny, résultat mis en cache).
Différence de déploiement entre REST API et HTTP API ?|REST API : un changement n'est actif qu'après création d'un déploiement vers le stage (piège du "ça ne bouge pas"). HTTP API : auto-deploy du stage $default, changements publiés automatiquement.
Quelles sont les limites de throttling par défaut et le code renvoyé en cas de dépassement ?|10 000 RPS de rate + burst (bucket) de 5 000, par compte et par région, partagés entre toutes les API. Dépassement → 429 Too Many Requests ; le client doit faire de l'exponential backoff. Le burst n'est pas modifiable par le client.
En Lambda proxy REST API, qui doit ajouter les en-têtes CORS ?|La Lambda elle-même doit inclure Access-Control-Allow-Origin dans chaque réponse (erreurs comprises) ; la gateway ne l'ajoute pas automatiquement. En HTTP API, on configure le CORS au niveau de l'API.
Une API key protège-t-elle une API ? Sur quel type d'API existe-t-elle ?|Non : une API key (x-api-key, REST API uniquement) sert à identifier un client pour l'usage plan / le quota, pas à l'authentifier. La sécurité vient de l'autoriseur (IAM/JWT/Cognito/Lambda).
```

---

## Pont vers le lab

> Lab associé : `labs/lab-07-api-gateway/README.md`. Tu déploies une **vraie** HTTP API devant une **vraie** Lambda (AWS CLI + Console), tu appelles l'endpoint au `curl`, tu provoques puis corriges un **502** de format, tu observes le CORS — puis tu **détruis tout** (teardown, Free Tier). Corrigé complet, feedback coach, variante J+30.
