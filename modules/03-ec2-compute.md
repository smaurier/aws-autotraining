---
titre: "EC2 : le compute à la demande"
cours: 12-aws-cloud
notions: ["instance EC2", "AMI (Amazon Machine Image)", "familles et types d'instances", "instances burstable T (crédits CPU)", "volumes EBS (gp3, io2, st1, sc1)", "key pair SSH", "user-data (cloud-init)", "Elastic IP", "modèles de tarification (On-Demand, Reserved, Spot, Savings Plans)", "Auto Scaling Group (survol)"]
outcomes:
  - "sait lire un nom de type d'instance (famille, génération, suffixe, taille) et choisir une famille selon le workload"
  - "sait lancer une instance EC2 (Console + CLI) avec AMI, key pair, security group et user-data"
  - "sait distinguer EBS (persistant) d'instance store (éphémère) et choisir le bon type de volume"
  - "sait comparer On-Demand, Reserved, Savings Plans et Spot, et rester dans le Free Tier"
  - "sait arrêter/terminer une instance et faire le ménage pour ne pas être facturé"
prerequis: ["Modules 00-02 du cours 12-aws-cloud (compte + CLI, IAM rôles/policies, VPC/subnets/security groups)"]
next: 04-s3-stockage-objets
libs: []
tribuzen: infra compute TribuZen — serveur WebSocket de présence temps réel (connexions longues) hébergé sur EC2
last-reviewed: 2026-07
---

# EC2 : le compute à la demande

> **Outcomes — tu sauras FAIRE :** lire un type d'instance et choisir une famille, lancer une instance (Console + CLI) avec user-data, distinguer EBS/instance store, comparer les modèles de prix, et faire le teardown pour ne pas payer.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **EC2 uniquement** — instances, AMI, EBS, key pairs, user-data, Elastic IP, pricing, et un **survol** d'Auto Scaling. Les conteneurs managés (**ECS/Fargate**) sont le **module 12**, le **serverless** (Lambda) est le **module 06**. On ne fait ici que du compute « machine virtuelle que tu administres ».

## 1. Cas concret d'abord

TribuZen a besoin d'un **indicateur de présence temps réel** : voir en direct quels membres d'une famille sont en ligne. Ça implique des **connexions WebSocket longues** (des heures) — un cas où une fonction Lambda (limitée à 15 min, sans état de connexion) n'est pas le bon outil. Il faut un **serveur qui tourne en continu**.

Ton job : mettre en ligne un petit serveur Node WebSocket sur une instance EC2, **sans te connecter en SSH pour l'installer à la main**. L'instance doit, à son premier démarrage, installer Node, récupérer le code et lancer le serveur toute seule.

Un collègue te lance la commande suivante et te demande « pourquoi ça coûte de l'argent alors que je n'ai rien lancé ? » :

```bash
# Il a "juste testé" la semaine dernière puis fermé son laptop
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query "Reservations[].Instances[].[InstanceId,InstanceType,LaunchTime]" \
  --output table
# → une instance t3.large tourne depuis 6 jours. Personne ne s'en sert.
```

Trois choses à comprendre pour résoudre ça :
1. **Une instance `running` est facturée à la seconde**, qu'on l'utilise ou non. « Fermer son laptop » n'arrête pas l'instance dans le cloud.
2. **Le bon type** : un serveur WebSocket de démo n'a besoin ni de 8 Go de RAM ni de `t3.large`. Un `t3.micro` (Free Tier) suffit.
3. **L'automatisation du setup** passe par le **user-data**, pas par du SSH manuel.

Ce module te donne les outils pour lancer proprement l'instance, choisir sa taille, et **la détruire** quand tu as fini.

---

## 2. Théorie complète, concise

### 2.1 Qu'est-ce qu'une instance EC2

**EC2** (Elastic Compute Cloud) fournit des **machines virtuelles** à la demande. Une VM = une **instance**. Tu as le contrôle total de l'OS (root/admin), tu paies **à la seconde** (Linux, minimum 60 s), et tu peux démarrer/arrêter/redimensionner en quelques secondes.

Cycle de vie d'une instance :

```
pending → running → stopping → stopped → (start) → running
                              → shutting-down → terminated (définitif)
```

