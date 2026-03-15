# Module 02 — VPC & Networking

> **Objectif** : Comprendre et configurer un réseau privé virtuel AWS : sous-réseaux, passerelles, tables de routage, groupes de sécurité, et concevoir des architectures réseau sécurisées.
> **Difficulté** : ⭐⭐⭐
> **Prérequis** : Module 01
> **Durée estimée** : 5 heures

---

## Table des matières

1. [Qu'est-ce qu'un VPC ?](#quest-ce-quun-vpc)
2. [Notation CIDR](#notation-cidr)
3. [Sous-réseaux publics et privés](#sous-réseaux-publics-et-privés)
4. [Internet Gateway](#internet-gateway)
5. [NAT Gateway](#nat-gateway)
6. [Tables de routage](#tables-de-routage)
7. [Security Groups vs NACLs](#security-groups-vs-nacls)
8. [Elastic Network Interfaces (ENI)](#elastic-network-interfaces)
9. [VPC Peering](#vpc-peering)
10. [VPC Endpoints](#vpc-endpoints)
11. [VPC Flow Logs](#vpc-flow-logs)
12. [Architecture réseau complète](#architecture-réseau-complète)
13. [Bonnes pratiques](#bonnes-pratiques)

---

## Qu'est-ce qu'un VPC ?

Un **VPC** (Virtual Private Cloud) est un réseau virtuel isolé dans le cloud AWS. C'est votre espace réseau privé où vous déployez vos ressources.

### Caractéristiques fondamentales

- Un VPC est **régional** — il s'étend sur toutes les AZ d'une région
- Chaque compte a un **VPC par défaut** dans chaque région (à ne pas utiliser en production)
- Vous pouvez créer jusqu'à **5 VPC par région** (limite augmentable)
- Un VPC a un bloc CIDR principal (IPv4 obligatoire, IPv6 optionnel)

---

## Notation CIDR

Le **CIDR** (Classless Inter-Domain Routing) définit une plage d'adresses IP. Comprendre le CIDR est indispensable pour concevoir un réseau AWS.

### Format

```
10.0.0.0/16
│        │
│        └── Masque : les 16 premiers bits sont fixes
└── Adresse de base du réseau
```

### Tableau des masques courants

| CIDR | Masque | Adresses disponibles | Usage typique |
|------|--------|---------------------|---------------|
| `/16` | 255.255.0.0 | 65 536 | VPC principal |
| `/20` | 255.255.240.0 | 4 096 | Grand sous-réseau |
| `/24` | 255.255.255.0 | 256 | Sous-réseau standard |
| `/28` | 255.255.255.240 | 16 | Petit sous-réseau (minimum AWS) |

### Règles AWS pour le CIDR

- Le bloc CIDR d'un VPC doit être entre `/16` (65 536 adresses) et `/28` (16 adresses)
- AWS **réserve 5 adresses** dans chaque sous-réseau :
  - `.0` — Adresse réseau
  - `.1` — Passerelle VPC
  - `.2` — Serveur DNS
  - `.3` — Réservée par AWS pour usage futur
  - `.255` — Adresse de diffusion (broadcast)

### Calcul rapide

```
/16 = 2^(32-16) = 65 536 adresses
/24 = 2^(32-24) = 256 adresses
/28 = 2^(32-28) = 16 adresses

Pour un sous-réseau /24 : 256 - 5 (réservées) = 251 adresses utilisables
```

### Plages d'adresses privées (RFC 1918)

| Plage | CIDR | Utilisation recommandée |
|-------|------|------------------------|
| 10.0.0.0 – 10.255.255.255 | 10.0.0.0/8 | Grands réseaux d'entreprise |
| 172.16.0.0 – 172.31.255.255 | 172.16.0.0/12 | Réseaux moyens |
| 192.168.0.0 – 192.168.255.255 | 192.168.0.0/16 | Petits réseaux |

---

## Sous-réseaux publics et privés

Un **sous-réseau** (subnet) est une subdivision de votre VPC. Chaque sous-réseau réside dans **une seule AZ**.

### Sous-réseau public vs privé

| Caractéristique | Sous-réseau public | Sous-réseau privé |
|-----------------|-------------------|-------------------|
| Route vers Internet Gateway | Oui | Non |
| IP publique automatique | Possible | Non |
| Accessible depuis Internet | Oui (si SG le permet) | Non |
| Accès à Internet sortant | Via IGW | Via NAT Gateway |
| Usage typique | Load balancers, bastions | Serveurs d'application, BDD |

### Plan d'adressage recommandé

```
VPC : 10.0.0.0/16

Sous-réseaux publics :
  10.0.1.0/24  → eu-west-3a (251 hôtes)
  10.0.2.0/24  → eu-west-3b (251 hôtes)
  10.0.3.0/24  → eu-west-3c (251 hôtes)

Sous-réseaux privés (application) :
  10.0.10.0/24 → eu-west-3a
  10.0.11.0/24 → eu-west-3b
  10.0.12.0/24 → eu-west-3c

Sous-réseaux privés (base de données) :
  10.0.20.0/24 → eu-west-3a
  10.0.21.0/24 → eu-west-3b
  10.0.22.0/24 → eu-west-3c
```

---

## Internet Gateway

L'**Internet Gateway** (IGW) est la passerelle qui connecte votre VPC à Internet. Sans IGW, aucune ressource de votre VPC ne peut communiquer avec Internet.

### Caractéristiques

- **Un seul IGW par VPC** (relation 1:1)
- Hautement disponible et redondant par conception
- Gratuit (pas de frais supplémentaires)
- Effectue le NAT pour les instances avec une IP publique

---

## NAT Gateway

Le **NAT Gateway** permet aux instances dans un sous-réseau **privé** d'accéder à Internet (pour les mises à jour, appels API, etc.) **sans être accessibles depuis Internet**.

### Fonctionnement

```
Instance privée → NAT Gateway (sous-réseau public) → Internet Gateway → Internet
                      ↑
               Traduit l'IP privée en IP publique (Elastic IP)
```

### NAT Gateway vs NAT Instance

| Caractéristique | NAT Gateway | NAT Instance |
|-----------------|-------------|--------------|
| Disponibilité | Managé, haute dispo dans une AZ | Vous gérez |
| Bande passante | Jusqu'à 100 Gbps | Dépend du type d'instance |
| Maintenance | Aucune | Patches, monitoring à votre charge |
| Coût | ~0,052 $/h + données | Coût de l'instance |
| Security Groups | Non applicable | Oui |

### Haute disponibilité

Un NAT Gateway est résilient **dans une seule AZ**. Pour la haute disponibilité, créez un NAT Gateway **dans chaque AZ** :

```
AZ-a : NAT Gateway A → sous-réseau public A
AZ-b : NAT Gateway B → sous-réseau public B
AZ-c : NAT Gateway C → sous-réseau public C
```

Chaque sous-réseau privé utilise le NAT Gateway de sa propre AZ dans sa table de routage.

---

## Tables de routage

Une **table de routage** contient des règles (routes) qui déterminent où diriger le trafic réseau.

### Table de routage du sous-réseau public

| Destination | Cible | Description |
|------------|-------|-------------|
| 10.0.0.0/16 | local | Trafic interne au VPC |
| 0.0.0.0/0 | igw-xxx | Tout le reste → Internet |

### Table de routage du sous-réseau privé

| Destination | Cible | Description |
|------------|-------|-------------|
| 10.0.0.0/16 | local | Trafic interne au VPC |
| 0.0.0.0/0 | nat-xxx | Tout le reste → NAT Gateway |

### Règle importante

La route **la plus spécifique** l'emporte toujours. Si vous avez :
- `10.0.0.0/16 → local`
- `0.0.0.0/0 → igw-xxx`

Un paquet destiné à `10.0.1.5` ira vers `local` car `/16` est plus spécifique que `/0`.

---

## Security Groups vs NACLs

Ce sont les deux couches de pare-feu dans un VPC. Comprendre leur différence est essentiel.

### Security Groups (SG)

Un Security Group est un pare-feu **au niveau de l'instance** (ENI).

**Caractéristiques** :
- **Stateful** : si le trafic entrant est autorisé, le trafic de retour est automatiquement autorisé
- Règles **ALLOW uniquement** (pas de règle Deny)
- Par défaut : tout le trafic sortant autorisé, tout le trafic entrant refusé
- Vous pouvez référencer un **autre Security Group** comme source

### Network ACLs (NACLs)

Les NACLs sont des pare-feux **au niveau du sous-réseau**.

**Caractéristiques** :
- **Stateless** : trafic entrant et sortant évalués indépendamment
- Règles **ALLOW et DENY**
- Évaluées **par numéro de règle** (du plus petit au plus grand)
- La NACL par défaut autorise tout

### Tableau comparatif

| Caractéristique | Security Group | NACL |
|-----------------|---------------|------|
| Niveau | Instance (ENI) | Sous-réseau |
| État | Stateful | Stateless |
| Règles | Allow uniquement | Allow + Deny |
| Évaluation | Toutes les règles | Par ordre de numéro |
| Par défaut | Deny entrant, Allow sortant | Allow tout |
| Référence SG | Oui | Non |

---

## Elastic Network Interfaces

Une **ENI** (Elastic Network Interface) est une carte réseau virtuelle attachée à une instance.

### Attributs d'une ENI

- Une adresse IPv4 privée principale
- Une ou plusieurs adresses IPv4 privées secondaires
- Une adresse IPv4 publique (optionnelle)
- Une ou plusieurs adresses IPv6
- Un ou plusieurs Security Groups
- Une adresse MAC
- Un flag source/destination check

### Cas d'usage

- **Dual-homing** : une instance avec une ENI dans un sous-réseau public et une dans un sous-réseau privé
- **Failover** : déplacer une ENI d'une instance défaillante vers une instance saine
- **Licensing** : certaines licences sont liées à l'adresse MAC

---

## VPC Peering

Le **VPC Peering** permet de connecter deux VPC entre eux via le réseau privé AWS (sans passer par Internet).

### Caractéristiques

- Fonctionne **entre régions** et **entre comptes**
- Le trafic reste sur le backbone AWS (pas de goulot d'étranglement Internet)
- **Non transitif** : si VPC-A est peered avec VPC-B, et VPC-B avec VPC-C, VPC-A ne peut PAS communiquer avec VPC-C via VPC-B
- Les blocs CIDR ne doivent **pas se chevaucher**

### Limitation de transitivité

```
VPC-A ←→ VPC-B ←→ VPC-C

VPC-A peut parler à VPC-B       ✅
VPC-B peut parler à VPC-C       ✅
VPC-A peut parler à VPC-C       ❌ (il faut un peering direct A↔C)
```

Pour des architectures avec beaucoup de VPC, utilisez **AWS Transit Gateway** à la place.

---

## VPC Endpoints

Les **VPC Endpoints** permettent de connecter votre VPC aux services AWS **sans passer par Internet**. Le trafic reste entièrement sur le réseau AWS.

### Types de VPC Endpoints

| Type | Services supportés | Fonctionnement |
|------|-------------------|----------------|
| **Gateway Endpoint** | S3, DynamoDB uniquement | Entrée dans la table de routage |
| **Interface Endpoint** | La plupart des services AWS | ENI avec IP privée (PrivateLink) |

### Gateway Endpoint (S3, DynamoDB)

```bash
# Créer un Gateway Endpoint pour S3
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0abc123def456 \
  --service-name com.amazonaws.eu-west-3.s3 \
  --route-table-ids rtb-0abc123-private

# Vérifier
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=vpc-0abc123def456"
```

**Avantage** : le trafic vers S3 ne passe plus par le NAT Gateway → **économie significative** sur les frais de données NAT.

### Interface Endpoint (PrivateLink)

Les Interface Endpoints créent une ENI avec une IP privée dans vos sous-réseaux. Ils supportent la plupart des services AWS (SQS, SNS, CloudWatch, etc.). Activez le DNS privé pour que les appels SDK utilisent automatiquement l'endpoint.

Vous pouvez restreindre l'accès via une **politique d'endpoint** (IAM policy attachée au VPC endpoint).

---

## VPC Flow Logs

Les **VPC Flow Logs** capturent les informations sur le trafic IP entrant et sortant des interfaces réseau de votre VPC.

### Niveaux de capture

- **VPC** : tout le trafic du VPC
- **Sous-réseau** : tout le trafic d'un sous-réseau
- **ENI** : trafic d'une interface réseau spécifique

### Format d'un enregistrement

```
version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status

2 123456789012 eni-0abc123 10.0.1.5 10.0.2.10 443 49152 6 25 5000 1620000000 1620000060 ACCEPT OK
2 123456789012 eni-0abc123 203.0.113.5 10.0.1.5 0 0 1 4 336 1620000000 1620000060 REJECT OK
```

### Destinations

Les Flow Logs peuvent être envoyés vers **CloudWatch Logs** (analyse temps réel) ou **S3** (stockage long terme, moins cher).

---

## Architecture réseau complète

Voici l'architecture réseau typique d'une application en production :

```
                        Internet
                           │
                    ┌──────┴──────┐
                    │ Internet GW │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │ Public-A  │   │ Public-B  │   │ Public-C  │
    │ 10.0.1/24 │   │ 10.0.2/24 │   │ 10.0.3/24 │
    │    ALB    │   │    ALB    │   │    ALB    │
    │  NAT GW   │   │  NAT GW   │   │  NAT GW   │
    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
          │                │                │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │ Private-A │   │ Private-B │   │ Private-C │
    │10.0.10/24 │   │10.0.11/24 │   │10.0.12/24 │
    │   EC2 App │   │   EC2 App │   │   EC2 App │
    └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
          │                │                │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │  Data-A   │   │  Data-B   │   │  Data-C   │
    │10.0.20/24 │   │10.0.21/24 │   │10.0.22/24 │
    │    RDS    │   │    RDS    │   │    RDS    │
    └───────────┘   └───────────┘   └───────────┘
```

---

## Bonnes pratiques

### Checklist réseau

1. **Plan d'adressage**
   - [ ] Utiliser un CIDR `/16` pour le VPC (assez d'espace)
   - [ ] Ne pas chevaucher les CIDR avec d'autres VPC ou le réseau on-premise
   - [ ] Documenter le plan d'adressage

2. **Sous-réseaux**
   - [ ] Minimum 2 AZ (idéalement 3) pour la haute disponibilité
   - [ ] Séparer public / privé / données
   - [ ] Les bases de données dans des sous-réseaux dédiés sans accès Internet

3. **Sécurité**
   - [ ] Security Groups : principe du moindre privilège
   - [ ] Référencer des SG plutôt que des CIDR quand possible
   - [ ] NACLs en couche supplémentaire pour les sous-réseaux sensibles
   - [ ] Activer les VPC Flow Logs

4. **Coûts**
   - [ ] VPC Endpoint Gateway pour S3 et DynamoDB (gratuit, économise le NAT)
   - [ ] Un NAT Gateway par AZ (éviter le trafic cross-AZ)
   - [ ] Surveiller les coûts de transfert de données

5. **Connectivité**
   - [ ] VPC Peering pour 2-3 VPC
   - [ ] Transit Gateway pour des architectures à plusieurs VPC
   - [ ] VPN ou Direct Connect pour la connectivité on-premise

---

## Résumé du module

| Concept | Points clés |
|---------|-------------|
| VPC | Réseau isolé, régional, CIDR /16 à /28 |
| Sous-réseaux | Public (route IGW) vs Privé (route NAT), liés à une AZ |
| Internet Gateway | Porte vers Internet, 1 par VPC, gratuit |
| NAT Gateway | Accès Internet sortant pour sous-réseaux privés, ~0,05 $/h |
| Tables de routage | Dirigent le trafic, route la plus spécifique gagne |
| Security Groups | Stateful, Allow only, niveau instance |
| NACLs | Stateless, Allow + Deny, niveau sous-réseau |
| VPC Peering | Connexion privée entre VPC, non transitif |
| VPC Endpoints | Accès privé aux services AWS, Gateway (S3/DDB) ou Interface |

