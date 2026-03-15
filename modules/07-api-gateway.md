# Module 07 — API Gateway — Construire et securiser des API REST

> **Objectif** : Comprendre les differents types d'API Gateway AWS, configurer des ressources, methodes et integrations, securiser les acces, gerer le throttling et les deploiements par stages.
>
> **Difficulte** : ⭐⭐ (intermediaire)
>
> **Prerequis** : Module 05 (Lambda), notions HTTP/REST basiques
>
> **Duree** : 3h00

---

## 1. Pourquoi API Gateway

### 1.1 Le probleme qu'il resout

Quand vous construisez des microservices ou des fonctions Lambda, chaque composant a besoin d'un point d'entree HTTP. Sans API Gateway, vous devriez :

- Gerer vous-meme le routage HTTP
- Implementer l'authentification dans chaque service
- Gerer le rate limiting manuellement
- Configurer CORS sur chaque endpoint
- Deployer et versionner vos API sans outil dedie

API Gateway agit comme une **porte d'entree unique** pour toutes vos API. Il recoit les requetes HTTP, les valide, les transforme si necessaire, et les transmet au bon service backend.

> **Analogie** : API Gateway est comme le receptionniste d'un hotel. Il accueille tous les visiteurs (requetes), verifie leur identite (authentification), les oriente vers la bonne chambre (routage), et s'assure que l'hotel n'est pas surcharge (throttling).

### 1.2 Les trois types d'API Gateway

AWS propose trois types d'API Gateway, chacun avec ses cas d'usage :

| Caracteristique | REST API | HTTP API | WebSocket API |
|---|---|---|---|
| **Protocole** | HTTP/HTTPS | HTTP/HTTPS | WebSocket |
| **Cas d'usage** | API completes, entreprise | API simples, microservices | Temps reel, chat, notifications |
| **Latence** | ~30ms | ~10ms | Connexion persistante |
| **Cout** | $3.50/million requetes | $1.00/million requetes | $1.00/million messages |
| **Fonctionnalites** | Completes | Essentielles | Bidirectionnel |
| **Validation requete** | Oui | Non | Non |
| **Usage plans/API keys** | Oui | Non | Non |
| **Caching** | Oui | Non | Non |

> **Regle de decision** : Utilisez **HTTP API** par defaut pour les nouvelles API (moins cher, plus rapide). Passez a **REST API** si vous avez besoin de validation de requetes, caching, usage plans ou API keys. Utilisez **WebSocket API** pour le temps reel.

---

## 2. Concepts fondamentaux (REST API)

### 2.1 Ressources et methodes

Une API REST dans API Gateway est organisee en **ressources** (les chemins URL) et **methodes** (les verbes HTTP).

```
/users                 ← Ressource
  GET                  ← Methode (lister les utilisateurs)
  POST                 ← Methode (creer un utilisateur)
/users/{userId}        ← Ressource avec parametre de chemin
  GET                  ← Methode (obtenir un utilisateur)
  PUT                  ← Methode (modifier un utilisateur)
  DELETE               ← Methode (supprimer un utilisateur)
```

Chaque methode sur une ressource forme un **endpoint**. Un endpoint est le couple `methode + ressource`, par exemple `GET /users/{userId}`.

### 2.2 Le cycle de vie d'une requete

Quand une requete arrive sur API Gateway, elle traverse quatre etapes :

```
Client → [Method Request] → [Integration Request] → Backend
Client ← [Method Response] ← [Integration Response] ← Backend
```

1. **Method Request** : validation de la requete (parametres, headers, body)
2. **Integration Request** : transformation de la requete avant envoi au backend
3. **Integration Response** : reception et transformation de la reponse du backend
4. **Method Response** : formatage final de la reponse pour le client

### 2.3 Types d'integration

L'integration definit **quel backend** traite la requete et **comment** la requete lui est transmise.

| Type | Description | Cas d'usage |
|---|---|---|
| **Lambda** | Invoque une fonction Lambda | Le plus courant |
| **Lambda Proxy** | Transmet la requete brute a Lambda | Recommande pour les nouveaux projets |
| **HTTP** | Proxy vers un endpoint HTTP | API existante |
| **HTTP Proxy** | Transmet la requete brute a un endpoint HTTP | Microservices |
| **AWS Service** | Invoque directement un service AWS | SQS, DynamoDB, Step Functions |
| **Mock** | Retourne une reponse fixe | Tests, prototypage |

