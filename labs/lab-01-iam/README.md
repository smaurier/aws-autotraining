# Lab 01 — IAM : user, group, role de moindre privilège, MFA

> **Outcome :** à la fin, tu as créé dans un **vrai compte AWS** un user, un group, un role au moindre privilège et une policy MFA, et tu as **prouvé** leur comportement avec l'IAM Policy Simulator — puis tout détruit.
> **Vrai outil :** AWS Console (IAM) + AWS CLI v2 + **IAM Policy Simulator** (`https://policysim.aws.amazon.com`). Aucun harnais de test simulé.
> **Feedback :** le coach valide en session (lecture des policies + résultats du simulator). Pas de test-runner auto-correcteur.
>
> ⚠️ **Coût / sécurité :** IAM est **gratuit** (users, groups, roles, policies ne sont pas facturés). Le risque ici n'est pas le coût mais la **sécurité** : n'attache jamais `AdministratorAccess` à un user programmatique, ne crée pas d'access keys pour le root. **Teardown obligatoire** en fin de lab (section dédiée).

---

## Prérequis

- Un compte AWS avec un **user admin IAM** (pas le root) et le **MFA activé** sur le root — voir module 00.
- **AWS CLI v2** installée et configurée (`aws configure`) avec un profil qui a le droit de gérer IAM.
- Région de travail : `eu-west-3` (Paris). IAM est global, mais on fixe la région pour le reste.

Vérifie ton identité de départ :

```bash
aws sts get-caller-identity
# → Account, UserId, Arn : note l'Account ID (12 chiffres), tu en auras besoin dans les ARN.
```

---

## Énoncé

Tu poses la couche IAM de TribuZen. Cahier des charges **exact** :

1. **Un group `TribuZen-Developers`** portant la policy AWS managée `AmazonDynamoDBReadOnlyAccess`.
2. **Un user `alice`** (accès console), membre de ce group.
3. **Une customer managed policy `TribuZen-FeedLambdaPolicy`** de moindre privilège : autoriser **seulement** `dynamodb:PutItem` sur la table `TribuZenFeed` et `s3:PutObject` sur `tribuzen-avatars/family-*/*`.
4. **Un role `tribuzen-feed-lambda`** dont la **trust policy** n'autorise que **Lambda** (`lambda.amazonaws.com`) à l'assumer, avec la policy de l'étape 3 attachée.
5. **Une policy MFA `TribuZen-RequireMFA`** attachée au group : refuser toute action (sauf gérer son propre MFA) tant que la session n'a pas de MFA.
6. **Prouver** avec l'IAM Policy Simulator que :
   - `alice` **peut** `dynamodb:GetItem` mais **ne peut pas** `dynamodb:DeleteTable` ;
   - le role `tribuzen-feed-lambda` **peut** `dynamodb:PutItem` sur `TribuZenFeed` mais **ne peut pas** `dynamodb:Scan`.

Tu écris toi-même les documents JSON. Pas de gap-fill.

### Fichiers de travail (locaux, pas de projet npm)

Crée un dossier de travail et ces fichiers JSON — tu les passeras à la CLI :

```
lab-iam/
  feed-lambda-policy.json     ← permission policy de moindre privilège (étape 3)
  lambda-trust-policy.json    ← trust policy du role (étape 4)
  require-mfa-policy.json      ← policy MFA (étape 5)
```

---

## Étapes (en friction)

Écris chaque JSON **avant** de lancer la commande. Remplace `111122223333` par ton Account ID réel partout.

1. **Group + policy managée**
   ```bash
   aws iam create-group --group-name TribuZen-Developers
   aws iam attach-group-policy \
     --group-name TribuZen-Developers \
     --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess
   ```

2. **User console, membre du group**
   ```bash
   aws iam create-user --user-name alice
   aws iam create-login-profile --user-name alice \
     --password 'ChangeMe_TribuZen2026!' --password-reset-required
   aws iam add-user-to-group --user-name alice --group-name TribuZen-Developers
   ```

