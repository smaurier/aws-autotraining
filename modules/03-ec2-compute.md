# Module 03 — EC2 : Compute

> **Objectif** : Maîtriser le service de calcul EC2 : types d'instances, images, stockage, mise à l'échelle automatique, et optimiser les coûts avec les différents modèles de tarification.
> **Difficulté** : ⭐⭐⭐
> **Prérequis** : Module 02
> **Durée estimée** : 5 heures

---

## Table des matières

1. [Qu'est-ce qu'EC2 ?](#quest-ce-quec2)
2. [Types d'instances et familles](#types-dinstances-et-familles)
3. [AMI — Amazon Machine Images](#ami)
4. [User Data](#user-data)
5. [Key Pairs et connexion SSH](#key-pairs-et-connexion-ssh)
6. [Volumes EBS](#volumes-ebs)
7. [Instance Store](#instance-store)
8. [Elastic IP](#elastic-ip)
9. [Placement Groups](#placement-groups)
10. [Launch Templates](#launch-templates)
11. [Auto Scaling Groups](#auto-scaling-groups)
12. [Modèles de tarification](#modèles-de-tarification)
13. [Bonnes pratiques](#bonnes-pratiques)

---

## Qu'est-ce qu'EC2 ?

**EC2** (Elastic Compute Cloud) est le service de machines virtuelles d'AWS. Chaque machine virtuelle est appelée une **instance**.

### Caractéristiques clés

- Démarrage en secondes (vs semaines pour du bare metal)
- Taille ajustable (scale up/down)
- Paiement à la seconde (minimum 60 secondes)
- Contrôle total sur l'OS (root/admin)

---

## Types d'instances et familles

Le nom d'une instance suit le format : **[famille][génération].[taille]**

```
t3.large
│ │  │
│ │  └── Taille : nano, micro, small, medium, large, xlarge, 2xlarge...
│ └── Génération : 3ème génération
└── Famille : T (burstable)
```

### Familles d'instances

| Famille | Catégorie | Usage | Exemple |
|---------|-----------|-------|---------|
| **T** | Usage général (burstable) | Dev, tests, petites apps | t3.micro, t3.medium |
| **M** | Usage général (stable) | Applications, backends | m7i.large, m7g.xlarge |
| **C** | Optimisé calcul | Batch, ML, encodage | c7i.2xlarge |
| **R** | Optimisé mémoire | Caches, bases in-memory | r7i.4xlarge |
| **I** | Optimisé stockage | NoSQL, data warehousing | i4i.large |
| **G/P** | Accéléré (GPU) | ML training, rendu 3D | g5.xlarge, p5.48xlarge |
| **HPC** | High Performance Compute | Simulations scientifiques | hpc7g.16xlarge |

### Le système de crédits des instances T (burstable)

Les instances T accumulent des **crédits CPU** quand elles sont sous leur baseline. Quand elles ont besoin de plus de CPU, elles consomment ces crédits.

```
Baseline CPU :
  t3.micro  → 10% (2 vCPU × 10% = 0,2 vCPU en continu)
  t3.small  → 20%
  t3.medium → 20%
  t3.large  → 30%
```

**Mode Unlimited** : l'instance peut dépasser sa baseline même sans crédits (facturation supplémentaire).

### Suffixes courants

| Suffixe | Signification |
|---------|--------------|
| `g` | Processeur Graviton (ARM) — meilleur rapport prix/performance |
| `a` | Processeur AMD — moins cher |
| `i` | Processeur Intel |
| `d` | Stockage NVMe local inclus |
| `n` | Réseau amélioré |
| `z` | Haute fréquence |

Exemple : `m7g.large` = usage général, 7ème génération, processeur Graviton

---

## AMI

Une **AMI** (Amazon Machine Image) est un modèle qui contient le système d'exploitation, les logiciels préinstallés et la configuration pour lancer une instance.

### Sources d'AMI

| Source | Description |
|--------|------------|
| AWS | Amazon Linux, Ubuntu, Windows Server, etc. |
| Marketplace | AMIs commerciales (avec ou sans licence) |
| Communauté | AMIs partagées publiquement |
| Custom | Vos propres AMIs personnalisées |

### Créer une AMI personnalisée

```bash
# Créer l'AMI depuis une instance existante
aws ec2 create-image \
  --instance-id i-0abc123 \
  --name "app-server-v2.1.0" \
  --description "Application server with Node.js 20 and PM2" \
  --no-reboot
```

### Cycle de vie recommandé

```
Instance de base → Configuration → Test → Créer AMI → Déployer
                                            │
                                    Golden AMI (image de référence)
```

**Important** : une AMI est **régionale**. Pour l'utiliser dans une autre région, il faut la copier.

---

## User Data

Le **User Data** est un script exécuté automatiquement au **premier démarrage** de l'instance (en tant que root). Il permet d'automatiser la configuration initiale.

```bash
# Script User Data typique (encodé en base64 automatiquement par la CLI)
aws ec2 run-instances \
  --image-id ami-0abc123 \
  --instance-type t3.small \
  --user-data file://setup.sh \
  --key-name ma-cle \
  --security-group-ids sg-0abc123 \
  --subnet-id subnet-0abc123
```

### User Data vs AMI personnalisée

| Approche | Temps de démarrage | Complexité | Quand l'utiliser |
|----------|-------------------|------------|------------------|
| User Data | Lent (minutes) | Script bash | Prototypage, configurations légères |
| AMI personnalisée | Rapide (secondes) | Build pipeline | Production, Auto Scaling |
| Hybride | Moyen | AMI + User Data léger | AMI de base + config dynamique |

---

## Key Pairs et connexion SSH

Une **Key Pair** est une paire de clés cryptographiques (publique/privée) pour se connecter aux instances Linux via SSH.

```bash
# Créer une Key Pair
aws ec2 create-key-pair \
  --key-name prod-key-2026 \
  --key-type ed25519 \
  --query 'KeyMaterial' \
  --output text > prod-key-2026.pem

# Définir les permissions (Linux/Mac)
chmod 400 prod-key-2026.pem

# Se connecter à l'instance
ssh -i prod-key-2026.pem ec2-user@<ip-publique>
```

### Alternative moderne : SSM Session Manager

```bash
aws ssm start-session --target i-0abc123
```

SSM Session Manager est **recommandé** en production : pas de port SSH ouvert, audit via CloudTrail, pas de gestion de clés.

---

## Volumes EBS

**EBS** (Elastic Block Store) fournit des volumes de stockage persistant attachés aux instances EC2. C'est le disque dur de votre instance.

### Types de volumes EBS

| Type | IOPS max | Débit max | Cas d'usage | Coût relatif |
|------|----------|-----------|-------------|-------------|
| **gp3** | 16 000 | 1 000 Mo/s | Usage général, boot volumes | $ |
| **gp2** | 16 000 | 250 Mo/s | Ancien usage général (préférer gp3) | $ |
| **io2** | 256 000 | 4 000 Mo/s | Bases de données critiques | $$$$ |
| **io2 Block Express** | 256 000 | 4 000 Mo/s | Charges SAP HANA, Oracle | $$$$$ |
| **st1** | 500 | 500 Mo/s | Big data, logs, streaming | ¢ |
| **sc1** | 250 | 250 Mo/s | Archivage, accès rare | ¢¢ |

### gp3 : le choix par défaut

**gp3 est 20% moins cher que gp2** et offre des performances de base meilleures pour les petits volumes. Les IOPS et le débit sont configurables indépendamment de la taille du volume.

### Snapshots EBS

```bash
# Créer un snapshot
aws ec2 create-snapshot \
  --volume-id vol-0abc123 \
  --description "Backup before migration v2.1" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=pre-migration}]'
```

On peut restaurer un volume depuis un snapshot ou le copier vers une autre region pour le DR.

### Chiffrement EBS

- Le chiffrement utilise **AWS KMS** (AES-256)
- Activez le chiffrement par défaut au niveau du compte :

```bash
aws ec2 enable-ebs-encryption-by-default
```

- Un volume non chiffré ne peut pas être chiffré directement → créer un snapshot, copier avec chiffrement, créer un nouveau volume

---

## Instance Store

Le **Instance Store** est un stockage éphémère physiquement attaché à l'hôte de l'instance. Contrairement à EBS, les données sont **perdues** quand l'instance est arrêtée ou terminée.

| Caractéristique | EBS | Instance Store |
|-----------------|-----|---------------|
| Persistance | Oui | Non (éphémère) |
| Performance | Jusqu'à 256K IOPS | Jusqu'à millions d'IOPS |
| Détachable | Oui | Non |
| Snapshots | Oui | Non |
| Cas d'usage | Données persistantes | Cache, fichiers temporaires, buffers |

**Règle** : ne mettez **jamais** de données importantes sur un Instance Store sans réplication.

---

## Elastic IP

Une **Elastic IP** est une adresse IPv4 statique publique que vous pouvez allouer et associer à une instance.

### Règles de tarification

- **Gratuit** tant qu'elle est associée à une instance **en cours d'exécution**
- **Facturée** (~0,005 $/h) si elle est allouée mais **non associée** ou associée à une instance **arrêtée**
- Limite de 5 Elastic IPs par région (augmentable)

**Bonne pratique** : utilisez un **Load Balancer** ou un **nom DNS** plutôt qu'une Elastic IP quand possible.

---

## Placement Groups

Les **Placement Groups** contrôlent comment les instances sont placées sur le matériel physique.

### Trois stratégies

| Stratégie | Comportement | Cas d'usage |
|-----------|-------------|-------------|
| **Cluster** | Toutes les instances dans le même rack | HPC, faible latence réseau |
| **Spread** | Instances sur des racks physiques différents | Haute disponibilité critique |
| **Partition** | Groupes d'instances sur des racks séparés | Hadoop, Cassandra, Kafka |

### Spread : maximum 7 instances par AZ

```
AZ-a: [Instance 1] [Instance 2] ... [Instance 7]  ← chacune sur un rack différent
AZ-b: [Instance 8] [Instance 9] ... [Instance 14]
```

---

## Launch Templates

Un **Launch Template** centralise la configuration de lancement d'une instance. Il est utilisé par les Auto Scaling Groups, EC2 Fleet, et Spot Fleet.

Un Launch Template regroupe : AMI, type d'instance, key pair, security groups, user data, configuration EBS (volume type, taille, chiffrement), et tags.

Les Launch Templates supportent le **versioning** : créez de nouvelles versions et définissez la version par défaut ou `$Latest` pour l'ASG.

---

## Auto Scaling Groups

Un **Auto Scaling Group** (ASG) gère automatiquement le nombre d'instances EC2 en fonction de la charge.

### Composants

```
Launch Template → Auto Scaling Group → Instances EC2
                       │
                  Scaling Policies (règles de mise à l'échelle)
                       │
                  CloudWatch Alarms (métriques de déclenchement)
```

### Création d'un ASG

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name web-asg \
  --launch-template LaunchTemplateName=web-server-template,Version='$Latest' \
  --min-size 2 \
  --max-size 10 \
  --desired-capacity 3 \
  --vpc-zone-identifier "subnet-0abc123-a,subnet-0abc123-b,subnet-0abc123-c" \
  --target-group-arns "arn:aws:elasticloadbalancing:eu-west-3:123456789012:targetgroup/web-tg/abc123" \
  --health-check-type ELB \
  --health-check-grace-period 300 \
  --tags "Key=Environment,Value=production,PropagateAtLaunch=true"
```

### Politiques de mise à l'échelle

#### Target Tracking (recommandé)

```bash
# Maintenir le CPU moyen à 50%
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name web-asg \
  --policy-name cpu-target-50 \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "TargetValue": 50.0
  }'
```

Autres politiques disponibles : **Step Scaling** (ajustements par paliers selon l'écart à un seuil) et **Scheduled Scaling** (cron pour augmenter/réduire la capacité à heures fixes).

---

## Modèles de tarification

### Comparaison des options

| Modèle | Réduction | Engagement | Interruption | Cas d'usage |
|--------|-----------|------------|-------------|-------------|
| **On-Demand** | 0% (référence) | Aucun | Non | Dev, tests, charges imprévisibles |
| **Reserved (1 an)** | ~40% | 1 an | Non | Charges stables et prévisibles |
| **Reserved (3 ans)** | ~60% | 3 ans | Non | Charges stables long terme |
| **Savings Plans** | Jusqu'à 72% | 1 ou 3 ans | Non | Flexible (famille/région) |
| **Spot** | Jusqu'à 90% | Aucun | **Oui (2 min)** | Batch, CI/CD, tolérant aux pannes |

### On-Demand

Paiement à la seconde (Linux) ou à l'heure (Windows). Aucun engagement. C'est le modèle par défaut.

### Reserved Instances

Trois options de paiement : **All Upfront** (~62% de réduction), **Partial Upfront** (~55%), **No Upfront** (~40%).

### Spot Instances

Les Spot Instances se lancent via `--instance-market-options` avec un `MaxPrice` et un `SpotInstanceType` (`one-time` ou `persistent`). AWS envoie une notification **2 minutes** avant l'interruption.

### Savings Plans

| Type | Flexibilité | Réduction |
|------|------------|-----------|
| Compute Savings Plans | Famille, taille, OS, région | Jusqu'à 66% |
| EC2 Instance Savings Plans | Taille, OS dans une famille/région | Jusqu'à 72% |

### Stratégie de coûts optimale

```
Charge de base stable (24/7)        → Reserved Instances ou Savings Plans
Charge variable prévisible           → Scheduled Scaling + On-Demand
Charge variable imprévisible         → Auto Scaling + On-Demand
Tâches tolérantes aux interruptions  → Spot Instances
```

---

## Bonnes pratiques

### Checklist EC2

1. **Sécurité**
   - [ ] Utiliser SSM Session Manager au lieu de SSH (pas de port 22)
   - [ ] Rôles IAM plutôt que clés d'accès sur les instances
   - [ ] Chiffrement EBS activé par défaut
   - [ ] IMDSv2 obligatoire (protection contre SSRF)

2. **Performance**
   - [ ] Choisir la bonne famille d'instance pour le workload
   - [ ] Graviton (suffix `g`) pour un meilleur rapport prix/perf
   - [ ] gp3 plutôt que gp2 pour les volumes EBS

3. **Disponibilité**
   - [ ] Déployer dans au moins 2 AZ
   - [ ] Auto Scaling Group avec health checks ELB
   - [ ] Golden AMI pour un démarrage rapide

4. **Coûts**
   - [ ] Reserved/Savings Plans pour la charge de base
   - [ ] Spot pour le batch et les tâches tolérantes
   - [ ] Right-sizing : utiliser AWS Compute Optimizer
   - [ ] Éteindre les instances de dev/test la nuit

---

## Résumé du module

| Concept | Points clés |
|---------|-------------|
| Familles | T (burstable), M (général), C (calcul), R (mémoire), I (stockage), G/P (GPU) |
| AMI | Image de base, régionale, Golden AMI pour la production |
| User Data | Script au premier démarrage, combiné avec AMI en prod |
| EBS | gp3 par défaut, io2 pour les BDD critiques, chiffrement obligatoire |
| Instance Store | Éphémère, ultra-rapide, pour cache/temp uniquement |
| Auto Scaling | Target Tracking recommandé, min 2 AZ |
| Pricing | Reserved/Savings Plans (base) + On-Demand (variable) + Spot (tolérant) |

