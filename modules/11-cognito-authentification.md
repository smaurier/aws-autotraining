# Module 11 — Cognito — Authentification et gestion des identités

> **Objectif** : Comprendre les User Pools et Identity Pools de Cognito, implémenter un flux d'authentification complet (inscription, connexion, MFA, fédération), gérer les tokens JWT, et intégrer Cognito avec API Gateway et Lambda.
>
> **Difficulté** : ⭐⭐⭐ (avancé)
>
> **Prérequis** : Module 01 (IAM), Module 06 (API Gateway)
>
> **Durée estimée** : 3h30

---

## Table des matières

1. [Pourquoi Cognito](#1-pourquoi-cognito)
2. [User Pools](#2-user-pools)
3. [Flux d'authentification](#3-flux-dauthentification)
4. [Tokens JWT](#4-tokens-jwt)
5. [MFA — Authentification multi-facteurs](#5-mfa--authentification-multi-facteurs)
6. [Hosted UI et Custom UI](#6-hosted-ui-et-custom-ui)
7. [Fédération d'identité](#7-fédération-didentité)
8. [Identity Pools](#8-identity-pools)
9. [Lambda Triggers](#9-lambda-triggers)
10. [Intégration avec API Gateway](#10-intégration-avec-api-gateway)
11. [TypeScript SDK v3](#11-typescript-sdk-v3)
12. [Bonnes pratiques](#12-bonnes-pratiques)
13. [Récapitulatif](#13-récapitulatif)

---

## 1. Pourquoi Cognito

### 1.1 Le problème qu'il résout

Implémenter un système d'authentification robuste est complexe et risqué. Vous devez gérer :

- Le stockage sécurisé des mots de passe (hashing, salting)
- Les flux d'inscription et de vérification d'email
- La réinitialisation de mot de passe
- L'authentification multi-facteurs (MFA)
- La fédération avec des fournisseurs externes (Google, Facebook)
- La gestion et la rotation des tokens
- La protection contre les attaques (brute force, credential stuffing)

Cognito fournit tout cela **en tant que service managé**, avec un free tier de **50 000 utilisateurs actifs mensuels**.

> **Analogie** : Cognito est comme le service de sécurité à l'entrée d'un immeuble de bureaux. Il vérifie l'identité de chaque visiteur (authentification), lui donne un badge d'accès (token JWT) indiquant les étages auxquels il a droit (autorisations), et gère la liste des employés autorisés (User Pool).

### 1.2 Les deux composants principaux

| Composant | Rôle | Analogie |
|---|---|---|
| **User Pool** | Annuaire d'utilisateurs + authentification | La liste des employés et la vérification du badge |
| **Identity Pool** | Échange de tokens contre des credentials AWS temporaires | Le badge donne accès à certaines salles (services AWS) |

```
Utilisateur → User Pool (login) → Token JWT
                                       ↓
                              Identity Pool → Credentials AWS temporaires
                                       ↓
                              Accès direct à S3, DynamoDB, etc.
```

---

## 2. User Pools

### 2.1 Concept

Un **User Pool** est un annuaire d'utilisateurs. Il gère :

- L'inscription (sign-up)
- La connexion (sign-in)
- La vérification d'email/téléphone
- La réinitialisation de mot de passe
- Les attributs utilisateur (email, nom, attributs personnalisés)

### 2.2 Création via CLI

```bash
# Créer un User Pool
aws cognito-idp create-user-pool \
  --pool-name my-app-users \
  --auto-verified-attributes email \
  --username-attributes email \
  --policies '{
    "PasswordPolicy": {
      "MinimumLength": 12,
      "RequireUppercase": true,
      "RequireLowercase": true,
      "RequireNumbers": true,
      "RequireSymbols": true
    }
  }' \
  --schema '[
    {"Name": "email", "Required": true, "Mutable": true},
    {"Name": "name", "Required": true, "Mutable": true}
  ]'
```

### 2.3 App Client

Pour qu'une application puisse interagir avec le User Pool, vous devez créer un **App Client** :

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id eu-west-1_XXXXXXX \
  --client-name my-web-app \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --prevent-user-existence-errors ENABLED \
  --access-token-validity 60 \
  --id-token-validity 60 \
  --refresh-token-validity 30 \
  --token-validity-units '{
    "AccessToken": "minutes",
    "IdToken": "minutes",
    "RefreshToken": "days"
  }'
```

> `ALLOW_USER_SRP_AUTH` utilise le protocole **Secure Remote Password** — le mot de passe n'est jamais transmis en clair sur le réseau.

### 2.4 Attributs utilisateur

Cognito distingue les **attributs standard** (définis par OpenID Connect) et les **attributs personnalisés** :

| Attributs standard | Attributs personnalisés |
|---|---|
| `email`, `phone_number` | `custom:company` |
| `name`, `family_name` | `custom:role` |
| `address`, `birthdate` | `custom:tenant_id` |
| `locale`, `zoneinfo` | `custom:subscription_tier` |

Les attributs personnalisés sont préfixés par `custom:` et doivent être définis à la création du pool.

---

## 3. Flux d'authentification

### 3.1 Inscription (Sign-up)

```
1. L'utilisateur fournit email + mot de passe
2. Cognito crée le compte (status: UNCONFIRMED)
3. Cognito envoie un code de vérification par email
4. L'utilisateur saisit le code
5. Cognito confirme le compte (status: CONFIRMED)
```

```bash
# Inscription
aws cognito-idp sign-up \
  --client-id 1234567890abcdef \
  --username alice@example.com \
  --password 'MonMotDePasse123!' \
  --user-attributes Name=name,Value="Alice Dupont"

# Confirmation avec le code reçu par email
aws cognito-idp confirm-sign-up \
  --client-id 1234567890abcdef \
  --username alice@example.com \
  --confirmation-code 123456
```

### 3.2 Connexion (Sign-in)

```bash
aws cognito-idp initiate-auth \
  --client-id 1234567890abcdef \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=alice@example.com,PASSWORD='MonMotDePasse123!'
```

Réponse :
```json
{
  "AuthenticationResult": {
    "AccessToken": "eyJra...",
    "IdToken": "eyJra...",
    "RefreshToken": "eyJjd...",
    "ExpiresIn": 3600,
    "TokenType": "Bearer"
  }
}
```

### 3.3 Réinitialisation de mot de passe

```bash
# Étape 1 : Demander un code de réinitialisation
aws cognito-idp forgot-password \
  --client-id 1234567890abcdef \
  --username alice@example.com

# Étape 2 : Confirmer le nouveau mot de passe
aws cognito-idp confirm-forgot-password \
  --client-id 1234567890abcdef \
  --username alice@example.com \
  --confirmation-code 654321 \
  --password 'NouveauMotDePasse456!'
```

---

## 4. Tokens JWT

### 4.1 Les trois tokens

Cognito délivre trois tokens JWT après une authentification réussie :

| Token | Contenu | Durée | Usage |
|---|---|---|---|
| **ID Token** | Identité de l'utilisateur (email, nom, attributs) | 5 min à 1 jour | Personnaliser l'UI, afficher le profil |
| **Access Token** | Autorisations (scopes, groupes) | 5 min à 1 jour | Autoriser les appels API |
| **Refresh Token** | Permet d'obtenir de nouveaux tokens | 1 heure à 10 ans | Renouveler la session sans re-login |

### 4.2 Structure d'un ID Token (décodé)

```json
{
  "sub": "12345678-abcd-1234-efgh-123456789012",
  "email_verified": true,
  "iss": "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_XXXXXXX",
  "cognito:username": "alice@example.com",
  "aud": "1234567890abcdef",
  "event_id": "abcd-1234",
  "token_use": "id",
  "auth_time": 1710412800,
  "name": "Alice Dupont",
  "exp": 1710416400,
  "iat": 1710412800,
  "email": "alice@example.com",
  "custom:tenant_id": "tenant-42"
}
```

### 4.3 Vérification des tokens

Pour valider un token JWT côté serveur :

1. Vérifier la **signature** avec la clé publique JWKS du User Pool
2. Vérifier que `iss` correspond à votre User Pool
3. Vérifier que `token_use` est `id` ou `access` selon le besoin
4. Vérifier que le token n'est pas expiré (`exp`)

L'URL JWKS : `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`

---

## 5. MFA — Authentification multi-facteurs

### 5.1 Types de MFA supportés

| Type | Description | Niveau de sécurité |
|---|---|---|
| **SMS** | Code envoyé par SMS | Moyen (vulnérable au SIM swapping) |
| **TOTP** | Application d'authentification (Google Auth, Authy) | Élevé |
| **Email** | Code envoyé par email | Moyen |

### 5.2 Configuration

```bash
# Activer le MFA optionnel (l'utilisateur choisit)
aws cognito-idp set-user-pool-mfa-config \
  --user-pool-id eu-west-1_XXXXXXX \
  --mfa-configuration OPTIONAL \
  --software-token-mfa-configuration Enabled=true \
  --sms-mfa-configuration SmsAuthenticationMessage="Votre code : {####}",SmsConfiguration='{
    "SnsCallerArn": "arn:aws:iam::123456789:role/cognito-sms-role",
    "ExternalId": "my-app"
  }'
```

Valeurs possibles pour `--mfa-configuration` :
- `OFF` : MFA désactivé
- `OPTIONAL` : l'utilisateur choisit d'activer le MFA
- `ON` : MFA obligatoire pour tous les utilisateurs

### 5.3 Flux avec MFA activé

```
1. L'utilisateur se connecte (email + password)
2. Cognito retourne un challenge MFA (pas encore de tokens)
3. L'utilisateur fournit le code TOTP/SMS
4. Cognito valide le code et retourne les tokens JWT
```

---

## 6. Hosted UI et Custom UI

### 6.1 Hosted UI

Cognito fournit une **interface d'authentification prête à l'emploi**. Elle gère l'inscription, la connexion, la réinitialisation de mot de passe et la fédération.

```bash
# Configurer le domaine de la Hosted UI
aws cognito-idp create-user-pool-domain \
  --user-pool-id eu-west-1_XXXXXXX \
  --domain my-app-auth

# URL résultante :
# https://my-app-auth.auth.eu-west-1.amazoncognito.com/login?
#   client_id=1234567890abcdef&
#   response_type=code&
#   scope=openid+email+profile&
#   redirect_uri=https://myapp.com/callback
```

**Avantages** : Rapide à mettre en place, gère tous les flux, personnalisable (CSS).
**Inconvénients** : Personnalisation limitée, expérience utilisateur générique.

### 6.2 Custom UI

Pour une expérience totalement personnalisée, vous construisez votre propre interface et utilisez le SDK Cognito côté client :

```typescript
// Avec la bibliothèque amazon-cognito-identity-js ou AWS Amplify
import { Amplify } from 'aws-amplify'
import { signIn, signUp, confirmSignUp } from 'aws-amplify/auth'

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'eu-west-1_XXXXXXX',
      userPoolClientId: '1234567890abcdef',
    },
  },
})

// Inscription
await signUp({
  username: 'alice@example.com',
  password: 'MonMotDePasse123!',
  options: {
    userAttributes: { name: 'Alice Dupont' },
  },
})

// Connexion
const { isSignedIn, nextStep } = await signIn({
  username: 'alice@example.com',
  password: 'MonMotDePasse123!',
})
```

---

## 7. Fédération d'identité

### 7.1 Concept

La fédération permet à vos utilisateurs de se connecter avec un **fournisseur d'identité externe** (Google, Facebook, Apple, SAML, OIDC) sans créer un compte spécifique.

```
Utilisateur → "Se connecter avec Google"
    → Google OAuth → Code d'autorisation
    → Cognito échange le code → Tokens Cognito
    → Utilisateur créé/lié dans le User Pool
```

### 7.2 Fournisseurs supportés

| Fournisseur | Protocole | Configuration requise |
|---|---|---|
| **Google** | OIDC | Client ID + Client Secret (Google Console) |
| **Facebook** | OAuth 2.0 | App ID + App Secret (Meta Developers) |
| **Apple** | OIDC | Service ID + Team ID + Key ID |
| **Amazon** | OAuth 2.0 | Client ID + Client Secret |
| **SAML** | SAML 2.0 | Metadata XML de l'IdP |
| **OIDC générique** | OIDC | Issuer URL + Client ID + Secret |

### 7.3 Configuration d'un fournisseur Google

```bash
# Ajouter Google comme Identity Provider
aws cognito-idp create-identity-provider \
  --user-pool-id eu-west-1_XXXXXXX \
  --provider-name Google \
  --provider-type Google \
  --provider-details '{
    "client_id": "123456789.apps.googleusercontent.com",
    "client_secret": "GOCSPX-xxxxxxxxxxxx",
    "authorize_scopes": "openid email profile"
  }' \
  --attribute-mapping '{
    "email": "email",
    "name": "name",
    "username": "sub"
  }'
```

### 7.4 Fédération SAML (entreprise)

Pour les clients entreprise utilisant Active Directory, Okta, ou un autre IdP SAML :

```bash
aws cognito-idp create-identity-provider \
  --user-pool-id eu-west-1_XXXXXXX \
  --provider-name CorporateSSO \
  --provider-type SAML \
  --provider-details '{
    "MetadataURL": "https://idp.corporate.com/saml/metadata"
  }' \
  --attribute-mapping '{
    "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
  }'
```

---

## 8. Identity Pools

### 8.1 Concept

Un **Identity Pool** (anciennement Federated Identities) échange un token d'authentification contre des **credentials AWS temporaires** (via STS). Cela permet à un utilisateur authentifié d'accéder directement aux services AWS (S3, DynamoDB) depuis le front-end.

```
Token Cognito User Pool ──┐
Token Google             ──┤→ Identity Pool → STS → Credentials AWS
Token Facebook           ──┘                         (AccessKeyId, SecretAccessKey, SessionToken)
```

### 8.2 Rôles IAM

L'Identity Pool attribue des **rôles IAM différents** selon que l'utilisateur est authentifié ou non :

| Rôle | Accès |
|---|---|
| **Authenticated role** | Accès à ses propres données (S3, DynamoDB) |
| **Unauthenticated role** | Accès limité (lecture publique seulement) |

Exemple de politique IAM pour accès à DynamoDB par utilisateur :

```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"],
  "Resource": "arn:aws:dynamodb:eu-west-1:123456789:table/UserData",
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": ["${cognito-identity.amazonaws.com:sub}"]
    }
  }
}
```

> Chaque utilisateur ne peut accéder qu'aux items dont la PK correspond à son identifiant Cognito.

### 8.3 User Pool vs Identity Pool

| Aspect | User Pool | Identity Pool |
|---|---|---|
| **Fonction** | Authentification (qui êtes-vous ?) | Autorisation (quelles ressources AWS ?) |
| **Résultat** | Tokens JWT | Credentials AWS temporaires |
| **Usage** | API Gateway, backend | Accès direct S3, DynamoDB depuis le client |
| **Peut fonctionner seul** | Oui | Oui (mais souvent couplé à un User Pool) |

---

## 9. Lambda Triggers

### 9.1 Concept

Cognito peut invoquer des **fonctions Lambda** à différentes étapes du cycle de vie utilisateur. Ces triggers permettent de personnaliser le comportement par défaut.

### 9.2 Triggers disponibles

| Trigger | Moment | Cas d'usage |
|---|---|---|
| **Pre Sign-up** | Avant la création du compte | Valider l'email (domaine autorisé), auto-confirmer |
| **Pre Authentication** | Avant la vérification du mot de passe | Bloquer certains utilisateurs, logging |
| **Post Authentication** | Après une connexion réussie | Enregistrer l'IP, mettre à jour last_login |
| **Post Confirmation** | Après la confirmation du compte | Créer un profil dans DynamoDB, envoyer un email de bienvenue |
| **Pre Token Generation** | Avant la génération des tokens | Ajouter des claims personnalisés au JWT |
| **Custom Message** | Quand Cognito envoie un message | Personnaliser l'email de vérification |
| **User Migration** | Quand un utilisateur inconnu tente de se connecter | Migrer depuis un ancien système d'auth |
| **Define Auth Challenge** | Pour les flux d'auth custom | Implémenter un CAPTCHA, challenge personnalisé |

### 9.3 Exemple : Pre Sign-up (validation de domaine)

```typescript
import type { PreSignUpTriggerHandler } from 'aws-lambda'

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email
  const allowedDomains = ['@entreprise.fr', '@filiale.fr']

  const isAllowed = allowedDomains.some((domain) => email.endsWith(domain))
  if (!isAllowed) {
    throw new Error('Inscription réservée aux adresses @entreprise.fr')
  }

  // Auto-confirmer les utilisateurs du domaine principal
  if (email.endsWith('@entreprise.fr')) {
    event.response.autoConfirmUser = true
    event.response.autoVerifyEmail = true
  }

  return event
}
```

### 9.4 Exemple : Post Confirmation (créer un profil DynamoDB)

```typescript
import type { PostConfirmationTriggerHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const { sub, email, name } = event.request.userAttributes

  await docClient.send(new PutCommand({
    TableName: 'UserProfiles',
    Item: {
      userId: sub,
      email,
      name,
      createdAt: new Date().toISOString(),
      tier: 'free',
    },
  }))

  return event
}
```

### 9.5 Exemple : Pre Token Generation (ajouter des claims)

```typescript
import type { PreTokenGenerationTriggerHandler } from 'aws-lambda'

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  // Ajouter des claims personnalisés au token ID
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        tenant_id: 'tenant-42',
        permissions: 'read,write,admin',
      },
      claimsToSuppress: ['phone_number'], // retirer un claim
    },
  }

  return event
}
```

---

## 10. Intégration avec API Gateway

### 10.1 Cognito Authorizer

API Gateway peut utiliser Cognito comme **authorizer natif**. Le client envoie le token JWT dans le header `Authorization`, et API Gateway le valide automatiquement.

```
Client → Authorization: Bearer eyJra... → API Gateway → Cognito Authorizer (validation)
                                                              ↓ valide
                                                         Lambda backend
                                                              ↓ invalide
                                                         403 Forbidden
