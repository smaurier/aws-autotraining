---
titre: IAM — Identités, accès et moindre privilège
cours: 12-aws-cloud
notions: [users, groups, roles, policies JSON, "Version 2012-10-17", "Effect Allow/Deny", "Action service:Operation", Resource ARN, Condition, moindre privilege, policy evaluation, explicit deny, trust policy, "sts:AssumeRole", credentials temporaires STS, "aws:MultiFactorAuthPresent", MFA]
outcomes:
  - sait distinguer user, group et role IAM et choisir le bon pour un besoin donné
  - sait lire et écrire une policy JSON (Version, Statement, Effect, Action, Resource, Condition)
  - sait appliquer l'ordre d'évaluation IAM et pourquoi un Deny explicite gagne toujours
  - sait écrire une trust policy pour qu'un service AWS assume un role et applique le moindre privilège
prerequis: [Module 00 — compte AWS, régions, root, CLI, modèle de responsabilité partagée]
next: 02-vpc-networking
libs: []
tribuzen: infra cloud TribuZen — roles IAM des services (Lambda API, tâche ECS, accès S3 avatars) et politique MFA des humains
last-reviewed: 2026-07
---

# IAM — Identités, accès et moindre privilège

> **Outcomes — tu sauras FAIRE :** distinguer user / group / role, lire et écrire une policy JSON, appliquer l'ordre d'évaluation IAM, écrire une trust policy pour un service AWS.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **IAM seul** — identités, policies, evaluation, roles, MFA. Le chiffrement (**KMS**), les secrets (**Secrets Manager**), le filtrage applicatif (**WAF**) et la détection de menaces (**GuardDuty**) sont le sujet du **module 15 (sécurité AWS avancée)**. Ici on répond à une seule question : *qui a le droit de faire quoi sur quelle ressource ?*

## 1. Cas concret d'abord

Tu montes l'infra AWS de TribuZen. La première fonction serverless est prête : `postFeedMessage`, une **Lambda** qui écrit un message de famille dans une table **DynamoDB** `TribuZenFeed` et joint parfois une image stockée dans un bucket **S3** `tribuzen-avatars`.

Un collègue te tend ce raccourci pour « aller vite » :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
```

Il propose d'attacher cette policy à la Lambda via un role, « le temps que ça marche ». Trois problèmes concrets :

1. Si le code de la Lambda est compromis (dépendance npm vérolée, injection), l'attaquant peut **supprimer toute la base**, vider S3, créer des utilisateurs IAM, ouvrir des instances EC2 pour miner de la crypto. `Action: "*"` sur `Resource: "*"` = les clés du royaume.
2. Personne ne saura jamais de quoi cette Lambda a *réellement* besoin — l'audit est impossible.
3. Le jour où la sécu passe (revue, certification SOC 2, client B2B exigeant), cette policy est un carton rouge immédiat.

Ce que la Lambda a réellement besoin de faire : écrire **un item** dans **une** table, lire/écrire **un** préfixe d'**un** bucket. Rien d'autre. À la fin de ce module, tu sais écrire la policy exacte et le role qui la porte — et comprendre *pourquoi* AWS l'appliquera comme tu l'écris.

---

## 2. Théorie complète, concise

### 2.1 Les trois questions d'IAM

IAM (Identity and Access Management) est le portier de chaque appel AWS. Chaque requête (console, CLI, SDK) passe par lui :

1. **Authentification** — qui es-tu ? (identité prouvée)
2. **Autorisation** — as-tu le droit ? (policies évaluées)
3. **Audit** — qu'as-tu fait ? (journalisé par CloudTrail)

IAM est un service **global** (pas régional) : un user créé dans le compte agit dans toutes les régions.

### 2.2 Users, groups, roles — trois identités, pas interchangeables

| Identité | Credentials | Pour qui | Durée |
|----------|-------------|----------|-------|
| **User** | mot de passe (console) et/ou access keys (programmatique) — **long terme** | une personne physique, ou un workload qui ne peut pas utiliser de role | permanents jusqu'à révocation |
| **Group** | aucun — on ne se connecte pas « en tant que groupe » | conteneur de users, porte les policies | — |
| **Role** | **aucun credential permanent** — délivre des credentials **temporaires** via STS | un service AWS, un autre compte, une identité fédérée, un user qui « change de casquette » | 1 h par défaut, jusqu'à 12 h |

Points structurants (vérifiés doc IAM) :

- Un **group** ne contient que des users, **pas d'autres groups** (pas d'imbrication). Un user peut appartenir à plusieurs groups. Les policies du group s'appliquent à tous ses membres.
- Un **role** « est similaire à un user, mais n'a pas de credentials long terme (mot de passe ou access keys). Quand tu l'assumes, il te fournit des credentials de sécurité **temporaires** pour la session ». C'est la citation de la doc, et c'est *toute* la différence conceptuelle.
- **Règle de choix AWS** : n'utilise un user que pour les cas que la fédération/les roles ne couvrent pas (ex. outil tiers non hébergé sur AWS, accès d'urgence). Pour tout service AWS et tout accès cross-account → **role**.

### 2.3 Une policy : un document JSON

Une **policy** est un document JSON qui décrit des permissions. C'est le cœur d'IAM.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowFeedWrite",
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:eu-west-3:111122223333:table/TribuZenFeed",
      "Condition": {
        "StringEquals": { "aws:RequestedRegion": "eu-west-3" }
      }
    }
  ]
}
```

