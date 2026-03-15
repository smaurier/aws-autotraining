# Module 00 — Prérequis et vue d'ensemble AWS

> **Objectif** : Comprendre les fondamentaux du cloud computing, l'infrastructure mondiale d'AWS, et savoir naviguer dans la console et le CLI.
> **Difficulté** : ⭐⭐
> **Prérequis** : Aucun — ce module est le point de départ
> **Durée estimée** : 3 heures

---

## Table des matières

1. [Qu'est-ce que le cloud computing ?](#quest-ce-que-le-cloud-computing)
2. [Les modèles de service : IaaS, PaaS, SaaS](#les-modèles-de-service)
3. [L'infrastructure mondiale AWS](#linfrastructure-mondiale-aws)
4. [Le Free Tier AWS](#le-free-tier-aws)
5. [Créer et configurer un compte AWS](#créer-et-configurer-un-compte-aws)
6. [Navigation dans la console AWS](#navigation-dans-la-console-aws)
7. [AWS CLI : premiers pas](#aws-cli-premiers-pas)
8. [Le modèle de responsabilité partagée](#le-modèle-de-responsabilité-partagée)
9. [Facturation, budgets et Cost Explorer](#facturation-budgets-et-cost-explorer)

---

## Qu'est-ce que le cloud computing ?

### L'analogie de l'électricité

Imaginez que chaque entreprise doive construire sa propre centrale électrique pour alimenter ses bureaux. Ce serait absurde, non ? C'est pourtant exactement ce que faisaient les entreprises avec l'informatique avant le cloud : acheter des serveurs, les installer dans une salle climatisée, les entretenir, les remplacer...

Le **cloud computing**, c'est l'équivalent du réseau électrique pour l'informatique. Au lieu de posséder vos propres serveurs, vous **louez** de la puissance de calcul, du stockage et des services à un fournisseur comme AWS — exactement comme vous payez votre facture d'électricité en fonction de votre consommation.

### Définition formelle

Le cloud computing est la mise à disposition de ressources informatiques (serveurs, stockage, bases de données, réseau, logiciels) **à la demande**, via Internet, avec une **tarification à l'usage**.

### Les 5 caractéristiques essentielles (NIST)

1. **Libre-service à la demande** — Vous provisionnez des ressources sans intervention humaine du fournisseur
2. **Accès réseau large** — Accessible depuis n'importe quel appareil connecté à Internet
3. **Mise en commun des ressources** — Le fournisseur mutualise ses ressources entre tous ses clients (multi-tenant)
4. **Élasticité rapide** — Les ressources peuvent augmenter ou diminuer automatiquement selon la demande
5. **Service mesuré** — Vous payez uniquement ce que vous consommez (pay-as-you-go)

### Cloud public vs privé vs hybride

| Type | Description | Analogie |
|------|-------------|----------|
| **Public** | Ressources partagées, gérées par AWS/Azure/GCP | Prendre le bus |
| **Privé** | Infrastructure dédiée à une seule organisation | Avoir son propre chauffeur |
| **Hybride** | Combinaison des deux | Bus pour les trajets courants, chauffeur pour les occasions spéciales |

---

## Les modèles de service

### IaaS — Infrastructure as a Service

**Analogie** : Louer un terrain et construire sa maison soi-même.

Vous obtenez les briques de base : serveurs virtuels, réseau, stockage. C'est à vous de tout configurer : système d'exploitation, middleware, applications.

**Exemples AWS** : EC2 (serveurs), EBS (disques), VPC (réseau)

**Vous gérez** : OS, runtime, applications, données
**AWS gère** : Matériel physique, virtualisation, réseau physique

### PaaS — Platform as a Service

**Analogie** : Louer un appartement meublé — la structure est là, vous n'avez qu'à y mettre vos affaires.

Vous déployez votre code sans vous soucier de l'infrastructure sous-jacente. La plateforme gère le scaling, les patchs OS, etc.

**Exemples AWS** : Elastic Beanstalk, RDS, Lambda (aussi considéré FaaS)

**Vous gérez** : Code applicatif, données
**AWS gère** : Tout le reste (OS, runtime, scaling, patching)

### SaaS — Software as a Service

**Analogie** : Aller au restaurant — vous consommez un plat prêt sans cuisiner.

L'application est entièrement gérée. Vous n'avez qu'à l'utiliser.

**Exemples** : Gmail, Salesforce, Amazon WorkMail

**Vous gérez** : Vos données et la configuration utilisateur
**AWS gère** : Absolument tout le reste

### Tableau comparatif

```
                    On-Premise    IaaS    PaaS    SaaS
┌──────────────┐
│ Applications │    Vous        Vous    Vous    Provider
│ Données      │    Vous        Vous    Vous    Provider
│ Runtime      │    Vous        Vous    Provider Provider
│ Middleware   │    Vous        Vous    Provider Provider
│ OS           │    Vous        Vous    Provider Provider
│ Virtualisation│   Vous        Provider Provider Provider
│ Serveurs     │    Vous        Provider Provider Provider
│ Stockage     │    Vous        Provider Provider Provider
│ Réseau       │    Vous        Provider Provider Provider
└──────────────┘
```

---

## L'infrastructure mondiale AWS

### Régions (Regions)

Une **région** est une zone géographique contenant plusieurs data centers. En mars 2026, AWS dispose de plus de 30 régions dans le monde.

**Chaque région est identifiée par un code** :
- `eu-west-1` → Irlande
- `eu-west-3` → Paris
- `us-east-1` → Virginie du Nord (la plus ancienne, souvent la moins chère)
- `ap-southeast-1` → Singapour

**Comment choisir une région ?**

1. **Latence** — Choisissez la région la plus proche de vos utilisateurs
2. **Conformité légale** — Le RGPD peut exiger que les données restent en Europe
3. **Services disponibles** — Tous les services ne sont pas disponibles dans toutes les régions
4. **Coût** — Les prix varient d'une région à l'autre (us-east-1 est souvent la moins chère)

### Zones de disponibilité (Availability Zones — AZs)

Chaque région contient au minimum **2 AZs** (généralement 3). Une AZ est constituée d'un ou plusieurs data centers physiquement séparés mais reliés par un réseau à très faible latence.

```
Région eu-west-3 (Paris)
├── AZ eu-west-3a  ← Data center(s) dans un bâtiment
├── AZ eu-west-3b  ← Data center(s) dans un autre bâtiment (> 10 km)
└── AZ eu-west-3c  ← Data center(s) dans un troisième bâtiment
```

**Pourquoi plusieurs AZs ?** — Si un incendie, une inondation ou une panne électrique touche une AZ, les autres continuent de fonctionner. C'est le fondement de la **haute disponibilité** sur AWS.

### Points de présence (Edge Locations)

Les **edge locations** sont des mini-data centers répartis dans plus de 400 villes. Ils servent principalement à :

- **CloudFront** (CDN) — Cache du contenu au plus près des utilisateurs
- **Route 53** (DNS) — Résolution DNS rapide
- **AWS Shield** — Protection DDoS en bordure de réseau

**Analogie** : Si les régions sont des entrepôts centraux, les edge locations sont des points relais de livraison dans votre quartier.

### Carte mentale de l'infrastructure

```
AWS Global Infrastructure
│
├── Régions (30+)
│   ├── Zones de disponibilité (2-6 par région)
│   │   └── Data centers (1+ par AZ)
│   └── Local Zones (extensions urbaines)
│
├── Edge Locations (400+)
│   ├── CloudFront PoP
│   └── Route 53 PoP
│
└── AWS Outposts (extension sur site client)
```

---

## Le Free Tier AWS

AWS propose trois types d'offres gratuites :

### 1. Toujours gratuit (Always Free)

Ces services restent gratuits tant que vous ne dépassez pas les limites :

| Service | Limite gratuite |
|---------|----------------|
| Lambda | 1 million de requêtes/mois + 400 000 Go-secondes |
| DynamoDB | 25 Go de stockage + 25 unités de lecture/écriture |
| SNS | 1 million de publications/mois |
| CloudWatch | 10 métriques personnalisées + 10 alarmes |

### 2. 12 mois gratuits (après création du compte)

| Service | Limite mensuelle |
|---------|-----------------|
| EC2 | 750 heures t2.micro (ou t3.micro selon la région) |
| S3 | 5 Go de stockage standard |
| RDS | 750 heures db.t2.micro |
| EBS | 30 Go de stockage SSD (gp2) |
| Data Transfer | 15 Go sortant/mois |

### 3. Essais gratuits (limités dans le temps)

Certains services offrent un essai de 30 à 60 jours : Redshift, SageMaker, etc.

::: warning Attention aux pièges du Free Tier
- Une instance EC2 t2.micro **allumée 24/7** = ~730 heures/mois → dans la limite
- **Deux** instances t2.micro allumées 24/7 = ~1460 heures/mois → vous payez la moitié !
- Le trafic réseau **sortant** au-delà de 15 Go est facturé
- Les **Elastic IPs non attachées** coûtent de l'argent
- Les **snapshots EBS** et les **AMI personnalisées** ne sont pas gratuits
:::

---

## Créer et configurer un compte AWS

### Étapes de création

1. Allez sur [aws.amazon.com](https://aws.amazon.com) → **Créer un compte AWS**
2. Fournissez une adresse e-mail et un mot de passe
3. Choisissez un plan de support (sélectionnez **Basic — Gratuit**)
4. Entrez vos informations de facturation (carte bancaire requise même pour le Free Tier)
5. Vérifiez votre identité par SMS ou appel vocal
6. Sélectionnez le plan de support Basic (gratuit)

### Sécurisation immédiate du compte

Dès la création du compte, effectuez ces actions critiques :

1. **Activez le MFA** sur le compte root (authenticator app ou clé physique)
2. **Créez un utilisateur IAM** pour l'usage quotidien (ne jamais utiliser le root au quotidien)
3. **Configurez une alerte de facturation** (Budget > 0 $)
4. **Activez CloudTrail** pour auditer toutes les actions sur le compte

---

## Navigation dans la console AWS

### La barre de recherche

Le moyen le plus rapide de trouver un service : tapez son nom dans la barre de recherche en haut. Tapez "EC2", "S3", "Lambda" pour accéder directement au service.

### Le sélecteur de région

En haut à droite de la console, le sélecteur de région est **critique**. Si vous créez une instance EC2 en `us-east-1` mais que vous cherchez ensuite en `eu-west-3`, vous ne la trouverez pas.

::: tip Astuce
Certains services sont **globaux** (non liés à une région) : IAM, Route 53, CloudFront, WAF, Organizations. Pour ceux-ci, la région n'a pas d'importance.
:::

### Le tableau de bord

- **Recently visited** — Vos services récemment utilisés
- **Favorites** — Épinglez vos services les plus fréquents (cliquez sur l'étoile)
- **Health Dashboard** — État de santé des services AWS

---

## AWS CLI : premiers pas

### Installation

```bash
# macOS (via Homebrew)
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Windows (via MSI installer)
# Téléchargez depuis https://awscli.amazonaws.com/AWSCLIV2.msi

# Vérification
aws --version
# aws-cli/2.x.x Python/3.x.x ...
```

### Configuration

```bash
aws configure
# AWS Access Key ID [None]: AKIA...
# AWS Secret Access Key [None]: wJal...
# Default region name [None]: eu-west-3
# Default output format [None]: json
```

Les credentials sont stockés dans `~/.aws/credentials` et la config dans `~/.aws/config`.

### Profils nommés

Pour gérer plusieurs comptes :

```bash
aws configure --profile dev
aws configure --profile prod

# Utilisation
aws s3 ls --profile dev
aws ec2 describe-instances --profile prod

# Ou via variable d'environnement
export AWS_PROFILE=dev
```

### Commandes de base

```bash
# Lister les buckets S3
aws s3 ls

# Lister les instances EC2
aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceId'

# Obtenir l'identité du caller (qui suis-je ?)
aws sts get-caller-identity

# Format de sortie
aws ec2 describe-regions --output table
aws ec2 describe-regions --output json
aws ec2 describe-regions --output yaml
```

---

## Le modèle de responsabilité partagée

C'est l'un des concepts les plus importants d'AWS (et très présent à l'examen de certification).

### Le principe

AWS et le client se partagent la responsabilité de la sécurité :

- **AWS est responsable de la sécurité DU cloud** — l'infrastructure physique
- **Le client est responsable de la sécurité DANS le cloud** — ce qu'il y met et comment il le configure

### Répartition détaillée

```
┌─────────────────────────────────────────────────────────┐
│              RESPONSABILITÉ DU CLIENT                    │
│                                                         │
│  Données client                                         │
│  Chiffrement côté client & intégrité des données       │
│  Configuration réseau & pare-feu (Security Groups)      │
│  Gestion des identités et accès (IAM)                  │
│  Système d'exploitation, patchs, mises à jour          │
│  Configuration des applications                         │
├─────────────────────────────────────────────────────────┤
│              RESPONSABILITÉ D'AWS                        │
│                                                         │
│  Logiciel : Compute, Storage, Database, Networking      │
│  Infrastructure matérielle/réseau mondial               │
│  Régions, AZs, Edge Locations                          │
│  Sécurité physique des data centers                    │
└─────────────────────────────────────────────────────────┘
```

### Exemples concrets

| Scénario | Responsable |
|----------|-------------|
| Un serveur physique tombe en panne | **AWS** |
| Un groupe de sécurité laisse le port 22 ouvert au monde | **Client** |
| Une faille dans l'hyperviseur | **AWS** |
| Un bucket S3 est public par erreur | **Client** |
| Le data center est inondé | **AWS** |
| Les données ne sont pas chiffrées | **Client** |
| Le câble réseau entre deux AZs est coupé | **AWS** |
| Le mot de passe root n'a pas de MFA | **Client** |

### Ça varie selon le service

Pour un service **managé** comme RDS, AWS gère le patching de l'OS et du moteur de base de données. Pour EC2, c'est **vous** qui devez patcher l'OS.

Plus un service est managé (Lambda > Fargate > ECS sur EC2 > EC2 brut), moins le client a de responsabilités.

---

## Facturation, budgets et Cost Explorer

### Comprendre la facturation AWS

La facturation AWS repose sur trois piliers :

1. **Compute** — Temps d'exécution (EC2, Lambda, etc.)
2. **Storage** — Volume de données stockées (S3, EBS, etc.)
3. **Data Transfer** — Trafic réseau sortant (le trafic entrant est généralement gratuit)

::: tip Règle d'or du réseau AWS
- Trafic **entrant** → gratuit
- Trafic **dans la même AZ** → gratuit
- Trafic **entre AZs** → payant (faible coût)
- Trafic **entre régions** → payant
- Trafic **sortant vers Internet** → payant
:::

### AWS Budgets

Créez des alertes pour ne jamais être surpris par une facture :

1. Console AWS → **Billing** → **Budgets**
2. Créez un budget de type **Cost budget**
3. Définissez un montant (ex : 10 $/mois)
4. Configurez des alertes à 50%, 80% et 100% du budget
5. Recevez les alertes par e-mail ou SNS

### AWS Cost Explorer

Cost Explorer vous permet d'analyser vos coûts :

- **Visualisation** — Graphiques de coûts sur 12 mois
- **Filtres** — Par service, par région, par tag
- **Prévisions** — Estimation du coût à venir
- **Recommandations** — Suggestions d'économies (Reserved Instances, Savings Plans)

### AWS Pricing Calculator

Avant de déployer, estimez vos coûts avec le [AWS Pricing Calculator](https://calculator.aws/) :

1. Sélectionnez les services que vous comptez utiliser
2. Configurez les paramètres (type d'instance, stockage, trafic)
3. Obtenez une estimation mensuelle

### Tags pour le suivi des coûts

Les **tags** sont des paires clé-valeur que vous attachez à vos ressources :

```
Environment: production
Team: backend
Project: e-commerce
CostCenter: CC-1234
```

Activez les **Cost Allocation Tags** dans la console Billing pour pouvoir filtrer les coûts par tag dans Cost Explorer.

---

## Résumé du module

| Concept | Points clés |
|---------|-------------|
| Cloud Computing | Ressources à la demande, pay-as-you-go |
| IaaS/PaaS/SaaS | Du plus de contrôle au plus managé |
| Régions & AZs | Choix basé sur latence, conformité, coût |
| Free Tier | 3 types : toujours gratuit, 12 mois, essais |
| AWS CLI | `aws configure`, profils nommés, commandes `aws <service> <action>` |
| Responsabilité partagée | AWS = sécurité DU cloud, Client = sécurité DANS le cloud |
| Facturation | Compute + Storage + Data Transfer, budgets, Cost Explorer |

---

## Pour aller plus loin

- [Documentation officielle AWS — Getting Started](https://docs.aws.amazon.com/getting-started/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [AWS Pricing Calculator](https://calculator.aws/)
- [AWS Free Tier](https://aws.amazon.com/free/)
