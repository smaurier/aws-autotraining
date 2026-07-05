---
titre: Cognito — Authentification et identités managées
cours: 12-aws-cloud
notions: [User Pool, Identity Pool, "sign-up / confirm-sign-up", initiate-auth, "SRP (secure remote password)", USER_SRP_AUTH, USER_PASSWORD_AUTH, REFRESH_TOKEN_AUTH, ID token, access token, refresh token, "token_use = id | access", "claim cognito:groups", JWKS, "iss / aud / client_id", RS256, app client, "hosted UI / managed login", domaine Cognito, triggers Lambda, pre token generation, "fédération OIDC / SAML", "COGNITO_USER_POOLS authorizer", MFA TOTP, "credentials temporaires STS"]
outcomes:
  - sait distinguer un User Pool (authentification, JWT) d'un Identity Pool (credentials AWS temporaires via STS) et choisir le bon
  - sait dérouler un flux sign-up / confirm / sign-in avec l'AWS CLI et récupérer les trois tokens
  - sait décoder et vérifier un JWT Cognito (signature JWKS, iss, aud/client_id, token_use, exp)
  - sait brancher un User Pool comme authorizer d'API Gateway et lire les claims côté backend
prerequis: [Modules 00-10 du cours 12-aws-cloud, dont 01-iam (roles, STS, moindre privilège) et 07-api-gateway (REST vs HTTP API, autorisers)]
next: 12-ecs-fargate-containers
libs: []
tribuzen: infra cloud TribuZen — authentification des familles via un User Pool Cognito, JWT vérifié par l'API Gateway devant les Lambda du feed
last-reviewed: 2026-07
---

# Cognito — Authentification et identités managées

> **Outcomes — tu sauras FAIRE :** distinguer User Pool et Identity Pool, dérouler un flux sign-up/sign-in en CLI et récupérer les tokens, décoder et vérifier un JWT Cognito, brancher un User Pool comme authorizer d'API Gateway.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **Cognito seul** — User Pools, Identity Pools, flux d'authentification, JWT, triggers, fédération (survol), intégration API Gateway. Il **réutilise** IAM/STS (module 01) et API Gateway (module 07) sans les réexpliquer. Le chiffrement (**KMS**), les secrets (**Secrets Manager**) et le WAF devant l'auth relèvent du **module 15 (sécurité AWS avancée)**. Ici, une seule question : *comment prouver qui est l'utilisateur, et quoi faire de cette preuve ?*

## 1. Cas concret d'abord

TribuZen a besoin de connecter les membres d'une famille : chaque parent se crée un compte, confirme son email, se connecte, et l'app appelle ensuite l'API du feed familial. Un collègue propose de « faire l'auth nous-mêmes » dans une Lambda :

```ts
// ❌ auth "maison" dans une Lambda — le piège classique
export async function login(email: string, password: string) {
  const user = await db.getUser(email)
  if (user.passwordHash === md5(password)) {        // hash cassé, pas de sel
    return { token: sign({ email }, 'super-secret') } // secret en dur, jamais tourné
  }
  throw new Error('invalid')
}
```

Ce que ce code n'a pas et n'aura jamais sans des semaines de travail :

1. Un **hash de mot de passe** correct (bcrypt/Argon2 + sel), pas `md5`.
2. La **vérification d'email**, le **reset de mot de passe**, le **MFA**, le blocage anti brute-force.
3. Une **rotation des clés de signature** des tokens, et une signature **asymétrique** (le backend ne devrait pas connaître le secret pour *vérifier* un token).
4. La **fédération** (« se connecter avec Google ») et le **SSO** entreprise (SAML) quand un client B2B le demandera.

**Cognito** fournit tout ça en service managé : un **User Pool** est un annuaire d'utilisateurs qui *authentifie* et émet des **JWT** standards (OIDC). Un **Identity Pool** échange ensuite ces tokens contre des **credentials AWS temporaires** (via STS) si le front doit taper directement S3/DynamoDB. À la fin de ce module, tu sais lequel des deux tu veux, comment obtenir les tokens, et comment le backend les vérifie sans jamais voir le mot de passe.