---

## 3. Lambda Proxy Integration (la star)

### 3.1 Pourquoi c'est le choix par defaut

L'integration Lambda Proxy est de loin la plus utilisee. Elle transmet **toute la requete HTTP** a votre fonction Lambda dans un format standardise, et attend une reponse dans un format precis.

**Avantages** :
- Pas besoin de configurer les mappings de requete/reponse
- Votre Lambda recoit tout le contexte HTTP
- Le routage peut etre gere cote Lambda (avec des frameworks comme Express via `aws-serverless-express`)

### 3.2 Format de l'evenement recu par Lambda

```json
{
  "httpMethod": "GET",
  "path": "/users/123",
  "pathParameters": { "userId": "123" },
  "queryStringParameters": { "fields": "name,email" },
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer eyJhbGc..."
  },
  "body": null,
  "isBase64Encoded": false,
  "requestContext": {
    "accountId": "123456789012",
    "stage": "prod",
    "requestId": "abc-123",
    "identity": {
      "sourceIp": "203.0.113.1"
    }
  }
}
```

### 3.3 Format de la reponse attendue par API Gateway

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"id\":\"123\",\"name\":\"Alice\"}"
}
```

> **Attention** : Le champ `body` doit etre une **chaine de caracteres**, pas un objet JSON. Utilisez `JSON.stringify()` pour convertir votre objet en chaine.

### 3.4 Exemple de handler Lambda

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  const userId = event.pathParameters?.userId;

  if (!userId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'userId is required' }),
    };
  }

  // Simuler une requete a une base de donnees
  const user = { id: userId, name: 'Alice', email: 'alice@example.com' };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  };
};
```

---

## 4. Validation de requetes

### 4.1 Modeles de requete (REST API uniquement)

REST API permet de valider les requetes **avant** qu'elles n'atteignent votre backend. Cela economise des invocations Lambda et protege votre API.

Vous definissez un **modele JSON Schema** qui decrit la structure attendue :

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "title": "CreateUserRequest",
  "type": "object",
  "required": ["name", "email"],
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "age": {
      "type": "integer",
      "minimum": 0,
      "maximum": 150
    }
  }
}
```

### 4.2 Niveaux de validation

| Niveau | Valide le body | Valide les parametres |
|---|---|---|
| `NONE` | Non | Non |
| `BODY_ONLY` | Oui | Non |
| `PARAMS_ONLY` | Non | Oui (query string, headers, path) |
| `FULL` | Oui | Oui |

Si la validation echoue, API Gateway retourne automatiquement une erreur `400 Bad Request` sans invoquer votre Lambda.

---

## 5. Stages et deploiement

### 5.1 Concept de stage

Un **stage** represente un environnement de deploiement de votre API. Chaque stage a sa propre URL :

```
https://abc123.execute-api.eu-west-1.amazonaws.com/dev
https://abc123.execute-api.eu-west-1.amazonaws.com/staging
https://abc123.execute-api.eu-west-1.amazonaws.com/prod
```

Les stages permettent de :
- Deployer differentes versions de votre API
- Configurer des variables d'environnement par stage
- Activer le caching par stage
- Configurer le throttling par stage

### 5.2 Variables de stage

Les variables de stage permettent de configurer des valeurs differentes selon l'environnement :

```
Stage: dev    → stageVariables.dbTable = "users-dev"
Stage: prod   → stageVariables.dbTable = "users-prod"
```

Dans votre Lambda, vous accedez aux variables de stage via `event.stageVariables.dbTable`.

### 5.3 Deploiement

Pour que vos modifications soient visibles, vous devez **deployer** votre API vers un stage. Une API non deployee n'est pas accessible.

```bash
# Deployer l'API vers le stage "prod"
aws apigateway create-deployment \
  --rest-api-id abc123 \
  --stage-name prod \
  --description "Version 2.1 - ajout endpoint /orders"