- **stopped** : l'instance ne tourne plus, tu ne paies **plus le compute** — mais tu paies toujours le **volume EBS** attaché et l'**Elastic IP** si tu en as une non associée. Redémarrable.
- **terminated** : suppression **définitive**. Le volume racine EBS est supprimé par défaut (`DeleteOnTermination=true`).

### 2.2 Lire un type d'instance

Le nom suit le format **`famille` + `génération` + `suffixes` + `.` + `taille`**. AWS documente ce nommage par : *famille d'instance, génération, famille de processeur, capacités, taille*.

```
t3.micro          m7g.large         c7gn.2xlarge
│ │ │             │ │  │            │ │  │  │
│ │ └ taille      │ │  └ taille     │ │  │  └ taille
│ └ génération 3  │ └ génération 7  │ │  └ suffixes: g=Graviton, n=réseau amélioré
└ famille T       └ famille M       │ └ génération 7
  (burstable)       (Graviton ARM)  └ famille C (compute)
```

**Familles** (catégories confirmées dans la doc EC2) :

| Catégorie | Familles | Usage typique |
|-----------|----------|---------------|
| Usage général | **M** (stable), **T** (burstable) | backends, apps web, dev/test |
| Compute optimisé | **C** | batch CPU, encodage, calcul |
| Mémoire optimisée | **R**, **X**, **z**, **U** | caches, bases in-memory, SAP HANA |
| Stockage optimisé | **I**, **D**, **Im**, **Is** | NoSQL, data warehouse, gros I/O disque |
| Accéléré (GPU/ML) | **P**, **G**, **Inf**, **Trn**, **F** | training/inférence ML, rendu 3D |
| HPC | **Hpc** | simulations scientifiques |

**Suffixes de processeur/capacité** (se lisent après la génération) : `g` = AWS **Graviton** (ARM, meilleur prix/perf), `a` = **AMD**, `i` = **Intel**, `d` = stockage **NVMe local** inclus, `n` = **réseau** amélioré. Ex. `m7g.large` = usage général, gén. 7, Graviton, taille large.

### 2.3 Les instances burstable (famille T)

Les instances **T** (t3, t3a, t4g…) ont une **baseline CPU** basse et accumulent des **crédits CPU** quand elles tournent sous cette baseline. Quand la charge monte, elles **consomment** ces crédits pour « burster » au-dessus de la baseline. Idéal pour des charges **majoritairement au repos avec des pics courts** (petit backend, dev, démo) — c'est le cas de notre serveur WebSocket.

En mode **`unlimited`** (par défaut sur t3), l'instance peut dépasser sa baseline même sans crédits, moyennant une **facturation supplémentaire** si le CPU reste haut longtemps. Piège budget classique : un `t3.micro` en boucle CPU à 100 % 24/7 coûte plus que son prix « affiché ».

### 2.4 AMI — Amazon Machine Image

Une **AMI** est le **modèle** (OS + logiciels préinstallés + config) à partir duquel une instance est lancée. Sources : AMIs AWS (Amazon Linux 2023, Ubuntu, Windows Server…), Marketplace, communauté, ou tes **AMIs personnalisées**.

Deux propriétés à retenir :
- Une AMI est **régionale** — pour l'utiliser ailleurs, il faut la **copier** dans l'autre région.
- La **Golden AMI** = une image que tu as pré-configurée (Node, agent, dépendances déjà installés) → démarrage **rapide**, reproductible, idéale pour l'Auto Scaling.

```bash
# Créer une AMI depuis une instance déjà configurée
aws ec2 create-image \
  --instance-id i-0abc123 \
  --name "tribuzen-ws-server-v1" \
  --description "Node 20 + serveur WebSocket TribuZen"
```

### 2.5 User-data : automatiser le premier démarrage

Le **user-data** est un script (ou des directives **cloud-init**) exécuté **automatiquement** par l'instance. Faits vérifiés dans la doc EC2 :

- Sur Linux, un script user-data doit **commencer par un shebang** (`#!/bin/bash`).
- Il s'exécute **en tant que root** — pas de `sudo` dans le script.
- Par défaut, il ne tourne **qu'une fois**, au **premier boot** (pas aux reboots suivants).
- Il est **limité à 16 Ko** (forme brute, avant encodage base64).
- Il doit être **base64-encodé** — mais la CLI (`aws ec2 run-instances --user-data`) le fait **pour toi** si tu passes un fichier.
- Log de sortie sur l'instance : `/var/log/cloud-init-output.log` (pour debugger).
- On peut le récupérer via l'**IMDS** : `http://169.254.169.254/latest/user-data`.