```

```bash
# Créer un authorizer Cognito sur API Gateway
aws apigateway create-authorizer \
  --rest-api-id abc123 \
  --name cognito-auth \
  --type COGNITO_USER_POOLS \
  --provider-arns arn:aws:cognito-idp:eu-west-1:123456789:userpool/eu-west-1_XXXXXXX \
  --identity-source method.request.header.Authorization
```

### 10.2 Accès aux claims dans Lambda

Quand API Gateway valide le token, il transmet les claims dans l'événement Lambda :

```typescript
import type { APIGatewayProxyHandler } from 'aws-lambda'

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = event.requestContext.authorizer?.claims
  const userId = claims?.sub
  const email = claims?.email
  const tenantId = claims?.['custom:tenant_id']

  return {
    statusCode: 200,
    body: JSON.stringify({ message: `Bonjour ${email}` }),
  }
}
```

---

## 11. TypeScript SDK v3

### 11.1 Installation

```bash
pnpm add @aws-sdk/client-cognito-identity-provider
```

### 11.2 Opérations d'administration

```typescript
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDisableUserCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const cognito = new CognitoIdentityProviderClient({ region: 'eu-west-1' })
const userPoolId = 'eu-west-1_XXXXXXX'

// Créer un utilisateur (admin)
await cognito.send(new AdminCreateUserCommand({
  UserPoolId: userPoolId,
  Username: 'bob@example.com',
  UserAttributes: [
    { Name: 'email', Value: 'bob@example.com' },
    { Name: 'email_verified', Value: 'true' },
    { Name: 'name', Value: 'Bob Martin' },
  ],
  TemporaryPassword: 'TempPass123!',
  MessageAction: 'SUPPRESS', // ne pas envoyer l'email d'invitation
}))

