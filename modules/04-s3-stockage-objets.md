---
titre: "S3 : stockage d'objets"
cours: 12-aws-cloud
notions: [buckets et objets, "classes de stockage (Standard, IA, Glacier)", versioning, lifecycle, "bucket policy vs IAM", block public access, presigned URLs, static website hosting]
outcomes:
  - sait créer un bucket, uploader/lister des objets en Console et en CLI
  - sait choisir une classe de stockage selon la fréquence d'accès et le coût
  - sait activer le versioning et poser une lifecycle rule
  - sait distinguer bucket policy et politique IAM et sécuriser un bucket avec Block Public Access
  - sait générer une presigned URL pour un upload direct navigateur vers S3
prerequis: [modules 00-03 du cours 12-aws-cloud (compte, régions, IAM, réseau, EC2)]
next: 05-cdk-infrastructure-code
libs: []
tribuzen: infra cloud TribuZen — stockage S3 des avatars et photos de tribu, upload direct par presigned URL
last-reviewed: 2026-07
---

# S3 : stockage d'objets

> **Outcomes — tu sauras FAIRE :** créer et remplir un bucket (Console + CLI), choisir une classe de stockage, activer le versioning + une lifecycle rule, sécuriser un bucket (bucket policy vs IAM, Block Public Access), générer une presigned URL d'upload.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **S3 seul**. Mettre un CDN **CloudFront devant S3** (HTTPS, cache, OAC) est le sujet du **module 13**. Le chiffrement KMS avancé et Object Lock relèvent du **module 15 (sécurité AWS avancée)**. Ici on reste sur le stockage, l'accès et le cycle de vie des objets.

## 1. Cas concret d'abord

Tu travailles sur l'infra TribuZen. La première demande produit : les membres d'une tribu doivent pouvoir **uploader une photo d'avatar**. Un dev a codé ça dans le back Node :

```
Navigateur ──(POST fichier 3 Mo)──▶ API Node (EC2) ──(PutObject)──▶ S3
```

Trois problèmes concrets apparaissent en prod :