```bash
#!/bin/bash
# setup.sh — installe Node et lance le serveur WebSocket au premier boot
dnf update -y
dnf install -y nodejs git
git clone https://github.com/tribuzen/ws-presence.git /opt/ws
cd /opt/ws && npm ci
node server.js
```

> **User-data vs Golden AMI** : le user-data configure à chaque lancement (lent mais souple, bon pour prototyper) ; l'AMI personnalisée embarque déjà tout (rapide, reproductible, meilleur pour la prod et l'Auto Scaling). En pratique on combine : AMI de base + user-data léger pour la config dynamique.

### 2.6 Key pairs et connexion

Une **key pair** est une paire de clés (publique/privée) pour se connecter en **SSH** à une instance Linux. AWS garde la clé **publique**, toi la clé **privée** (fichier `.pem`, à ne jamais committer).

```bash
aws ec2 create-key-pair --key-name tribuzen-key --key-type ed25519 \
  --query 'KeyMaterial' --output text > tribuzen-key.pem
chmod 400 tribuzen-key.pem                       # Linux/Mac
ssh -i tribuzen-key.pem ec2-user@<ip-publique>   # ec2-user = user par défaut sur Amazon Linux
```

**Alternative recommandée en prod : SSM Session Manager** (`aws ssm start-session --target i-0abc123`) — pas de port 22 ouvert, pas de clé à gérer, audit via CloudTrail. À privilégier dès que l'instance a le rôle IAM adéquat.

### 2.7 Stockage : EBS vs instance store

**EBS** (Elastic Block Store) = volume de stockage **persistant** attaché via le réseau — le « disque dur » de l'instance. Il **survit** à un `stop` et peut être détaché/réattaché, snapshoté, chiffré (via KMS).

Types de volumes EBS (chiffres **max par volume**, vérifiés dans la doc EBS) :

| Type | Catégorie | IOPS max | Débit max | Cas d'usage |
|------|-----------|----------|-----------|-------------|
| **gp3** | SSD | 80 000 | 2 000 MiB/s | Défaut usage général, volumes de boot |
| **gp2** | SSD (ancien) | 16 000 | 250 MiB/s | Ancien usage général → préférer gp3 |
| **io2 Block Express** | SSD | 256 000 | 4 000 MiB/s | BDD critiques (99,999 % durabilité) |
| **io1** | SSD | 64 000 | 1 000 MiB/s | BDD à IOPS provisionnées |
| **st1** | HDD | 500 | 500 MiB/s | Big data, logs, streaming (débit) |
| **sc1** | HDD | 250 | 250 MiB/s | Archivage, accès rare (le moins cher) |

**gp3 est le choix par défaut** : IOPS et débit se règlent **indépendamment** de la taille, et il est moins cher que gp2 à performance égale.

L'**instance store** est un stockage **éphémère** physiquement attaché à l'hôte : très rapide, mais les données sont **perdues** au `stop` ou au `terminate`. À réserver aux caches et fichiers temporaires — **jamais** de données importantes dessus.

### 2.8 Elastic IP

Une **Elastic IP** est une IPv4 publique **statique** que tu alloues à ton compte et associes à une instance. Règle de facturation à connaître : elle est **facturée quand elle n'est pas utilisée** (allouée mais non associée, ou associée à une instance arrêtée). En pratique, préfère un **Load Balancer** ou un **nom DNS** ; ne garde pas une Elastic IP « au cas où ».

### 2.9 Modèles de tarification

Options d'achat EC2 (confirmées dans la doc « billing and purchasing options ») :

| Modèle | Engagement | Interruption possible | Cas d'usage |
|--------|------------|----------------------|-------------|
| **On-Demand** | aucun, paiement à la seconde | non | dev, tests, charge imprévisible (défaut) |
| **Reserved Instances** | config d'instance fixe, **1 ou 3 ans** | non | charge stable et prévisible |
| **Savings Plans** | montant $/h fixe, **1 ou 3 ans** | non | charge stable, plus **flexible** que Reserved |
| **Spot** | aucun | **oui** (capacité reprise par AWS) | batch, CI/CD, tâches tolérantes aux pannes |

