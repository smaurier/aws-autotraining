# 15 — Securite AWS Avancee

> **Duree estimee** : 5h00
> **Difficulte** : 4/5
> **Prerequis** : Module 01 (IAM), Module 02 (VPC), notions de chiffrement
> **Objectifs** :
> - Maitriser **KMS** (cles, envelope encryption, politiques)
> - Comparer **Secrets Manager** et **Parameter Store**
> - Configurer **WAF** et **Shield** pour la protection DDoS
> - Comprendre **GuardDuty**, **Security Hub** et **Config**
> - Securiser les communications avec **VPC Endpoints** et **PrivateLink**
> - Gerer les comptes avec **Organizations**, SCPs et OUs

---

## KMS — Key Management Service

### Pourquoi chiffrer ?

Le chiffrement protege les donnees meme si un attaquant obtient un acces physique ou logique aux systemes de stockage. AWS propose le chiffrement **at rest** (donnees stockees) et **in transit** (donnees en mouvement).

### Concepts KMS

| Concept | Description |
|---------|-------------|
| **CMK** (Customer Master Key) | Cle principale, ne quitte jamais KMS |
| **Data Key** | Cle generee par KMS pour chiffrer les donnees |
| **Key Policy** | Politique IAM specifique a la cle |
| **Key Alias** | Nom lisible pour une cle (ex : `alias/my-app-key`) |
| **Key Rotation** | Rotation automatique annuelle de la cle |

### Types de cles

| Type | Gestion | Cout | Cas d'usage |
|------|---------|------|-------------|
| **AWS Managed** | AWS cree et gere | Gratuit | S3 SSE-S3, EBS par defaut |
| **Customer Managed** | Vous creez, AWS stocke | $1/mois + API calls | Controle total, audit |
| **Customer Imported** | Vous importez le materiel | $1/mois + API calls | Conformite stricte |

### Envelope Encryption

KMS ne chiffre directement que de petites quantites de donnees (max 4 Ko). Pour les fichiers plus gros, on utilise l'**envelope encryption** :

```
Etape 1 : Generer une Data Key
  Application → KMS.GenerateDataKey()
  KMS retourne :
    - Data Key en clair (pour chiffrer)
    - Data Key chiffree (pour stocker)

Etape 2 : Chiffrer les donnees
  Application chiffre le fichier avec la Data Key en clair
  Application supprime la Data Key en clair de la memoire
  Application stocke : [fichier chiffre] + [Data Key chiffree]

Etape 3 : Dechiffrer
  Application → KMS.Decrypt(Data Key chiffree)
  KMS retourne la Data Key en clair
  Application dechiffre le fichier
```

Visuellement :

```
┌─────────────────────────────────────┐
│          Envelope Encryption         │
│                                      │
│  CMK (dans KMS, ne sort jamais)      │
│    │                                 │
│    ├── Chiffre → Data Key chiffree   │
│    └── Dechiffre ← Data Key chiffree │
│                                      │
│  Data Key (en clair, ephemere)       │
│    │                                 │
│    ├── Chiffre → Donnees chiffrees   │
│    └── Dechiffre ← Donnees chiffrees │
└─────────────────────────────────────┘
```

### Pourquoi ce systeme a deux niveaux ?

1. **Performance** : chiffrer avec une cle locale est rapide (pas d'appel reseau par octet)
2. **Securite** : la CMK ne quitte jamais KMS (hardware securise FIPS 140-2 Level 3)
3. **Scalabilite** : chaque fichier a sa propre data key

### Key Policy

Chaque cle KMS a une **key policy** qui controle qui peut l'utiliser :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Allow key administrators",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::123456789012:role/Admin" },
      "Action": [
        "kms:Create*",
        "kms:Describe*",
        "kms:Enable*",
        "kms:List*",
        "kms:Put*",
        "kms:Update*",
        "kms:Revoke*",
        "kms:Disable*",
        "kms:Delete*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Allow key usage",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::123456789012:role/AppRole" },
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "*"
    }
  ]
}
```

**Bonne pratique** : separez les roles **administrateur de cle** (gestion) et **utilisateur de cle** (chiffrement/dechiffrement).

---

## Secrets Manager vs Parameter Store

### Deux services pour stocker des secrets

| Critere | Secrets Manager | Parameter Store (SecureString) |
|---------|----------------|-------------------------------|
| **Prix** | $0.40/secret/mois + $0.05/10k API calls | Gratuit (standard) / $0.05/parametre avance |
| **Rotation auto** | Oui (Lambda integre) | Non (custom) |
| **Cross-region** | Replication multi-region | Non |
| **Taille max** | 64 Ko | 8 Ko (standard) / 64 Ko (avance) |
| **Versioning** | Oui (automatique) | Oui |
| **Historique** | 100 versions | Non |
| **Integration** | RDS, Redshift, DocumentDB | Tous services AWS |

### Secrets Manager

Ideal pour les **credentials de bases de donnees** grace a la rotation automatique :

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

async function getDbCredentials(): Promise<{ username: string; password: string }> {
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: 'prod/db/postgres' })
  );
  return JSON.parse(response.SecretString!);
}
```

