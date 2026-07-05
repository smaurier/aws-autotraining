---
titre: VPC & réseau — subnets, routage, NAT, pare-feux
cours: 12-aws-cloud
notions: [VPC régional, bloc CIDR, "subnet public vs privé (route IGW)", adresses réservées AWS, table de routage, longest-prefix-match, Internet Gateway, NAT Gateway, Elastic IP, "Security Group (stateful)", "NACL (stateless)", VPC endpoint Gateway vs Interface]
outcomes:
  - sait découper un VPC en subnets publics/privés multi-AZ avec un plan CIDR cohérent
  - sait rendre un subnet public ou privé via sa table de routage (IGW vs NAT Gateway)
  - sait distinguer Security Group (stateful, instance) et NACL (stateless, subnet) et choisir le bon
  - sait pourquoi un NAT Gateway coûte cher et comment un VPC endpoint S3 réduit la facture
prerequis: [Modules 00-01 du cours 12-aws-cloud — compte AWS + régions/AZ, IAM et moindre privilège]
next: 03-ec2-compute
libs: []
tribuzen: infrastructure réseau TribuZen — le VPC qui isole l'API Lambda, la base de données et le NAT vers Internet
last-reviewed: 2026-07
---

# VPC & réseau — subnets, routage, NAT, pare-feux

> **Outcomes — tu sauras FAIRE :** découper un VPC en subnets publics/privés multi-AZ, router un subnet vers Internet (IGW) ou en sortie seule (NAT Gateway), et choisir entre Security Group et NACL.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **le réseau uniquement** — VPC, CIDR, subnets, tables de routage, Internet Gateway, NAT Gateway, Security Groups vs NACL, et un survol des VPC endpoints. Ce qu'on **branche dedans** (instances EC2, EBS, groupes d'auto-scaling) est le sujet du **module 03**. Les rôles/politiques qui autorisent les appels d'API réseau relèvent du **module 01 (IAM)**, supposé acquis.

## 1. Cas concret d'abord

Tu poses les fondations cloud de TribuZen. Avant la moindre ligne de code applicatif, une question : **où vivent la base de données et l'API ?**

Un stagiaire a tout lancé dans le **VPC par défaut**, tout dans un seul subnet, et a ouvert le Security Group de la base PostgreSQL en `0.0.0.0/0` sur le port 5432 « pour que ça marche vite ». Trois jours plus tard, GuardDuty signale des tentatives de connexion depuis l'autre bout du monde.

Le cahier des charges réseau correct pour TribuZen :

```
VPC TribuZen : 10.0.0.0/16

  Subnet PUBLIC   10.0.0.0/24   (AZ eu-west-3a)  → l'API/le load balancer, joignable d'Internet
  Subnet PUBLIC   10.0.1.0/24   (AZ eu-west-3b)
  Subnet PRIVÉ    10.0.10.0/24  (AZ eu-west-3a)  → la base PostgreSQL, JAMAIS joignable d'Internet
  Subnet PRIVÉ    10.0.11.0/24  (AZ eu-west-3b)
```

Trois décisions que tu dois savoir justifier à la fin de ce module :

