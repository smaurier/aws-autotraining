---
titre: Prérequis et vue d'ensemble AWS
cours: 12-aws-cloud
notions: [compte AWS, régions et zones de disponibilité, edge locations, IAM root vs utilisateurs, MFA sur le root, AWS CLI et fichiers de config, profils nommés, modèle de responsabilité partagée, Free Tier post-2025, budgets et maîtrise des coûts]
outcomes:
  - sait créer et sécuriser un compte AWS (MFA root, premier utilisateur IAM, budget d'alerte)
  - sait choisir une région et raisonner sur les zones de disponibilité
  - sait installer et configurer l'AWS CLI avec des profils nommés
  - sait expliquer le modèle de responsabilité partagée et l'appliquer à un service donné
  - sait rester dans le Free Tier post-2025 et détecter une dérive de coûts
prerequis: []
next: 01-iam-identity-access
libs: []
tribuzen: infrastructure cloud TribuZen — panorama du compte AWS et des régions qui hébergeront auth, API et stockage
last-reviewed: 2026-07
---

# Prérequis et vue d'ensemble AWS

> **Outcomes — tu sauras FAIRE :** créer et sécuriser un compte AWS, choisir une région, configurer l'AWS CLI avec des profils, expliquer la responsabilité partagée, rester dans le Free Tier.
> **Difficulté :** :star::star:
>
> **Portée :** ce module pose le terrain. Il ne détaille PAS les policies IAM (module 01), ni le réseau VPC (module 02). Ici : le compte, la géographie AWS, l'outil en ligne de commande, le partage de responsabilité et l'argent.

## 1. Cas concret d'abord

Tu démarres l'infrastructure cloud de **TribuZen**. Avant d'écrire la moindre ligne d'IaC, tu dois répondre à cinq questions que tout·e lead te posera en revue :

1. **Où** vivront les données des familles TribuZen ? (RGPD : des utilisateurs européens → une région européenne)
2. **Avec quelle identité** vas-tu créer les ressources ? (surtout pas le compte root au quotidien)
3. **Comment** ton terminal parle-t-il à AWS sans coller une clé secrète en clair dans un script ?
4. **Qui** est responsable si un serveur prend feu ? Et si un bucket S3 fuite les avatars des enfants ?
5. **Combien** ça coûte, et comment être alerté·e AVANT de recevoir une facture à 400 € ?

Un·e dev qui saute ces questions crée son premier bucket sous le compte root, en `us-east-1`, sans budget, avec une clé d'accès dans un `.env` commité. Trois semaines plus tard : clé fuitée sur GitHub, minage de crypto sur ton compte, facture surprise. Ce module te fait éviter exactement ce scénario.

```bash
# La toute première commande que tu lanceras après config : "qui suis-je pour AWS ?"
aws sts get-caller-identity
# {
#   "UserId": "AIDA...",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/sylvain-dev"   ← PAS ":root"
# }
```

Si l'`Arn` finit par `:root`, tu travailles avec le compte propriétaire tout-puissant : à corriger immédiatement.

---

## 2. Théorie complète, concise

### 2.1 Le compte AWS : la frontière de facturation et d'isolation

Un **compte AWS** est l'unité d'isolation de base : ses ressources, ses factures, ses identités. Il est identifié par un numéro à 12 chiffres (ex. `123456789012`). Créer un compte demande un e-mail unique, une carte bancaire (même pour le Free Tier) et une vérification d'identité par SMS/appel.

L'e-mail + mot de passe utilisés à l'inscription créent le **compte root** : l'identité propriétaire, qui peut TOUT faire, y compris fermer le compte et changer les moyens de paiement. On ne s'en sert **presque jamais** (voir 2.3).

### 2.2 Géographie AWS : régions, AZ, edge locations

- **Région** — zone géographique isolée (ex. `eu-west-3` = Paris, `eu-west-1` = Irlande, `us-east-1` = Virginie du Nord). Les données et la plupart des services sont **régionaux** : une ressource créée à Paris n'existe pas à Dublin. Choix d'une région = latence (proximité des utilisateurs) + conformité (RGPD → Europe) + disponibilité des services + coût.
- **Zone de disponibilité (Availability Zone, AZ)** — une région contient **plusieurs AZ** (généralement 3), chacune constituée d'un ou plusieurs data centers à alimentation, réseau et connectivité redondants, dans des bâtiments physiquement séparés. On les nomme par suffixe : `eu-west-3a`, `eu-west-3b`, `eu-west-3c`. Répartir une application sur ≥ 2 AZ = fondement de la **haute disponibilité** : si une AZ tombe, les autres tiennent.
- **Edge locations** — centaines de points de présence, plus proches des utilisateurs finaux, utilisés par CloudFront (CDN), Route 53 (DNS) et AWS Shield (anti-DDoS).

Quelques services sont **globaux** (non liés à une région) : IAM, Route 53, CloudFront, WAF, Organizations. Pour eux, le sélecteur de région de la console n'a pas d'effet.

### 2.3 IAM root vs utilisateurs : ne jamais coder en root

| | Compte **root** | **Utilisateur IAM** |
|---|---|---|
| Origine | e-mail d'inscription | créé dans IAM |
| Pouvoirs | illimités (fermer le compte, facturation) | ceux que tu accordes (moindre privilège) |
| Usage | tâches exceptionnelles uniquement | quotidien |
| Risque si compromis | catastrophe totale | limité au périmètre accordé |

**Actions de sécurisation dès la création du compte :**

1. Activer le **MFA** (authentification multifacteur) sur le root — app TOTP ou clé physique.
2. Créer un **utilisateur IAM** administrateur pour ton usage quotidien (le détail des policies est le sujet du module 01).
3. Ne plus jamais utiliser le root sauf pour les quelques tâches qui l'exigent (changer le plan de support, fermer le compte…).

> Les **clés d'accès** (Access Key ID + Secret Access Key) sont des identifiants programmatiques. On n'en génère **jamais** pour le root. Pour un utilisateur, on les crée seulement si un usage CLI/SDK le justifie, et on les fait tourner régulièrement.

### 2.4 AWS CLI : configuration et profils

L'**AWS CLI** est l'outil en ligne de commande officiel. Après installation, `aws configure` enregistre tes réglages dans deux fichiers texte du dossier `~/.aws/` :

- `~/.aws/credentials` — les secrets (`aws_access_key_id`, `aws_secret_access_key`), rangés par **profil** entre crochets.
- `~/.aws/config` — les réglages non secrets (`region`, `output`), aussi par profil.

```bash
aws --version
# aws-cli/2.x.x Python/3.x.x ...

aws configure
# AWS Access Key ID [None]: AKIA...
# AWS Secret Access Key [None]: wJal...
# Default region name [None]: eu-west-3
# Default output format [None]: json
```

Par défaut la CLI utilise le profil `default`. Pour jongler entre plusieurs comptes, on crée des **profils nommés** :

```bash
aws configure --profile tribuzen-dev
aws configure --profile tribuzen-prod

# Utilisation ponctuelle
aws s3 ls --profile tribuzen-dev

# Ou pour toute la session shell
export AWS_PROFILE=tribuzen-dev   # PowerShell : $env:AWS_PROFILE = "tribuzen-dev"
```

Contenu typique des fichiers (les sections nommées prennent la forme `[profile nom-du-profil]` dans `~/.aws/config`) :

```ini
# ~/.aws/config
[default]
region = eu-west-3
output = json

[profile tribuzen-prod]
region = eu-west-1
output = json
```

```ini
# ~/.aws/credentials
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = wJal...
```

Un réglage peut être surchargé (ordre de priorité croissant) par une **variable d'environnement** (`AWS_REGION`, `AWS_PROFILE`…) puis par un **paramètre de ligne de commande** (`--region`, `--profile`).

### 2.5 Le modèle de responsabilité partagée

AWS le résume ainsi : « Security and Compliance is a shared responsibility between AWS and the customer. »

- **AWS est responsable de la sécurité DU cloud** — le matériel, le logiciel, le réseau et les installations qui font tourner les services : sécurité physique, patch de l'infrastructure, régions, AZ, edge locations.
- **Le client est responsable de la sécurité DANS le cloud** — ce qu'il met et configure : OS invité et ses patchs (sur EC2), applications, règles de pare-feu (Security Groups), chiffrement et gestion des données, permissions IAM.

Le curseur **bouge selon le service** :

- Service **non managé** (IaaS, ex. EC2) → le client fait « toutes les tâches de configuration et de gestion de sécurité nécessaires », y compris patcher l'OS.
- Service **managé/abstrait** (ex. S3, DynamoDB, Lambda) → AWS opère l'infrastructure et la plateforme ; le client se concentre sur ses **données** (options de chiffrement), la classification et les **outils IAM**.

Règle mnémotechnique : plus un service est managé (Lambda > Fargate > ECS-sur-EC2 > EC2 brut), moins il te reste de responsabilités.

### 2.6 Free Tier et coûts (règles post-2025)

⚠️ **Point souvent périmé dans les tutos.** AWS a changé le Free Tier le **15 juillet 2025**. Il faut distinguer deux régimes selon la date de création du compte :

**Comptes créés APRÈS le 15 juillet 2025 — nouveau modèle par plans :**

- À l'inscription tu choisis **Free account plan** ou **Paid account plan**.
- Tout nouveau client reçoit **100 USD de crédits** à la création, plus **jusqu'à 100 USD supplémentaires** en accomplissant des activités (tutoriels guidés).
- Le **Free plan** : gratuit jusqu'à **6 mois OU épuisement des crédits** (le premier des deux). Aucun frais tant que tu n'upgrades pas. Certains services coûteux y sont **indisponibles**.
- Le **Paid plan** : au-delà des crédits (ou pour un service non couvert), tu payes au tarif standard pay-as-you-go.
- Plus de **30 services « always free »** avec des quotas mensuels gratuits restent accessibles.

**Comptes créés AVANT le 15 juillet 2025 — ancien modèle à trois offres :**

- **Always free** — n'expire jamais (ex. quotas mensuels Lambda, DynamoDB).
- **12 months free** — 12 mois après l'inscription (ex. heures EC2 `t2.micro`/`t3.micro`, stockage S3).
- **Short-term trials** — essais limités dans le temps par service.

**Maîtrise des coûts (identique aux deux régimes) — à faire dès le jour 1 :**

1. **AWS Budgets** — crée un *cost budget* (ex. 5 $/mois) avec alertes à 50/80/100 %. Console → Billing → Budgets.
2. **Cost Explorer** — visualise les coûts par service/région/tag.
3. **Pricing Calculator** (`calculator.aws`) — estime AVANT de déployer.
4. Piliers de facturation : **Compute** (temps d'exécution) + **Storage** (Go stockés) + **Data Transfer** (trafic sortant). Le trafic **entrant** est généralement gratuit ; le **sortant** vers Internet et l'**inter-région** sont payants.

> Piège classique même « gratuit » : une **Elastic IP non attachée**, un **snapshot EBS**, une **AMI personnalisée** ou une seconde instance allumée 24/7 génèrent des frais hors quota.

---

## 3. Worked examples

### Exemple 1 — Sécuriser un compte neuf et vérifier l'identité CLI (TribuZen)

Objectif : passer d'un compte tout juste créé à un poste de travail sûr.

```bash
# 1) Après avoir créé un utilisateur IAM "sylvain-dev" dans la console
#    et généré SES clés d'accès (jamais celles du root), on configure la CLI :
aws configure --profile tribuzen-dev
# AWS Access Key ID [None]: AKIA...            (clé de l'utilisateur IAM, pas du root)
# AWS Secret Access Key [None]: wJal...
# Default region name [None]: eu-west-3        (Paris — utilisateurs TribuZen européens, RGPD)
# Default output format [None]: json

# 2) On active ce profil pour la session
export AWS_PROFILE=tribuzen-dev     # PowerShell : $env:AWS_PROFILE = "tribuzen-dev"

# 3) On vérifie QUI on est — l'Arn ne doit PAS finir par ":root"
aws sts get-caller-identity
# "Arn": "arn:aws:iam::123456789012:user/sylvain-dev"   ✅ utilisateur, pas root

# 4) On liste les régions accessibles (confirme que la CLI parle bien à AWS)
aws ec2 describe-regions --query 'Regions[].RegionName' --output table
```

Ce qui a été mis en place : MFA sur le root (dans la console), un utilisateur IAM dédié, un profil CLI nommé pointant sur Paris. On ne touchera plus au root.

### Exemple 2 — Trancher un cas de responsabilité partagée

Question type d'entretien / certification : « Qui est responsable ? »

| Scénario | Responsable | Pourquoi |
|---|---|---|
| Un disque physique meurt dans un data center | **AWS** | matériel = sécurité DU cloud |
| Un Security Group laisse le port 22 ouvert au monde | **Client** | configuration réseau = sécurité DANS le cloud |
| Faille dans l'hyperviseur de virtualisation | **AWS** | couche infra gérée par AWS |
| Un bucket S3 d'avatars TribuZen est rendu public par erreur | **Client** | config et données du client |
| Le root n'a pas de MFA | **Client** | gestion des identités = client |
| Patch de sécurité du moteur RDS managé | **AWS** | service managé → AWS patche la plateforme |
| Patch de l'OS d'une instance EC2 | **Client** | EC2 = non managé, l'OS invité est au client |

Le raisonnement : *matériel / infra physique / plateforme managée → AWS ; ma config, mes données, mes identités, mon OS invité → moi.*

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Travailler au quotidien avec le compte root

Le root peut fermer le compte et changer la facturation. Une clé root fuitée = compte perdu. **Correct :** MFA sur le root, puis un utilisateur IAM pour tout le reste. Jamais de clé d'accès pour le root.

### PIÈGE #2 — Croire que « Free Tier = illimité et éternel »

Le Free Tier a des **quotas** et, depuis le 15 juillet 2025, le *Free plan* expire après **6 mois ou épuisement des 100 $ (+100 $) de crédits**. Une ressource oubliée (EIP non attachée, instance 24/7, snapshot) facture au-delà du quota. **Correct :** budget d'alerte dès le jour 1 + teardown des ressources de test.

### PIÈGE #3 — « J'ai créé la ressource mais je ne la retrouve pas »

La console affiche les ressources de **la région sélectionnée**. Créer une instance en `us-east-1` puis chercher en `eu-west-3` → elle est « invisible ». **Correct :** vérifier le sélecteur de région (et se rappeler que IAM/Route 53/CloudFront sont globaux).

### PIÈGE #4 — Confondre région et zone de disponibilité

La **région** est géographique (Paris). L'**AZ** est un groupe de data centers dans cette région (`eu-west-3a`). Déployer dans « une seule AZ » n'apporte aucune haute disponibilité : il faut **≥ 2 AZ**. **Correct :** répartir les ressources critiques sur plusieurs AZ.

### PIÈGE #5 — Coller les clés d'accès dans le code / un `.env` commité

Une clé dans un dépôt Git est une clé publique. **Correct :** `aws configure` (fichiers `~/.aws/`), profils nommés, variables d'environnement — et sur AWS, préférer des **rôles** (module 01) qui évitent les clés statiques.

### PIÈGE #6 — Penser qu'AWS sécurise tout

Le modèle est **partagé**. AWS ne configure pas tes Security Groups, ne chiffre pas tes données à ta place sur un service non managé, ne met pas de MFA sur ton root. **Correct :** appliquer la grille « qui fait quoi » de 2.5 à chaque service.

---

## 5. Ancrage TribuZen

Ce module cadre **l'infrastructure cloud de TribuZen** avant tout code. Le panorama qui guidera les modules suivants :

- **Compte & région** — un compte AWS dédié TribuZen, région principale `eu-west-3` (Paris) pour la conformité RGPD des données familiales. Un profil CLI `tribuzen-dev` pointe dessus.
- **Identités** — root protégé par MFA, jamais utilisé ; utilisateur IAM `sylvain-dev` pour le quotidien (les rôles fins arrivent au module 01).
- **Où atterriront les briques suivantes** (aperçu, pas encore construit) :
  - auth → **Cognito** (module 11)
  - API → **Lambda + API Gateway** (modules 06-07)
  - avatars → **S3** (module 04), servis via **CloudFront** (module 13)
  - feed des familles → **DynamoDB** (module 09)
- **Responsabilité partagée appliquée à TribuZen** — c'est nous qui devons empêcher un bucket d'avatars d'enfants de devenir public, chiffrer les données, poser le MFA. AWS garantit le matériel et les AZ.
- **Coûts** — un budget d'alerte à 5 $/mois est posé dès l'ouverture du compte pour un projet d'apprentissage qui doit rester dans le Free Tier.

Fichier cible dans `smaurier/tribuzen` (documentation d'infra, pas encore d'IaC) :

```
tribuzen/
  infra/
    README.md        ← compte, région eu-west-3, profil CLI, budget, schéma de responsabilité
```

---

## 6. Points clés

1. Un compte AWS = unité d'isolation + de facturation, identifiée par 12 chiffres ; l'e-mail d'inscription crée le root tout-puissant.
2. **Région** = géographie (RGPD → Europe) ; **AZ** = data centers redondants dans la région, ≥ 2 AZ pour la haute disponibilité ; IAM/Route 53/CloudFront sont globaux.
3. Sécuriser dès le jour 1 : MFA sur le root, un utilisateur IAM pour le quotidien, jamais de clé root, jamais de root au quotidien.
4. `aws configure` écrit dans `~/.aws/credentials` (secrets) et `~/.aws/config` (region, output) ; les **profils nommés** gèrent plusieurs comptes ; `AWS_PROFILE` / `--profile` sélectionnent.
5. Responsabilité **partagée** : AWS = sécurité DU cloud (infra) ; client = sécurité DANS le cloud (config, données, identités, OS invité) ; le curseur bouge selon que le service est managé ou non.
6. Free Tier **post-15 juillet 2025** : Free vs Paid plan, 100 $ (+100 $) de crédits, Free plan expirant à 6 mois ou crédits épuisés ; ancien modèle (always free / 12 mois / trials) pour les comptes antérieurs.
7. Maîtrise des coûts dès le départ : Budgets + Cost Explorer + Pricing Calculator ; trafic sortant/inter-région payant ; EIP non attachées et snapshots facturent même « gratuit ».

---

## 7. Seeds Anki

```
Pourquoi ne jamais travailler au quotidien avec le compte root AWS ?|Le root a des pouvoirs illimités (fermer le compte, changer la facturation) ; une compromission = perte totale. On active le MFA dessus, on crée un utilisateur IAM pour le quotidien, et on ne génère jamais de clé d'accès root.
Quelle différence entre une région AWS et une zone de disponibilité (AZ) ?|La région est une zone géographique (ex. eu-west-3 Paris) ; une AZ est un groupe de data centers redondants au sein de la région (ex. eu-west-3a). Il faut déployer sur ≥ 2 AZ pour la haute disponibilité.
Où l'AWS CLI stocke-t-elle ses réglages après aws configure ?|Dans ~/.aws/credentials (aws_access_key_id, aws_secret_access_key) et ~/.aws/config (region, output), organisés par profil. Le profil par défaut est [default] ; on crée des profils nommés pour plusieurs comptes.
Résume le modèle de responsabilité partagée AWS.|AWS = sécurité DU cloud (matériel, réseau, installations, régions/AZ, patch de l'infra). Client = sécurité DANS le cloud (config, données, chiffrement, IAM, Security Groups, OS invité sur EC2). Le partage varie : plus le service est managé, moins le client a de responsabilités.
Qu'a changé le Free Tier AWS le 15 juillet 2025 ?|Nouveau modèle par plans : Free plan ou Paid plan choisi à l'inscription, 100 USD de crédits (+ jusqu'à 100 USD via activités), Free plan gratuit jusqu'à 6 mois OU épuisement des crédits. Les comptes créés avant gardent l'ancien modèle : always free / 12 mois / short-term trials.
Comment éviter une facture AWS surprise sur un compte d'apprentissage ?|Créer un AWS Budget (cost budget, ex. 5 $/mois) avec alertes à 50/80/100 % dès le jour 1, suivre via Cost Explorer, estimer avec le Pricing Calculator, et faire le teardown des ressources de test (EIP non attachées, snapshots et instances 24/7 facturent hors quota).
Comment vérifier avec quelle identité l'AWS CLI agit ?|aws sts get-caller-identity — renvoie l'Account et l'Arn. Si l'Arn finit par ":root", c'est le compte propriétaire (à éviter) ; on veut un Arn de type user/<nom> ou role/<nom>.
Quels services AWS sont globaux plutôt que régionaux ?|IAM, Route 53, CloudFront, WAF, Organizations. Le sélecteur de région de la console n'a pas d'effet sur eux, contrairement à la plupart des services (EC2, S3, Lambda…) qui sont régionaux.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-00-aws-fundamentals/README.md`. Créer et sécuriser un compte AWS réel, configurer l'AWS CLI avec un profil nommé, poser un budget d'alerte, et lire l'infrastructure via CLI — avec rappel teardown et Free Tier. Vrai outil : Console AWS + AWS CLI, feedback coach.