3. **Écris `feed-lambda-policy.json`** (moindre privilège) puis crée la policy. À toi de rédiger le JSON : deux statements, `dynamodb:PutItem` sur l'ARN exact de la table, `s3:PutObject` sur `tribuzen-avatars/family-*/*`.
   ```bash
   aws iam create-policy \
     --policy-name TribuZen-FeedLambdaPolicy \
     --policy-document file://feed-lambda-policy.json
   # → note le "Arn" retourné (arn:aws:iam::111122223333:policy/TribuZen-FeedLambdaPolicy)
   ```

4. **Écris `lambda-trust-policy.json`** (Principal = service Lambda, action `sts:AssumeRole`) puis crée le role et attache la policy de l'étape 3.
   ```bash
   aws iam create-role \
     --role-name tribuzen-feed-lambda \
     --assume-role-policy-document file://lambda-trust-policy.json
   aws iam attach-role-policy \
     --role-name tribuzen-feed-lambda \
     --policy-arn arn:aws:iam::111122223333:policy/TribuZen-FeedLambdaPolicy
   ```

5. **Écris `require-mfa-policy.json`** (Deny + `NotAction` des actions de self-management MFA + condition `aws:MultiFactorAuthPresent: false`) puis crée-la et attache-la au group.
   ```bash
   aws iam create-policy \
     --policy-name TribuZen-RequireMFA \
     --policy-document file://require-mfa-policy.json
   aws iam attach-group-policy \
     --group-name TribuZen-Developers \
     --policy-arn arn:aws:iam::111122223333:policy/TribuZen-RequireMFA
   ```

6. **Prouve dans le Policy Simulator** (`https://policysim.aws.amazon.com`) :
   - Sélectionne le user `alice` → simule `dynamodb:GetItem` (attendu **allowed**) puis `dynamodb:DeleteTable` (attendu **denied — implicit deny**).
   - Sélectionne le role `tribuzen-feed-lambda` → simule `dynamodb:PutItem` sur l'ARN de `TribuZenFeed` (**allowed**) puis `dynamodb:Scan` (**denied**).
   - Note pour chaque test : le verdict **et** la policy responsable (colonne « Matched statements »).

---

## Corrigé complet commenté

### `feed-lambda-policy.json` — permission policy de moindre privilège

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

- Deux statements séparés : un service + un ARN par bloc, lisible et auditable.
- `Action` = l'opération exacte (`dynamodb:PutItem`), jamais `dynamodb:*`. Pas de lecture, pas de suppression : la Lambda n'en a pas besoin.
- `Resource` = l'ARN précis. Le préfixe `family-*/*` limite S3 aux objets des familles, rien d'autre dans le bucket.

### `lambda-trust-policy.json` — trust policy (qui peut assumer)

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

- `Principal.Service = lambda.amazonaws.com` : **seul** le service Lambda peut endosser ce role — aucun humain, aucun autre service.
- Aucun `*` dans le `Principal` : IAM l'interdit dans une trust policy, et ce serait une faille béante.
- Ce document répond à *qui peut assumer* ; ce que le role peut faire vient de la permission policy attachée séparément (étape 4).

### `require-mfa-policy.json` — forcer le MFA par policy

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
        "iam:GetUser",
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

- `Effect: "Deny"` : c'est un **deny explicite** — il l'emporte sur tous les Allow du group tant que la condition est vraie.
- `NotAction` : on refuse **tout sauf** ces actions, celles qui permettent à l'utilisateur d'activer son propre MFA (sinon il serait bloqué avant de pouvoir le configurer).
- `BoolIfExists` + `aws:MultiFactorAuthPresent: "false"` : le Deny s'applique quand la session **n'a pas** de MFA. Une fois `alice` connectée avec MFA, la condition est fausse, le Deny ne s'applique plus, et les Allow du group reprennent.

### Résultats attendus du Policy Simulator

