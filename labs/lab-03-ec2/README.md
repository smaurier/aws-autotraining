# Lab 03 — EC2 : lancer, automatiser, détruire

> **Outcome :** à la fin, tu sais lancer une instance EC2 `t3.micro` (Console **et** CLI) avec un **user-data** qui démarre un serveur au premier boot, t'y connecter en SSH, vérifier que ça tourne, puis **tout détruire** proprement.
> **Vrai outil :** AWS Console (EC2) + AWS CLI v2 + SSH. Pas de simulateur, pas de harnais de test — tu manipules le vrai service.
> **Feedback :** le coach valide en session (démo live : l'URL répond, puis `describe-instances` ne renvoie plus rien). Pas d'auto-correcteur.

> ⚠️ **Coût réel.** Ce lab lance des ressources **facturables**. Utilise un `t3.micro`/`t2.micro` (**Free Tier**) et fais le **teardown** de la section dédiée **avant de fermer ta session**. Une instance oubliée facture à la seconde, 24/7.

---

## Prérequis

- Un compte AWS avec la CLI configurée (`aws configure`, module 00).
- Un **VPC avec un subnet public** et un **security group** (module 02). Si tu n'en as pas, le VPC par défaut de la région convient pour ce lab.
- Une **key pair** (on la crée à l'étape 0 si besoin).
- Région de travail cohérente (ex. `eu-west-3` Paris). Vérifie : `aws configure get region`.

---

## Énoncé

Tu héberges le futur **serveur de présence TribuZen** (indicateur « qui est en ligne »). Pour ce lab, on simplifie : au lieu d'un serveur WebSocket, l'instance servira une **page HTTP** « TribuZen presence: OK » via un mini serveur — l'objectif pédagogique est la **mécanique EC2**, pas le code du serveur.

Cahier des charges **exact** :

1. Lancer **une** instance **`t3.micro`** (Free Tier) sous **Amazon Linux 2023**.
2. Le setup se fait **entièrement via user-data** — **interdiction** d'installer quoi que ce soit à la main en SSH.
3. Le security group autorise **SSH (22)** depuis **ton IP seulement** et **HTTP (80)** depuis partout.
4. Au premier boot, le user-data installe un serveur, écrit une page qui affiche `TribuZen presence: OK` et l'expose sur le port 80.
5. Tu vérifies dans un navigateur (`http://<ip-publique>`) que la page répond.
6. Tu te connectes en SSH et tu lis `/var/log/cloud-init-output.log` pour confirmer que le user-data s'est exécuté.
7. Tu **détruis tout** (instance + key pair + Elastic IP si tu en as créé une) et tu **prouves** qu'il ne reste rien.

**Tu fais l'exercice deux fois** : une fois **par la Console** (pour comprendre chaque champ), une fois **par la CLI** (pour l'automatiser). Le corrigé ci-dessous est la version CLI.

### Script user-data à utiliser

Crée `user-data.sh` en local :

```bash
#!/bin/bash
dnf update -y
dnf install -y python3
cat > /var/www-index.html <<'HTML'
TribuZen presence: OK
HTML
# petit serveur HTTP sur le port 80, servant le fichier (démo — pas pour la prod)
cd /var && nohup python3 -m http.server 80 &>/var/log/tribuzen-http.log &
```

> Note : `python3 -m http.server` sert le **répertoire courant**. On sert `/var` et on ouvre `http://<ip>/www-index.html`. Suffisant pour prouver que le user-data a tourné. En vrai (module TribuZen), ce serait `node server.js`.

---

## Étapes (en friction)

Tu produis les commandes toi-même à partir des indices — ne copie pas d'abord le corrigé.

### Partie A — par la Console (comprendre)

1. **EC2 → Launch instances.** Nomme l'instance `tribuzen-ws-lab`.
2. **AMI** : Amazon Linux 2023 (repère le tag « Free tier eligible »).
3. **Type** : `t3.micro` (ou `t2.micro`) — vérifie le tag « Free tier eligible ».
4. **Key pair** : crée-en une (`ed25519`), télécharge le `.pem`, **ne le committe jamais**.
5. **Network settings** : subnet public, **Auto-assign public IP = Enable**, crée un security group avec **SSH depuis My IP** + **HTTP (80) depuis Anywhere**.
6. **Advanced details → User data** : colle le contenu de `user-data.sh`.
7. Lance, attends l'état `running` + `2/2 checks passed`, ouvre `http://<ip-publique>/www-index.html`.
8. **Ne détruis pas encore** — refais tout en CLI (Partie B), puis teardown commun.

### Partie B — par la CLI (automatiser)

1. **Créer la key pair** (si pas déjà fait en A) et `chmod 400`.
2. **Trouver l'AMI Amazon Linux 2023** la plus récente via SSM Parameter Store (indice : `aws ssm get-parameters --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64`).
3. **Créer/repérer le security group**, ouvrir 22 (ton IP) et 80 (0.0.0.0/0).
4. **`aws ec2 run-instances`** avec `--instance-type t3.micro`, `--user-data file://user-data.sh`, `--key-name`, `--security-group-ids`, `--subnet-id`, un tag Name.
5. **Attendre** que l'instance soit prête (`aws ec2 wait instance-status-ok`).
6. **Récupérer l'IP publique** et tester (`curl http://<ip>/www-index.html`).
7. **SSH** dans l'instance, lire `/var/log/cloud-init-output.log`, et vérifier le user-data via `curl http://169.254.169.254/latest/user-data` (IMDSv2 : récupère d'abord un token).
8. **Teardown** (section dédiée) + preuve qu'il ne reste rien.