Rotation automatique des mots de passe RDS :

```
Jour 0 : password = "abc123"
Jour 30 : Secrets Manager → Lambda de rotation → RDS (change le password)
           password = "xyz789" (nouveau)
           Application recupere automatiquement le nouveau password
```

### Parameter Store

Ideal pour la **configuration applicative** (pas necessairement secrete) :

```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

// Parametre simple (non chiffre)
const config = await ssm.send(
  new GetParameterCommand({ Name: '/app/prod/api-url' })
);

// Parametre chiffre (SecureString avec KMS)
const secret = await ssm.send(
  new GetParameterCommand({
    Name: '/app/prod/api-key',
    WithDecryption: true
  })
);
```

### Hierarchie des parametres

Parameter Store permet une organisation hierarchique :

```
/app/
  ├── prod/
  │   ├── db-host       = "prod-db.rds.amazonaws.com"
  │   ├── db-password    = "***" (SecureString)
  │   └── feature-flags  = '{"darkMode":true}'
  └── staging/
      ├── db-host       = "staging-db.rds.amazonaws.com"
      └── db-password    = "***" (SecureString)
```

Vous pouvez recuperer tous les parametres d'un chemin :

```bash
aws ssm get-parameters-by-path --path "/app/prod" --with-decryption
```

### Quand utiliser quoi ?

| Cas d'usage | Service recommande |
|-------------|-------------------|
| Credentials de base de donnees | **Secrets Manager** (rotation auto) |
| Cles API tierces | **Secrets Manager** |
| Configuration applicative | **Parameter Store** |
| Feature flags | **Parameter Store** |
| Certificats | **Secrets Manager** |

---

## WAF — Web Application Firewall

### Qu'est-ce que WAF ?

**WAF** est un pare-feu applicatif (couche 7) qui filtre le trafic HTTP/HTTPS entrant. Il protege contre les attaques web courantes.

### Architecture

```
Internet → CloudFront / ALB / API Gateway
                    ↓
              AWS WAF (filtre)
                    ↓
          Requete autorisee → Application
          Requete bloquee → 403 Forbidden
```

### Web ACL (Access Control List)

Une **Web ACL** est un ensemble de regles evaluees dans l'ordre :

```
Web ACL : "Protection-Production"
  Regle 1 : Bloquer les IP blacklistees          → BLOCK
  Regle 2 : Rate limiting (2000 req/5min par IP) → BLOCK si depasse
  Regle 3 : AWS Managed Rules (SQL injection)    → BLOCK
  Regle 4 : AWS Managed Rules (XSS)              → BLOCK
  Regle 5 : Geo-block (pays interdits)           → BLOCK
  Action par defaut :                             → ALLOW
```

### Types de regles

| Type | Description | Exemple |
|------|-------------|---------|
| **IP Set** | Bloquer/autoriser des IPs | Liste noire d'IPs malveillantes |
| **Rate-based** | Limiter le debit par IP | Max 2000 req/5 min |
| **Geo match** | Filtrer par pays | Bloquer certains pays |
| **String match** | Chercher un pattern | Bloquer les user-agents suspects |
| **SQL injection** | Detecter les injections SQL | `' OR 1=1 --` |
| **XSS** | Detecter le cross-site scripting | `<script>alert(1)</script>` |
| **Size constraint** | Limiter la taille | Body > 10 Ko → block |