> **Free tier Cognito :** depuis nov. 2024, les User Pools offrent **10 000 MAU gratuits/mois** (tier Lite ou Essentials), un tier permanent qui n'expire pas. Les pools créés avant cette date conservent en grandfathering l'ancien palier de 50 000 MAU. La fédération SAML/OIDC n'a droit qu'à **50 MAU** gratuits.

---

## 2. Théorie complète, concise

### 2.1 Les deux composants : User Pool vs Identity Pool

C'est **LA** distinction du module. Les deux sont indépendants et se combinent souvent, mais ne répondent pas à la même question (formulation doc AWS : « The two components... operate independently or in tandem »).

| | **User Pool** | **Identity Pool** (Federated Identities) |
|---|---|---|
| Question | *Qui es-tu ?* (**authentification**) | *À quelles ressources AWS as-tu droit ?* (**autorisation AWS**) |
| Ce qu'il est | un **annuaire** d'utilisateurs + serveur d'auth OIDC | un **courtier de credentials** |
| Ce qu'il produit | des **JWT** (ID, access, refresh) | des **credentials AWS temporaires** (AccessKeyId, SecretAccessKey, SessionToken) via **STS** |
| Pour quoi | connexion à ton app/API, autoriser des appels API | accès **direct** du client à S3, DynamoDB… |
| Peut fonctionner seul | oui (« issue authenticated JWTs directly to an app, a web server, or an API ») | oui (accepte aussi des claims d'IdP tiers) |

Combinés (scénario doc AWS) :

```
1. L'utilisateur se connecte via le User Pool        → reçoit des tokens OAuth 2.0 (JWT)
2. L'app échange le token du User Pool auprès de     → l'Identity Pool
3. L'Identity Pool appelle STS                       → credentials AWS temporaires
4. Le client accède directement à S3, DynamoDB, ...  avec ces credentials
```

> **Règle de choix.** Besoin de *connecter des utilisateurs à ton API* → **User Pool** suffit. Besoin que le *front frappe directement un service AWS* au nom de l'utilisateur → ajouter un **Identity Pool**. Pour TribuZen, le front parle à l'API Gateway (pas à S3 en direct) : on utilise surtout le **User Pool**.

### 2.2 User Pool : annuaire + serveur d'authentification

Un User Pool stocke des profils utilisateur (attributs standard OIDC — `email`, `name`, `phone_number`… — et attributs `custom:`), gère le sign-up, la confirmation, le reset, le MFA, la protection anti-attaques. Il joue à la fois :

- **OIDC IdP** pour ton app (il émet des ID tokens),
- **serveur d'autorisation OAuth 2.0** (il émet des access tokens avec des scopes),
- et **service provider** vers des IdP tiers (Google, Facebook, Apple, ou SAML/OIDC entreprise) — il mappe leurs claims vers un **format de token unique**.

### 2.3 App client : par où l'application parle au pool

Une application n'interagit jamais « avec le pool » directement : elle passe par un **app client** (un identifiant `ClientId`, avec ou sans `ClientSecret`). L'app client déclare notamment les **flux d'authentification autorisés** via `ExplicitAuthFlows`. Valeurs (vérifiées doc) :

| `ExplicitAuthFlows` | Flux `AuthFlow` (InitiateAuth) | À quoi |
|---|---|---|
| `ALLOW_USER_SRP_AUTH` | `USER_SRP_AUTH` | mot de passe via **SRP** — le mot de passe **ne transite pas** en clair |
| `ALLOW_USER_PASSWORD_AUTH` | `USER_PASSWORD_AUTH` | mot de passe envoyé au service (à réserver au dev/migration) |
| `ALLOW_USER_AUTH` | `USER_AUTH` | **choice-based** : le user choisit (mot de passe, OTP email, passkey…) |
| `ALLOW_REFRESH_TOKEN_AUTH` | `REFRESH_TOKEN_AUTH` | renouveler les tokens avec le refresh token |
| `ALLOW_ADMIN_USER_PASSWORD_AUTH` | `ADMIN_USER_PASSWORD_AUTH` | auth **côté serveur** (backend de confiance) |
| `ALLOW_CUSTOM_AUTH` | `CUSTOM_AUTH` | challenges custom via triggers Lambda |

> **SRP** = Secure Remote Password : un protocole où le client prouve qu'il connaît le mot de passe **sans jamais l'envoyer** (« sign-in with secure remote password (SRP) »). `USER_PASSWORD_AUTH` transmet le mot de passe au service — pratique en CLI pour apprendre, mais `USER_SRP_AUTH` est le défaut sain en production.

### 2.4 Flux sign-up → confirm → sign-in

Cycle de vie d'un utilisateur local (créé dans le pool, pas fédéré) :

```
SignUp (email + password)          → compte créé, statut UNCONFIRMED
        ↓  Cognito envoie un code par email/SMS
ConfirmSignUp (code)               → statut CONFIRMED
        ↓
InitiateAuth (USER_PASSWORD_AUTH)  → [challenge MFA éventuel] → 3 tokens JWT
```

Si le MFA est actif, `InitiateAuth` ne renvoie **pas** les tokens tout de suite : il renvoie un **challenge** (ex. `SOFTWARE_TOKEN_MFA`), auquel on répond via `RespondToAuthChallenge` (le code TOTP), et *alors* Cognito émet les tokens. Un flux peut enchaîner plusieurs challenges ; chaque réponse renvoie une `Session` à rejouer (par défaut **3 minutes** pour répondre à chaque challenge).

> **Anti brute-force (doc).** Après **5** échecs de mot de passe, Cognito verrouille l'utilisateur 1 s, puis double à chaque échec, jusqu'à ~15 min max. C'est un garde-fou que tu n'as pas à coder.

### 2.5 Les trois tokens JWT

Après une auth réussie, le User Pool renvoie **trois** tokens :

| Token | Contenu (claims) | Sert à | Décodable ? |
|---|---|---|---|
| **ID token** | *identité* : `email`, `name`, attributs, `aud` (= client), `iss`, `cognito:groups` | savoir *qui* est l'utilisateur, peupler l'UI/le profil | oui (base64url → JSON) |
| **Access token** | *autorisation* : `scope`, `cognito:groups`, `client_id`, `iss` | autoriser des appels API, le userInfo endpoint, les self-service | oui (base64url → JSON) |
| **Refresh token** | opaque | obtenir de **nouveaux** ID/access tokens | **non** — chiffré, illisible hors du pool |

Points vérifiés à retenir :

- ID token **et** access token portent le claim `cognito:groups` (les groupes du pool).
- Le refresh token est **chiffré et opaque** : inutile d'essayer de le décoder, seul le pool sait le lire.
- **Durées.** ID et access tokens : configurable de **5 min à 1 jour** (défaut 1 h). Refresh token : **défaut 30 jours**, configurable de **60 minutes à 10 ans** (vérifié doc). Bonne pratique doc : renouveler à ~75 % de la durée de vie, stocker en **mémoire** (client) ou cache chiffré (serveur).

### 2.6 Vérifier un JWT — l'étape que personne ne doit sauter

Un JWT se **décode** trivialement (base64url) : ne *jamais* faire confiance à son contenu sans **vérifier la signature**. Un access token modifié = escalade de privilège ; un ID token modifié = usurpation. Cognito signe en **RS256** (RSA + SHA-256, signature **asymétrique**) : le backend n'a besoin que de la **clé publique** pour vérifier.

Structure d'un JWT : `header.payload.signature` (trois segments séparés par `.`). Le header contient `kid` (quelle clé) et `alg` (`RS256`).

Les clés publiques sont exposées au **JWKS URI** du pool :

```
https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/jwks.json
```

Étapes de vérification (doc AWS, à faire à **chaque** sign-in) :

1. **Signature** : récupérer la clé du JWKS dont le `kid` correspond au `kid` du header, vérifier la signature RS256. (Cacher le JWKS par `kid`, le pool peut faire tourner ses clés.)
2. **`iss`** doit valoir `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`.
3. **`aud`** (ID token) ou **`client_id`** (access token) doit valoir l'**app client** attendu.
4. **`token_use`** : `id` si tu attends un ID token, `access` si tu attends un access token.
5. **`exp`** : le token ne doit pas être expiré.

En Node, AWS recommande la lib **`aws-jwt-verify`** (`CognitoJwtVerifier`) qui fait tout ça. On **ne** réimplémente **pas** la crypto à la main.

### 2.7 Hosted UI / managed login

Cognito fournit des **pages d'authentification hébergées** : login, sign-up, reset, MFA, et les boutons de fédération, sans écrire de front. On active un **domaine** sur le pool, ce qui expose des endpoints OAuth 2.0 :

```
https://<domaine>.auth.<region>.amazoncognito.com/login       (managed login / hosted UI)
https://<domaine>.auth.<region>.amazoncognito.com/oauth2/token
https://<domaine>.auth.<region>.amazoncognito.com/logout
```

> AWS propose désormais **managed login** (la version moderne, personnalisable, avec passkeys/passwordless) à côté du **classic hosted UI**. Les flux **passwordless** et **passkey** ne sont disponibles **qu'en managed login**, pas via l'API SDK directe. Les flux de **fédération** (Google/SAML) passent aussi **obligatoirement** par ces pages hébergées, jamais par l'API SDK pure.

### 2.8 Triggers Lambda

Cognito peut invoquer une **Lambda** à des moments clés du cycle de vie, pour injecter ta logique métier :

| Trigger | Moment | Usage TribuZen typique |
|---|---|---|
| **Pre Sign-up** | avant création | auto-confirmer un domaine de confiance, valider l'email |
| **Post Confirmation** | après confirmation | créer le profil famille dans DynamoDB |
| **Pre Token Generation** | avant l'émission des tokens | **ajouter des claims** (ex. `family_id`) au JWT |
| **Custom Message** | à l'envoi d'un email/SMS | personnaliser le mail de vérification |
| **User Migration** | user inconnu qui se connecte | migrer depuis un ancien système |
| **Define / Create / Verify Auth Challenge** | flux `CUSTOM_AUTH` | CAPTCHA, challenge maison |

**Pre Token Generation** est le plus utile côté produit : plutôt que de requêter la base à chaque appel API pour savoir à quelle famille appartient l'utilisateur, on **grave** l'info dans le token une fois pour toutes.

### 2.9 Fédération OIDC / SAML (survol)

La fédération laisse l'utilisateur se connecter via un **IdP externe** sans créer de mot de passe dans le pool :

- **Social / OIDC** : Google, Facebook, Apple, Amazon, ou tout IdP OIDC générique (issuer + client id/secret).
- **SAML 2.0** : IdP entreprise (Okta, ADFS, Entra ID) via les **metadata** de l'IdP — le cas SSO B2B.

Le User Pool agit alors comme **service provider** vers l'IdP et **IdP** vers ton app : quel que soit le fournisseur, ton app reçoit **le même format de JWT**. C'est tout l'intérêt — standardiser en aval.

### 2.10 Intégration API Gateway (authorizer)

Le cas TribuZen : l'app envoie un token, l'**API Gateway** le vérifie avant d'atteindre la Lambda. Deux options selon le type d'API (module 07) :

- **REST API** → authorizer de type **`COGNITO_USER_POOLS`**. Le client passe un **ID token ou access token** dans le header **`Authorization`** ; API Gateway valide et rejette sinon (doc : « call the API method with one of the tokens, which are typically set to the request's `Authorization` header »). L'**ID token** autorise sur les **claims d'identité** ; l'**access token** autorise sur les **scopes** OAuth. Les claims sont exposés au backend via `$context.authorizer.claims` → dans la Lambda : `event.requestContext.authorizer.claims`.
- **HTTP API** → **JWT authorizer** natif : on configure l'**issuer** (l'URL du pool) et l'**audience** (l'app client). Claims côté Lambda : `event.requestContext.authorizer.jwt.claims`.