---

## Corrigé complet commenté

```bash
# ─────────────────────────────────────────────────────────────
# 0) Key pair (clé privée téléchargée localement, jamais committée)
# ─────────────────────────────────────────────────────────────
aws ec2 create-key-pair --key-name tribuzen-lab --key-type ed25519 \
  --query 'KeyMaterial' --output text > tribuzen-lab.pem
chmod 400 tribuzen-lab.pem

# ─────────────────────────────────────────────────────────────
# 1) AMI Amazon Linux 2023 la plus récente (résolue par SSM, pas en dur :
#    un ID d'AMI change selon la région et la date)
# ─────────────────────────────────────────────────────────────
AMI_ID=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
echo "AMI: $AMI_ID"

# ─────────────────────────────────────────────────────────────
# 2) Security group : SSH depuis MON IP seulement, HTTP depuis partout
# ─────────────────────────────────────────────────────────────
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
  --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group \
  --group-name tribuzen-lab-sg \
  --description "Lab EC2 - SSH + HTTP" \
  --vpc-id "$VPC_ID" --query 'GroupId' --output text)

MY_IP=$(curl -s https://checkip.amazonaws.com)          # mon IP publique
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr "${MY_IP}/32"          # SSH: MON IP uniquement
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0              # HTTP: ouvert (démo)

# ─────────────────────────────────────────────────────────────
# 3) Subnet public du VPC par défaut
# ─────────────────────────────────────────────────────────────
SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=default-for-az,Values=true" \
  --query 'Subnets[0].SubnetId' --output text)

# ─────────────────────────────────────────────────────────────
# 4) Lancer l'instance
#    --user-data file://... : la CLI base64-encode POUR TOI
#    --associate-public-ip-address : joignable depuis Internet
# ─────────────────────────────────────────────────────────────
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type t3.micro \
  --key-name tribuzen-lab \
  --security-group-ids "$SG_ID" \
  --subnet-id "$SUBNET_ID" \
  --associate-public-ip-address \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tribuzen-ws-lab}]' \
  --count 1 \
  --query 'Instances[0].InstanceId' --output text)
echo "Instance: $INSTANCE_ID"

# ─────────────────────────────────────────────────────────────
# 5) Attendre que l'instance soit prête (running + status checks OK)
# ─────────────────────────────────────────────────────────────
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "IP publique: $PUBLIC_IP"

# ─────────────────────────────────────────────────────────────
# 6) Tester la page servie par le user-data
#    (laisse ~1-2 min après status-ok : le user-data tourne au boot)
# ─────────────────────────────────────────────────────────────
curl "http://${PUBLIC_IP}/www-index.html"   # attendu: "TribuZen presence: OK"

# ─────────────────────────────────────────────────────────────
# 7) SSH + preuve que le user-data s'est exécuté
# ─────────────────────────────────────────────────────────────
ssh -i tribuzen-lab.pem ec2-user@"$PUBLIC_IP"
#   Sur l'instance :
#   sudo cat /var/log/cloud-init-output.log      # logs du user-data
#   # Récupérer le user-data via IMDSv2 (token obligatoire) :
#   TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
#       -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
#   curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
#       http://169.254.169.254/latest/user-data
#   exit
```