```

> **Piege courant** : Apres avoir modifie une ressource ou methode dans la console, n'oubliez pas de **re-deployer**. Sans deploiement, vos changements ne sont pas actifs.

---

## 6. Autorisation et securite

### 6.1 Les quatre methodes d'autorisation

| Methode | Complexite | Cas d'usage |
|---|---|---|
| **IAM** | Faible | Appels service-a-service (AWS SDK) |
| **Cognito User Pools** | Moyenne | Applications web/mobile avec inscription |
| **Lambda Authorizer** | Elevee | Logique d'auth personnalisee, tokens tiers |
| **API Keys** | Faible | Identification (pas authentification !) |

### 6.2 Autorisation IAM

L'autorisation IAM utilise les credentials AWS (Signature V4) pour authentifier les appels. Ideal pour les appels entre services AWS.

```bash
# Appel avec Signature V4 via AWS CLI
aws apigateway test-invoke-method \
  --rest-api-id abc123 \
  --resource-id xyz789 \
  --http-method GET
```

### 6.3 Cognito Authorizer

Cognito Authorizer valide automatiquement les tokens JWT emis par un User Pool Cognito :

```
Client → [JWT token dans Authorization header]
       → API Gateway → [Valide le token avec Cognito]
                     → Lambda (si token valide)
                     → 401 Unauthorized (si token invalide)
```

Aucun code d'autorisation a ecrire — API Gateway gere tout.

### 6.4 Lambda Authorizer

Un Lambda Authorizer est une fonction Lambda dediee qui recoit le token (ou les parametres de requete) et retourne une **policy IAM** indiquant si l'acces est autorise.

Deux types :
- **Token-based** : recoit un token (header Authorization)
- **Request-based** : recoit les headers, query string, stage variables, context

```typescript
// Lambda Authorizer simplifie
export const handler = async (event: any) => {
  const token = event.authorizationToken; // "Bearer xxx"

  // Verifier le token (ex: JWT, base de donnees, service externe)
  const isValid = await verifyToken(token);

  if (!isValid) {
    throw new Error('Unauthorized'); // Retourne 401
  }

  return {
    principalId: 'user123',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: 'Allow',
        Resource: event.methodArn,
      }],
    },
  };
};
```

> **Optimisation** : Les resultats du Lambda Authorizer peuvent etre mis en cache (TTL configurable). Un TTL de 300 secondes reduit considerablement le nombre d'invocations.

---

## 7. Throttling et quotas

### 7.1 Limites par defaut

API Gateway protege vos backends contre les pics de trafic :

| Limite | Valeur par defaut |
|---|---|
| **Steady-state rate** | 10 000 requetes/seconde |
| **Burst** | 5 000 requetes |
| **Par compte/region** | Partage entre toutes les API |

### 7.2 Throttling a plusieurs niveaux

```
Compte (global) → API → Stage → Methode
```

Vous pouvez configurer des limites a chaque niveau. Le throttling le plus restrictif s'applique.

### 7.3 Reponse en cas de throttling

Quand le throttling s'active, API Gateway retourne :

```
HTTP 429 Too Many Requests
```

Le client devrait implementer un **exponential backoff** : attendre 1s, puis 2s, puis 4s, etc.

---

## 8. CORS (Cross-Origin Resource Sharing)

### 8.1 Le probleme CORS

Quand votre frontend (sur `https://app.example.com`) appelle votre API (sur `https://api.example.com`), le navigateur bloque la requete par defaut. C'est la politique de **same-origin**.

CORS permet d'autoriser ces appels cross-origin en ajoutant des headers specifiques.

### 8.2 Configuration CORS sur API Gateway

Pour activer CORS, vous devez configurer deux choses :

1. **Reponse OPTIONS (preflight)** : API Gateway repond automatiquement aux requetes OPTIONS
2. **Headers CORS dans vos reponses** : Votre Lambda doit inclure les headers CORS

```typescript
// Headers CORS a inclure dans chaque reponse Lambda
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://app.example.com',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

return {
  statusCode: 200,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
};
```

> **Piege** : Avec Lambda Proxy Integration, API Gateway ne peut **pas** ajouter automatiquement les headers CORS. C'est a votre Lambda de les inclure dans chaque reponse, y compris les reponses d'erreur.

