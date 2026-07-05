# Lab 11 — Cognito : un vrai User Pool, de l'inscription au JWT vérifié

> **Outcome :** à la fin, tu as créé un **vrai** User Pool Cognito, inscrit et confirmé un utilisateur, récupéré les trois tokens JWT à l'AWS CLI, **décodé puis vérifié** l'ID token — et tout détruit.
> **Vrai outil :** AWS CLI v2 (`aws cognito-idp ...`) sur un vrai compte AWS + `aws-jwt-verify` (Node) pour la vérification. Pas de harnais simulé.
> **Feedback :** le coach valide en session (les tokens réels, la sortie de `verify()`, le teardown). Aucun test-runner auto-correcteur.

> ⚠️ **Coût & Free Tier.** Un User Pool tient dans le **Free Tier** pour ce lab (poignée d'utilisateurs, pas de MFA SMS — le SMS est facturé). **Reste sur email/TOTP, jamais SMS.** À la fin, **supprime le pool** (section Teardown) : ne laisse rien traîner.

---

## Prérequis

- AWS CLI v2 configurée (`aws sts get-caller-identity` répond) avec un user/role autorisé sur `cognito-idp` (module 01).
- Une **boîte email réelle** que tu contrôles (pour recevoir le code de confirmation).
- Node 18+ (pour l'étape de vérification avec `aws-jwt-verify`).
- Une région fixée, ex. `eu-west-3`. Toutes les commandes ci-dessous supposent cette région (`aws configure get region` ou `--region eu-west-3`).

---

## Énoncé

Tu montes l'authentification de TribuZen. Objectif : un utilisateur `toi+lab@…` peut s'inscrire, confirmer son email, se connecter, et ton backend peut **vérifier** son ID token sans jamais voir son mot de passe.

Tu dois produire, **toi-même**, les commandes qui réalisent ce parcours. Le corrigé est plus bas : essaie d'abord.

Livrables à montrer au coach :
1. l'`Id` du User Pool et le `ClientId` de l'app client ;
2. la sortie de `initiate-auth` avec les **trois** tokens ;
3. le **payload décodé** de l'ID token (JSON lisible) ;
4. la sortie de `verify()` d'`aws-jwt-verify` (payload **vérifié**) **et** une preuve que la vérification **échoue** sur un token trafiqué ;
5. la confirmation que le pool est **supprimé**.

**Pas de gap-fill.** Tu écris les commandes à partir des étapes ci-dessous.

---

## Étapes (en friction)

1. **Crée le User Pool** `tribuzen-lab-users` : email comme identifiant, email auto-vérifié, politique de mot de passe forte (≥ 12, majuscule/minuscule/chiffre/symbole). Récupère son `Id`.
2. **Crée un app client** public (`--no-generate-secret`) nommé `tribuzen-lab-web`, autorisant `ALLOW_USER_PASSWORD_AUTH` **et** `ALLOW_REFRESH_TOKEN_AUTH`. Récupère son `ClientId`.
   - *Réfléchis :* pourquoi active-t-on `USER_PASSWORD_AUTH` ici alors que le module dit de préférer SRP en prod ?
3. **Inscris** un utilisateur avec **ta vraie adresse email** et un mot de passe conforme. Le compte est `UNCONFIRMED`.
4. **Relève le code** reçu par email et **confirme** le compte (`confirm-sign-up`). Le compte passe `CONFIRMED`.
5. **Connecte-toi** avec `initiate-auth` / `USER_PASSWORD_AUTH`. Récupère `IdToken`, `AccessToken`, `RefreshToken`.
6. **Décode** le payload de l'`IdToken` (2ᵉ segment, base64url) et repère `iss`, `aud`, `token_use`, `exp`, `email`.
7. **Vérifie** l'`IdToken` avec `aws-jwt-verify` (`tokenUse: 'id'`, ton `clientId`, ton `userPoolId`).
8. **Casse la signature** : change un caractère du token et relance `verify()` → tu dois voir l'erreur. C'est *le* point du lab.
9. **Teardown** : supprime l'app client, puis le pool.

---

## Corrigé complet commenté

### 1-2. Pool + app client

```bash
REGION=eu-west-3

# 1. User Pool
aws cognito-idp create-user-pool \
  --region $REGION \
  --pool-name tribuzen-lab-users \
  --username-attributes email \
  --auto-verified-attributes email \
  --policies '{"PasswordPolicy":{"MinimumLength":12,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":true}}' \
  --query 'UserPool.Id' --output text
# → ex. eu-west-3_ABC123   (garde-le)
POOL_ID=eu-west-3_ABC123

# 2. App client public (pas de secret : c'est une SPA/mobile)
aws cognito-idp create-user-pool-client \
  --region $REGION \
  --user-pool-id $POOL_ID \
  --client-name tribuzen-lab-web \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --query 'UserPoolClient.ClientId' --output text
# → ex. 5abc123def456
CLIENT_ID=5abc123def456
```

> **Pourquoi `USER_PASSWORD_AUTH` ici ?** L'AWS CLI n'implémente pas le calcul SRP (challenge/réponse cryptographique) : `USER_PASSWORD_AUTH` permet de se connecter en une commande **pour apprendre**. En production (front réel), on utilise `ALLOW_USER_SRP_AUTH` via le SDK Amplify, qui ne transmet jamais le mot de passe.

### 3-4. Inscription + confirmation

```bash
EMAIL="ton.adresse+lab@gmail.com"     # ← TA vraie boîte
PASSWORD='MotDePasseTresSolide1!'

# 3. Sign-up → compte UNCONFIRMED, code envoyé par email
aws cognito-idp sign-up \
  --region $REGION \
  --client-id $CLIENT_ID \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --user-attributes Name=name,Value="Alice Lab"

# 4. Confirmer avec le code reçu par email → CONFIRMED
aws cognito-idp confirm-sign-up \
  --region $REGION \
  --client-id $CLIENT_ID \
  --username "$EMAIL" \
  --confirmation-code 123456        # ← le code réel de ton email
```

### 5. Connexion → les trois tokens

```bash
aws cognito-idp initiate-auth \
  --region $REGION \
  --client-id $CLIENT_ID \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$EMAIL",PASSWORD="$PASSWORD"
```

Sortie attendue :

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

> `ExpiresIn: 3600` = 1 h (défaut ID/access). Le refresh token vit 30 j par défaut. Copie l'`IdToken` dans une variable `ID_TOKEN=eyJraWQ...` pour la suite.

### 6. Décoder (≠ vérifier)

```bash
# Le payload est le 2e segment ; on ajoute du padding pour base64 -d
echo "$ID_TOKEN" | cut -d. -f2 | tr '_-' '/+' | \
  awk '{ while(length($0)%4)$0=$0"="; print }' | base64 -d 2>/dev/null | python -m json.tool
```

Tu dois lire quelque chose comme :

```json
{
  "sub": "8f3b...-uuid",
  "iss": "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_ABC123",
  "aud": "5abc123def456",
  "token_use": "id",
  "email": "ton.adresse+lab@gmail.com",
  "email_verified": true,
  "name": "Alice Lab",
  "exp": 1893456000,
  "iat": 1893452400
}
```

> À ce stade, tu as **lu** le token. Tu ne l'as **pas** vérifié : ce JSON est en clair, n'importe qui peut en fabriquer un. D'où l'étape 7.

### 7. Vérifier avec `aws-jwt-verify`

```bash
npm init -y >/dev/null 2>&1
npm i aws-jwt-verify
```

`verify.mjs` :

```js
import { CognitoJwtVerifier } from 'aws-jwt-verify'

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.POOL_ID,   // eu-west-3_ABC123
  tokenUse: 'id',                    // token_use doit valoir "id"
  clientId: process.env.CLIENT_ID,   // vérifie aud
})

const token = process.argv[2]
try {
  // verify() : télécharge le JWKS, matche le kid, contrôle signature RS256, iss, aud, token_use, exp
  const payload = await verifier.verify(token)
  console.log('OK — token vérifié. email =', payload.email)
} catch (err) {
  console.error('REJETÉ —', err.message)
  process.exit(1)
}
```

```bash
POOL_ID=$POOL_ID CLIENT_ID=$CLIENT_ID node verify.mjs "$ID_TOKEN"
# → OK — token vérifié. email = ton.adresse+lab@gmail.com
```

### 8. Casser la signature (le point du lab)

```bash
# On change le tout dernier caractère du token → signature invalide
TAMPERED="${ID_TOKEN%?}X"
POOL_ID=$POOL_ID CLIENT_ID=$CLIENT_ID node verify.mjs "$TAMPERED"
# → REJETÉ — Invalid signature   (ou message équivalent), exit 1
```

> C'est **toute** la démonstration : décoder un JWT trafiqué « marche » (le JSON se lit), mais `verify()` le **rejette** car la signature RS256 ne correspond plus à la clé publique du JWKS. Ne jamais faire confiance à un token non vérifié.

### 9. Teardown (obligatoire)

```bash
# Supprimer l'app client puis le pool (l'ordre importe peu, mais on nettoie tout)
aws cognito-idp delete-user-pool-client \
  --region $REGION --user-pool-id $POOL_ID --client-id $CLIENT_ID

aws cognito-idp delete-user-pool \
  --region $REGION --user-pool-id $POOL_ID

# Vérifier qu'il n'y a plus de pool "tribuzen-lab-users"
aws cognito-idp list-user-pools --region $REGION --max-results 20 \
  --query "UserPools[?Name=='tribuzen-lab-users']"
# → []   (liste vide = propre)
```

> Supprimer le pool supprime aussi ses utilisateurs. Rien ne reste facturable. Fais-le **avant de fermer la session**.

---

## Variante J+30 (fading)

**Même parcours, sans rouvrir ce corrigé, en 30 minutes, avec deux contraintes :**

1. **Active le MFA TOTP** sur le pool (`set-user-pool-mfa-config --software-token-mfa-configuration Enabled=true --mfa-configuration ON`). Le sign-in devient un flux à deux temps : `initiate-auth` renvoie un **challenge** `SOFTWARE_TOKEN_MFA` (pas de tokens), et tu réponds avec `respond-to-auth-challenge` + le code TOTP. Associe un authenticator via `associate-software-token` / `verify-software-token`.
2. **Vérifie l'access token** (pas l'ID token) : `tokenUse: 'access'` dans `aws-jwt-verify`, et repère la différence de claims (`client_id` au lieu de `aud`, `scope`, `cognito:groups`).

**Critère de réussite :** tu obtiens les tokens **après** avoir répondu au challenge MFA, et `verify()` accepte l'access token avec `tokenUse: 'access'` mais **rejette** l'ID token passé avec `tokenUse: 'access'` (mauvais `token_use`). Teardown à la fin.

---

## Application TribuZen

Dans le vrai produit, ce pool n'est pas créé à la main mais **par le CDK** (module 05) pour être reproductible :

```
tribuzen-infra/
  lib/
    auth-stack.ts        # UserPool + UserPoolClient (aws-cdk-lib/aws-cognito)
    api-stack.ts         # HttpApi + HttpUserPoolAuthorizer devant les Lambda du feed
  lambda/
    post-confirmation.ts # trigger : crée le profil famille dans DynamoDB
    pre-token-gen.ts     # trigger : ajoute family_id aux claims du JWT
```

**Différences avec le lab :**

- Le front (Nuxt/Vue) utilise **Amplify** avec `ALLOW_USER_SRP_AUTH` (mot de passe jamais transmis), pas `USER_PASSWORD_AUTH`.
- L'API Gateway porte un **authorizer Cognito** (module 07) ; les Lambda lisent `event.requestContext.authorizer.claims` — elles n'ont plus à vérifier le JWT elles-mêmes, API Gateway l'a déjà fait.
- La vérification manuelle (`aws-jwt-verify`) reste utile pour tout consommateur **hors** API Gateway (worker SQS, script d'admin).

**Commit cible :**

```
feat(auth): User Pool Cognito + authorizer API Gateway pour le feed familial
```