| Identité | Action simulée | Verdict | Policy responsable |
|----------|----------------|---------|--------------------|
| `alice` | `dynamodb:GetItem` | **allowed** | `AmazonDynamoDBReadOnlyAccess` (via group) |
| `alice` | `dynamodb:DeleteTable` | **denied** | aucune (deny implicite — pas d'Allow) |
| `tribuzen-feed-lambda` | `dynamodb:PutItem` sur `TribuZenFeed` | **allowed** | `TribuZen-FeedLambdaPolicy` |
| `tribuzen-feed-lambda` | `dynamodb:Scan` | **denied** | aucune (deny implicite) |

> Note : le simulator n'applique pas les conditions de session (MFA) par défaut — le Deny MFA se teste en réel en te connectant en tant qu'`alice` sans puis avec MFA. Le simulator sert ici à prouver le **scoping Action/Resource**, pas la condition MFA.

**Pourquoi ce corrigé est correct :** `alice` peut lire (policy read-only du group) mais pas supprimer une table (aucun Allow → deny implicite). Le role ne peut faire *que* les deux actions listées : tout le reste tombe en deny implicite. C'est le moindre privilège vérifié, pas supposé.

---

## Teardown (obligatoire)

IAM ne coûte rien, mais on ne laisse **jamais** traîner un user, une policy ou un role de test — surface d'attaque et bruit d'audit. Détache **avant** de supprimer (AWS refuse de supprimer une entité qui a encore des attachements) :

```bash
# 1. User : profil console, retrait du group, suppression
aws iam delete-login-profile --user-name alice
aws iam remove-user-from-group --user-name alice --group-name TribuZen-Developers
aws iam delete-user --user-name alice

# 2. Group : détacher les deux policies, puis supprimer
aws iam detach-group-policy --group-name TribuZen-Developers \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess
aws iam detach-group-policy --group-name TribuZen-Developers \
  --policy-arn arn:aws:iam::111122223333:policy/TribuZen-RequireMFA
aws iam delete-group --group-name TribuZen-Developers

# 3. Role : détacher la policy, supprimer le role
aws iam detach-role-policy --role-name tribuzen-feed-lambda \
  --policy-arn arn:aws:iam::111122223333:policy/TribuZen-FeedLambdaPolicy
aws iam delete-role --role-name tribuzen-feed-lambda

# 4. Customer managed policies : supprimer (après tout détachement)
aws iam delete-policy --policy-arn arn:aws:iam::111122223333:policy/TribuZen-FeedLambdaPolicy
aws iam delete-policy --policy-arn arn:aws:iam::111122223333:policy/TribuZen-RequireMFA
```

Vérifie que tout est parti :

```bash
aws iam list-users   --query "Users[?UserName=='alice']"
aws iam list-groups  --query "Groups[?GroupName=='TribuZen-Developers']"
aws iam list-roles   --query "Roles[?RoleName=='tribuzen-feed-lambda']"
# → les trois doivent renvoyer [] (liste vide)
```

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. En **20 minutes**, recrée uniquement le **role `tribuzen-feed-lambda`** et sa policy de moindre privilège — mais cette fois la Lambda doit aussi **lire** un item (`dynamodb:GetItem`) en plus de l'écrire, et pouvoir **lire** les avatars (`s3:GetObject`), toujours scopé aux mêmes ARN.
2. Ajoute une **`Condition`** sur le statement DynamoDB : n'autoriser que si `aws:RequestedRegion` vaut `eu-west-3`.
3. Prouve dans le Policy Simulator que `dynamodb:GetItem` passe en `eu-west-3` mais est **refusé** en `us-east-1`.
4. Fais le **teardown** complet de mémoire.

**Critère de réussite :** le simulator confirme le comportement région-dépendant, et `aws iam list-roles` renvoie `[]` après teardown.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces policies ne resteront pas écrites à la main : elles seront **générées par le CDK** (module 05), qui produit les ARN réels des ressources et attache automatiquement le bon role à chaque Lambda / tâche ECS.

**Ce que tu portes du lab vers le produit :**

- Le **pattern** « un role dédié par service, moindre privilège » — ici on l'a écrit à la main pour le comprendre ; en prod le CDK l'exprime en TypeScript (`table.grantWriteData(fn)` produit exactement la policy de ce lab).
- La **policy MFA** sur le group des humains reste une policy IAM gérée, appliquée dès la création du compte.
- Le **réflexe teardown** : toute ressource de test est détruite en fin de session.

**Commit cible :**
```
chore(iam): role feed-lambda moindre privilège + policy MFA developers (baseline manuelle avant CDK)
```