---

## 9. Usage Plans et API Keys

### 9.1 API Keys

Les API Keys sont des identifiants que vos clients envoient dans le header `x-api-key`. Elles servent a **identifier** qui appelle votre API, pas a **authentifier**.

> **Important** : Les API Keys ne remplacent pas l'authentification. Elles sont utiles pour le tracking d'usage, le throttling par client, et la facturation.

### 9.2 Usage Plans

Un Usage Plan lie des API Keys a des limites d'utilisation :

```
Usage Plan "Free"
  - Rate: 10 req/s
  - Burst: 20 req
  - Quota: 1000 req/mois

Usage Plan "Pro"
  - Rate: 100 req/s
  - Burst: 200 req
  - Quota: 100 000 req/mois
```

### 9.3 Flux complet

```
Client envoie x-api-key → API Gateway verifie la cle
  → Identifie le Usage Plan
  → Verifie le throttling (rate/burst)
  → Verifie le quota (mensuel)
  → Transmet au backend si OK
  → 429 si throttled, 403 si quota depasse
```

---

## 10. Custom Domains

### 10.1 Pourquoi un domaine personnalise

Les URL par defaut d'API Gateway sont peu pratiques :
```
https://abc123.execute-api.eu-west-1.amazonaws.com/prod
```

Avec un custom domain :
```
https://api.monapp.com
```

### 10.2 Configuration

1. **Certificat SSL** : Creer un certificat dans AWS Certificate Manager (ACM)
2. **Custom Domain** : Configurer dans API Gateway
3. **Base Path Mapping** : Associer le domaine a un stage de votre API
4. **DNS** : Creer un enregistrement CNAME/A pointant vers le domaine API Gateway

```
api.monapp.com → CNAME → d-abc123.execute-api.eu-west-1.amazonaws.com
```

### 10.3 Types d'endpoints

| Type | Latence | Certificat |
|---|---|---|
| **Edge-optimized** | Basse (via CloudFront) | us-east-1 uniquement |
| **Regional** | Variable | Meme region que l'API |
| **Private** | Interne VPC | Meme region |

---

## 11. Bonnes pratiques

### 11.1 Architecture

- Utilisez **HTTP API** par defaut, REST API seulement si vous avez besoin de ses fonctionnalites specifiques
- Preferez **Lambda Proxy Integration** pour sa simplicite
- Activez la **validation de requetes** cote API Gateway pour economiser des invocations Lambda
- Utilisez des **stages** pour separer vos environnements (dev, staging, prod)

### 11.2 Securite

- Ne comptez **jamais** sur les API Keys seules pour l'authentification
- Activez le **throttling** pour proteger vos backends
- Utilisez des **Lambda Authorizers** avec cache pour les tokens personnalises
- Activez les **logs d'acces** pour le monitoring

### 11.3 Performance

- Activez le **caching** (REST API) pour les endpoints peu dynamiques
- Utilisez le **edge-optimized endpoint** si vos clients sont distribues geographiquement
- Configurez le **TTL du Lambda Authorizer** pour eviter les appels repetitifs

---

## 12. Recapitulatif

| Concept | A retenir |
|---|---|
| **REST vs HTTP API** | HTTP API = moins cher, plus rapide. REST API = plus de fonctionnalites |
| **Lambda Proxy** | Transmet la requete brute, body en string JSON dans la reponse |
| **Validation** | REST API uniquement, economise des invocations Lambda |
| **Stages** | Un stage = un environnement, avec sa propre URL et config |
| **Authorizers** | IAM (service-a-service), Cognito (JWT), Lambda (custom) |
| **Throttling** | 10k req/s par defaut, configurable par methode |
| **CORS** | Avec Lambda Proxy, les headers CORS sont dans la reponse Lambda |
| **API Keys** | Identification, pas authentification |
| **Custom Domains** | Certificat ACM + CNAME DNS |

---

> **Prochain module** : [Module 07 — DynamoDB](./07-dynamodb.md) — Vous apprendrez a stocker et requeter des donnees avec la base NoSQL serverless d'AWS.