### AWS Managed Rule Groups

AWS fournit des ensembles de regles pre-configurees :

| Rule Group | Protection |
|-----------|-----------|
| **AWSManagedRulesCommonRuleSet** | OWASP Top 10 |
| **AWSManagedRulesSQLiRuleSet** | Injection SQL |
| **AWSManagedRulesKnownBadInputsRuleSet** | Payloads malveillants connus |
| **AWSManagedRulesAmazonIpReputationList** | IPs avec mauvaise reputation |
| **AWSManagedRulesBotControlRuleSet** | Protection contre les bots |

### Regles rate-based

Les regles **rate-based** limitent le nombre de requetes par IP sur une fenetre de 5 minutes :

```
Regle : "RateLimit"
  Seuil : 2000 requetes par 5 minutes par IP
  Action : BLOCK
  Duree du block : jusqu'a ce que le taux redescende
```

**Cas d'usage** : protection contre le brute force, le scraping agressif, les DDoS applicatifs.

---

## Shield — Protection DDoS

### Shield Standard (gratuit)

**Shield Standard** est active automatiquement pour tous les clients AWS. Il protege contre :
- Les attaques de couche 3/4 (SYN flood, UDP reflection)
- Les attaques volumetriques courantes

### Shield Advanced ($3000/mois)

Pour les applications critiques, Shield Advanced offre :

| Fonctionnalite | Description |
|----------------|-------------|
| **Protection avancee** | Detection et mitigation DDoS sophistiquees |
| **DRT** | Acces a l'equipe DDoS Response Team d'AWS |
| **Cost protection** | Remboursement des couts lies a un DDoS (scaling) |
| **Health checks** | Integration Route 53 pour le failover DDoS |
| **Visibilite** | Metriques et rapports detailles |

### Quand Shield Advanced ?

- Applications critiques (e-commerce, banque, gaming)
- Cibles frequentes d'attaques DDoS
- Besoin de support expert pendant une attaque
- Budget suffisant ($3000/mois minimum)

---

## GuardDuty

### Detection de menaces

**GuardDuty** est un service de detection de menaces qui analyse en continu :
- Les **VPC Flow Logs**
- Les **CloudTrail logs** (appels API)
- Les **DNS logs**
- Les **S3 data events**
- Les **EKS audit logs**

### Types de findings

| Categorie | Exemple |
|-----------|---------|
| **Reconnaissance** | Port scanning depuis une instance EC2 |
| **Compromission d'instance** | EC2 communique avec une IP de C&C |
| **Compromission de compte** | Appels API depuis un pays inhabituel |
| **Exfiltration de donnees** | Telechargement massif depuis S3 |
| **Cryptomining** | Instance EC2 mine du Bitcoin |

### Severite

| Severite | Score | Action |
|----------|-------|--------|
| **Low** | 1-3 | A surveiller |
| **Medium** | 4-6 | A investiguer |
| **High** | 7-8.9 | Action immediate requise |
| **Critical** | 9-10 | Urgence absolue |

### Automatisation

GuardDuty peut declencher des actions automatiques via **EventBridge** :

```
GuardDuty finding (High)
       ↓
EventBridge Rule
       ↓
Lambda : isoler l'instance EC2 (modifier le security group)
       ↓
SNS : alerter l'equipe securite
```

---

## Security Hub

### Vue unifiee de la securite

**Security Hub** agrege les findings de tous les services de securite AWS :

```
┌──────────────────────────────┐
│         Security Hub          │
│                                │
│  ← GuardDuty findings         │
│  ← Inspector findings          │
│  ← Macie findings              │
│  ← Firewall Manager findings   │
│  ← Config non-compliance       │
│  ← Partenaires (CrowdStrike...) │
│                                │
│  → Score de securite global    │
│  → Dashboard consolide         │
│  → Conformite aux standards    │
└──────────────────────────────┘
```

### Standards de conformite

Security Hub evalue votre compte contre des standards :