Les éléments (référence officielle IAM JSON policy elements) :

| Élément | Rôle | Obligatoire |
|---------|------|-------------|
| `Version` | version du langage de policy — **toujours** `"2012-10-17"` (ne pas confondre avec une date de création) | oui |
| `Statement` | tableau d'une ou plusieurs déclarations | oui |
| `Sid` | identifiant lisible de la déclaration | non |
| `Effect` | `"Allow"` **ou** `"Deny"` — pas d'autre valeur | oui |
| `Action` | une ou des actions API au format `service:Operation` (ex. `dynamodb:PutItem`) | oui |
| `Resource` | ARN de la/des ressource(s) visée(s) | oui (policy basée identité) |
| `Principal` | qui est concerné — **uniquement** dans les policies basées ressource et les trust policies | selon type |
| `Condition` | conditions supplémentaires (MFA, IP, région, heure…) | non |

Éléments **mutuellement exclusifs** dans une même déclaration (doc IAM) : `Action`/`NotAction`, `Resource`/`NotResource`, `Principal`/`NotPrincipal`. On ne peut pas mettre les deux d'une paire.

Deux familles de policies :

- **Basée identité** (identity-based) — attachée à un user, group ou role. Décrit ce que *cette identité* peut faire. Pas de `Principal` (l'identité, c'est le porteur).
- **Basée ressource** (resource-based) — attachée à la ressource elle-même (bucket S3, queue SQS, **trust policy** d'un role…). Elle a un `Principal` : *qui* a le droit d'agir sur cette ressource.

### 2.4 L'ARN — l'adresse unique d'une ressource

L'**ARN** (Amazon Resource Name) identifie une ressource de façon unique. Format général :

```
arn:partition:service:region:account-id:resource
```

```
arn:aws:s3:::tribuzen-avatars                         → bucket (S3 : ni région ni account dans l'ARN)
arn:aws:s3:::tribuzen-avatars/family-42/*             → tous les objets sous ce préfixe
arn:aws:dynamodb:eu-west-3:111122223333:table/TribuZenFeed
arn:aws:iam::111122223333:role/tribuzen-feed-lambda   → IAM est global : région vide
```

Le `*` sert de wildcard : `arn:aws:s3:::tribuzen-avatars/*` = tous les objets du bucket. Plus l'ARN est précis, plus le privilège est restreint.

### 2.5 Ordre d'évaluation — le point à ne jamais rater

Quand un principal fait une requête, AWS décide **allow ou deny** ainsi (référence officielle, evaluation logic) :

1. **Deny par défaut (implicit deny)** — par défaut *toute* requête est refusée. Seule exception : le **root** du compte, qui a un accès total.
2. **Recherche d'un Deny explicite** — AWS évalue **toutes** les policies applicables (SCP d'Organizations, resource-based, identity-based, permissions boundary, session policy). S'il trouve **ne serait-ce qu'un seul** `Deny` qui matche → décision finale = **Deny**, point final.
3. **Recherche d'un Allow explicite** — s'il n'y a pas de Deny, il faut au moins un `Allow` qui matche pour autoriser. Sinon → il reste au deny implicite.