Dans les deux cas, la validation cryptographique est **déléguée** à API Gateway : la Lambda reçoit des claims déjà vérifiés.

---

## 3. Worked examples

### Exemple 1 — Créer un User Pool et dérouler sign-up → sign-in en CLI

Objectif : un pool TribuZen, un app client capable de `USER_PASSWORD_AUTH`, un utilisateur qui s'inscrit, se confirme, se connecte, et récupère ses tokens.

```bash
# 1. Créer le User Pool (email = identifiant, email auto-vérifié)
aws cognito-idp create-user-pool \
  --pool-name tribuzen-users \
  --username-attributes email \
  --auto-verified-attributes email \
  --policies '{"PasswordPolicy":{"MinimumLength":12,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":true}}'
# → note l'Id retourné, ex. eu-west-3_ABC123

# 2. Créer un app client SANS secret (client public, ex. SPA) et autoriser USER_PASSWORD_AUTH
aws cognito-idp create-user-pool-client \
  --user-pool-id eu-west-3_ABC123 \
  --client-name tribuzen-web \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
# → note le ClientId, ex. 5abc123def456

# 3. Sign-up : l'utilisateur crée son compte (statut UNCONFIRMED)
aws cognito-idp sign-up \
  --client-id 5abc123def456 \
  --username alice@tribuzen.app \
  --password 'MotDePasseTresSolide1!' \
  --user-attributes Name=name,Value="Alice Martin"

# 4. Confirmer avec le code reçu par email (statut → CONFIRMED)
aws cognito-idp confirm-sign-up \
  --client-id 5abc123def456 \
  --username alice@tribuzen.app \
  --confirmation-code 123456

# 5. Sign-in : récupérer les trois tokens
aws cognito-idp initiate-auth \
  --client-id 5abc123def456 \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=alice@tribuzen.app,PASSWORD='MotDePasseTresSolide1!'
```