| Standard | Description |
|----------|-------------|
| **AWS Foundational Security Best Practices** | Bonnes pratiques AWS |
| **CIS AWS Foundations Benchmark** | Standard CIS niveau 1 et 2 |
| **PCI DSS** | Conformite carte de paiement |
| **NIST 800-53** | Standard americain de securite |

Chaque controle est note PASSED, FAILED ou WARNING avec des recommandations de remediation.

---

## AWS Config

### Conformite continue

**AWS Config** enregistre la configuration de vos ressources AWS et evalue leur conformite en continu.

### Config Rules

| Regle | Verifie |
|-------|---------|
| `s3-bucket-public-read-prohibited` | Aucun bucket S3 n'est public en lecture |
| `rds-instance-public-access-check` | Aucune instance RDS n'est publique |
| `encrypted-volumes` | Tous les volumes EBS sont chiffres |
| `iam-password-policy` | La politique de mot de passe est conforme |
| `vpc-flow-logs-enabled` | Les VPC Flow Logs sont actives |
| `multi-region-cloudtrail-enabled` | CloudTrail est active multi-region |

### Remediation automatique

Config peut declencher une **remediation automatique** quand une regle est violee :

```
Regle : "s3-bucket-public-read-prohibited"
  Etat : NON_COMPLIANT (bucket "test-bucket" est public)
       ↓
  Remediation automatique :
       ↓
  SSM Automation : supprime l'acces public du bucket
       ↓
  Etat : COMPLIANT
```

### Timeline

Config enregistre un **historique** de chaque ressource, permettant de voir quand et comment elle a change :

```
Bucket "mon-bucket" :
  2024-01-10 : Cree (prive)
  2024-01-15 : Politique modifiee (public !)  ← NON_COMPLIANT
  2024-01-15 : Remediation auto (prive)       ← COMPLIANT
  2024-02-01 : Chiffrement active
```

---

## VPC Endpoints

### Le probleme

Par defaut, les appels aux services AWS (S3, DynamoDB, SQS...) transitent par **Internet** :

```
EC2 (VPC prive) → NAT Gateway → Internet Gateway → S3
                  (cout $$$)     (exposition)
```

### La solution : VPC Endpoints

Les **VPC Endpoints** permettent d'acceder aux services AWS **sans passer par Internet** :

```
EC2 (VPC prive) → VPC Endpoint → S3
                  (prive, gratuit*)
```

### Gateway Endpoints

| Service supporte | Type | Cout |
|-----------------|------|------|
| **S3** | Gateway | **Gratuit** |
| **DynamoDB** | Gateway | **Gratuit** |

Un gateway endpoint est une entree dans la table de routage :

```
Table de routage du subnet :
  10.0.0.0/16    → local
  pl-xxx (S3)    → vpce-xxx (gateway endpoint)
```

### Interface Endpoints (PrivateLink)

Pour tous les autres services AWS, utilisez un **Interface Endpoint** :

```
EC2 → Interface Endpoint (ENI dans votre VPC) → Service AWS
      Adresse IP privee (10.0.x.x)
```

| Aspect | Detail |
|--------|--------|
| **Services** | SQS, SNS, KMS, CloudWatch, Secrets Manager, etc. |
| **Cout** | ~$0.01/h par AZ + $0.01/Go |
| **DNS** | Resolution privee automatique |
| **Security Group** | Controlable via SG |

### PrivateLink pour vos propres services

**PrivateLink** permet d'exposer vos services a d'autres VPC ou comptes AWS de maniere privee :

```
Compte A (fournisseur) :
  NLB → Vos instances
    ↓
  VPC Endpoint Service
    ↓
Compte B (consommateur) :
  Interface Endpoint → Acces prive au service du compte A
```

Cas d'usage : partager un service entre equipes sans exposer sur Internet.

---

## AWS Organizations

### Gerer plusieurs comptes

**Organizations** permet de gerer de maniere centralisee plusieurs comptes AWS :

```
Organisation
├── Root
│   ├── OU: Production
│   │   ├── Compte: prod-app (111111111111)
│   │   └── Compte: prod-data (222222222222)
│   ├── OU: Staging
│   │   └── Compte: staging (333333333333)
│   ├── OU: Development
│   │   ├── Compte: dev-team-a (444444444444)
│   │   └── Compte: dev-team-b (555555555555)
│   └── OU: Security
│       └── Compte: security-audit (666666666666)
```