> **La règle d'or, mot pour mot dans la doc AWS : « An explicit deny overrides an explicit allow. »** Un Deny explicite l'emporte **toujours** sur n'importe quel Allow. C'est le mécanisme des garde-fous (une policy Deny globale ne peut pas être « contournée » par un Allow ajouté ailleurs).

Corollaire : « pas d'Allow » ≠ « Deny explicite ». Ne pas autoriser une action laisse le **deny implicite** ; un `Effect: "Deny"` est un **deny explicite**, bien plus fort, qu'aucun Allow ne pourra lever.

### 2.6 Roles et assume-role via STS

Un role a **deux** policies distinctes — ne jamais les confondre :

1. **Trust policy** (obligatoire, basée ressource) — *qui* a le droit d'assumer le role. Elle liste les `Principal` autorisés et l'action `sts:AssumeRole`.
2. **Permission policy** (identity-based, une ou plusieurs) — *ce que* le porteur peut faire une fois le role assumé.

Trust policy typique pour qu'une **Lambda** assume le role (le service principal est `lambda.amazonaws.com`) :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Qui peut assumer un role (doc IAM) : un **user IAM** (même compte ou autre), un **autre role**, un **service principal** (EC2, Lambda, ECS…), une **identité fédérée** (SAML 2.0 / OIDC). Assumer un role via `AssumeRole` renvoie des credentials temporaires ; `DurationSeconds` va jusqu'à **43200 s (12 h)**, dans la limite du *maximum session duration* du role. En **role chaining** (un role qui en assume un autre), la session est plafonnée à **1 h**.

Pourquoi préférer un role à des access keys sur un service :

| Access keys (user) | Role (STS) |
|--------------------|------------|
| permanentes, stockées quelque part (risque de fuite) | temporaires, jamais stockées, obtenues à la demande |
| rotation manuelle | rotation automatique par STS |
| liées à une identité | assumables par tout principal autorisé par la trust policy |

### 2.7 Le principe du moindre privilège

**N'accorder que les permissions strictement nécessaires, rien de plus.**

