---
titre: Sécurité AWS avancée — chiffrement, secrets et garde-fous
cours: 12-aws-cloud
notions: [chiffrement at rest, chiffrement in transit, "KMS — customer managed vs AWS managed vs AWS owned key", envelope encryption, "GenerateDataKey", data key, key policy, "rotation automatique KMS (365 j)", "Secrets Manager (rotation via Lambda)", "Parameter Store SecureString", WAF, "web ACL", "règles rate-based", "AWS Managed Rules", GuardDuty, "sources fondamentales GuardDuty (CloudTrail, VPC Flow Logs, DNS)", Security Hub, "SCP (Service Control Policy)", "permissions boundary", "VPC endpoints / PrivateLink"]
outcomes:
  - sait expliquer l'envelope encryption et le rôle d'une KMS key comme clé d'enrobage
  - sait choisir entre Secrets Manager et Parameter Store SecureString selon le besoin de rotation
  - sait décrire ce que protège WAF et ce que détecte GuardDuty, et où les brancher
  - sait distinguer une SCP d'une permissions boundary et poser un garde-fou au bon niveau
prerequis: [Modules 00-14 du cours AWS (dont 01 IAM et 02 VPC), notions de chiffrement symétrique]
next: 16-architectures-serverless
libs: []
tribuzen: sécurité de l'infra TribuZen — chiffrement KMS des avatars et du feed, secrets d'API dans Secrets Manager, WAF devant l'API, garde-fous SCP et permissions boundaries
last-reviewed: 2026-07
---

<!-- FLAG-REVIEW: SÉCURITÉ AWS — à valider par Sylvain -->

# Sécurité AWS avancée — chiffrement, secrets et garde-fous

> **Outcomes — tu sauras FAIRE :** expliquer l'envelope encryption avec KMS, choisir Secrets Manager ou Parameter Store, décrire ce que protègent WAF et GuardDuty, distinguer une SCP d'une permissions boundary.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module **approfondit la sécurité** au-delà d'IAM (module 01). IAM répond à *qui a le droit de faire quoi*. Ici on ajoute les couches suivantes : **chiffrer** les données (KMS), **stocker les secrets** (Secrets Manager / Parameter Store), **filtrer le trafic** (WAF), **détecter les menaces** (GuardDuty, Security Hub) et **poser des garde-fous** organisationnels (SCP, permissions boundaries). On ne réexplique pas la mécanique des policies IAM — elle est acquise au module 01.

## 1. Cas concret d'abord

L'API de TribuZen doit appeler un fournisseur d'envoi d'e-mails transactionnels (confirmation d'invitation à une famille). Un collègue a « fait au plus vite » :

```ts
// handler Lambda — AVANT
const MAILER_API_KEY = 'sk_live_9f2c8b1a7d4e...' // ❌ secret en dur dans le code

export const handler = async (event) => {
  await sendEmail(MAILER_API_KEY, event.to, event.body)
}
```

Et côté stockage, les avatars uploadés par les familles sont dans un bucket S3 **sans chiffrement configuré explicitement**, avec le bucket accessible directement depuis Internet.

Quatre problèmes concrets, tous sanctionnés en revue de sécurité :

1. **Le secret est dans le code.** Il part dans Git, dans les logs de build, dans l'historique. Quiconque lit le dépôt (ou une fuite de dépôt) obtient une clé de production réutilisable. Il faut le **sortir du code** et le **chiffrer au repos**.
2. **Aucune rotation.** Si la clé fuit, il n'existe aucun mécanisme pour la remplacer automatiquement sans redéployer.
3. **Les avatars ne sont pas maîtrisés côté chiffrement.** On veut un chiffrement **at rest** dont *on* contrôle la clé et l'audit.
4. **Rien ne filtre le trafic entrant ni ne détecte un comportement anormal** (scan, exfiltration, bruteforce sur l'endpoint d'invitation).

À la fin de ce module, tu sais : mettre la clé du mailer dans **Secrets Manager** (chiffrée par **KMS**, avec rotation), chiffrer les avatars avec une **KMS key** que tu gouvernes, poser un **WAF** devant l'API, activer **GuardDuty**, et empêcher structurellement les erreurs via une **SCP** et une **permissions boundary**.

---

## 2. Théorie complète, concise

### 2.1 Chiffrement at rest vs in transit