Réponse de `initiate-auth` (pas de MFA activé ici) :

```json
{
  "AuthenticationResult": {
    "AccessToken":  "eyJraWQ...",
    "IdToken":      "eyJraWQ...",
    "RefreshToken": "eyJjdH...",
    "ExpiresIn": 3600,
    "TokenType": "Bearer"
  }
}
```

Analyse :
- `--no-generate-secret` : un client **public** (SPA, mobile) ne peut pas garder un secret ; un backend de confiance en générerait un.
- `ALLOW_USER_PASSWORD_AUTH` est activé **volontairement** pour apprendre en CLI ; en prod on préfère `ALLOW_USER_SRP_AUTH` (mot de passe jamais transmis).
- `ExpiresIn: 3600` = 1 h : la durée par défaut des ID/access tokens. Le refresh token, lui, vit 30 jours par défaut.

### Exemple 2 — Décoder puis vérifier l'ID token

**Décoder** (sans vérifier) le payload de l'ID token — juste pour *lire* :

```bash
# le payload est le 2e segment séparé par des points
echo "<IdToken>" | cut -d. -f2 | base64 -d 2>/dev/null
```

Payload typique (décodé) :

```json
{
  "sub": "8f3b...-uuid",
  "iss": "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_ABC123",
  "aud": "5abc123def456",
  "token_use": "id",
  "cognito:username": "alice@tribuzen.app",
  "email": "alice@tribuzen.app",
  "email_verified": true,
  "name": "Alice Martin",
  "exp": 1893456000,
  "iat": 1893452400
}
```

