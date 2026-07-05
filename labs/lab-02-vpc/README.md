# Lab 02 — Le VPC de TribuZen (subnets, IGW, NAT, Security Groups)

> **Outcome :** à la fin, tu sais construire un VPC multi-AZ avec subnet public + subnet privé, IGW, NAT Gateway et Security Groups, **prouver la connectivité au bon sens**, puis tout détruire.
> **Vrai outil :** Console AWS (VPC) **+ AWS CLI** — pas de harnais simulé, tu manipules le vrai réseau.
> **Feedback :** le coach valide en session (tests de connectivité réels + revue de la topologie) — pas de test-runner auto-correcteur.

> ⚠️ **COÛT — À LIRE AVANT DE COMMENCER.** Ce lab crée un **NAT Gateway** : il est **facturé à l'heure dès sa création** *et* au Go traité — il **n'est pas dans le Free Tier**. Compte quelques dizaines de centimes si tu fais le lab en une session et que tu **détruis tout** à la fin. Le VPC, les subnets, l'IGW et les Security Groups, eux, sont **gratuits**. Fais le lab d'une traite et exécute le **teardown** (dernière section) sans exception. Vérifie ensuite dans **Billing → Cost Explorer** qu'aucun NAT ne tourne encore.

---

## Prérequis

- Compte AWS avec un utilisateur IAM disposant des droits VPC/EC2 (pas le root — module 01).
- AWS CLI installé et configuré (`aws configure`), région **eu-west-3** (Paris) conseillée.
- Vérifie ta région : `aws configure get region`.

---

## Énoncé

Tu bâtis le réseau de **TribuZen** conformément au module 02. Topologie cible :

```
VPC TribuZen  10.0.0.0/16   (eu-west-3, 2 AZ)

  Subnet PUBLIC   10.0.0.0/24   (eu-west-3a)   → NAT Gateway + (plus tard) le load balancer
  Subnet PRIVÉ    10.0.10.0/24  (eu-west-3a)   → la base de données, JAMAIS joignable d'Internet

  Internet Gateway   → attaché au VPC
  NAT Gateway        → dans le subnet public, avec une Elastic IP
  Table de routage publique  : 0.0.0.0/0 → IGW
  Table de routage privée    : 0.0.0.0/0 → NAT
  SG-public : entrant 443 depuis 0.0.0.0/0
  SG-private: entrant PostgreSQL 5432 depuis SG-public UNIQUEMENT
```

**Critères de réussite (le coach vérifie) :**