1. **Le fichier transite par ton serveur.** Chaque avatar de 3 Mo occupe la RAM et la bande passante de l'instance EC2. À 500 uploads simultanés, l'API sature — alors que S3, lui, encaisserait sans broncher.
2. **Où sont les credentials AWS ?** Le serveur a une clé pour écrire dans S3. Si tu voulais laisser le navigateur écrire *directement*, il te faudrait exposer une clé AWS au client — inacceptable.
3. **Le bucket est-il public ?** Le premier réflexe (« je mets le bucket en public pour que les avatars s'affichent ») ouvre la porte à n'importe qui pour lister et écraser tes fichiers.

Ce module répond aux trois : **presigned URL** pour que le navigateur écrive dans S3 sans credential et sans passer par ton serveur, **Block Public Access + bucket policy** pour n'exposer que ce qui doit l'être, et **classes de stockage + lifecycle** pour ne pas payer le prix fort sur des vieilles photos jamais reconsultées.

---

## 2. Théorie complète, concise

### 2.1 Buckets et objets

**S3** (Simple Storage Service) est un stockage **d'objets** : tu ranges des fichiers, pas des blocs (EBS) ni un système de fichiers (EFS). Deux niveaux seulement :

- **Bucket** — le conteneur. Son nom est **unique dans tout AWS** (pas juste ton compte), 3 à 63 caractères, minuscules/chiffres/tirets. Un bucket vit dans **une région**.
- **Objet** — un fichier + ses métadonnées, identifié par sa **key** (chemin complet). Un objet pèse de 0 octet à **5 To**.

Il n'y a **pas de vrais dossiers** dans S3. `avatars/tribu-42/alice.jpg` est une seule key ; le `/` n'est qu'une convention de préfixe que la Console affiche comme une arborescence.

```bash
# Créer un bucket (région explicite)
aws s3 mb s3://tribuzen-avatars-eu-west-3 --region eu-west-3

# Uploader un objet
aws s3 cp alice.jpg s3://tribuzen-avatars-eu-west-3/avatars/tribu-42/alice.jpg

# Lister sous un préfixe
aws s3 ls s3://tribuzen-avatars-eu-west-3/avatars/tribu-42/

# Synchroniser un dossier local (utile pour un site statique)
aws s3 sync ./dist s3://tribuzen-site --delete
```

> Durabilité annoncée : **99,999999999 %** (« 11 neufs ») — les objets sont répliqués sur **au moins 3 zones de disponibilité** pour les classes multi-AZ (voir 2.2). Durabilité ≠ disponibilité : la première dit « tes octets ne sont pas perdus », la seconde « le service répond ».

### 2.2 Classes de stockage

Une classe de stockage se choisit **par objet**, selon la fréquence d'accès. Toutes offrent la même durabilité (11 neufs) sauf `REDUCED_REDUNDANCY` (déconseillée). Chiffres vérifiés sur la doc AWS :

| Classe (constante API) | AZ | Durée min de stockage | Taille min facturée | Usage type |
|---|---|---|---|---|
| S3 Standard (`STANDARD`) | ≥ 3 | aucune | aucune | Données chaudes, accès fréquent |
| S3 Intelligent-Tiering (`INTELLIGENT_TIERING`) | ≥ 3 | aucune | aucune | Accès imprévisible (frais de monitoring/objet) |
| S3 Standard-IA (`STANDARD_IA`) | ≥ 3 | 30 jours | 128 Ko | Accès rare mais immédiat requis |
| S3 One Zone-IA (`ONEZONE_IA`) | 1 | 30 jours | 128 Ko | Données recréables (1 seule AZ) |
| S3 Glacier Instant Retrieval (`GLACIER_IR`) | ≥ 3 | 90 jours | 128 Ko | Archive avec accès milliseconde |
| S3 Glacier Flexible Retrieval (`GLACIER`) | ≥ 3 | 90 jours | — | Archive, restauration minutes→heures |
| S3 Glacier Deep Archive (`DEEP_ARCHIVE`) | ≥ 3 | 180 jours | — | Archive froide, restauration en heures |

Points à retenir :

- **IA et Glacier facturent la récupération** (frais par Go) + une durée minimale : supprimer un objet `STANDARD_IA` avant 30 jours te facture quand même 30 jours. Ne mets pas des données chaudes en IA « pour économiser » : tu paieras plus.
- **One Zone-IA** est sur **une seule AZ** : moins cher, mais un sinistre de cette AZ perd les données. Réservé au recréable.
- **Intelligent-Tiering** déplace *automatiquement* les objets entre paliers selon l'accès réel — pas de frais de récupération, mais un petit **frais de monitoring par objet**. Les objets **< 128 Ko ne sont pas monitorés** et restent en accès fréquent. Transitions automatiques : 30 jours sans accès → Infrequent Access, 90 jours → Archive Instant Access ; paliers asynchrones optionnels Archive Access (≥ 90 j) et Deep Archive Access (≥ 180 j).

```bash
# Uploader directement dans une classe précise
aws s3 cp export.zip s3://mon-bucket/archives/ --storage-class GLACIER_IR
```

### 2.3 Versioning

Le **versioning** conserve chaque version d'un objet au lieu de l'écraser. Un bucket est dans **un des trois états** : `Unversioned` (défaut), `Enabled`, `Suspended`.

Règle importante (doc AWS) : **une fois activé, un bucket ne peut jamais redevenir `Unversioned`** — on peut seulement *suspendre* le versioning. Les objets présents avant activation ont un version ID `null` ; ils ne changent pas, seul le traitement des futures requêtes change.

```bash
aws s3api put-bucket-versioning \
  --bucket tribuzen-avatars-eu-west-3 \
  --versioning-configuration Status=Enabled
```

Comportement une fois activé :

- Chaque `PUT` crée une **nouvelle version** (version ID unique) ; l'ancienne reste.
- Un `DELETE` sans version ID **n'efface pas** l'objet : il pose un **delete marker** qui devient la version courante. L'objet « disparaît » des listings normaux mais toutes ses versions sont récupérables. Supprimer le delete marker « ressuscite » l'objet.
- Chaque version est **facturée comme un objet entier** (pas un diff). D'où l'intérêt d'une lifecycle rule pour purger les versions non courantes.

### 2.4 Lifecycle

Une **lifecycle rule** automatise transitions de classe et expirations. Deux familles d'actions : sur la version **courante** (`Transitions`, `Expiration`) et sur les versions **non courantes** (`NoncurrentVersionTransitions`, `NoncurrentVersionExpiration`), plus le nettoyage des uploads multipart inachevés.

```json
{
  "Rules": [
    {
      "ID": "avatars-refroidissement",
      "Status": "Enabled",
      "Filter": { "Prefix": "avatars/" },
      "Transitions": [
        { "Days": 90,  "StorageClass": "STANDARD_IA" },
        { "Days": 365, "StorageClass": "GLACIER_IR" }
      ],
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket tribuzen-avatars-eu-west-3 \
  --lifecycle-configuration file://lifecycle.json
```

### 2.5 Bucket policy vs IAM

Deux mécanismes d'autorisation cohabitent, et il faut savoir lequel utiliser :

- **Politique IAM** — attachée à une **identité** (user, groupe, role). Elle répond à « *ce principal* peut-il faire quoi, où ? ». Idéale pour donner à ton API TribuZen (via un **role**) le droit d'écrire dans le bucket.
- **Bucket policy** — attachée à la **ressource** (le bucket). Elle répond à « qui peut accéder à *ce bucket* ? ». Idéale pour un accès **cross-account** ou pour autoriser un **service** (ex. CloudFront) à lire, ou pour interdire globalement une condition.

Les deux sont du JSON de même grammaire (`Effect`, `Action`, `Resource`, `Condition`). L'accès est **la somme des deux** : un `Deny` explicite dans l'une gagne toujours. Règle pratique : **permissions d'une identité → IAM ; règles portant sur le bucket lui-même → bucket policy.** Les **ACL** sont un mécanisme *legacy* — AWS recommande de les désactiver (`BucketOwnerEnforced`).

```json
// Bucket policy : forcer HTTPS (refuse tout accès en HTTP clair)
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": [
      "arn:aws:s3:::tribuzen-avatars-eu-west-3",
      "arn:aws:s3:::tribuzen-avatars-eu-west-3/*"
    ],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
```

### 2.6 Block Public Access (BPA)

**Block Public Access** est un garde-fou *au-dessus* des policies et ACL : même si une policy rend le bucket public, BPA peut refuser l'accès. Depuis avril 2023, **les nouveaux buckets ont BPA activé par défaut** (aucun accès public). Quatre réglages indépendants, combinables, applicables au niveau **compte, bucket, access point** (et organisation) — S3 applique la combinaison **la plus restrictive** :

| Réglage | Effet (mis à `TRUE`) |
|---|---|
| `BlockPublicAcls` | Rejette tout `PUT` de bucket/objet qui inclut une ACL publique |
| `IgnorePublicAcls` | Ignore toutes les ACL publiques existantes et futures |
| `BlockPublicPolicy` | Rejette une bucket policy qui autorise l'accès public |
| `RestrictPublicBuckets` | Si la policy est publique, limite l'accès aux principals de services AWS et aux users du compte propriétaire (coupe le cross-account) |

```bash
aws s3api put-public-access-block \
  --bucket tribuzen-avatars-eu-west-3 \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

> BPA **ne modifie pas** les policies/ACL existantes ; il les *neutralise*. Retirer BPA rend de nouveau public un bucket qui a une policy publique. Recommandation AWS : **les quatre activés partout**, et n'ouvrir que via CloudFront (module 13).

### 2.7 Presigned URLs

Une **presigned URL** est une URL signée qui accorde un accès **temporaire** à **une** opération sur **un** objet (GET pour télécharger, PUT pour uploader), sans exposer de credential. Elle porte les droits **du principal qui l'a générée** : ton serveur signe avec son role, le navigateur utilise l'URL sans jamais voir de clé AWS.

Limites d'expiration (doc AWS, signatures SigV4) :

- via **AWS CLI** : maximum **7 jours** (`--expires-in`, en secondes, max 604800) ;
- via la **Console S3** : maximum **12 heures**.

```bash
# GET presigned URL (téléchargement), valable 1 heure
aws s3 presign s3://tribuzen-avatars-eu-west-3/avatars/tribu-42/alice.jpg \
  --expires-in 3600
```

Le flux d'upload direct résout le cas concret §1 :

```
1. Navigateur ──▶ API TribuZen : "je veux uploader alice.jpg"
2. API (role S3) ──▶ génère une presigned PUT URL (expire 5 min) ──▶ Navigateur
3. Navigateur ──(PUT fichier)──▶ S3 directement  (l'API ne voit jamais l'octet)
```

Sécurité : **expiration courte** (5–15 min pour un upload), figer le `Content-Type`, configurer le **CORS** du bucket pour accepter le domaine front, et limiter la taille via `createPresignedPost` (`content-length-range`) plutôt qu'un simple PUT si tu veux borner le poids.

### 2.8 Static website hosting

S3 peut servir un site **statique** (HTML/CSS/JS) via un *website endpoint* (`http://mon-site.s3-website.<region>.amazonaws.com`). Cela impose un accès **public en lecture** — donc désactiver les réglages BPA concernés *et* poser une bucket policy `s3:GetObject` publique.

```bash
aws s3 website s3://tribuzen-site --index-document index.html --error-document 404.html
```

> Le website endpoint est en **HTTP seul**, sans domaine custom ni cache. En production on ne l'expose jamais nu : on garde le bucket **privé** et on met **CloudFront devant** (HTTPS, cache, OAC) — c'est le **module 13**. Ici, retiens juste que S3 *peut* héberger un statique, et pourquoi ce n'est pas suffisant seul.

---

## 3. Worked examples

### Exemple 1 — Bucket d'avatars TribuZen sécurisé, de zéro

Objectif : un bucket privé, versionné, prêt pour l'upload par presigned URL.

```bash
# 1. Créer le bucket dans la région du produit
aws s3 mb s3://tribuzen-avatars-eu-west-3 --region eu-west-3

# 2. Verrouiller l'accès public (les 4 réglages BPA)
aws s3api put-public-access-block \
  --bucket tribuzen-avatars-eu-west-3 \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 3. Activer le versioning (protège contre l'écrasement d'un avatar)
aws s3api put-bucket-versioning \
  --bucket tribuzen-avatars-eu-west-3 \
  --versioning-configuration Status=Enabled

# 4. Poser la lifecycle : purge des versions non courantes après 30 j,
#    et nettoyage des uploads multipart inachevés après 7 j
aws s3api put-bucket-lifecycle-configuration \
  --bucket tribuzen-avatars-eu-west-3 \
  --lifecycle-configuration file://lifecycle.json

# 5. Générer une presigned PUT URL pour un nouvel avatar (expire 5 min)
aws s3 presign s3://tribuzen-avatars-eu-west-3/avatars/tribu-42/bob.jpg \
  --expires-in 300
```

Ce que garantit cette configuration :
- Personne ne peut lister/lire le bucket depuis Internet (BPA + pas de policy publique).
- Un avatar écrasé reste récupérable (versioning), mais les vieilles versions ne s'accumulent pas indéfiniment (lifecycle).
- Le front uploade **directement** vers S3 avec l'URL signée, sans clé AWS et sans charger l'API.

### Exemple 2 — Lire une ancienne version après un écrasement accidentel

Un membre a remplacé son avatar par une image floue ; on veut restaurer le précédent.

```bash
# Lister toutes les versions de la key
aws s3api list-object-versions \
  --bucket tribuzen-avatars-eu-west-3 \
  --prefix avatars/tribu-42/alice.jpg
# → chaque version a un VersionId ; la plus récente est IsLatest=true

# Récupérer une version antérieure précise dans un fichier local
aws s3api get-object \
  --bucket tribuzen-avatars-eu-west-3 \
  --key avatars/tribu-42/alice.jpg \
  --version-id 3sL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY+MTRCxf3vjVBH40Nr8X8gdRQBpUMLUo \
  alice-restaure.jpg

# Re-uploader comme nouvelle version courante
aws s3 cp alice-restaure.jpg s3://tribuzen-avatars-eu-west-3/avatars/tribu-42/alice.jpg
```

Sans versioning, l'octet d'origine serait **définitivement perdu** dès le premier écrasement.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « Je mets le bucket en public pour afficher les avatars »

Rendre le bucket public expose *tout* le bucket à la lecture/listing par n'importe qui, et c'est l'origine de fuites de données massives. **Le bon réflexe :** bucket **privé** + presigned URL (accès temporaire par objet) ou **CloudFront + OAC** (module 13). Public = uniquement un vrai site statique assumé.

### PIÈGE #2 — Confondre durabilité et disponibilité

« 11 neufs » (99,999999999 %) est la **durabilité** : la probabilité de ne pas perdre un octet. La **disponibilité** (99,99 % en Standard) est la probabilité que le service réponde. One Zone-IA a la *même* durabilité de conception que Standard-IA mais une disponibilité et une résilience moindres (1 seule AZ).

### PIÈGE #3 — Mettre des données chaudes en Standard-IA « pour payer moins »

IA et Glacier facturent la **récupération** (par Go) et imposent une **durée minimale** (30 j pour IA, 90/180 j pour Glacier). Sur des données souvent lues ou vite supprimées, tu paies *plus* qu'en Standard. IA/Glacier = données **froides et stables**. Pour un accès imprévisible, laisse **Intelligent-Tiering** décider.

### PIÈGE #4 — Bucket policy vs IAM : mettre la règle au mauvais endroit

Pour donner à *ton* service le droit d'écrire : **politique IAM sur son role**. Pour autoriser un *autre compte* ou un *service AWS* à lire le bucket, ou interdire une condition globale : **bucket policy**. Se tromper mène soit à un accès qui ne marche pas, soit à une policy trop large. Rappel : un `Deny` explicite l'emporte toujours sur un `Allow`.

### PIÈGE #5 — Croire qu'on peut « désactiver » le versioning

Une fois le versioning **activé**, un bucket ne redevient **jamais** `Unversioned` — au mieux `Suspended`. En état suspendu, les nouveaux objets prennent un version ID `null`, mais les versions déjà créées restent (et restent facturées). Pour vraiment purger, il faut une **lifecycle** sur les versions non courantes.

### PIÈGE #6 — Presigned URL « permanente »

Une presigned URL a une expiration : **max 7 jours** en CLI (SigV4), **12 h** en Console. Elle porte les droits de celui qui l'a signée : si ce principal perd le droit avant l'expiration, l'URL cesse de fonctionner. Ne t'en sers pas comme d'un lien public durable — pour ça, c'est CloudFront.

---

## 5. Ancrage TribuZen

Dans l'infra `tribuzen`, S3 est la **couche de stockage des médias** : avatars de membres et photos partagées dans une tribu.

**Bucket `tribuzen-avatars-<region>`** (Exemple 1) — privé, BPA aux 4 réglages, versioning activé, lifecycle qui purge les versions non courantes à 30 jours. C'est la brique posée dès ce module.

**Upload d'avatar par presigned URL** — c'est *le* pattern TribuZen pour tout média :

```
front (Nuxt) ──▶ POST /api/avatars/presign  (API Lambda, module 06)
API ──▶ génère une presigned PUT URL (expire 5 min) ──▶ front
front ──(PUT image)──▶ S3   (aucun octet ne traverse l'API)
```

L'API n'écrit jamais l'image elle-même : elle **signe**, le navigateur **uploade**. Le role IAM de la fonction porte `s3:PutObject` sur `arn:aws:s3:::tribuzen-avatars-*/avatars/*` (politique IAM — 2.5), pas une bucket policy publique.

**Cycle de vie des photos de tribu** — les photos d'événements passés sont rarement reconsultées : une lifecycle les fait glisser vers `STANDARD_IA` à 90 jours puis `GLACIER_IR` à 1 an, divisant le coût de stockage sans code applicatif.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/
  infra/
    s3-avatars.ts          ← bucket avatars (défini en CDK au module 05)
  server/
    api/
      avatars/
        presign.post.ts    ← génère la presigned PUT URL (module 06/07)
```

> La distribution CloudFront **devant** ce bucket (lecture publique cachée, HTTPS, OAC) est ajoutée au **module 13** — ici le bucket reste strictement privé.

---

## 6. Points clés

1. S3 stocke des **objets** dans des **buckets** au nom **globalement unique** et régional ; la key est un chemin plat, pas un dossier.
2. La **classe de stockage** se choisit par objet selon l'accès : Standard (chaud), IA (froid, min 30 j + frais de récupération), Glacier (archive, min 90/180 j), Intelligent-Tiering (accès imprévisible, auto).
3. Le **versioning** protège de l'écrasement/suppression ; une fois activé il ne peut être que **suspendu**, jamais désactivé ; un DELETE sans version pose un **delete marker**.
4. Les **lifecycle rules** automatisent transitions de classe et expiration, y compris la purge des **versions non courantes** et des multipart inachevés.
5. **IAM** = droits d'une identité ; **bucket policy** = règles sur la ressource (cross-account, services) ; un `Deny` explicite gagne toujours ; les **ACL** sont legacy.
6. **Block Public Access** (4 réglages, activés par défaut sur les nouveaux buckets) neutralise les policies/ACL publiques ; garde-les tous activés et ouvre via CloudFront.
7. Une **presigned URL** donne un accès temporaire par objet, aux droits du signataire — max **7 j** (CLI) / **12 h** (Console) ; c'est le pattern d'upload direct navigateur → S3.
8. S3 peut héberger un **site statique** (website endpoint HTTP public) mais en prod on le met **privé derrière CloudFront** (module 13).

---

## 7. Seeds Anki

```
Pourquoi ne jamais rendre un bucket d'avatars public pour l'afficher ?|Public expose tout le bucket au listing/lecture par n'importe qui (source de fuites). Bon pattern : bucket privé + presigned URL par objet, ou CloudFront+OAC. Public = uniquement un site statique assumé.
Quelle différence entre durabilité et disponibilité S3 ?|Durabilité (11 neufs, 99,999999999 %) = probabilité de ne pas perdre un octet. Disponibilité (99,99 % Standard) = probabilité que le service réponde. One Zone-IA : même durabilité de conception mais moins disponible (1 seule AZ).
Quand choisir Standard-IA plutôt que Standard, et quel est le piège ?|IA = données froides et stables, accès rare mais immédiat requis. Piège : durée min facturée 30 jours + frais de récupération par Go. Sur données chaudes ou vite supprimées, IA coûte PLUS cher que Standard.
Peut-on désactiver le versioning d'un bucket S3 une fois activé ?|Non. Un bucket versionné ne redevient jamais Unversioned, seulement Suspended. En suspendu les nouveaux objets ont un version ID null, mais les versions existantes restent (et restent facturées). Purge via lifecycle sur versions non courantes.
Bucket policy ou politique IAM : où mettre la règle ?|IAM = droits attachés à une identité (donner à un role le droit d'écrire). Bucket policy = règles sur la ressource (cross-account, autoriser un service AWS, interdire une condition). Un Deny explicite l'emporte toujours.
À quoi servent les 4 réglages de Block Public Access ?|BlockPublicAcls (refuse PUT avec ACL publique), IgnorePublicAcls (ignore ACL publiques), BlockPublicPolicy (refuse policy publique), RestrictPublicBuckets (coupe le cross-account si policy publique). Activés par défaut sur nouveaux buckets ; S3 applique le plus restrictif.
Qu'est-ce qu'une presigned URL et quelle est son expiration max ?|URL signée donnant un accès temporaire à UNE opération (GET/PUT) sur UN objet, aux droits du principal qui l'a générée, sans exposer de credential. Max 7 jours en CLI (SigV4), 12 h en Console. Sert à l'upload direct navigateur → S3.
Que se passe-t-il lors d'un DELETE sans version-id sur un bucket versionné ?|S3 n'efface pas l'objet : il pose un delete marker qui devient la version courante. L'objet disparaît des listings normaux mais toutes ses versions restent récupérables ; supprimer le delete marker restaure l'objet.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-04-s3/README.md`. Créer un vrai bucket privé, l'uploader/versionner en Console + CLI, générer une presigned URL d'upload et poser une bucket policy — avec rappel de **teardown** (coût AWS). Corrigé commandes intégral, feedback coach en session.