**Pourquoi ce corrigé est correct :**
- **AMI résolue par SSM**, jamais un ID en dur : un `ami-xxxx` est propre à une région et périme. `run-instances` avec un ID copié-collé d'un tuto échoue « InvalidAMIID » dans une autre région.
- **SSH restreint à `${MY_IP}/32`** : ouvrir le port 22 à `0.0.0.0/0` est la faute de sécurité classique (scan/brute-force immédiat).
- **`--user-data file://`** : la CLI fait le base64 ; pas besoin d'encoder à la main. Le script commence par `#!/bin/bash` (obligatoire) et tourne en **root** au premier boot.
- **`aws ec2 wait instance-status-ok`** évite de tester l'IP avant que l'instance soit réellement joignable.
- **IMDSv2** (token PUT puis GET) : sur Amazon Linux 2023, IMDSv1 est désactivé par défaut — la requête metadata sans token échoue.

---

## Teardown (obligatoire — à faire avant de fermer la session)

```bash
# 1) Terminer l'instance (détruit aussi le volume racine par défaut)
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"

# 2) Supprimer le security group (échoue tant que l'instance n'est pas terminée)
aws ec2 delete-security-group --group-id "$SG_ID"

# 3) Supprimer la key pair côté AWS + le .pem local
aws ec2 delete-key-pair --key-name tribuzen-lab
rm -f tribuzen-lab.pem

# 4) Si tu as alloué une Elastic IP dans la Partie A, la relâcher :
#    aws ec2 describe-addresses --query "Addresses[].AllocationId"
#    aws ec2 release-address --allocation-id eipalloc-xxxx

# 5) PREUVE qu'il ne reste rien en running :
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running,pending,stopped" \
  --query "Reservations[].Instances[].[InstanceId,InstanceType,State.Name]" \
  --output table
#   → doit être vide.
```

> Ouvre aussi **Billing → Cost Explorer** en fin de journée : zéro ligne EC2 active = teardown réussi.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées — sans rouvrir ce corrigé ni le module 03 :**

1. Refais **tout en CLI en 20 minutes**, de la key pair au teardown.
2. **Interdit d'ouvrir le port 22** : pas de key pair, pas de SSH. Attache un **rôle IAM avec `AmazonSSMManagedInstanceCore`** à l'instance et connecte-toi via **`aws ssm start-session --target <id>`** (module 01 pour le rôle).
3. Le user-data doit en plus **taguer** l'heure de démarrage dans un fichier `/opt/started-at.txt` et l'afficher sur la page.
4. Vérifie que le **security group ne contient plus aucune règle sur le port 22**.

**Critère de réussite :** la page répond, tu t'es connecté **sans SSH** (via SSM), et le teardown laisse `describe-instances` vide.

---

## Application TribuZen

Dans `smaurier/tribuzen`, l'infra EC2 vit hors du code applicatif :

```
tribuzen-infra/
  ec2/
    ws-presence/
      user-data.sh      ← install Node + lancement du serveur WebSocket de présence
      launch.sh         ← run-instances documenté (type choisi, SG, subnet)
      README.md         ← type d'instance + RAPPEL teardown + éligibilité Free Tier
```

**Différences avec le lab :**
- Le vrai serveur est un **WebSocket Node** (connexions longues), pas un `python3 -m http.server` de démo.
- La connexion admin se fait via **SSM Session Manager** (rôle IAM), **pas de port 22 ouvert**.
- À terme : **Launch Template + Auto Scaling Group** sur ≥ 2 AZ derrière un Load Balancer (survol module — détail hors périmètre ici).

**Commit cible :**
```
chore(infra): serveur de présence EC2 — t3.micro + user-data, SSM au lieu de SSH, teardown documenté
```