**Vérifier** (Node, lib recommandée par AWS) — c'est ce que fait un backend qui reçoit le token :

```js
// npm i aws-jwt-verify
import { CognitoJwtVerifier } from 'aws-jwt-verify'

const verifier = CognitoJwtVerifier.create({
  userPoolId: 'eu-west-3_ABC123',
  tokenUse: 'id',              // on attend un ID token → token_use doit valoir "id"
  clientId: '5abc123def456',   // vérifie l'audience (aud)
})

// verify() télécharge le JWKS, matche le kid, contrôle signature RS256, iss, aud, token_use, exp
const payload = await verifier.verify(idToken)
console.log(payload.email) // digne de confiance SEULEMENT après verify()
```

Ce que `verify()` contrôle (et qu'un `base64 -d` **ne** contrôle **pas**) :
1. la **signature** via le `kid` du JWKS (`.../.well-known/jwks.json`),
2. `iss` = ton pool, 3. `aud` = ton app client, 4. `token_use` = `id`, 5. `exp` non dépassé.

Sans ces 5 contrôles, n'importe qui peut forger un JSON et se faire passer pour Alice.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre User Pool et Identity Pool

- **User Pool** = *authentification* → produit des **JWT**. C'est ce dont TribuZen a besoin pour son API.
- **Identity Pool** = *autorisation AWS* → produit des **credentials AWS temporaires** (STS) pour taper S3/DynamoDB **en direct** depuis le client.

Beaucoup ajoutent un Identity Pool « parce que le tuto le fait » alors que le front passe par une API Gateway : dans ce cas l'Identity Pool est **inutile**. On l'ajoute seulement si le client doit accéder à un service AWS sans backend.

### PIÈGE #2 — Faire confiance à un JWT décodé sans le vérifier

Décoder un JWT (`base64 -d`) ne prouve **rien** : les segments header/payload sont en clair, n'importe qui les fabrique. Seule la **vérification de signature** (JWKS + `kid`, RS256) + `iss`/`aud`/`token_use`/`exp` rend le contenu digne de confiance. Lire `payload.email` sans `verify()` = trou de sécurité.

### PIÈGE #3 — Vérifier le mauvais token, ou ignorer `token_use`

L'access token et l'ID token ont des rôles différents : autoriser une **API par scopes** → **access token** (`token_use: access`) ; connaître **l'identité** → **ID token** (`token_use: id`). Oublier de contrôler `token_use` laisse accepter un ID token là où un access token est attendu (et inversement) : une confusion que les attaquants exploitent.

### PIÈGE #4 — Essayer de décoder le refresh token

L'ID et l'access tokens sont des JWT lisibles (base64url). Le **refresh token est chiffré et opaque** : il n'a pas de claims exploitables côté client, seul le pool le lit. Le passer à un décodeur JWT ne donne rien d'utile — son seul usage est `REFRESH_TOKEN_AUTH`.

### PIÈGE #5 — `USER_PASSWORD_AUTH` en production

`USER_PASSWORD_AUTH` **transmet le mot de passe** au service : acceptable pour apprendre en CLI, à éviter en prod. `USER_SRP_AUTH` (Secure Remote Password) prouve la connaissance du mot de passe **sans l'envoyer**. Activer `ALLOW_USER_PASSWORD_AUTH` sur l'app client de production, c'est ouvrir une porte qu'on n'a pas besoin d'ouvrir.

### PIÈGE #6 — Croire que la fédération se fait via l'API SDK

Les connexions **Google/Facebook/SAML** passent **obligatoirement** par les pages hébergées (hosted UI / managed login), pas par `InitiateAuth` en SDK pur. De même, **passkey** et **passwordless** ne sont dispo qu'en **managed login**. Vouloir tout piloter en API SDK bloque ces cas d'usage.

---

## 5. Ancrage TribuZen

TribuZen authentifie les familles avec **un User Pool** ; le front (Nuxt/Vue) parle à l'**API Gateway** (module 07) qui met un **authorizer Cognito** devant les Lambda du feed (module 06). Pas d'Identity Pool au départ : le client ne tape jamais S3/DynamoDB en direct.

Chaîne complète :

```
App TribuZen ──(1) sign-in──▶ User Pool  ──▶ ID + access + refresh (JWT)
App ──(2) GET /feed  Authorization: Bearer <access token>──▶ API Gateway
                                   │ authorizer COGNITO_USER_POOLS (vérifie le JWT)
                                   ▼
                          Lambda getFeed  (event.requestContext.authorizer.claims)
                                   │  lit family_id depuis les claims
                                   ▼
                          DynamoDB TribuZenFeed  (items de CETTE famille)
```

Choix concrets :

| Besoin TribuZen | Réponse Cognito |
|---|---|
| Login email + mot de passe | User Pool, app client `USER_SRP_AUTH` |
| « Se connecter avec Google » | fédération OIDC via managed login |
| Chaque JWT sait à quelle famille il appartient | trigger **Pre Token Generation** ajoute `family_id` |
| Créer le profil famille à l'inscription | trigger **Post Confirmation** écrit dans DynamoDB |
| Protéger l'API du feed | authorizer **`COGNITO_USER_POOLS`** sur l'API Gateway |
| MFA pour les comptes admin de famille | MFA **TOTP** activé sur le pool |

> Le **client secret** de la fédération Google et les paramètres sensibles ne vont **pas** en dur : ils relèvent de **Secrets Manager** (module 15). Ici, Cognito ne fait qu'*authentifier* et *émettre des tokens* ; le stockage sécurisé des secrets est un autre module.

---

## 6. Points clés

1. **User Pool** = authentification → émet des **JWT** (ID/access/refresh). **Identity Pool** = échange un token contre des **credentials AWS temporaires** (STS). Deux composants indépendants, questions différentes.
2. Une app parle au pool via un **app client** (`ClientId`) qui déclare les **flux autorisés** (`ExplicitAuthFlows` : `ALLOW_USER_SRP_AUTH`, `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`, …).
3. Cycle : **SignUp** (UNCONFIRMED) → **ConfirmSignUp** (CONFIRMED) → **InitiateAuth** → tokens (avec challenge **MFA** intercalé si activé).
4. Trois tokens : **ID** (identité), **access** (scopes/`cognito:groups`), **refresh** (opaque, chiffré). ID/access défaut **1 h** (5 min–1 j) ; refresh défaut **30 j** (60 min–10 ans).
5. **Vérifier** un JWT = signature via **JWKS**/`kid` (**RS256**) + `iss` + `aud`/`client_id` + `token_use` + `exp`. Décoder ≠ vérifier. Utiliser **`aws-jwt-verify`**.
6. **SRP** (`USER_SRP_AUTH`) ne transmet jamais le mot de passe ; `USER_PASSWORD_AUTH` si — à réserver au dev/CLI.
7. **Triggers Lambda** (surtout **Pre Token Generation** pour ajouter des claims, **Post Confirmation** pour provisionner) ; **fédération** OIDC/SAML via les pages **managed login**.
8. Devant l'API : **REST → `COGNITO_USER_POOLS`** (token dans `Authorization`, claims via `event.requestContext.authorizer.claims`) ; **HTTP API → JWT authorizer** (issuer + audience).

---

## 7. Seeds Anki

```
Cognito : différence entre User Pool et Identity Pool ?|User Pool = authentification, il émet des JWT (ID/access/refresh). Identity Pool = il échange un token contre des credentials AWS temporaires via STS pour accéder directement à S3/DynamoDB. Indépendants, souvent combinés.
Quels sont les trois tokens d'un User Pool et lequel n'est pas décodable ?|ID token (identité), access token (scopes/cognito:groups), refresh token (obtenir de nouveaux tokens). Le refresh token est chiffré et opaque : non décodable, seul le pool le lit. ID et access sont des JWT base64url lisibles.
Quelles vérifications faire sur un JWT Cognito avant de lui faire confiance ?|Signature via la clé du JWKS dont le kid correspond (RS256), iss = URL du pool, aud (ID) ou client_id (access) = app client, token_use (id ou access), exp non expiré. Décoder ne suffit pas : il faut vérifier la signature.
Où se trouvent les clés publiques pour vérifier un JWT Cognito ?|Au JWKS URI du pool : https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/jwks.json — on matche le kid du header du token à une clé du JWKS.
Différence entre USER_SRP_AUTH et USER_PASSWORD_AUTH ?|USER_SRP_AUTH (Secure Remote Password) prouve la connaissance du mot de passe sans jamais le transmettre. USER_PASSWORD_AUTH envoie le mot de passe au service — à réserver au dev/CLI, SRP en prod.
Quel est le cycle de vie d'un utilisateur local d'un User Pool ?|SignUp (statut UNCONFIRMED) → code de vérification par email/SMS → ConfirmSignUp (statut CONFIRMED) → InitiateAuth → tokens JWT (avec un challenge MFA intercalé via RespondToAuthChallenge si le MFA est actif).
À quoi sert le trigger Pre Token Generation, exemple TribuZen ?|Ajouter/modifier/supprimer des claims dans les tokens avant émission. Ex TribuZen : graver family_id dans le JWT pour ne pas requêter la base à chaque appel API.
Comment API Gateway REST valide-t-il un token Cognito et où sont les claims côté Lambda ?|Un authorizer de type COGNITO_USER_POOLS : le client met un ID ou access token dans le header Authorization, API Gateway le valide. Les claims arrivent à la Lambda via event.requestContext.authorizer.claims.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-11-cognito/README.md`. Tu crées un **vrai** User Pool + app client à l'AWS CLI, tu déroules sign-up / confirm / initiate-auth, tu récupères les trois tokens et tu **décodes puis vérifies** l'ID token — puis tu **détruis tout** (teardown, Free Tier). Corrigé commenté, feedback coach, variante J+30.