1. **Pourquoi la base va dans un subnet privé** et l'API dans un subnet public — c'est la table de routage qui tranche, pas un attribut « privé ».
2. **Comment la base télécharge quand même ses mises à jour** sans être joignable de l'extérieur — c'est le rôle du NAT Gateway (et pourquoi il te coûtera de l'argent).
3. **Pourquoi le Security Group de la base ne référence jamais `0.0.0.0/0`** mais le Security Group de l'API — et la différence stateful/stateless qui rend ce choix sûr.

## 2. Théorie complète, concise

### 2.1 Le VPC : un réseau régional isolé

Un **VPC** (Virtual Private Cloud) est ton réseau IP privé dans AWS. Points structurants :

- Un VPC est **régional** : il s'étend sur **toutes les AZ** de sa région (contrairement à un subnet, lié à **une seule** AZ).
- Il possède au moins un **bloc CIDR IPv4** (taille comprise entre `/16` et `/28`), éventuellement un bloc IPv6.
- Chaque compte a un **VPC par défaut** par région — pratique pour bricoler, à **éviter en production** (tout y est public par défaut).

### 2.2 La notation CIDR

Le **CIDR** (Classless Inter-Domain Routing) décrit une plage d'adresses : `10.0.0.0/16` signifie « les 16 premiers bits sont fixes, les 16 restants sont libres ».

```
/16 = 2^(32-16) = 65 536 adresses   ← taille d'un VPC confortable
/24 = 2^(32-24) = 256 adresses      ← taille d'un subnet standard
/28 = 2^(32-28) = 16 adresses       ← plus petit subnet AWS possible
```

Utilise les plages **privées RFC 1918** : `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.

**AWS réserve 5 adresses dans CHAQUE subnet** (les 4 premières + la dernière). Pour `10.0.0.0/24` :

| Adresse | Rôle (doc AWS) |
|---------|----------------|
| `10.0.0.0` | Adresse réseau |
| `10.0.0.1` | Réservée AWS — **routeur du VPC** |
| `10.0.0.2` | Réservée AWS — **serveur DNS** (base du réseau + 2) |
| `10.0.0.3` | Réservée AWS — usage futur |
| `10.0.0.255` | Adresse de broadcast (le broadcast n'est pas supporté dans un VPC) |

Un subnet `/24` offre donc **256 − 5 = 251** adresses utilisables. C'est pour ça qu'un subnet ne peut pas être plus petit que `/28` (16 adresses → 11 utilisables).

### 2.3 Subnets : public vs privé — c'est la ROUTE qui décide

Un **subnet** est une subdivision du VPC dans **une seule AZ**. Il n'y a **pas de case à cocher « privé »**. La doc AWS est explicite : *« le type de subnet est déterminé par la façon dont tu configures le routage »*.

- **Subnet public** = sa table de routage a une **route directe vers un Internet Gateway**.
- **Subnet privé** = sa table de routage **n'a pas** de route vers un Internet Gateway (il lui faut un NAT device pour sortir).

Chaque subnet doit être associé à **exactement une** table de routage (par défaut, la *main route table* du VPC). Répartis toujours tes subnets sur **≥ 2 AZ** : un subnet ne survit pas à la panne de son AZ.

### 2.4 Tables de routage & priorité

Une **table de routage** contient des routes `destination → cible`. Le trafic est dirigé selon l'**adresse IP de destination**.

Table d'un **subnet public** :

| Destination | Cible | Sens |
|-------------|-------|------|
| `10.0.0.0/16` | `local` | trafic interne au VPC |
| `0.0.0.0/0` | `igw-xxxx` | tout le reste → Internet |

Table d'un **subnet privé** :

| Destination | Cible | Sens |
|-------------|-------|------|
| `10.0.0.0/16` | `local` | trafic interne au VPC |
| `0.0.0.0/0` | `nat-xxxx` | sortie Internet via NAT Gateway |

La route `local` est **implicite et impossible à supprimer** — elle assure la communication entre tous les subnets du VPC.

**Priorité — longest prefix match :** quand plusieurs routes correspondent, AWS choisit **la plus spécifique** (le préfixe le plus long). Un paquet vers `10.0.10.5` matche à la fois `10.0.0.0/16` (local) et `0.0.0.0/0` ; `/16` étant plus spécifique que `/0`, il part en `local`. C'est ce qui garantit que le trafic interne ne fuit jamais par Internet.

### 2.5 Internet Gateway (IGW)

L'**Internet Gateway** connecte le VPC à Internet.

- **Un seul IGW par VPC** (relation 1:1), attaché au VPC.
- Hautement disponible et redondant **par conception** (pas de gestion, pas de goulot).
- **Gratuit** (tu paies le transfert de données, pas la passerelle).
- Il fait le NAT entre l'IP privée d'une instance et son **IP publique/Elastic IP**.

Sans route `0.0.0.0/0 → igw` **et** sans IP publique, une instance ne voit pas Internet, même dans un subnet « public ».

### 2.6 NAT Gateway — la sortie des subnets privés (⚠️ payant)

Un **NAT Gateway** (public) permet aux instances d'un subnet **privé** de **sortir** vers Internet (mises à jour, appels d'API externes) **sans jamais accepter de connexion entrante** venue d'Internet. Facts (doc AWS) :

- Se crée **dans un subnet public** et exige une **Elastic IP** à la création.
- **Managé** par AWS, résilient **dans une seule AZ** → pour la HA, un NAT Gateway **par AZ**.
- *« Les connexions doivent toujours être initiées depuis l'intérieur du VPC »* — il est **unidirectionnel sortant**.
- Le subnet privé le vise via `0.0.0.0/0 → nat-xxxx` ; le NAT, lui, route vers l'IGW.
- **Payant** : tarif **horaire** (dès sa création, qu'il serve ou non) **+ frais par Go traité**. C'est le piège de facture n°1 en apprentissage → **teardown obligatoire**.

Distinction utile : un **IGW** rend une instance joignable **des deux sens** (si elle a une IP publique) ; un **NAT Gateway** n'autorise que le **sortant**.

### 2.7 Security Groups vs NACL — les deux pare-feux

Deux couches de filtrage, souvent confondues. La distinction **stateful / stateless** est le cœur du sujet (et une question d'entretien classique).

**Security Group (SG)** — pare-feu au niveau **de la ressource / ENI** :

- **Stateful** : si une requête sort (ou une requête entrante est autorisée), le **trafic retour est automatiquement permis**, quelles que soient les autres règles. Tu n'écris jamais la règle de retour.
- Règles **ALLOW uniquement** (pas de DENY possible).
- Par défaut sur un SG neuf : **tout entrant refusé**, **tout sortant autorisé**.
- Peut **référencer un autre Security Group** comme source (ex. « SG-app autorise SG-base ») — bien plus robuste qu'un CIDR.

**Network ACL (NACL)** — pare-feu au niveau **du subnet** :

- **Stateless** : entrant et sortant sont évalués **indépendamment**. Autoriser l'entrant n'autorise **pas** le retour → il faut penser aux **ports éphémères** en sortie.
- Règles **ALLOW et DENY**.
- Règles **numérotées de 1 à 32766**, évaluées **de la plus petite à la plus grande** ; **première règle qui matche = appliquée**, on arrête là.
- La **NACL par défaut autorise tout** ; une **NACL custom refuse tout** tant que tu n'ajoutes pas de règle.
- Un subnet est associé à **exactement une** NACL.

| Critère | Security Group | NACL |
|---------|----------------|------|
| Niveau | Ressource / ENI | Subnet |
| État | **Stateful** (retour auto) | **Stateless** (retour à gérer) |
| Règles | ALLOW seulement | ALLOW **et** DENY |
| Évaluation | Toutes les règles (OR) | Par n° croissant, 1re match gagne |
| Défaut | Entrant deny, sortant allow | Défaut = allow tout ; custom = deny tout |
| Référencer un SG | Oui | Non (CIDR seulement) |

**Règle de choix :** le SG est ton outil principal (99 % des cas). La NACL ajoute une couche de subnet — utile pour bloquer explicitement une plage d'IP (DENY), ce que le SG ne sait pas faire.

### 2.8 VPC Endpoints — survol

Un **VPC endpoint** permet d'atteindre un service AWS **sans passer par Internet** (le trafic reste sur le backbone AWS). Deux types :

| Type | Services | Mécanisme |
|------|----------|-----------|
| **Gateway Endpoint** | **S3 et DynamoDB uniquement** | une entrée ajoutée dans la table de routage (gratuit) |
| **Interface Endpoint** | la plupart des services (SQS, Secrets Manager…) | une ENI à IP privée dans tes subnets (PrivateLink, payant) |

Intérêt clé : un **Gateway Endpoint S3** évite de faire transiter le trafic S3 par le **NAT Gateway** → **économie directe** sur les frais de données NAT. On y revient au module 04 (S3).

## 3. Worked examples

### Exemple 1 — Rendre le subnet base de données de TribuZen réellement privé

**Objectif :** la base PostgreSQL de TribuZen dans `10.0.10.0/24` doit pouvoir **télécharger ses mises à jour** mais rester **injoignable d'Internet**.

Étape par étape (concepts + CLI AWS) :

```bash
# 1. Le VPC (bloc /16)
aws ec2 create-vpc --cidr-block 10.0.0.0/16
# → renvoie vpc-0aaa...

# 2. Un subnet PUBLIC (pour le NAT) et un subnet PRIVÉ (pour la base), même AZ
aws ec2 create-subnet --vpc-id vpc-0aaa --cidr-block 10.0.0.0/24  --availability-zone eu-west-3a   # public
aws ec2 create-subnet --vpc-id vpc-0aaa --cidr-block 10.0.10.0/24 --availability-zone eu-west-3a   # privé

# 3. Internet Gateway attaché au VPC (gratuit)
aws ec2 create-internet-gateway                    # → igw-0ccc
aws ec2 attach-internet-gateway --vpc-id vpc-0aaa --internet-gateway-id igw-0ccc

# 4. Le subnet PUBLIC route 0.0.0.0/0 vers l'IGW → il devient "public"
aws ec2 create-route --route-table-id rtb-public --destination-cidr-block 0.0.0.0/0 --gateway-id igw-0ccc

# 5. Un NAT Gateway DANS le subnet public, avec une Elastic IP  (⚠️ facturation démarre ici)
aws ec2 allocate-address --domain vpc              # → eipalloc-0eee
aws ec2 create-nat-gateway --subnet-id subnet-public --allocation-id eipalloc-0eee   # → nat-0fff

# 6. Le subnet PRIVÉ route 0.0.0.0/0 vers le NAT → sortie seule, pas d'entrée
aws ec2 create-route --route-table-id rtb-private --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-0fff
```

**Pourquoi c'est correct :**
- Le subnet base n'a **aucune** route vers l'IGW → rien venu d'Internet ne peut l'atteindre (la doc AWS définit « privé » ainsi).
- Il a une route `0.0.0.0/0 → nat` → il **sort** pour ses mises à jour, mais le NAT refuse toute connexion initiée de l'extérieur.
- La route `local` (implicite) laisse l'API du subnet public parler à la base — sans passer par Internet.

**Teardown (sinon ça facture) :** `delete-nat-gateway`, puis `release-address` de l'Elastic IP, puis les subnets, l'IGW (détacher d'abord), le VPC.

### Exemple 2 — SG stateful vs NACL stateless sur le port PostgreSQL

**Objectif :** seule l'API (subnet public) doit joindre la base sur le **port 5432**.

**Avec un Security Group (recommandé) :**

```
SG-api   (attaché à l'API)   : entrant  443 depuis 0.0.0.0/0
SG-base  (attaché à la base) : entrant  5432 depuis  SG-api      ← on référence un SG, pas un CIDR
```

Une seule règle entrante sur `SG-base`. **Pas de règle de retour** : le SG étant **stateful**, la réponse de PostgreSQL vers l'API repart automatiquement. Et comme la source est `SG-api` (pas un CIDR), n'importe quelle instance qui rejoint `SG-api` est autorisée sans retoucher la base.

**Le même besoin avec une NACL (stateless) est plus lourd :**

```
NACL du subnet base :
  Entrant  100 : ALLOW  TCP 5432        depuis 10.0.0.0/24   (le subnet API)
  Sortant  100 : ALLOW  TCP 1024-65535  vers   10.0.0.0/24   ← ports éphémères du RETOUR, à la main
```

Comme la NACL est **stateless**, oublier la règle **sortante** sur les ports éphémères casse la connexion : la requête entre, mais la réponse est bloquée. C'est l'illustration concrète de « stateful vs stateless », et la raison pour laquelle on pilote l'accès applicatif par **Security Group**, la NACL servant de garde-fou grossier au niveau subnet.

## 4. Pièges & misconceptions

### PIÈGE #1 — « Un subnet privé, c'est une option à cocher »

Faux. Il n'existe pas d'attribut « privé ». Un subnet est privé **uniquement parce que sa table de routage n'a pas de route vers un IGW**. Ajoute cette route par erreur (ou mets l'instance dans la mauvaise table) et ton subnet « privé » devient public sans avertissement.

### PIÈGE #2 — Confondre stateful (SG) et stateless (NACL)

Sur un **Security Group**, tu n'écris **jamais** la règle de retour : il est stateful. Sur une **NACL**, tu **dois** autoriser explicitement le trafic retour (souvent les ports éphémères `1024-65535` en sortie), sinon la connexion se bloque à la réponse. Beaucoup de « la connexion timeout » viennent d'une NACL custom dont on a oublié la règle sortante.

### PIÈGE #3 — Croire que le NAT Gateway est gratuit ou bidirectionnel

Deux erreurs en une. (a) Le NAT Gateway est **facturé à l'heure dès sa création** *plus* au Go traité — un NAT oublié un week-end coûte réellement. (b) Il est **sortant uniquement** : *« les connexions doivent toujours être initiées depuis l'intérieur du VPC »*. Pour exposer un service à Internet, c'est un **IGW + IP publique/load balancer**, pas un NAT.

### PIÈGE #4 — Ouvrir un Security Group en `0.0.0.0/0` sur un port de base de données

`0.0.0.0/0` sur 5432/3306 expose la base au monde entier (le scénario du cas concret). La bonne pratique : référencer le **Security Group** de la couche appelante comme source. Réserve `0.0.0.0/0` aux ports publics légitimes (443) sur les ressources **faites** pour être exposées.

### PIÈGE #5 — Croire que le VPC Peering est transitif / oublier le chevauchement CIDR

Le VPC Peering n'est **pas transitif** (A↔B et B↔C ne donnent pas A↔C) et exige des **CIDR qui ne se chevauchent pas**. C'est pour ça qu'on choisit des plages disjointes dès la conception (`10.0.0.0/16` vs `10.1.0.0/16`), même pour un seul VPC aujourd'hui.

### PIÈGE #6 — Croire qu'un `/24` offre 256 adresses utilisables

Non : AWS **réserve 5 adresses par subnet** (`.0`, `.1`, `.2`, `.3`, `.255`). Un `/24` fournit **251** adresses assignables. À l'échelle d'un `/28` (16 → **11** utilisables), l'écart devient critique.

## 5. Ancrage TribuZen

Le VPC est la **couche 0** de l'infrastructure TribuZen : tout ce qui suivra dans le cours (EC2, RDS, Lambda, ElastiCache) se déploie **dedans**.

Topologie cible de TribuZen :

```
VPC TribuZen  10.0.0.0/16   (région eu-west-3, 2 AZ)

  Subnets PUBLICS   10.0.0.0/24  · 10.0.1.0/24
     └─ Application Load Balancer (front de l'API)   ← route vers IGW
     └─ NAT Gateway (1 par AZ en prod)

  Subnets PRIVÉS-APP  10.0.10.0/24 · 10.0.11.0/24
     └─ compute de l'API TribuZen                    ← sort via NAT, jamais joignable d'Internet

  Subnets PRIVÉS-DATA 10.0.20.0/24 · 10.0.21.0/24
     └─ RDS PostgreSQL (données familles/membres)    ← SG n'autorise que le SG-app sur 5432
     └─ ElastiCache (module 08)
```

Décisions de sécurité TribuZen ancrées ici :
- La **base familles/membres** est en subnet **privé-data**, injoignable d'Internet — obligation RGPD de fait sur des données de mineurs.
- Le **Security Group de RDS** ne référence **que** le SG de l'API, jamais un CIDR public.
- Un **Gateway Endpoint S3** (avatars TribuZen, module 04) évite de payer le NAT pour le trafic S3.

> Ce qu'on **place** dans ces subnets — instances, base managée, fonctions — arrive aux modules suivants. Ici, on a bâti et sécurisé **le réseau** qui les accueillera.

Fichiers cibles côté IaC (le VPC sera codé en CDK au module 05) :
```
tribuzen-infra/
  lib/
    network-stack.ts     ← VPC, subnets publics/privés, IGW, NAT, tables de routage
    security-groups.ts   ← SG-alb, SG-api, SG-rds (références croisées)
```

## 6. Points clés

1. Un **VPC** est régional ; un **subnet** vit dans **une seule AZ** → répartir sur ≥ 2 AZ.
2. **Public vs privé** ne se coche pas : c'est la **table de routage** (route vers IGW = public) qui tranche.
3. AWS **réserve 5 adresses par subnet** ; un `/24` = 251 utilisables ; taille de subnet `/28` → `/16`.
4. **Priorité de routage = longest prefix match** : la route la plus spécifique gagne, `local` protège le trafic interne.
5. **Internet Gateway** : 1 par VPC, gratuit, bidirectionnel (avec IP publique).
6. **NAT Gateway** : sortie seule des subnets privés, dans un subnet public, Elastic IP requise, **payant (horaire + par Go) → teardown**.
7. **Security Group** : stateful, ALLOW-only, niveau ressource, peut référencer un autre SG.
8. **NACL** : stateless (gérer le retour), ALLOW+DENY, niveau subnet, règles numérotées 1re-match.
9. **VPC endpoint** : accès privé aux services AWS ; Gateway (S3/DynamoDB, gratuit) vs Interface (PrivateLink, payant).

## 7. Seeds Anki

```
Qu'est-ce qui rend un subnet AWS "public" ou "privé" ?|Sa table de routage : un subnet est public s'il a une route directe vers un Internet Gateway, privé s'il n'en a pas (il lui faut alors un NAT device pour sortir). Il n'existe aucun attribut "privé" à cocher.
Combien d'adresses AWS réserve-t-il dans chaque subnet et lesquelles ?|5 : les 4 premières (.0 réseau, .1 routeur VPC, .2 DNS, .3 usage futur) et la dernière (.255 broadcast). Un /24 offre donc 251 adresses utilisables.
Différence entre Security Group et NACL sur l'état ?|SG = stateful : le trafic retour est automatiquement autorisé, on n'écrit jamais la règle de réponse. NACL = stateless : entrant et sortant évalués indépendamment, il faut autoriser explicitement le retour (ports éphémères).
Security Group vs NACL : règles autorisées et niveau ?|SG : ALLOW uniquement, au niveau ressource/ENI, peut référencer un autre SG comme source. NACL : ALLOW et DENY, au niveau subnet, règles numérotées 1-32766 évaluées de la plus petite à la plus grande (1re match gagne), CIDR seulement.
À quoi sert un NAT Gateway et quel est son piège ?|Il laisse les instances d'un subnet privé SORTIR vers Internet sans accepter de connexion entrante. Il se crée dans un subnet public avec une Elastic IP. Piège : facturé à l'heure dès sa création + par Go traité → toujours le détruire (teardown) après un lab.
Comment fonctionne la priorité entre routes d'une table de routage ?|Longest prefix match : la route la plus spécifique (préfixe le plus long) gagne. Ex. un paquet vers 10.0.10.5 matche 10.0.0.0/16 (local) et 0.0.0.0/0 ; /16 étant plus spécifique, il reste en local.
Internet Gateway vs NAT Gateway ?|IGW : 1 par VPC, gratuit, rend une instance joignable dans les deux sens si elle a une IP publique. NAT Gateway : payant, sortie uniquement pour les subnets privés, les connexions doivent toujours être initiées depuis le VPC.
Quels sont les deux types de VPC endpoint ?|Gateway Endpoint (S3 et DynamoDB seulement, entrée dans la table de routage, gratuit) et Interface Endpoint (la plupart des services via PrivateLink, une ENI à IP privée, payant). Un Gateway Endpoint S3 évite de payer le NAT pour le trafic S3.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-02-vpc/README.md`. Construire de bout en bout le VPC TribuZen (subnets public/privé, IGW, NAT, tables de routage, SG) dans la Console AWS + CLI, tester la connectivité, puis **tout détruire** — le NAT Gateway est payant.