- **On-Demand** : le plus cher, zéro engagement — le défaut.
- **Reserved / Savings Plans** : réductions importantes contre un engagement 1 ou 3 ans, pour la **charge de base 24/7**. (La doc n'affiche pas de pourcentage fixe — les chiffres varient par famille/région ; voir la page pricing pour un devis exact.)
- **Spot** : capacité EC2 inutilisée à **forte réduction**. AWS peut **reprendre** l'instance à tout moment ; selon le comportement configuré, elle est alors **terminée, arrêtée (stop) ou mise en hibernation**. AWS émet un **avis d'interruption Spot deux minutes** avant (plus une *rebalance recommendation*). Jamais pour un service stateful qui doit rester up.

### 2.10 Auto Scaling Group — survol

Un **Auto Scaling Group** (ASG) ajuste **automatiquement** le nombre d'instances selon la charge. On le mentionne ici ; le détail (politiques, health checks, intégration Load Balancer) dépasse ce module.

```
Launch Template (AMI + type + user-data + SG)
        │
   Auto Scaling Group  ──►  N instances EC2 réparties sur ≥ 2 AZ
        │
   Scaling policy (ex. Target Tracking : garder le CPU moyen à 50 %)
```

Idée clé : au lieu d'une instance unique fragile, l'ASG maintient un **nombre désiré** d'instances, en **remplace** une qui tombe, et **scale** entre `min` et `max` selon une métrique CloudWatch.

---

## 3. Worked examples

### Exemple 1 — Lancer le serveur WebSocket TribuZen en CLI (avec user-data)

On reprend le cas concret : lancer un `t3.micro` (Free Tier) qui s'auto-configure.

```bash
# 1) Écrire le script user-data dans un fichier local
cat > setup.sh <<'EOF'
#!/bin/bash
dnf update -y
dnf install -y nodejs git
git clone https://github.com/tribuzen/ws-presence.git /opt/ws
cd /opt/ws && npm ci && node server.js
EOF

# 2) Lancer l'instance
#    --instance-type t3.micro  → éligible Free Tier (voir §5)
#    --user-data file://setup.sh → la CLI base64-encode pour toi
#    --security-group-ids       → un SG du module 02, ouvrant le port du serveur WS
aws ec2 run-instances \
  --image-id ami-0abcd1234efgh5678 \
  --instance-type t3.micro \
  --key-name tribuzen-key \
  --security-group-ids sg-0abc123 \
  --subnet-id subnet-0abc123 \
  --user-data file://setup.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tribuzen-ws}]' \
  --count 1
```

Ce qui se passe :
1. AWS provisionne un `t3.micro` depuis l'AMI Amazon Linux 2023.
2. Au **premier boot**, cloud-init exécute `setup.sh` **en tant que root** : Node s'installe, le repo est cloné, le serveur démarre.
3. Si ça ne marche pas, tu te connectes et tu lis `/var/log/cloud-init-output.log` — c'est **le** premier réflexe de debug user-data.

> **Vérifier sans SSH** : `curl http://169.254.169.254/latest/user-data` **depuis l'instance** renvoie le script tel qu'AWS l'a reçu — utile pour confirmer qu'il a bien été passé.

### Exemple 2 — Choisir le type et éviter la sur-facturation

Le collègue du §1 tournait sur `t3.large` (2 vCPU, 8 Go) pour un serveur de démo. Raisonnement de right-sizing :

```
Besoin réel : quelques connexions WS, ~200 Mo de RAM, CPU quasi idle.
→ Famille : T (burstable) — charge au repos avec pics courts = crédits CPU suffisants.
→ Taille  : micro (1 Go) largement assez pour une démo.
→ Verdict : t3.micro (Free Tier) au lieu de t3.large.
```

Et pour arrêter l'hémorragie de son instance oubliée :

```bash
# Arrêter (stop) : garde le volume EBS, redémarrable, ne facture plus le compute
aws ec2 stop-instances --instance-ids i-0abc123

# Ou terminer (terminate) : suppression définitive + volume racine supprimé par défaut
aws ec2 terminate-instances --instance-ids i-0abc123
```

**Règle** : `stop` si tu comptes reprendre demain (tu paies encore l'EBS) ; `terminate` si tu as fini (plus rien facturé, mais irréversible).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « J'ai fermé mon laptop, donc l'instance est arrêtée »

Faux. L'instance tourne **dans le cloud**, indépendamment de ta machine. Tant qu'elle est `running`, elle est **facturée à la seconde**. Seul `stop` (ou `terminate`) coupe la facturation du compute. C'est la première source de surprise sur la facture.

### PIÈGE #2 — Confondre `stop` et `terminate`

`stop` = pause réversible, **le volume EBS reste** (et reste facturé). `terminate` = **destruction définitive**, le volume racine est supprimé par défaut. Terminer une instance croyant juste la « mettre en pause » = perte de données. Vérifie l'action avant de valider.

### PIÈGE #3 — Mettre des données importantes sur l'instance store

L'instance store est **éphémère** : au `stop` ou au `terminate`, les données **disparaissent**. Il ne survit même pas à un arrêt. Toute donnée à conserver va sur **EBS** (persistant, snapshotable). L'instance store, c'est cache/temp uniquement.

### PIÈGE #4 — Croire que gp3 = gp2

Ce sont deux types différents. **gp3** monte à **80 000 IOPS / 2 000 MiB/s** avec IOPS et débit **réglables indépendamment** de la taille, et coûte moins cher que gp2 à perf égale. **gp2** plafonne à **16 000 IOPS / 250 MiB/s** et lie la perf à la taille du volume. Pour tout nouveau volume : gp3.

### PIÈGE #5 — Utiliser Spot pour un service qui doit rester up

Spot est de la capacité **reprise par AWS** à tout moment, avec seulement **deux minutes** de préavis. Parfait pour du batch/CI tolérant aux pannes ; **catastrophique** pour notre serveur WebSocket de présence (connexions coupées sans prévenir). Pour du stateful long-lived : On-Demand (ou Reserved si stable).

### PIÈGE #6 — Elastic IP « gratuite » oubliée

Une Elastic IP **non associée** (ou associée à une instance **arrêtée**) est **facturée**. Après un `terminate`, si tu avais alloué une Elastic IP, elle reste sur ton compte et continue de coûter tant que tu ne la **relâches** pas (`release-address`).

---

## 5. Ancrage TribuZen

TribuZen est une archi **majoritairement serverless** (Cognito, API Gateway + Lambda, DynamoDB — modules 06, 07, 09, 11). EC2 y intervient pour les **charges que le serverless gère mal** :

**Serveur WebSocket de présence** (le cas de ce module) — les connexions temps réel longue durée ne collent pas au modèle Lambda (15 min max, sans état de connexion persistant). Un petit `t3.micro`/`t3.small` en On-Demand, lancé via **user-data** (install Node + serveur WS), derrière un security group du module 02, fait le job. En montée en charge, on passerait à un **Launch Template + Auto Scaling Group** sur ≥ 2 AZ (survol §2.10) et un Load Balancer.

**Free Tier — reste à zéro euro pour apprendre :**
- **Comptes créés avant le 15/07/2025** : Free Tier 12 mois = **750 heures/mois** d'instance **t2.micro** (ou **t3.micro** dans les régions sans t2.micro) — soit **une** instance micro allumée 24/7 — plus 30 Go d'EBS. Le quota est **mensuel** et se **partage** entre instances (deux micro en parallèle = 1 500 h → dépassement).
- **Comptes créés à partir du 15/07/2025** : le modèle a changé — plan **Free** à base de **crédits** (offre 12 mois supprimée). Vérifie ton éligibilité dans la Console avant de lancer.

**Teardown obligatoire après chaque session :**
```bash
aws ec2 terminate-instances --instance-ids i-0abc123   # détruit l'instance + volume racine
aws ec2 describe-addresses --query "Addresses[].AllocationId"  # repère les Elastic IP...
aws ec2 release-address --allocation-id eipalloc-0abc123        # ...et relâche-les
```
Vérifie ensuite dans **Cost Explorer / Billing** qu'aucune ressource EC2 ne tourne encore.

Repo cible dans `smaurier/tribuzen` :
```
tribuzen-infra/
  ec2/
    ws-presence/
      setup.sh          ← user-data (install Node + lancement serveur WS)
      README.md         ← type d'instance choisi + rappel teardown
```

---

## 6. Points clés

1. Une instance `running` est **facturée à la seconde**, utilisée ou non — `stop`/`terminate` pour couper le compute.
2. Nom de type = **famille + génération + suffixes + taille** ; suffixe `g` = Graviton (meilleur prix/perf).
3. La famille **T** est **burstable** (crédits CPU) — idéale pour charges au repos avec pics courts.
4. **AMI** = modèle de lancement, **régionale** ; Golden AMI pour un démarrage rapide/reproductible.
5. **User-data** : shebang obligatoire, exécuté root, **une fois** au premier boot, base64 (fait par la CLI), max 16 Ko, log dans `/var/log/cloud-init-output.log`.
6. **EBS** = persistant (survit au stop, snapshotable) ; **instance store** = éphémère (perdu au stop).
7. **gp3** est le défaut : **80 000 IOPS / 2 000 MiB/s**, IOPS/débit réglables indépendamment de la taille.
8. Pricing : **On-Demand** (défaut), **Reserved/Savings Plans** (charge de base, engagement 1/3 ans), **Spot** (jusqu'à forte remise mais interruption avec préavis **2 min**).
9. **Elastic IP** non associée = facturée ; la **relâcher** après teardown.
10. **Free Tier** : `t2.micro`/`t3.micro` — mais toujours **terminer** l'instance et relâcher les Elastic IP en fin de session.

---

## 7. Seeds Anki

```
Pourquoi une instance EC2 "running" que personne n'utilise coûte-t-elle de l'argent ?|Le compute est facturé à la seconde tant que l'état est running, indépendamment de l'usage. Seul stop (arrête le compute, garde l'EBS) ou terminate (détruit tout) coupe la facturation.
Comment lit-on le nom de type m7g.large ?|Famille M (usage général) + génération 7 + suffixe g (processeur Graviton/ARM) + taille large. Le suffixe g indique le meilleur rapport prix/perf.
Que fait une instance burstable de la famille T avec ses crédits CPU ?|Elle accumule des crédits CPU quand elle tourne sous sa baseline, et les consomme pour "burster" au-dessus lors des pics. Bon pour charges majoritairement au repos.
Quelles sont les 5 contraintes clés d'un script user-data Linux ?|Commence par un shebang (#!/bin/bash), s'exécute en tant que root, tourne une seule fois au premier boot par défaut, limité à 16 Ko, base64-encodé (la CLI le fait). Log dans /var/log/cloud-init-output.log.
Quelle est la différence entre un volume EBS et l'instance store ?|EBS est persistant (survit au stop, détachable, snapshotable, chiffrable) ; l'instance store est éphémère (données perdues au stop ou terminate). Données importantes => EBS uniquement.
Pourquoi choisir gp3 plutôt que gp2 ?|gp3 monte à 80 000 IOPS / 2 000 MiB/s avec IOPS et débit réglables indépendamment de la taille, et coûte moins cher à perf égale. gp2 plafonne à 16 000 IOPS / 250 MiB/s et lie la perf à la taille.
Quand utiliser Spot et quand l'éviter ?|Spot = capacité inutilisée à forte remise, mais reprise par AWS avec 2 minutes de préavis (terminate/stop/hibernate). OK pour batch/CI tolérant aux pannes ; à éviter pour un service stateful longue durée (ex. serveur WebSocket).
Quel type d'instance rester dans le Free Tier et que faut-il faire en fin de session ?|t2.micro ou t3.micro (750 h/mois sur comptes créés avant le 15/07/2025). En fin de session : terminate l'instance ET release les Elastic IP non associées, sinon facturation résiduelle.
Pourquoi une Elastic IP peut-elle apparaître sur la facture ?|Elle est facturée quand elle n'est pas utilisée : allouée mais non associée, ou associée à une instance arrêtée. Après un terminate il faut la relâcher (release-address).
```

---

## Pont vers le lab

> Lab associé : `labs/lab-03-ec2/README.md`. Lancer une vraie instance `t3.micro` (Console + CLI) avec user-data qui démarre un serveur, s'y connecter, puis **tout détruire** — vrai outil AWS, rappel teardown + Free Tier.