Deux surfaces distinctes, deux mécanismes :

- **In transit** — les données qui circulent sur le réseau, protégées par **TLS** (HTTPS). Entre le client et CloudFront/API Gateway, entre les services AWS. C'est le chiffrement du *transport*.
- **At rest** — les données *stockées* (objets S3, volumes EBS, tables DynamoDB, secrets). Protégées par un chiffrement dont les clés sont gérées par **KMS**. C'est ce que ce module détaille.

Les deux sont nécessaires et complémentaires : TLS ne protège pas un disque volé, le chiffrement at rest ne protège pas une interception réseau.

### 2.2 KMS — vocabulaire à jour et types de clés

**AWS KMS** (Key Management Service) gère des clés de chiffrement. Le terme officiel actuel est **KMS key** (l'ancien « CMK / Customer Master Key » est déprécié dans la doc). Trois types, vérifiés doc KMS :

| Type de KMS key | Qui la gère | Contrôle / audit | Coût |
|-----------------|-------------|------------------|------|
| **Customer managed key** | toi (création, key policy, rotation, suppression) | contrôle total, auditable via CloudTrail | frais mensuels + à l'usage |
| **AWS managed key** | un service AWS, en ton nom (alias `aws/<service>`) | visible, auditable, mais **non modifiable** par toi | pas de frais mensuel, frais à l'usage (parfois pris en charge) |
| **AWS owned key** | AWS, dans un compte AWS (hors du tien) | **non visible, non auditable** | gratuit |

Règle : utilise une **customer managed key** quand le **contrôle et l'audit** comptent (données sensibles, conformité) ; une **AWS managed / owned key** quand la **commodité** prime.

### 2.3 Envelope encryption — le mécanisme central

Une KMS key symétrique est faite pour chiffrer de **petites** quantités de données (l'opération `Encrypt` est limitée à quelques kilo-octets — 4 Ko côté doc KMS). On ne chiffre donc **pas** un gros fichier directement avec elle. On utilise l'**envelope encryption** : la KMS key sert de **clé d'enrobage** (*wrapping key* / *key-encryption key*) qui chiffre une **data key**, et c'est la data key qui chiffre les données.

Déroulé (opération `GenerateDataKey`) :

```
1. Application → KMS.GenerateDataKey(KeyId = ta KMS key)
   KMS renvoie :
     - la data key EN CLAIR   (pour chiffrer maintenant)
     - la data key CHIFFRÉE   (à stocker à côté des données)

2. L'application chiffre le fichier avec la data key en clair,
   puis EFFACE la data key en clair de la mémoire.
   On stocke : [fichier chiffré] + [data key chiffrée]

3. Pour déchiffrer : Application → KMS.Decrypt(data key chiffrée)
   KMS renvoie la data key en clair → l'application déchiffre le fichier.
```

Pourquoi ce double niveau (vérifié doc KMS) :
1. **Sécurité** — la KMS key (matière cryptographique) **ne quitte jamais KMS** (HSM). Seules les data keys circulent.
2. **Performance** — le gros du chiffrement se fait localement avec la data key, sans appel réseau par octet.
3. **Rayon de souffle** — chaque fichier peut avoir sa propre data key ; les KMS keys, utilisées comme clés d'enrobage, sont peu réutilisées (risque d'épuisement de clé quasi nul).

Concrètement, quand tu actives « chiffrement SSE-KMS » sur un bucket S3 ou un volume EBS, **c'est exactement ce mécanisme** que le service exécute pour toi.

### 2.4 Key policy — le contrôle d'accès de la clé

Une KMS key a sa propre **key policy** (une resource-based policy). C'est le contrôle d'accès *de la clé* : il s'ajoute aux policies IAM. Bonne pratique doc KMS : **séparer les rôles** *administrateur de clé* (gérer le cycle de vie : `kms:Create*`, `kms:Disable*`, `kms:ScheduleKeyDeletion`…) et *utilisateur de clé* (chiffrer/déchiffrer : `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`). Un rôle applicatif n'a jamais besoin d'administrer la clé.

### 2.5 Rotation automatique KMS

Vérifié doc KMS :
- Pour une **customer managed key** symétrique (origine `AWS_KMS`), la rotation automatique est **optionnelle**. Activée, KMS génère une nouvelle matière cryptographique tous les **365 jours par défaut** ; on peut fixer une **période personnalisée** (`RotationPeriodInDays`). Une **rotation on-demand** est aussi possible à tout moment.
- Pour une **AWS managed key**, la rotation est **automatique tous les ~365 jours**, non désactivable (depuis mai 2022 ; c'était 3 ans avant).
- La rotation change la matière **sans changer l'identifiant** de la clé : le déchiffrement des anciens ciphertexts reste transparent (KMS retrouve la bonne version).

### 2.6 Secrets Manager vs Parameter Store

Deux façons de sortir un secret du code :

**AWS Secrets Manager** (vérifié doc) gère et fait **tourner** (rotation) des credentials de base de données, clés d'API, tokens OAuth, etc. Points clés :
- **Rotation automatique** via une **fonction Lambda** (planifiée) — c'est sa valeur ajoutée majeure.
- Les secrets sont **chiffrés par KMS** : la clé AWS managed `aws/secretsmanager` est **gratuite**, ou tu fournis ta propre KMS key (facturée au tarif KMS).
- On paie « à l'usage » (par secret et par appel) ; pas de facturation pour un secret marqué en suppression.

Récupération dans une Lambda :

```ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const client = new SecretsManagerClient({})

async function getMailerKey(): Promise<string> {
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: 'tribuzen/prod/mailer-api-key' }),
  )
  return res.SecretString ?? ''
}
```

**SSM Parameter Store** stocke de la **configuration**. Un paramètre de type **`SecureString`** est chiffré via KMS. Le tier **standard est gratuit**. Il **n'a pas** de rotation intégrée (à faire soi-même).

Règle de choix simple :

| Besoin | Service |
|--------|---------|
| Credential de base de données, clé d'API tierce, **rotation** attendue | **Secrets Manager** |
| Configuration applicative, feature flags, valeurs non secrètes | **Parameter Store** (String) |
| Valeur secrète simple, **sans** besoin de rotation, à moindre coût | **Parameter Store** (`SecureString`) |

> La doc AWS précise aussi : pour des **credentials AWS**, on n'utilise ni l'un ni l'autre mais **IAM (roles)** ; pour des **clés de chiffrement**, **KMS** ; pour des **certificats**, **ACM**. Secrets Manager / Parameter Store, c'est pour les secrets *applicatifs*.

### 2.7 WAF — filtrer le trafic HTTP/HTTPS (couche 7)

**AWS WAF** (Web Application Firewall) surveille les requêtes HTTP/HTTPS envoyées à une ressource protégée et autorise, bloque, compte, ou soumet à CAPTCHA/challenge. Vérifié doc : il protège notamment une **distribution CloudFront**, une **API Gateway REST API**, un **Application Load Balancer**, une **AppSync GraphQL API**, un **Cognito user pool**, un **App Runner service**, etc.

- La configuration se fait dans une **web ACL** (Web Access Control List) : une liste de **règles** évaluées, avec une **action par défaut** (Allow ou Block).
- Critères de match : IP source, pays d'origine, en-têtes, chaînes ou regex dans la requête, taille, présence d'**injection SQL**, présence de **XSS**.
- **AWS Managed Rules** : des groupes de règles pré-packagés par AWS (et le Marketplace) — protections courantes réutilisables.
- **Règles rate-based** : bloquent une IP qui dépasse un seuil de requêtes sur une fenêtre (par minute ou 5 minutes) — utile contre bruteforce et scraping.

Pour le DDoS réseau (couches 3/4), **AWS Shield Standard** est **inclus automatiquement, sans coût supplémentaire** ; **Shield Advanced** (payant) ajoute une protection L3/L4/L7 renforcée et l'accès à la Shield Response Team.

### 2.8 GuardDuty et Security Hub — détecter, agréger

**Amazon GuardDuty** est un service de **détection de menaces** qui analyse en continu des données de ton environnement à l'aide de renseignements sur les menaces et de ML. Vérifié doc :
- **Sources fondamentales** ingérées automatiquement dès l'activation : **CloudTrail management events**, **VPC Flow Logs**, **DNS logs**. Rien d'autre à activer pour ces sources.
- **Plans de protection** optionnels pour élargir : S3 data events, EKS audit logs, activité de login RDS, EBS, Runtime Monitoring, activité réseau Lambda.
- Détecte par ex. : credentials compromis, exfiltration/ransomware, **cryptomining** sur EC2, malware.
- Produit des **findings** avec une **sévérité** (de faible à critique). On peut réagir en quasi temps réel via **EventBridge** (ex. isoler une instance, alerter).

**AWS Security Hub** **agrège** les findings de plusieurs services (GuardDuty, Inspector, Macie…) en une vue unifiée et évalue le compte contre des **standards** de bonnes pratiques (AWS Foundational Security Best Practices, CIS…).

### 2.9 SCP vs permissions boundary — deux garde-fous, deux niveaux

Ces deux mécanismes **limitent** des permissions maximales ; **aucun des deux n'accorde** de permission. Ne pas les confondre (vérifié doc Organizations + IAM) :

| | **SCP** (Service Control Policy) | **Permissions boundary** |
|---|---|---|
| S'attache à | une **OU** ou un **compte** (via AWS Organizations) | **un** IAM user **ou** un IAM role |
| Portée | **tous** les users/roles du/des comptes concernés (y compris le root du compte membre) | l'entité IAM ciblée uniquement |
| Effet | **plafond** de permissions du compte | **plafond** de permissions de l'entité |
| N'affecte pas | le **management account** de l'org ; les service-linked roles | — |
| Requiert | Organizations avec « all features » | rien (feature IAM) |

**Permission effective** = **intersection** de toutes les couches qui s'appliquent. Si une SCP, une permissions boundary et une policy identity sont toutes présentes, **les trois** doivent autoriser l'action. Et — comme au module 01 — **un `Deny` explicite dans n'importe laquelle l'emporte toujours**.

Exemples typiques :
- **SCP** « restreindre aux régions autorisées », « interdire de désactiver CloudTrail », « interdire de quitter l'organisation ».
- **Permissions boundary** : déléguer la création d'utilisateurs à un admin junior **sans** qu'il puisse créer des users plus puissants que lui — le boundary plafonne ce que les users créés peuvent recevoir.

### 2.10 Réseau privé — VPC endpoints / PrivateLink (rappel sécurité)

Par défaut, un appel d'une ressource privée vers un service AWS (S3, Secrets Manager, KMS…) peut transiter par Internet (via NAT). Les **VPC endpoints** permettent d'atteindre ces services **sans sortir sur Internet** : *Gateway endpoints* (S3, DynamoDB, gratuits, via table de routage) et *Interface endpoints* (**PrivateLink**, une ENI privée dans ton VPC, pour la plupart des services : Secrets Manager, KMS, SQS…). Bénéfice sécurité : la surface d'exposition diminue, le trafic reste sur le réseau AWS.

---

## 3. Worked examples

### Exemple 1 — Sortir la clé du mailer et chiffrer les avatars (TribuZen)

On reprend le cas concret et on le corrige de bout en bout.

**Étape 1 — créer une customer managed key pour TribuZen (AWS CLI) :**

```bash
# Crée la KMS key (customer managed, symétrique par défaut)
aws kms create-key \
  --description "TribuZen data encryption key" \
  --tags TagKey=app,TagValue=tribuzen

# Alias lisible pour ne pas manipuler l'ID brut
aws kms create-alias \
  --alias-name alias/tribuzen-data \
  --target-key-id <key-id-retourné-ci-dessus>

# Rotation automatique annuelle (365 j par défaut)
aws kms enable-key-rotation --key-id alias/tribuzen-data
```

**Étape 2 — mettre la clé du mailer dans Secrets Manager, chiffrée par cette KMS key :**

```bash
aws secretsmanager create-secret \
  --name tribuzen/prod/mailer-api-key \
  --secret-string 'sk_live_9f2c8b1a7d4e...' \
  --kms-key-id alias/tribuzen-data
```

**Étape 3 — le handler lit le secret au runtime (plus rien en dur) :**

```ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const client = new SecretsManagerClient({})
let cached: string | undefined // cache d'invocation : évite un appel par requête

async function getMailerKey(): Promise<string> {
  if (cached) return cached
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: 'tribuzen/prod/mailer-api-key' }),
  )
  cached = res.SecretString ?? ''
  return cached
}

export const handler = async (event: { to: string; body: string }) => {
  const apiKey = await getMailerKey()
  await sendEmail(apiKey, event.to, event.body)
}
```

**Étape 4 — la Lambda a besoin des droits (rappel module 01, moindre privilège)** : sa permission policy autorise `secretsmanager:GetSecretValue` sur l'ARN **exact** du secret **et** `kms:Decrypt` sur l'ARN de la KMS key (Secrets Manager déchiffre via KMS pour ton compte) :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadMailerSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:eu-west-3:111122223333:secret:tribuzen/prod/mailer-api-key-*"
    },
    {
      "Sid": "DecryptWithTribuZenKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:eu-west-3:111122223333:key/<key-id>"
    }
  ]
}
```

**Étape 5 — chiffrer les avatars** : sur le bucket, activer le chiffrement par défaut **SSE-KMS** avec `alias/tribuzen-data`. S3 exécute alors l'envelope encryption (§2.3) à chaque `PutObject` — l'objet est chiffré au repos sous une data key protégée par ta KMS key.

Résultat : le secret n'est plus dans le code, il est chiffré et **rotable** ; les avatars sont chiffrés at rest avec une clé que tu **audites** et **rotates**.

### Exemple 2 — Poser un garde-fou avec une SCP

TribuZen n'opère qu'en `eu-west-3` (Paris) et `eu-west-1` (Irlande). On veut **empêcher structurellement** tout déploiement dans une autre région, y compris par un admin distrait. Ce n'est pas une policy IAM (contournable par un autre Allow) : c'est une **SCP** posée sur l'OU de production.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideEurope",
      "Effect": "Deny",
      "NotAction": [
        "iam:*",
        "kms:*",
        "cloudfront:*",
        "route53:*",
        "support:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["eu-west-3", "eu-west-1"]
        }
      }
    }
  ]
}
```

