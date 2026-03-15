# Module 01 — IAM : Identity & Access Management

> **Objectif** : Maîtriser la gestion des identités et des accès AWS : utilisateurs, groupes, rôles, politiques, et appliquer le principe du moindre privilège.
> **Difficulté** : ⭐⭐⭐
> **Prérequis** : Module 00
> **Durée estimée** : 4 heures

---

## Table des matières

1. [Pourquoi IAM est fondamental](#pourquoi-iam-est-fondamental)
2. [Le compte root](#le-compte-root)
3. [Utilisateurs IAM](#utilisateurs-iam)
4. [Groupes IAM](#groupes-iam)
5. [Politiques IAM (Policies)](#politiques-iam-policies)
6. [Le format ARN](#le-format-arn)
7. [Rôles IAM](#rôles-iam)
8. [Le principe du moindre privilège](#le-principe-du-moindre-privilège)
9. [MFA — Authentification multi-facteurs](#mfa)
10. [Politiques de mots de passe](#politiques-de-mots-de-passe)
11. [Rôles liés aux services](#rôles-liés-aux-services)
12. [Accès cross-account](#accès-cross-account)
13. [Bonnes pratiques IAM](#bonnes-pratiques-iam)

---

## Pourquoi IAM est fondamental

IAM est le **gardien** de votre compte AWS. Chaque appel API, chaque clic dans la console, chaque commande CLI passe par IAM pour vérifier : **qui fait quoi sur quelle ressource ?**

**Analogie** : IAM est comme le service de sécurité d'un immeuble de bureaux. Il vérifie votre badge (authentification), puis regarde si vous avez le droit d'entrer dans la salle demandée (autorisation).

IAM est un service **global** — il n'est pas lié à une région. Un utilisateur IAM créé dans votre compte peut agir dans toutes les régions.

### Les trois questions d'IAM

1. **Authentification** — Qui êtes-vous ? (identité vérifiée)
2. **Autorisation** — Qu'avez-vous le droit de faire ? (permissions vérifiées)
3. **Audit** — Qu'avez-vous fait ? (CloudTrail enregistre tout)

---

## Le compte root

Le compte **root** est le premier utilisateur créé avec votre compte AWS. Il a un pouvoir **illimité** et ne peut être restreint par aucune politique.

### Ce que seul le root peut faire

- Changer les informations de facturation et le plan de support
- Fermer le compte AWS
- Restaurer les permissions d'un utilisateur IAM
- Créer un CloudFront key pair
- Modifier certaines configurations au niveau du compte (Tax settings, etc.)
- S'inscrire comme vendeur sur le Marketplace

### Règles absolues pour le root

1. **Ne jamais utiliser le root au quotidien** — Créez un utilisateur IAM admin
2. **Activez le MFA immédiatement** — De préférence une clé physique (YubiKey)
3. **Ne créez jamais de clés d'accès pour le root**
4. **Stockez les identifiants root dans un coffre-fort** (physique ou numérique sécurisé)

---

## Utilisateurs IAM

Un **utilisateur IAM** représente une personne ou une application qui interagit avec AWS.

### Types d'accès

| Type | Usage | Identifiants |
|------|-------|-------------|
| **Console** | Interface web | Nom d'utilisateur + mot de passe |
| **Programmatique** | CLI, SDK, API | Access Key ID + Secret Access Key |

### Création d'un utilisateur

```bash
# Créer un utilisateur
aws iam create-user --user-name alice

# Créer des clés d'accès (programmatique)
aws iam create-access-key --user-name alice

# Créer un profil de connexion (console)
aws iam create-login-profile --user-name alice --password 'TempP@ss2026!' --password-reset-required
```

### Bonnes pratiques utilisateurs

- Un utilisateur = une personne (ne jamais partager)
- Désactivez les clés d'accès inutilisées (rotation régulière)
- Supprimez les utilisateurs qui quittent l'organisation
- Utilisez des **Access Advisor** pour voir les permissions réellement utilisées

---

## Groupes IAM

Un **groupe** est un ensemble d'utilisateurs IAM. Les politiques attachées au groupe s'appliquent à tous ses membres.

```
Groupe: Developers
├── alice (hérite des permissions du groupe)
├── bob
└── charlie

Groupe: Admins
├── dave
└── eve
```

### Règles des groupes

- Un utilisateur peut appartenir à **plusieurs groupes** (max 10)
- Les groupes ne peuvent **pas contenir d'autres groupes** (pas d'imbrication)
- Il n'y a pas de groupe par défaut — tous les utilisateurs n'appartiennent à aucun groupe initialement
- Les groupes n'ont **pas d'identifiants** — on ne peut pas se connecter "en tant que groupe"

### Exemple de structure d'entreprise

```
Groupe: ReadOnlyAccess
  → Politique: ViewOnlyAccess (AWS managée)

Groupe: Developers
  → Politique: PowerUserAccess (AWS managée)
  → Politique: DenyProductionDelete (personnalisée)

Groupe: DBAdmins
  → Politique: AmazonRDSFullAccess
  → Politique: AmazonDynamoDBFullAccess

Groupe: Admins
  → Politique: AdministratorAccess
```

---

## Politiques IAM (Policies)

Les **politiques** (policies) sont des documents JSON qui définissent les permissions. C'est le coeur d'IAM.

### Structure d'une politique

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ReadOnly",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::mon-bucket",
        "arn:aws:s3:::mon-bucket/*"
      ],
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "203.0.113.0/24"
        }
      }
    }
  ]
}
```

### Chaque champ expliqué

| Champ | Description | Obligatoire |
|-------|-------------|-------------|
| `Version` | Toujours `"2012-10-17"` (la version du langage de politique) | Oui |
| `Statement` | Tableau de déclarations de permissions | Oui |
| `Sid` | Identifiant lisible de la déclaration | Non |
| `Effect` | `"Allow"` ou `"Deny"` | Oui |
| `Action` | Actions API autorisées/refusées (`service:Action`) | Oui |
| `Resource` | ARN des ressources concernées | Oui* |
| `Condition` | Conditions supplémentaires (IP, MFA, heure, etc.) | Non |

*Pour les politiques basées sur l'identité. Les politiques basées sur les ressources utilisent `Principal` à la place.

### Types de politiques

1. **AWS Managed** — Créées et maintenues par AWS (`AdministratorAccess`, `ReadOnlyAccess`, etc.)
2. **Customer Managed** — Créées par vous, réutilisables, versionnées
3. **Inline** — Directement intégrées à un utilisateur/groupe/rôle (non recommandé, sauf cas exceptionnel)

### Évaluation des politiques

L'algorithme d'évaluation suit cet ordre :

```
1. Par défaut → DENY implicite (tout est interdit)
2. Évaluer toutes les politiques applicables
3. Y a-t-il un DENY explicite ? → DENY (fin, c'est définitif)
4. Y a-t-il un ALLOW ? → ALLOW
5. Sinon → DENY implicite
```

**Règle d'or : un Deny explicite l'emporte TOUJOURS sur un Allow.**

### Exemples de conditions utiles

```json
{
  "Condition": {
    "Bool": { "aws:MultiFactorAuthPresent": "true" },
    "StringEquals": { "aws:RequestedRegion": "eu-west-3" },
    "DateGreaterThan": { "aws:CurrentTime": "2026-01-01T00:00:00Z" },
    "IpAddress": { "aws:SourceIp": "10.0.0.0/8" },
    "StringLike": { "s3:prefix": ["home/${aws:username}/*"] }
  }
}
```

### Variables de politique

Vous pouvez utiliser des variables dynamiques :

- `${aws:username}` — Nom de l'utilisateur IAM
- `${aws:userid}` — ID unique de l'utilisateur
- `${aws:SourceIp}` — Adresse IP source
- `${aws:CurrentTime}` — Date et heure actuelles
- `${aws:PrincipalTag/department}` — Tag du principal

---

## Le format ARN

L'**ARN** (Amazon Resource Name) est l'identifiant unique d'une ressource AWS.

### Format général

```
arn:partition:service:region:account-id:resource-type/resource-id
```

### Exemples commentés

```
arn:aws:s3:::mon-bucket
│   │   │    │
│   │   │    └── Nom du bucket (pas de région ni account car S3 est global)
│   │   └── Service = S3
│   └── Partition = aws (standard, vs aws-cn pour Chine, aws-us-gov pour GovCloud)
└── Préfixe ARN

arn:aws:ec2:eu-west-3:123456789012:instance/i-0abcd1234efgh5678
│   │   │   │          │              │        │
│   │   │   │          │              │        └── ID de l'instance
│   │   │   │          │              └── Type de ressource
│   │   │   │          └── Account ID (12 chiffres)
│   │   │   └── Région
│   │   └── Service
│   └── Partition
└── Préfixe

arn:aws:iam::123456789012:user/alice
                          │    │
                          │    └── Nom de l'utilisateur
                          └── Pas de région (IAM est global)
```

### Wildcards dans les ARN

```
arn:aws:s3:::*                    → Tous les buckets S3
arn:aws:s3:::mon-bucket/*         → Tous les objets dans mon-bucket
arn:aws:ec2:*:123456789012:*      → Toutes les ressources EC2 dans toutes les régions
arn:aws:iam::123456789012:user/*  → Tous les utilisateurs IAM du compte
```

---

## Rôles IAM

Un **rôle** est une identité IAM avec des permissions, mais **sans identifiants permanents**. Au lieu de ça, il délivre des **credentials temporaires** via STS (Security Token Service).

### Qui peut assumer un rôle ?

- Un utilisateur IAM (du même compte ou d'un autre)
- Un service AWS (EC2, Lambda, ECS, etc.)
- Une identité externe (fédération SAML, OpenID Connect)

### Anatomie d'un rôle

Un rôle a deux composants :

1. **Trust Policy** (politique de confiance) — Qui a le droit d'assumer ce rôle ?
2. **Permission Policy** — Que peut faire celui qui a assumé le rôle ?

#### Exemple : rôle pour une instance EC2

**Trust Policy** :
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Permission Policy** :
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::app-data-bucket/*"
    }
  ]
}
```

### Pourquoi des rôles plutôt que des clés d'accès ?

| Clés d'accès | Rôles |
|---------------|-------|
| Permanentes (jusqu'à révocation) | Temporaires (1h par défaut, max 12h) |
| Stockées quelque part (risque de fuite) | Jamais stockées, obtenues dynamiquement |
| Rotation manuelle nécessaire | Rotation automatique par STS |
| Liées à un utilisateur | Assumables par n'importe quel principal autorisé |

---

## Le principe du moindre privilège

**Donnez uniquement les permissions nécessaires, rien de plus.**

### Comment l'appliquer ?

1. **Commencez avec zéro permission** et ajoutez au fur et à mesure
2. Utilisez **IAM Access Analyzer** pour identifier les permissions excessives
3. Consultez **Access Advisor** pour voir les services réellement utilisés
4. Utilisez des **conditions** pour restreindre davantage (IP, MFA, heure, région)
5. Revoyez régulièrement les permissions (audit trimestriel minimum)

### Exemple progressif

```
❌ Trop permissif :
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}

⚠️ Mieux, mais encore trop large :
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}

✅ Principe du moindre privilège :
{
  "Effect": "Allow",
  "Action": ["s3:GetObject"],
  "Resource": "arn:aws:s3:::app-bucket/reports/*"
}
```

---

## MFA

L'**authentification multi-facteurs** ajoute une couche de sécurité en exigeant :

1. Quelque chose que vous **savez** (mot de passe)
2. Quelque chose que vous **avez** (device MFA)

### Types de MFA supportés

| Type | Description | Recommandation |
|------|-------------|----------------|
| Application TOTP | Google Authenticator, Authy | Bon pour le quotidien |
| Clé physique FIDO2 | YubiKey, Titan Key | Idéal pour le root |
| MFA virtuel | Application qui génère des codes | Standard |

### Forcer le MFA par politique

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyAllWithoutMFA",
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
        "BoolIfExists": {
          "aws:MultiFactorAuthPresent": "false"
        }
      }
    }
  ]
}
```

Cette politique refuse tout sauf les actions nécessaires pour configurer le MFA, tant que le MFA n'est pas activé.

---

## Politiques de mots de passe

Configurez une politique de mot de passe robuste pour tous les utilisateurs IAM :

```bash
aws iam update-account-password-policy \
  --minimum-password-length 14 \
  --require-symbols \
  --require-numbers \
  --require-uppercase-characters \
  --require-lowercase-characters \
  --allow-users-to-change-password \
  --max-password-age 90 \
  --password-reuse-prevention 12 \
  --hard-expiry
```

| Paramètre | Valeur recommandée |
|-----------|-------------------|
| Longueur minimum | 14 caractères |
| Majuscules requises | Oui |
| Minuscules requises | Oui |
| Chiffres requis | Oui |
| Symboles requis | Oui |
| Expiration | 90 jours |
| Historique | 12 derniers mots de passe |

---

## Rôles liés aux services

Les **Service-Linked Roles** sont des rôles prédéfinis qu'AWS crée automatiquement pour ses services. Vous ne pouvez pas modifier leurs permissions.

**Exemples** :
- `AWSServiceRoleForElasticLoadBalancing` — Permet à ELB de gérer les interfaces réseau
- `AWSServiceRoleForAutoScaling` — Permet à Auto Scaling de lancer/terminer des instances
- `AWSServiceRoleForRDS` — Permet à RDS de gérer les sous-réseaux et la sécurité

Ces rôles suivent le pattern : `aws-service-role/<service>.amazonaws.com/`

---

## Accès cross-account

Permettre à un utilisateur du **compte A** d'accéder à des ressources du **compte B**.

### Étapes

1. **Compte B** : Créer un rôle avec une Trust Policy autorisant le compte A

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "secret-external-id-123"
        }
      }
    }
  ]
}
```

2. **Compte A** : Donner la permission à l'utilisateur d'assumer le rôle

```json
{
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": "arn:aws:iam::222222222222:role/CrossAccountRole"
}
```

3. **L'utilisateur assume le rôle** :

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::222222222222:role/CrossAccountRole \
  --role-session-name my-session \
  --external-id secret-external-id-123
```

L'`ExternalId` protège contre le problème du "confused deputy" — un tiers ne peut pas se faire passer pour vous.

---

## Bonnes pratiques IAM

### Checklist complète

1. **Compte root**
   - [ ] MFA activé (clé physique de préférence)
   - [ ] Pas de clés d'accès
   - [ ] Utilisation uniquement pour les tâches qui le nécessitent

2. **Utilisateurs**
   - [ ] Un utilisateur par personne physique
   - [ ] Gérer les permissions via des groupes, pas individuellement
   - [ ] Rotation des clés d'accès tous les 90 jours
   - [ ] Supprimer les identifiants inutilisés

3. **Permissions**
   - [ ] Principe du moindre privilège
   - [ ] Commencer avec des politiques AWS managées, puis affiner
   - [ ] Utiliser les conditions (IP, MFA, région) quand possible
   - [ ] Auditer avec IAM Access Analyzer

4. **Rôles**
   - [ ] Utiliser des rôles pour les services AWS (EC2, Lambda, etc.)
   - [ ] Utiliser des rôles pour l'accès cross-account
   - [ ] Utiliser des rôles pour la fédération d'identité

5. **Monitoring**
   - [ ] Activer CloudTrail dans toutes les régions
   - [ ] Configurer des alertes pour les actions root
   - [ ] Utiliser IAM Credential Report pour l'audit

### Commandes d'audit utiles

```bash
# Rapport d'identifiants (tous les utilisateurs, clés, MFA, etc.)
aws iam generate-credential-report
aws iam get-credential-report --output text --query Content | base64 -d

# Dernière utilisation d'un service par un rôle
aws iam get-service-last-accessed-details --job-id <job-id>

# Lister les politiques attachées à un utilisateur
aws iam list-attached-user-policies --user-name alice
aws iam list-user-policies --user-name alice

# Lister les clés d'accès d'un utilisateur
aws iam list-access-keys --user-name alice
```

---

## Résumé du module

| Concept | Points clés |
|---------|-------------|
| Root | Pouvoir illimité, à protéger absolument, MFA obligatoire |
| Utilisateurs | Une personne = un utilisateur, accès console ou programmatique |
| Groupes | Regroupent les utilisateurs, portent les politiques |
| Politiques | JSON avec Effect/Action/Resource/Condition |
| ARN | Identifiant unique : `arn:partition:service:region:account:resource` |
| Rôles | Credentials temporaires, préférables aux clés d'accès |
| Moindre privilège | Permissions minimales nécessaires |
| MFA | Couche de sécurité supplémentaire, obligatoire pour le root |

---

## Pour aller plus loin

- [IAM Best Practices (AWS)](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Policy Simulator](https://policysim.aws.amazon.com/)
- [IAM Access Analyzer](https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html)