1. Le subnet privé **n'a aucune route** vers l'IGW (c'est ce qui le rend privé).
2. Une instance de test dans le subnet **privé** peut faire `curl https://aws.amazon.com` (sortie via NAT) mais **n'a pas** d'IP publique.
3. Le `SG-private` référence **le Security Group** `SG-public` comme source sur 5432 — **pas** un CIDR, et surtout pas `0.0.0.0/0`.
4. Tu sais expliquer, table de routage à l'appui, **pourquoi** le trafic interne (`10.0.0.0/16`) ne sort jamais par Internet (longest prefix match).
5. À la fin, **le NAT Gateway et l'Elastic IP sont détruits** (vérifié dans la console).

**Pas de gap-fill.** Tu construis la topologie toi-même, à la Console **ou** au CLI (idéalement : Console pour visualiser, CLI pour reproduire).

---

## Étapes (en friction)

1. **Crée le VPC** `10.0.0.0/16`, tag `Name=tribuzen-vpc`. Note son `vpc-id`.
2. **Crée les deux subnets** (`10.0.0.0/24` public, `10.0.10.0/24` privé), tous deux en `eu-west-3a`. Ne t'appuie pas sur l'attribut "auto-assign public IP" pour définir "privé" — c'est la route qui compte.
3. **Crée et attache un Internet Gateway** au VPC.
4. **Table de routage publique** : crée-la, ajoute `0.0.0.0/0 → igw`, associe-la au subnet public.
5. **Alloue une Elastic IP**, puis **crée le NAT Gateway dans le subnet public** avec cette EIP. ⏱️ Attends l'état `Available` (1-2 min). *(La facturation démarre ici.)*
6. **Table de routage privée** : crée-la, ajoute `0.0.0.0/0 → nat`, associe-la au subnet privé.
7. **Security Groups** : crée `SG-public` (entrant 443 depuis `0.0.0.0/0`) et `SG-private` (entrant TCP 5432 depuis **`SG-public`**).
8. **Teste la connectivité** (voir encadré ci-dessous) : lance une petite instance `t3.micro` dans le subnet privé et prouve la sortie NAT.
9. **Teardown** : détruis dans l'ordre (section dédiée). Ne saute pas cette étape.

> **Friction voulue :** ne colle pas un template CloudFormation « VPC tout fait ». Le but est de sentir que « privé » = **absence de route IGW**, et de voir le NAT se facturer.

### Encadré — tester la connectivité (le cœur du lab)

Pour joindre l'instance privée **sans SSH ni IP publique**, on passe par **SSM Session Manager**. Ça exige que l'instance porte un **rôle IAM** (via un *instance profile*) avec la policy managée **`AmazonSSMManagedInstanceCore`** — sinon l'agent SSM ne peut pas s'enregistrer et `start-session` échoue avec `TargetNotConnected`.

> **Note :** SSM (rôle, instance profile, Session Manager) est détaillé au **module 03**. Ici on l'utilise juste comme moyen d'accès à une instance sans IP publique.

```bash
# ─── Rôle IAM + instance profile pour SSM (à créer AVANT run-instances) ──────
cat > ssm-trust.json <<'EOF'
{ "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole" }] }
EOF
aws iam create-role --role-name tribuzen-ssm-role \
  --assume-role-policy-document file://ssm-trust.json
aws iam attach-role-policy --role-name tribuzen-ssm-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name tribuzen-ssm-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name tribuzen-ssm-profile --role-name tribuzen-ssm-role

# ─── Instance de test dans le subnet PRIVÉ (SG-private), SANS IP publique ─────
#   AMI Amazon Linux 2023 (agent SSM préinstallé) ; --iam-instance-profile = accès SSM
#   --no-associate-public-ip-address : l'instance reste privée (c'est le but)
aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --instance-type t3.micro \
  --subnet-id subnet-priv \
  --security-group-ids sg-priv \
  --iam-instance-profile Name=tribuzen-ssm-profile \
  --no-associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tribuzen-test-priv}]'
# → i-xxxx ; attends l'état "running", puis connecte-toi :
aws ssm start-session --target i-xxxx

# Depuis la session SSM sur l'instance privée :
curl -s -o /dev/null -w "%{http_code}\n" https://aws.amazon.com   # attendu : 200  → sortie NAT OK
curl -s https://checkip.amazonaws.com                            # renvoie l'IP publique = l'Elastic IP du NAT

# Vérifie qu'AUCUNE IP publique n'est attachée à l'instance privée :
aws ec2 describe-instances --instance-ids i-xxxx \
  --query "Reservations[].Instances[].PublicIpAddress"           # attendu : liste vide / null
```

Si `curl` sort mais que l'instance n'a pas d'IP publique → la démonstration « subnet privé + NAT » est réussie.

---

## Corrigé complet commenté

Séquence CLI complète et reproductible. Remplace les `vpc-…`, `subnet-…`, etc. par les ID renvoyés à chaque étape.

```bash
# ─── 1. VPC ────────────────────────────────────────────────────────────────
aws ec2 create-vpc --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=tribuzen-vpc}]'
# → vpc-0aaa   (note-le)

# ─── 2. Subnets (même AZ pour simplifier le lab ; en prod, 2 AZ) ────────────
aws ec2 create-subnet --vpc-id vpc-0aaa --cidr-block 10.0.0.0/24 \
  --availability-zone eu-west-3a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=tribuzen-public-a}]'
# → subnet-pub

aws ec2 create-subnet --vpc-id vpc-0aaa --cidr-block 10.0.10.0/24 \
  --availability-zone eu-west-3a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=tribuzen-private-a}]'
# → subnet-priv

# ─── 3. Internet Gateway (gratuit) ─────────────────────────────────────────
aws ec2 create-internet-gateway   # → igw-0ccc
aws ec2 attach-internet-gateway --vpc-id vpc-0aaa --internet-gateway-id igw-0ccc

# ─── 4. Table de routage PUBLIQUE → IGW ────────────────────────────────────
aws ec2 create-route-table --vpc-id vpc-0aaa   # → rtb-pub
aws ec2 create-route --route-table-id rtb-pub \
  --destination-cidr-block 0.0.0.0/0 --gateway-id igw-0ccc     # 0.0.0.0/0 → Internet
aws ec2 associate-route-table --route-table-id rtb-pub --subnet-id subnet-pub
# subnet-pub a maintenant une route IGW → il est PUBLIC (par définition AWS)

# ─── 5. Elastic IP + NAT Gateway (⚠️ facturation démarre) ───────────────────
aws ec2 allocate-address --domain vpc          # → eipalloc-0eee
aws ec2 create-nat-gateway --subnet-id subnet-pub --allocation-id eipalloc-0eee \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=tribuzen-nat}]'
# → nat-0fff   ; attends l'état "available" :
aws ec2 describe-nat-gateways --nat-gateway-ids nat-0fff --query "NatGateways[].State"

# ─── 6. Table de routage PRIVÉE → NAT ──────────────────────────────────────
aws ec2 create-route-table --vpc-id vpc-0aaa   # → rtb-priv
aws ec2 create-route --route-table-id rtb-priv \
  --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-0fff  # 0.0.0.0/0 → NAT (sortie seule)
aws ec2 associate-route-table --route-table-id rtb-priv --subnet-id subnet-priv
# subnet-priv n'a AUCUNE route IGW → il est PRIVÉ. La route local 10.0.0.0/16 est implicite.

# ─── 7. Security Groups ────────────────────────────────────────────────────
aws ec2 create-security-group --group-name SG-public --vpc-id vpc-0aaa \
  --description "Front public TribuZen"       # → sg-pub
aws ec2 authorize-security-group-ingress --group-id sg-pub \
  --protocol tcp --port 443 --cidr 0.0.0.0/0  # 443 ouvert au monde : légitime pour du HTTPS public

aws ec2 create-security-group --group-name SG-private --vpc-id vpc-0aaa \
  --description "Base de donnees TribuZen"     # → sg-priv
# La source est le SG public, PAS un CIDR : seul ce qui porte SG-public peut joindre 5432.
aws ec2 authorize-security-group-ingress --group-id sg-priv \
  --protocol tcp --port 5432 --source-group sg-pub
# NB : aucune règle sortante à écrire côté base — le SG est STATEFUL, le retour est automatique.
```

**Pourquoi ce corrigé est correct :**
- `subnet-priv` n'a **jamais** reçu de route vers `igw` → il est privé au sens de la doc AWS (« pas de route directe vers un Internet Gateway »).
- La route `0.0.0.0/0 → nat` du subnet privé autorise la **sortie** ; le NAT refuse toute connexion **entrante** initiée d'Internet (unidirectionnel).
- `SG-private` référence `SG-public` comme source sur 5432 : robuste (toute nouvelle instance `SG-public` est autorisée sans retoucher la base) et sûr (jamais exposé au public).
- Comme le Security Group est **stateful**, on n'écrit **aucune** règle de retour — contrairement à ce qu'exigerait une NACL stateless.
- La route `local` (10.0.0.0/16) étant plus spécifique que `0.0.0.0/0` (longest prefix match), le trafic entre subnets reste **interne**, jamais routé vers Internet.

---

## Teardown (OBLIGATOIRE — le NAT est payant)

Détruis **dans cet ordre** (dépendances) puis vérifie dans la console qu'il ne reste rien :

```bash
# 0. Termine d'abord l'instance de test (sinon les ENI bloquent la suppression)
aws ec2 terminate-instances --instance-ids i-xxxx

# 1. NAT Gateway  ← le poste de coût : à supprimer en PREMIER
aws ec2 delete-nat-gateway --nat-gateway-id nat-0fff
#    attends l'état "deleted" avant de libérer l'EIP :
aws ec2 describe-nat-gateways --nat-gateway-ids nat-0fff --query "NatGateways[].State"

# 2. Elastic IP  (une EIP non attachée est aussi facturée !)
aws ec2 release-address --allocation-id eipalloc-0eee

# 3. Détache puis supprime l'IGW
aws ec2 detach-internet-gateway --vpc-id vpc-0aaa --internet-gateway-id igw-0ccc
aws ec2 delete-internet-gateway --internet-gateway-id igw-0ccc

# 4. Subnets, tables de routage custom, security groups custom
aws ec2 delete-subnet --subnet-id subnet-pub
aws ec2 delete-subnet --subnet-id subnet-priv
aws ec2 delete-route-table --route-table-id rtb-pub
aws ec2 delete-route-table --route-table-id rtb-priv
aws ec2 delete-security-group --group-id sg-priv   # supprime SG-private avant SG-public (référence)
aws ec2 delete-security-group --group-id sg-pub

# 5. VPC
aws ec2 delete-vpc --vpc-id vpc-0aaa

# 6. Rôle IAM + instance profile SSM (retirer le rôle du profile AVANT de supprimer)
aws iam remove-role-from-instance-profile \
  --instance-profile-name tribuzen-ssm-profile --role-name tribuzen-ssm-role
aws iam delete-instance-profile --instance-profile-name tribuzen-ssm-profile
aws iam detach-role-policy --role-name tribuzen-ssm-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name tribuzen-ssm-role
```

✅ **Vérification finale :** `aws ec2 describe-nat-gateways --filter "Name=state,Values=available"` doit renvoyer **une liste vide**. Va aussi voir **Billing → Cost Explorer** le lendemain.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées — sans rouvrir ce corrigé ni le module 02 :**

1. Reproduis le VPC **en 30 minutes**, mais cette fois en **2 AZ** (`eu-west-3a` + `eu-west-3b`), avec **un subnet public et un subnet privé par AZ** (4 subnets) et **un NAT Gateway par AZ** — chaque subnet privé route vers le NAT de **sa propre** AZ (pas de trafic cross-AZ).
2. Ajoute une **NACL custom** sur les subnets privés qui **DENY** explicitement tout le trafic depuis `0.0.0.0/0` sauf le subnet applicatif — et écris **à la main** la règle sortante des ports éphémères `1024-65535` (rappel : NACL = stateless).
3. Ajoute un **Gateway Endpoint S3** et vérifie qu'une requête S3 depuis le subnet privé **ne passe plus par le NAT** (route ajoutée à la table privée).

**Critère de réussite :** connectivité NAT OK dans les deux AZ, la NACL bloque bien une IP externe testée, et le trafic S3 emprunte l'endpoint. **Teardown complet** derrière (4 NAT + 4 EIP = coût qui grimpe → ne traîne pas).

---

## Application TribuZen

Dans le vrai produit, ce réseau ne se pilote **pas à la main** : il sera codé en **CDK** (module 05) pour être reproductible entre environnements (`dev`, `prod`).

```
tribuzen-infra/
  lib/
    network-stack.ts      ← VPC 2 AZ, subnets public/privé/data, IGW, NAT, tables de routage
    security-groups.ts    ← SG-alb, SG-api, SG-rds (références croisées, jamais de 0.0.0.0/0 sur la data)
```

**Différences par rapport au lab :**
- Le construct CDK `ec2.Vpc` génère subnets, IGW, NAT et tables de routage **automatiquement** à partir d'une config déclarative — mais tu dois **comprendre** ce qu'il génère, d'où ce lab manuel d'abord.
- En prod TribuZen : **3 subnet groups** (public / private-app / private-data), NAT **par AZ**, et un **Gateway Endpoint S3** pour les avatars afin d'éviter les frais NAT.
- Les Security Groups sont **référencés entre eux** dans le code (`sgRds.addIngressRule(sgApi, Port.tcp(5432))`), jamais par CIDR.

**Commit cible (`smaurier/tribuzen-infra`) :**
```
feat(network): VPC TribuZen multi-AZ — subnets public/privé, IGW, NAT, SG référencés
```