Lecture :
- La SCP **ne donne rien** : elle **plafonne**. Les permissions réelles restent l'**intersection** SCP ∩ policies IAM.
- Le `Deny` sur toute action **hors** des deux régions rend impossible, pour *n'importe quel* user/role des comptes de l'OU (root du compte membre inclus), de créer une ressource ailleurs.
- On exclut via `NotAction` les services **globaux** (IAM, KMS pour certaines opérations, CloudFront, Route 53) qui ne sont pas régionaux — sinon on se bloquerait soi-même.
- **Rappel** : la SCP n'affecte **pas** le management account de l'organisation ni les service-linked roles.

Si on voulait plafonner **une seule** identité (un admin junior) plutôt qu'un compte entier, on n'utiliserait pas une SCP mais une **permissions boundary** attachée à ce user précis.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que KMS chiffre les gros fichiers directement

Faux. Une KMS key symétrique chiffre de **petites** données (≈ 4 Ko pour `Encrypt`). Pour un fichier, on fait de l'**envelope encryption** : `GenerateDataKey` → la data key chiffre le fichier, la KMS key ne chiffre que la data key. Vouloir passer un gros objet à `Encrypt` échoue — et de toute façon, ce n'est pas le rôle de la clé d'enrobage.

### PIÈGE #2 — Confondre les types de KMS keys