// Définir un mot de passe permanent
await cognito.send(new AdminSetUserPasswordCommand({
  UserPoolId: userPoolId,
  Username: 'bob@example.com',
  Password: 'MotDePassePermanent456!',
  Permanent: true,
}))

// Lister les utilisateurs
const { Users } = await cognito.send(new ListUsersCommand({
  UserPoolId: userPoolId,
  Filter: 'email = "bob@example.com"',
  Limit: 10,
}))
```

### 11.3 Groupes d'utilisateurs

```typescript
import {
  CreateGroupCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider'

// Créer un groupe
await cognito.send(new CreateGroupCommand({
  UserPoolId: userPoolId,
  GroupName: 'admins',
  Description: 'Administrateurs de la plateforme',
  Precedence: 0, // priorité (0 = la plus haute)
}))

// Ajouter un utilisateur au groupe
await cognito.send(new AdminAddUserToGroupCommand({
  UserPoolId: userPoolId,
  Username: 'alice@example.com',
  GroupName: 'admins',
}))
```

> Les groupes apparaissent dans le claim `cognito:groups` du token JWT.

---

## 12. Bonnes pratiques

1. **Utilisez SRP** (`ALLOW_USER_SRP_AUTH`) plutôt que `USER_PASSWORD_AUTH` — le mot de passe n'est jamais transmis
2. **Activez le MFA** au minimum en mode OPTIONAL, idéalement ON pour les applications sensibles
3. **Configurez les Lambda triggers** pour la logique métier (validation, provisioning)
4. **Utilisez Pre Token Generation** pour ajouter des claims métier plutôt que de requêter la DB à chaque appel API
5. **Limitez la durée des tokens** : Access/ID Token à 1h max, Refresh Token selon le contexte
6. **Activez la protection contre les attaques** : Advanced Security Features (risk-based adaptive auth)
7. **Ne stockez jamais les tokens en localStorage** — utilisez des cookies HttpOnly ou la mémoire
8. **Prévoyez la migration** : le trigger User Migration permet de migrer progressivement depuis un ancien système

---

## 13. Récapitulatif

| Concept | Description |
|---|---|
| **User Pool** | Annuaire d'utilisateurs, authentification, tokens JWT |
| **Identity Pool** | Échange de tokens contre des credentials AWS |
| **ID Token** | Contient l'identité de l'utilisateur (claims) |
| **Access Token** | Contient les autorisations (scopes, groupes) |
| **Refresh Token** | Permet de renouveler les tokens sans re-login |
| **Hosted UI** | Interface prête à l'emploi pour login/signup |
| **Fédération** | Login via Google, Facebook, SAML, OIDC |
| **Lambda Triggers** | Hooks pour personnaliser le cycle de vie utilisateur |
| **Cognito Authorizer** | Validation JWT native dans API Gateway |
| **Groupes** | Regrouper les utilisateurs pour l'autorisation |