- Partir de **zéro permission** et ajouter au fur et à mesure (jamais l'inverse).
- Restreindre `Action` (`dynamodb:PutItem`, pas `dynamodb:*`) **et** `Resource` (l'ARN exact, pas `*`).
- Resserrer avec des **`Condition`** : MFA présente, région, plage IP, préfixe S3.
- Auditer avec **IAM Access Analyzer** (permissions excessives) et **Access Advisor** (services réellement utilisés) — outils IAM, vus en pratique au lab.

### 2.8 MFA — deuxième facteur

Le **MFA** exige, en plus du mot de passe (« ce que tu sais »), un second facteur (« ce que tu as » : app TOTP, clé FIDO2 type YubiKey). On peut le **forcer par policy** : refuser toute action tant que la session n'a pas de MFA, via la clé de condition `aws:MultiFactorAuthPresent`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyAllExceptSelfManageMFAWithoutMFA",
      "Effect": "Deny",
      "NotAction": [
        "iam:CreateVirtualMFADevice",
        "iam:EnableMFADevice",
        "iam:ListMFADevices",
        "iam:ResyncMFADevice",
        "sts:GetSessionToken"
      ],
      "Resource": "*",
      "Condition": {
        "BoolIfExists": { "aws:MultiFactorAuthPresent": "false" }
      }
    }
  ]
}
```

C'est un `Deny` explicite : il neutralise tout Allow tant que le MFA n'est pas actif — sauf les quelques actions nécessaires pour justement configurer son MFA.

---

## 3. Worked examples

### Exemple 1 — La policy de moindre privilège de la Lambda TribuZen

On reprend le cas concret. Objectif : la Lambda `postFeedMessage` peut **écrire un item** dans la table `TribuZenFeed` et **déposer un objet** dans le préfixe d'une famille du bucket `tribuzen-avatars`. Rien d'autre.

**Étape 1 — la permission policy (ce que le role peut faire) :**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WriteFeedItem",
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:eu-west-3:111122223333:table/TribuZenFeed"
    },
    {
      "Sid": "PutAvatarObject",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::tribuzen-avatars/family-*/*"
    }
  ]
}
```

Analyse ligne à ligne :

- Deux `Statement` séparés car deux services et deux ARN distincts — plus lisible et auditable qu'un statement fourre-tout.
- `Action` scopée à l'opération exacte : `dynamodb:PutItem`, pas `dynamodb:*`. Pas de `GetItem`, `DeleteItem`, `Scan` : la Lambda n'en a pas besoin.
- `Resource` scopée à l'ARN précis : **cette** table, et seulement le préfixe `family-*/` du bucket (pas tout `tribuzen-avatars/*`).
- Comparé à `Action: "*" / Resource: "*"` du cas concret : la surface d'attaque passe de « tout AWS » à « écrire dans une table + un préfixe S3 ».

**Étape 2 — la trust policy (qui peut assumer ce role) :**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Seul le service Lambda peut endosser ce role — aucun humain, aucun autre service. On attache la permission policy de l'étape 1 au role, on associe le role à la fonction, et la Lambda obtient à l'exécution des credentials temporaires portant exactement ces deux permissions.

### Exemple 2 — Lire l'ordre d'évaluation sur un conflit Allow/Deny