- **Customer managed key** : *tu* la crées, la gouvernes, choisis sa rotation, l'audites. Frais mensuels.
- **AWS managed key** (`aws/<service>`) : gérée par le service, visible et auditable mais **non modifiable**, rotation annuelle imposée.
- **AWS owned key** : hors de ton compte, **ni visible ni auditable**, gratuite.

Pour de la conformité ou un audit fin → **customer managed key**. Croire qu'on « contrôle » une AWS owned key est faux : on ne la voit même pas.

### PIÈGE #3 — Mettre un secret dans Parameter Store en attendant une rotation « automatique »

Parameter Store `SecureString` **chiffre** le paramètre, mais **n'a pas** de rotation intégrée. Si le besoin est une **rotation** (credential de base, clé d'API critique), c'est **Secrets Manager** (rotation via Lambda). Choisir Parameter Store pour un credential rotatif, c'est se condamner à une rotation manuelle jamais faite.

### PIÈGE #4 — Confondre SCP et permissions boundary

- **SCP** : niveau **organisation** (OU / compte), plafonne **tout le monde** dans le compte, n'affecte pas le management account.
- **Permissions boundary** : niveau **une entité IAM** (un user / un role), plafonne **cette** entité.

Les deux **plafonnent** et **n'accordent rien**. Utiliser une permissions boundary pour verrouiller un compte entier (ou une SCP pour un seul user) revient à choisir le mauvais outil et à laisser des trous.