### OUs (Organizational Units)

Les **OUs** sont des groupes de comptes auxquels on peut appliquer des politiques :

| OU | Contient | Politiques |
|----|----------|-----------|
| Production | Comptes de prod | Restrictions strictes |
| Staging | Comptes de test | Restrictions moderees |
| Development | Comptes de dev | Permissions larges |
| Security | Audit, logs | Acces en lecture seule |

### SCPs (Service Control Policies)

Les **SCPs** definissent les **permissions maximales** pour les comptes d'une OU. Meme un administrateur du compte ne peut pas depasser les limites d'un SCP.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyLeaveOrg",
      "Effect": "Deny",
      "Action": "organizations:LeaveOrganization",
      "Resource": "*"
    },
    {
      "Sid": "DenyDisableCloudTrail",
      "Effect": "Deny",
      "Action": [
        "cloudtrail:StopLogging",
        "cloudtrail:DeleteTrail"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RequireIMDSv2",
      "Effect": "Deny",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringNotEquals": {
          "ec2:MetadataHttpTokens": "required"
        }
      }
    }
  ]
}
```

### SCPs courants

| SCP | Objectif |
|-----|----------|
| Deny leave organization | Empecher les comptes de quitter l'org |
| Deny disable CloudTrail | Garantir l'audit |
| Restrict regions | Limiter a certaines regions AWS |
| Require encryption | Forcer le chiffrement S3/EBS |
| Deny root user | Empecher l'utilisation du root |
| Require IMDSv2 | Securiser les metadonnees EC2 |

### Comment les SCPs interagissent avec IAM

```
Permission effective = IAM Policy ∩ SCP

Exemple :
  IAM Policy : Allow s3:*        (tout S3)
  SCP :        Deny s3:DeleteBucket

  Resultat :   L'utilisateur peut tout faire sur S3
               SAUF supprimer des buckets
```

Les SCPs sont un **filet de securite** : ils ne donnent pas de permissions, ils les limitent.

---

## Well-Architected — Pilier Securite

### Les 7 principes de conception

1. **Appliquer la securite a toutes les couches** : WAF, security groups, NACLs, chiffrement
2. **Activer la tracabilite** : CloudTrail, Config, VPC Flow Logs
3. **Appliquer le principe du moindre privilege** : IAM roles avec permissions minimales
4. **Securiser le systeme** : patches, hardening, scan de vulnerabilites
5. **Automatiser les bonnes pratiques** : Config rules, remediation auto
6. **Proteger les donnees en transit et au repos** : TLS, KMS, chiffrement S3/EBS/RDS
7. **Se preparer aux incidents** : runbooks, simulations, equipe de reponse

### Defense en profondeur

```
Internet
  └── WAF + Shield (couche 7, DDoS)
      └── CloudFront (edge, TLS)
          └── ALB + Security Group (couche 4)
              └── VPC + NACLs (couche 3)
                  └── Subnet prive (isolation)
                      └── EC2 + Security Group
                          └── Application (authentification)
                              └── Donnees chiffrees (KMS)
```

Chaque couche ajoute un niveau de protection. Si une couche est contournee, les suivantes protegent encore.

---

## Recapitulatif

| Concept | A retenir |
|---------|-----------|
| **KMS** | Gestion des cles de chiffrement (CMK ne quitte jamais KMS) |
| **Envelope Encryption** | CMK chiffre Data Key, Data Key chiffre les donnees |
| **Secrets Manager** | Secrets avec rotation automatique ($0.40/secret/mois) |
| **Parameter Store** | Configuration hierarchique (gratuit en standard) |
| **WAF** | Pare-feu applicatif (SQL injection, XSS, rate limiting) |
| **Shield** | Protection DDoS (Standard gratuit, Advanced $3000/mois) |
| **GuardDuty** | Detection de menaces (analyse logs en continu) |
| **Security Hub** | Vue unifiee securite + conformite |
| **Config** | Conformite continue des ressources + remediation auto |
| **VPC Endpoints** | Acces aux services AWS sans Internet (Gateway/Interface) |
| **Organizations** | Gestion multi-comptes avec SCPs et OUs |