Alice est dans le group `Developers`, qui a `AmazonDynamoDBFullAccess` (un Allow large sur `dynamodb:*`). Séparément, une policy « garde-fou » est attachée à Alice :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ProtectProdTable",
      "Effect": "Deny",
      "Action": "dynamodb:DeleteTable",
      "Resource": "arn:aws:dynamodb:eu-west-3:111122223333:table/TribuZenFeed"
    }
  ]
}
```

Alice tente `dynamodb:DeleteTable` sur `TribuZenFeed`. Déroulé de l'évaluation :

1. Deny par défaut → on cherche des policies applicables.
2. **Recherche d'un Deny explicite** : `ProtectProdTable` matche l'action et la ressource → **décision finale = Deny**. L'évaluation s'arrête ici.
3. On n'atteint même pas l'étape Allow — le `AmazonDynamoDBFullAccess` du group est **sans effet** sur cette action précise.

Résultat : Alice garde tous ses droits DynamoDB, **sauf** supprimer cette table. C'est exactement le pattern « pouvoir large + garde-fou ciblé » que rend possible la priorité du Deny explicite. Si on avait voulu obtenir l'inverse (tout interdire sauf une action) on n'aurait **pas** utilisé un Deny mais restreint les Allow.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'un Allow peut « annuler » un Deny

Faux. Un `Deny` explicite gagne **toujours**, quel que soit le nombre d'Allow. Ajouter un Allow plus « spécifique » ne lève jamais un Deny. Pour retirer un droit bloqué par un Deny, il faut **modifier ou supprimer le Deny lui-même** — pas empiler des Allow.

### PIÈGE #2 — Confondre `Version` avec une date

`"Version": "2012-10-17"` est la **version du langage de policy**, figée. Ce n'est ni la date d'aujourd'hui ni la date de création. Mettre `"2024-01-01"` ou l'année courante casse la policy. La seule autre valeur historique est `"2008-10-17"` (obsolète, ne l'utilise pas).

### PIÈGE #3 — Confondre trust policy et permission policy

- **Trust policy** : *qui* peut assumer le role (élément `Principal`, action `sts:AssumeRole`). Sans elle, personne ne peut endosser le role.
- **Permission policy** : *ce que* le porteur peut faire ensuite (pas de `Principal`).

Mettre les permissions dans la trust policy, ou l'inverse, est une erreur classique : le role « ne fait rien » ou « ne peut pas être assumé ». Deux documents, deux rôles.

### PIÈGE #4 — Wildcard dans le `Principal` d'une trust policy

Dans une trust policy, **on ne peut pas** mettre un `*` dans un ARN de l'élément `Principal` (interdit par IAM). Écrire `"Principal": { "AWS": "*" }` rendrait le role assumable par n'importe qui : à proscrire absolument. Pour un accès cross-account contrôlé, on nomme le compte de confiance et on ajoute un **`ExternalId`** (condition `sts:ExternalId`) pour éviter le problème du *confused deputy*.

### PIÈGE #5 — « Absence d'Allow » = « Deny explicite »

Non : ne pas autoriser une action laisse un **deny implicite** (faible, levable en ajoutant un Allow). Un `Effect: "Deny"` est un **deny explicite** (fort, non levable par un Allow). Les deux « refusent », mais n'ont pas la même force. Le confondre mène à sur-utiliser les `Deny` là où il suffirait de ne pas accorder l'Allow.

### PIÈGE #6 — Utiliser des access keys là où un role suffit

Coller des access keys d'un user IAM dans une Lambda, une instance EC2 ou une tâche ECS est un anti-pattern : credentials permanents, stockés, à rotation manuelle, qui fuient dans les logs ou le code. Un **role** avec la bonne trust policy donne des credentials temporaires à rotation automatique. Règle : un service AWS → toujours un role, jamais des access keys.

---

## 5. Ancrage TribuZen

IAM est la couche 0 de toute l'infra TribuZen : chaque service décrit dans le fil-rouge cloud porte un **role** au moindre privilège, jamais des access keys.

| Service TribuZen | Identité IAM | Ce que le role autorise (permission policy) | Qui l'assume (trust policy) |
|------------------|--------------|---------------------------------------------|-----------------------------|
| Lambda `postFeedMessage` | role `tribuzen-feed-lambda` | `dynamodb:PutItem` sur `TribuZenFeed` + `s3:PutObject` sur `tribuzen-avatars/family-*/*` | `lambda.amazonaws.com` |
| Tâche ECS/Fargate (API) | task role | lecture DynamoDB, publication SNS | `ecs-tasks.amazonaws.com` |
| Lambda de miniatures avatars | role dédié | `s3:GetObject`/`s3:PutObject` sur le préfixe avatars | `lambda.amazonaws.com` |
| Développeurs humains (toi) | user dans group `Developers` | droits de dev + **policy MFA obligatoire** | — (user, pas de trust policy) |

Principes appliqués côté TribuZen :

- **Un role par service**, scopé à ses seules actions/ressources — si une Lambda est compromise, le rayon de souffle est minimal.
- **Aucun access key** dans le code applicatif ni les variables d'environnement : uniquement des roles.
- **MFA forcée par policy** sur tous les humains ; root protégé par clé FIDO2 et jamais utilisé au quotidien (vu au module 00).
- Les ARN de ressources (tables, buckets) seront produits par le **CDK** (module 05) et injectés dans les policies — on ne les code pas en dur à la main en production.

> Le chiffrement des avatars (KMS), le stockage des secrets d'API (Secrets Manager) et le WAF devant l'API Gateway relèvent du **module 15** — ici, IAM ne fait que dire *qui* a le droit d'appeler ces services.

---

## 6. Points clés

1. IAM répond à *qui fait quoi sur quelle ressource* — service **global**, trois volets : authentification, autorisation, audit.
2. **User** = identité d'une personne/workload avec credentials long terme ; **group** = conteneur de users porteur de policies ; **role** = identité sans credential permanent, délivre des credentials **temporaires** via STS.
3. Une **policy** est du JSON : `Version` (`"2012-10-17"`), `Statement[]`, chaque statement a `Effect` (`Allow`/`Deny`), `Action` (`service:Operation`), `Resource` (ARN), `Condition` optionnelle.
4. Ordre d'évaluation : **deny implicite par défaut → un Deny explicite = Deny final → sinon il faut un Allow explicite**.
5. **Un Deny explicite l'emporte toujours sur un Allow** — c'est le socle des garde-fous.
6. Un role a **deux** policies : **trust policy** (qui peut l'assumer, via `sts:AssumeRole`) et **permission policy** (ce qu'il peut faire).
7. **Moindre privilège** : partir de zéro, scoper `Action` **et** `Resource`, resserrer avec `Condition`, auditer avec Access Analyzer/Access Advisor.
8. Un service AWS → **toujours un role**, jamais des access keys ; **MFA** forçable par policy via `aws:MultiFactorAuthPresent`.

---

## 7. Seeds Anki

```
IAM : quelle est la décision par défaut pour une requête, et sa seule exception ?|Deny implicite — toute requête est refusée par défaut. Seule exception : le root du compte, qui a un accès total.
Que se passe-t-il quand une action est à la fois Allow (par un group) et Deny (par une policy attachée) ?|Le Deny explicite l'emporte toujours. Décision finale = Deny, l'évaluation s'arrête sans même considérer l'Allow.
Différence entre un user IAM et un role IAM ?|Un user a des credentials long terme (mot de passe, access keys) et représente une personne/workload. Un role n'a pas de credential permanent : il délivre des credentials temporaires via STS (AssumeRole), assumable par un service, un autre compte ou une identité fédérée.
Quelle valeur doit avoir le champ Version d'une policy IAM, et pourquoi ce n'est pas une date ?|Toujours "2012-10-17" : c'est la version figée du langage de policy, pas la date de création ni la date du jour.
Quels sont les deux documents distincts d'un role, et à quoi sert chacun ?|La trust policy (basée ressource, avec Principal + sts:AssumeRole) dit QUI peut assumer le role ; la permission policy (basée identité) dit CE QUE le porteur peut faire une fois le role assumé.
Deny implicite vs Deny explicite : quelle différence de force ?|Le deny implicite = absence d'Allow, levable en ajoutant un Allow. Le deny explicite = Effect "Deny", non levable par un Allow. Les deux refusent mais le deny explicite gagne toujours.
Comment appliquer le moindre privilège à une Lambda qui écrit un item DynamoDB ?|Action scopée à dynamodb:PutItem (pas dynamodb:*), Resource scopée à l'ARN exact de la table (pas *), et un role dédié dont la trust policy n'autorise que lambda.amazonaws.com à l'assumer.
Pourquoi un wildcard dans le Principal d'une trust policy est-il dangereux, et quelle protection cross-account utiliser ?|"Principal": {"AWS": "*"} rend le role assumable par n'importe qui (et IAM interdit le * dans un ARN de Principal). Pour un accès cross-account, nommer le compte de confiance et ajouter un ExternalId (sts:ExternalId) contre le confused deputy.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-01-iam/README.md`. Tu crées un user, un group, un role de moindre privilège et une policy MFA dans la vraie console IAM + AWS CLI, et tu vérifies tes policies avec l'**IAM Policy Simulator** — puis tu détruis tout (teardown). Corrigé complet, feedback coach, variante J+30.