### PIÈGE #5 — Croire qu'une SCP ou un boundary « donne » des droits

Non. Ni une SCP ni une permissions boundary n'accordent la moindre permission. Il **faut toujours** une policy IAM qui autorise l'action ; la SCP/boundary ne fait que **retrancher**. Un user sans policy IAM n'a **aucun** droit, même si la SCP « autorise tout ». Permission effective = **intersection**, et un `Deny` explicite l'emporte partout.

### PIÈGE #6 — Penser que WAF ou GuardDuty « bloquent » à la place l'un de l'autre

Ce sont des rôles **différents** et complémentaires : **WAF** *filtre* le trafic HTTP/HTTPS entrant (couche 7, en amont d'une ressource comme CloudFront/API Gateway/ALB) ; **GuardDuty** *détecte* des menaces en analysant des logs (CloudTrail, VPC Flow Logs, DNS) et **produit des findings** — il ne bloque pas le trafic lui-même. Attendre de GuardDuty qu'il bloque une injection SQL, ou de WAF qu'il détecte un cryptomining sur EC2, c'est se tromper de couche.

### PIÈGE #7 — Oublier le chiffrement in transit en croyant le at rest suffisant

Chiffrer S3/EBS au repos (KMS) ne protège **pas** une donnée interceptée sur le réseau. Il faut **aussi** TLS (in transit). Les deux couches sont indépendantes ; la défense en profondeur exige les deux.

---

## 5. Ancrage TribuZen

La sécurité avancée s'applique à toute l'infra TribuZen vue dans le fil-rouge cloud :

| Élément TribuZen | Mécanisme de ce module |
|------------------|------------------------|
| Clé d'API du mailer, credentials RDS | **Secrets Manager**, chiffrés par `alias/tribuzen-data`, rotation planifiée |
| Configuration non secrète (URLs, feature flags) | **Parameter Store** (String / SecureString) |
| Avatars S3, feed DynamoDB, volumes | **chiffrement at rest SSE-KMS** avec la customer managed key TribuZen |
| CloudFront devant l'API (HTTP API + Lambda) | **WAF** : AWS Managed Rules + règle **rate-based** sur l'endpoint d'invitation. WAF ne s'attache **pas** à une HTTP API (v2) — on le pose sur **CloudFront devant l'API** (REST API / ALB / CloudFront seulement). |
| Compte AWS TribuZen | **GuardDuty** activé (sources fondamentales) + **Security Hub** pour la vue consolidée |
| Comptes de l'organisation | **SCP** « régions Europe uniquement » + « interdiction de désactiver CloudTrail » sur l'OU prod |
| Accès délégué (admin junior) | **permissions boundary** plafonnant ce qu'il peut créer |
| Appels Lambda → Secrets Manager / KMS | **Interface VPC endpoints** (PrivateLink) pour rester hors Internet |

Principes appliqués côté TribuZen :

- **Aucun secret dans le code** ni les variables d'environnement en clair — tout passe par Secrets Manager / Parameter Store.
- **Chiffrement de bout en bout** : TLS in transit **et** SSE-KMS at rest, avec une clé que TribuZen **gouverne et audite**.
- **Séparation des rôles de clé** : le rôle applicatif n'a que `kms:Decrypt`/`GenerateDataKey`, jamais l'administration de la clé.
- **Garde-fous structurels** : les SCP rendent certaines erreurs *impossibles*, pas seulement « interdites par convention ».
- Toutes ces ressources (KMS key, secret, WAF, endpoints) sont produites par le **CDK** (module 05) — on ne clique pas en console en production.

> Rappel de portée : *qui a le droit* (roles, policies, trust policy) relève du **module 01 (IAM)**. Ce module ajoute *comment on chiffre, où sont les secrets, ce qui filtre et détecte, et quels garde-fous plafonnent le tout*.

---

## 6. Points clés

1. **In transit** (TLS) et **at rest** (KMS) sont deux couches distinctes et toutes deux nécessaires.
2. Le terme actuel est **KMS key** ; trois types : **customer managed** (contrôle/audit, payante), **AWS managed** (`aws/<service>`, non modifiable), **AWS owned** (invisible, gratuite).
3. **Envelope encryption** : la KMS key (clé d'enrobage) chiffre une **data key** via `GenerateDataKey` ; la data key chiffre les données. La KMS key **ne quitte jamais KMS**.
4. Rotation KMS : **optionnelle** et **365 j par défaut** (personnalisable) pour une customer managed key ; **imposée annuellement** pour une AWS managed key.
5. **Secrets Manager** = secrets **avec rotation** (via Lambda), chiffrés par KMS ; **Parameter Store `SecureString`** = secret chiffré **sans** rotation intégrée (tier standard gratuit).
6. **WAF** filtre le HTTP/HTTPS (web ACL, règles, AWS Managed Rules, rate-based) devant CloudFront / API Gateway / ALB ; **Shield Standard** (DDoS L3/L4) est inclus gratuitement.
7. **GuardDuty** *détecte* (findings) via CloudTrail + VPC Flow Logs + DNS ; **Security Hub** *agrège* et note contre des standards. Détecter ≠ filtrer.
8. **SCP** (OU/compte, tout le monde) et **permissions boundary** (une entité IAM) **plafonnent** sans rien accorder ; permission effective = **intersection**, `Deny` explicite prioritaire.

---

## 7. Seeds Anki

```
Pourquoi ne chiffre-t-on pas un gros fichier directement avec une KMS key ?|Une KMS key symétrique ne chiffre que de petites données (~4 Ko pour Encrypt) et ne sort jamais de KMS. On fait de l'envelope encryption : GenerateDataKey renvoie une data key, la data key chiffre le fichier, la KMS key ne chiffre que la data key.
Quels sont les trois types de KMS key et lequel choisir pour l'audit/conformité ?|Customer managed key (tu la gouvernes, payante, auditable), AWS managed key (aws/service, non modifiable, rotation annuelle imposée), AWS owned key (hors de ton compte, invisible, gratuite). Pour l'audit/conformité : customer managed key.
Rotation automatique d'une customer managed key KMS : optionnelle ? quelle période ?|Optionnelle. Une fois activée, 365 jours par défaut (période personnalisable via RotationPeriodInDays), plus rotation on-demand possible. La rotation change la matière sans changer l'ID de la clé.
Secrets Manager vs Parameter Store SecureString : la différence décisive ?|Secrets Manager fait la rotation automatique (via une Lambda) et chiffre par KMS ; Parameter Store SecureString chiffre aussi (KMS) mais n'a pas de rotation intégrée, et son tier standard est gratuit. Besoin de rotation -> Secrets Manager.
Que protège WAF, et quelles ressources peut-il couvrir ?|WAF filtre les requêtes HTTP/HTTPS (couche 7) via une web ACL : IP, pays, regex, injection SQL, XSS, règles rate-based, AWS Managed Rules. Il protège CloudFront, API Gateway REST API, ALB, AppSync, Cognito user pool, App Runner, etc.
GuardDuty : quelles sources fondamentales analyse-t-il, et bloque-t-il le trafic ?|Il ingère automatiquement CloudTrail management events, VPC Flow Logs et DNS logs (plans de protection optionnels : S3, EKS, RDS...). Il DÉTECTE (findings avec sévérité), il ne bloque pas le trafic ; on réagit via EventBridge.
SCP vs permissions boundary : niveau et effet ?|SCP s'attache à une OU/un compte (Organizations) et plafonne tous les users/roles du compte (root membre inclus, sauf management account). Permissions boundary s'attache à UN user ou role et plafonne cette entité. Les deux plafonnent, aucun n'accorde de droit.
Comment se calcule la permission effective avec SCP + permissions boundary + policy IAM ?|C'est l'intersection des trois : l'action n'est permise que si les trois l'autorisent. Un Deny explicite dans n'importe laquelle l'emporte toujours. Sans policy IAM qui accorde l'action, l'entité n'a aucun droit.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-15-security/README.md`. Tu crées une **vraie** customer managed KMS key, tu stockes un secret dans **Secrets Manager** chiffré par cette clé, tu écris une **Lambda** de moindre privilège qui le lit, puis tu **détruis tout** (teardown, coût AWS). Corrigé complet AWS CLI, feedback coach, variante J+30.
