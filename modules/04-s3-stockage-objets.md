# Module 04 — S3 : Stockage d'Objets

> **Objectif** : Maîtriser Amazon S3 : stockage, classes, sécurité, cycle de vie, et exploiter les fonctionnalités avancées comme le versioning, les notifications et l'hébergement statique.
> **Difficulté** : ⭐⭐⭐
> **Prérequis** : Module 01
> **Durée estimée** : 5 heures

---

## Table des matières

1. [Qu'est-ce que S3 ?](#quest-ce-que-s3)
2. [Buckets, objets et clés](#buckets-objets-et-clés)
3. [Classes de stockage](#classes-de-stockage)
4. [Versioning](#versioning)
5. [Lifecycle Policies](#lifecycle-policies)
6. [Sécurité : Bucket Policies vs ACL](#sécurité--bucket-policies-vs-acl)
7. [Chiffrement côté serveur (SSE)](#chiffrement-côté-serveur)
8. [S3 Event Notifications](#s3-event-notifications)
9. [Hébergement de site statique](#hébergement-de-site-statique)
10. [Transfer Acceleration](#transfer-acceleration)
11. [Multipart Upload](#multipart-upload)
12. [Fonctionnalités avancées](#fonctionnalités-avancées)
13. [Bonnes pratiques](#bonnes-pratiques)

---

## Qu'est-ce que S3 ?

**S3** (Simple Storage Service) est un service de stockage d'objets offrant une durabilité de **99,999999999%** (11 neufs). Vos données sont automatiquement répliquées sur au moins **3 AZ** dans une région.

**Analogie** : S3 est un **entrepôt géant** avec des casiers infinis. Chaque casier (bucket) a un nom unique au monde. À l'intérieur, vous rangez des objets (fichiers) dans des dossiers virtuels. L'entrepôt ne tombe jamais en panne et peut stocker une quantité illimitée d'objets.

### Caractéristiques fondamentales

- Stockage **illimité** (pas de provisionnement de capacité)
- Taille d'un objet : 0 octets à **5 To**
- Durabilité : 99,999999999% (11 neufs)
- Disponibilité : 99,99% (Standard)
- Accès via HTTP/HTTPS (API REST)

```bash
# Créer un bucket
aws s3 mb s3://mon-app-production-eu-west-3-2026

# Uploader un fichier
aws s3 cp mon-fichier.zip s3://mon-app-production-eu-west-3-2026/backups/

# Lister le contenu
aws s3 ls s3://mon-app-production-eu-west-3-2026/backups/

# Synchroniser un répertoire
aws s3 sync ./dist s3://mon-app-production-eu-west-3-2026/static/ --delete
```

---

## Buckets, objets et clés

### Buckets

Un **bucket** est le conteneur de niveau supérieur dans S3.

- Le nom doit être **globalement unique** (dans tout AWS, pas juste votre compte)
- Entre 3 et 63 caractères, minuscules, chiffres, tirets
- Créé dans une **région** spécifique
- Pas de limite de nombre d'objets

### Objets

Un **objet** est composé de :

| Composant | Description | Limite |
|-----------|------------|--------|
| **Key** | Chemin complet de l'objet | 1 024 octets UTF-8 |
| **Value** | Le contenu du fichier | 5 To max |
| **Metadata** | Paires clé-valeur (system + user) | 2 Ko |
| **Version ID** | Identifiant de version (si activé) | — |
| **Tags** | Paires clé-valeur pour la gestion | 10 max |

### Structure des clés

```
s3://mon-bucket/photos/2026/03/vacances.jpg
│               │                          │
│               └── Key (chemin complet) ──┘
└── Bucket

Il n'y a PAS de vrais dossiers dans S3.
"photos/2026/03/" est un préfixe, pas un répertoire.
```

### Avec SDK TypeScript v3

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'eu-west-3' });

// Upload un objet
await s3.send(new PutObjectCommand({
  Bucket: 'mon-app-production',
  Key: 'reports/2026/03/monthly.pdf',
  Body: Buffer.from('contenu du rapport'),
  ContentType: 'application/pdf',
  Metadata: {
    'generated-by': 'report-service',
    'report-month': '2026-03',
  },
}));

// Lire un objet
const response = await s3.send(new GetObjectCommand({
  Bucket: 'mon-app-production',
  Key: 'reports/2026/03/monthly.pdf',
}));
const body = await response.Body?.transformToString();

// Lister les objets avec un préfixe
const list = await s3.send(new ListObjectsV2Command({
  Bucket: 'mon-app-production',
  Prefix: 'reports/2026/',
  MaxKeys: 100,
}));

for (const obj of list.Contents ?? []) {
  console.log(`${obj.Key} — ${obj.Size} octets — ${obj.LastModified}`);
}
```

---

## Classes de stockage

S3 propose plusieurs classes de stockage pour optimiser les coûts selon la fréquence d'accès.

### Tableau comparatif

| Classe | Disponibilité | AZ min | Latence accès | Coût stockage | Coût récupération | Cas d'usage |
|--------|--------------|--------|--------------|---------------|-------------------|-------------|
| **Standard** | 99,99% | ≥ 3 | Millisecondes | $$$  | Gratuit | Données fréquemment accédées |
| **Intelligent-Tiering** | 99,9% | ≥ 3 | Millisecondes | $$$ (auto) | Gratuit | Accès imprévisible |
| **Standard-IA** | 99,9% | ≥ 3 | Millisecondes | $$ | $ par Go | Accès moins fréquent (>30j) |
| **One Zone-IA** | 99,5% | 1 | Millisecondes | $ | $ par Go | Données reproductibles |
| **Glacier Instant** | 99,9% | ≥ 3 | Millisecondes | $ | $$ par Go | Archives avec accès immédiat |
| **Glacier Flexible** | 99,99% | ≥ 3 | Minutes à heures | ¢ | $$$ par Go | Archives, accès rare |
| **Glacier Deep Archive** | 99,99% | ≥ 3 | 12 à 48 heures | ¢¢ | $$$$ par Go | Conformité, rétention longue |

### Intelligent-Tiering

S3 Intelligent-Tiering déplace automatiquement les objets entre les niveaux :

```
Accès fréquent (par défaut)
    ↓ (30 jours sans accès)
Accès peu fréquent (-40% coût)
    ↓ (90 jours sans accès)
Archive Instant Access (-68% coût)
    ↓ (opt-in, 90-730 jours)
Archive Access
    ↓ (opt-in, 180-730 jours)
Deep Archive Access
```

```bash
# Uploader directement en Intelligent-Tiering
aws s3 cp fichier.zip s3://mon-bucket/data/ \
  --storage-class INTELLIGENT_TIERING
```

### Glacier : options de récupération

| Tier | Glacier Flexible | Glacier Deep Archive |
|------|-----------------|---------------------|
| Expedited | 1-5 minutes | — |
| Standard | 3-5 heures | 12 heures |
| Bulk | 5-12 heures | 48 heures |

---

## Versioning

Le **versioning** conserve toutes les versions d'un objet. Chaque modification crée une nouvelle version au lieu d'écraser l'ancienne.

### Activation

```bash
# Activer le versioning
aws s3api put-bucket-versioning \
  --bucket mon-bucket \
  --versioning-configuration Status=Enabled

# Vérifier l'état
aws s3api get-bucket-versioning --bucket mon-bucket
```

### Comportement

```
PUT photo.jpg (v1) → Version ID: aaa111
PUT photo.jpg (v2) → Version ID: bbb222  (v1 toujours là)
DELETE photo.jpg    → Delete Marker ajouté (v1 et v2 toujours là)
```

```bash
# Lister toutes les versions d'un objet
aws s3api list-object-versions \
  --bucket mon-bucket \
  --prefix photo.jpg

# Récupérer une version spécifique
aws s3api get-object \
  --bucket mon-bucket \
  --key photo.jpg \
  --version-id aaa111 \
  photo-v1.jpg

# Supprimer définitivement une version spécifique
aws s3api delete-object \
  --bucket mon-bucket \
  --key photo.jpg \
  --version-id bbb222
```

### MFA Delete

Pour une protection maximale, activez **MFA Delete** : la suppression définitive d'une version nécessite un code MFA.

```bash
# Activer MFA Delete (nécessite le root)
aws s3api put-bucket-versioning \
  --bucket mon-bucket \
  --versioning-configuration Status=Enabled,MFADelete=Enabled \
  --mfa "arn:aws:iam::123456789012:mfa/root-device 123456"
```

---

## Lifecycle Policies

Les **Lifecycle Policies** automatisent la transition entre classes de stockage et la suppression des objets.

### Exemple complet

```json
{
  "Rules": [
    {
      "ID": "optimize-storage-costs",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "logs/"
      },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        },
        {
          "Days": 365,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ],
      "Expiration": {
        "Days": 2555
      }
    },
    {
      "ID": "cleanup-incomplete-uploads",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "ID": "delete-old-versions",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionTransitions": [
        {
          "NoncurrentDays": 30,
          "StorageClass": "STANDARD_IA"
        }
      ],
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 90
      }
    }
  ]
}
```

```bash
# Appliquer la policy
aws s3api put-bucket-lifecycle-configuration \
  --bucket mon-bucket \
  --lifecycle-configuration file://lifecycle.json
```

### Flux visuel

```
Jour 0        Jour 30          Jour 90          Jour 365        Jour 2555
  │              │                │                │                │
Standard → Standard-IA → Glacier Flexible → Deep Archive → Suppression
```

---

## Sécurité : Bucket Policies vs ACL

### Bucket Policies (recommandé)

Les **Bucket Policies** sont des politiques JSON attachées au bucket. C'est le mécanisme de contrôle d'accès principal.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAC",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::mon-site-statique/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/E1ABC2DEF3GH"
        }
      }
    },
    {
      "Sid": "DenyUnencryptedUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::mon-bucket-secure/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "DenyHTTP",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::mon-bucket-secure",
        "arn:aws:s3:::mon-bucket-secure/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

### ACL (déconseillé)

Les **ACL** (Access Control Lists) sont un ancien mécanisme. AWS recommande de les désactiver :

```bash
# Désactiver les ACL (recommandé depuis 2023)
aws s3api put-bucket-ownership-controls \
  --bucket mon-bucket \
  --ownership-controls '{
    "Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]
  }'
```

### Block Public Access

```bash
# Bloquer tout accès public (au niveau du compte)
aws s3control put-public-access-block \
  --account-id 123456789012 \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }'
```

### Comparaison

| Critère | Bucket Policy | ACL |
|---------|--------------|-----|
| Format | JSON (comme IAM) | XML |
| Granularité | Fine (conditions, IP, MFA) | Grossière (read/write) |
| Cross-account | Oui (via Principal) | Oui (mais limité) |
| Recommandation | **Oui** | **Non** (legacy) |

---

## Chiffrement côté serveur

### Options de chiffrement

| Type | Clé gérée par | Rotation | Coût supplémentaire |
|------|--------------|----------|-------------------|
| **SSE-S3** | AWS (transparent) | Automatique | Gratuit |
| **SSE-KMS** | AWS KMS | Configurable | KMS API calls |
| **SSE-C** | Le client | À votre charge | Gratuit (mais vous gérez) |
| **CSE** | Le client (avant upload) | À votre charge | Gratuit |

### SSE-S3 (par défaut depuis 2023)

```bash
# Depuis janvier 2023, tous les nouveaux objets sont chiffrés SSE-S3 par défaut
# Pas d'action requise

# Vérifier le chiffrement d'un objet
aws s3api head-object \
  --bucket mon-bucket \
  --key document.pdf \
  --query 'ServerSideEncryption'
```

### SSE-KMS

```bash
# Configurer le chiffrement par défaut avec KMS
aws s3api put-bucket-encryption \
  --bucket mon-bucket-secure \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "arn:aws:kms:eu-west-3:123456789012:key/abc-123"
      },
      "BucketKeyEnabled": true
    }]
  }'
```

**Bucket Key** : réduit les appels KMS (et les coûts) en générant une clé intermédiaire au niveau du bucket.

### SSE-C

```bash
# Upload avec une clé fournie par le client
aws s3api put-object \
  --bucket mon-bucket \
  --key secret.dat \
  --body secret.dat \
  --sse-customer-algorithm AES256 \
  --sse-customer-key "$(openssl rand -base64 32)" \
  --sse-customer-key-md5 "$(echo -n '<key>' | openssl dgst -md5 -binary | base64)"
```

**Attention** : avec SSE-C, si vous perdez la clé, les données sont **irrécupérables**.

---

## S3 Event Notifications

S3 peut déclencher des actions automatiques quand des événements se produisent sur un bucket.

### Destinations supportées

| Destination | Latence | Cas d'usage |
|-------------|---------|-------------|
| **Lambda** | Secondes | Traitement d'image, indexation |
| **SQS** | Secondes | File d'attente de traitement |
| **SNS** | Secondes | Notification multi-destinataires |
| **EventBridge** | Secondes | Routage avancé, règles complexes |

### Configuration

```bash
aws s3api put-bucket-notification-configuration \
  --bucket mon-bucket-images \
  --notification-configuration '{
    "LambdaFunctionConfigurations": [
      {
        "Id": "resize-images",
        "LambdaFunctionArn": "arn:aws:lambda:eu-west-3:123456789012:function:resize-image",
        "Events": ["s3:ObjectCreated:*"],
        "Filter": {
          "Key": {
            "FilterRules": [
              {"Name": "prefix", "Value": "uploads/"},
              {"Name": "suffix", "Value": ".jpg"}
            ]
          }
        }
      }
    ],
    "EventBridgeConfiguration": {}
  }'
```

### Avec TypeScript (handler Lambda)

```typescript
import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export async function handler(event: S3Event, context: Context) {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const size = record.s3.object.size;

    console.log(`Nouvel objet : s3://${bucket}/${key} (${size} octets)`);

    const object = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    // Traitement de l'objet...
  }
}
```

---

## Hébergement de site statique

S3 peut héberger un site web statique (HTML, CSS, JS) sans serveur.

### Configuration

```bash
# Activer l'hébergement statique
aws s3 website s3://mon-site-statique \
  --index-document index.html \
  --error-document error.html

# Uploader le site
aws s3 sync ./dist s3://mon-site-statique --delete

# URL du site :
# http://mon-site-statique.s3-website.eu-west-3.amazonaws.com
```

### Bucket Policy pour l'accès public

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::mon-site-statique/*"
    }
  ]
}
```

### Architecture recommandée (production)

```
Utilisateur → CloudFront (CDN + HTTPS) → S3 (origin, accès privé via OAC)
                  │
            Certificat ACM (HTTPS)
            Route 53 (DNS)
```

En production, **ne jamais exposer S3 directement**. Utilisez CloudFront avec un OAC (Origin Access Control) pour :
- HTTPS avec votre domaine
- Cache global (latence réduite)
- Protection DDoS (AWS Shield)
- Accès S3 privé

---

## Transfer Acceleration

**S3 Transfer Acceleration** accélère les uploads longue distance en utilisant les edge locations CloudFront.

```
Client (Australie) → Edge Location Sydney → Backbone AWS → Bucket (eu-west-3)
                     (réseau optimisé AWS, pas l'Internet public)
```

```bash
# Activer Transfer Acceleration
aws s3api put-bucket-accelerate-configuration \
  --bucket mon-bucket \
  --accelerate-configuration Status=Enabled

# Utiliser l'endpoint accéléré
aws s3 cp gros-fichier.zip \
  s3://mon-bucket/uploads/ \
  --endpoint-url https://mon-bucket.s3-accelerate.amazonaws.com
```

**Coût** : supplément de ~0,04 $/Go (en plus du transfert standard). Utile uniquement pour les uploads intercontinentaux.

---

## Multipart Upload

Le **Multipart Upload** divise un fichier volumineux en parties uploadées en parallèle.

### Quand l'utiliser

| Taille du fichier | Recommandation |
|-------------------|---------------|
| < 100 Mo | Upload simple (PutObject) |
| 100 Mo – 5 Go | Multipart recommandé |
| > 5 Go | Multipart **obligatoire** |

### Avec la CLI

```bash
# La CLI utilise automatiquement le multipart pour les gros fichiers
aws s3 cp fichier-10go.zip s3://mon-bucket/backups/ \
  --expected-size 10737418240

# Configurer les seuils
aws configure set default.s3.multipart_threshold 100MB
aws configure set default.s3.multipart_chunksize 50MB
```

### Avec SDK TypeScript v3

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'node:fs';

const s3 = new S3Client({ region: 'eu-west-3' });

async function uploadLargeFile(filePath: string, key: string) {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: 'mon-bucket',
      Key: key,
      Body: createReadStream(filePath),
      ContentType: 'application/octet-stream',
    },
    queueSize: 4,        // Uploads parallèles
    partSize: 50 * 1024 * 1024, // 50 Mo par partie
    leavePartsOnError: false,
  });

  upload.on('httpUploadProgress', (progress) => {
    const pct = Math.round((progress.loaded! / progress.total!) * 100);
    console.log(`Upload : ${pct}% (${progress.loaded} / ${progress.total})`);
  });

  await upload.done();
  console.log('Upload terminé');
}
```

### Nettoyage des uploads incomplets

Les uploads multipart incomplets **consomment du stockage**. Ajoutez toujours une lifecycle rule :

```json
{
  "Rules": [{
    "ID": "abort-incomplete-multipart",
    "Status": "Enabled",
    "Filter": {},
    "AbortIncompleteMultipartUpload": {
      "DaysAfterInitiation": 7
    }
  }]
}
```

---

## Fonctionnalités avancées

### S3 Select et S3 Glacier Select

Exécutez des requêtes SQL directement sur les objets S3 (CSV, JSON, Parquet) sans les télécharger entièrement :

```bash
aws s3api select-object-content \
  --bucket mon-bucket \
  --key logs/2026-03.csv \
  --expression "SELECT s.timestamp, s.status FROM S3Object s WHERE s.status = '500'" \
  --expression-type SQL \
  --input-serialization '{"CSV": {"FileHeaderInfo": "USE"}}' \
  --output-serialization '{"CSV": {}}' \
  output.csv
```

### S3 Object Lock

Empêche la suppression ou la modification d'un objet pendant une durée définie (conformité WORM) :

| Mode | Comportement |
|------|-------------|
| **Governance** | Protégé sauf avec permission spéciale |
| **Compliance** | Protégé pour TOUS, y compris le root |

### Requester Pays

Le demandeur (pas le propriétaire du bucket) paie les frais de transfert :

```bash
aws s3api put-bucket-request-payment \
  --bucket mon-bucket-partage \
  --request-payment-configuration Payer=Requester
```

---

## Presigned URLs — Upload direct depuis le navigateur

Les **presigned URLs** permettent de donner un accès temporaire à un objet S3 sans exposer les credentials AWS. C'est essentiel pour les uploads directs depuis le navigateur.

### Pourquoi ?

Sans presigned URL, le flux est : `Navigateur → Serveur Node.js → S3`. Le fichier transite par votre serveur, consommant de la bande passante et de la mémoire. Avec presigned URL : `Navigateur → S3 directement`. Le serveur ne fait que générer l'URL signée.

### Générer une presigned URL (SDK v3)

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'eu-west-1' });

// Upload presigned URL (PUT)
async function getUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: 'mon-bucket',
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes
}

// Download presigned URL (GET)
async function getDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: 'mon-bucket',
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 heure
}
```

### Upload depuis le frontend

```typescript
// 1. Le frontend demande une URL signée au backend
const { uploadUrl } = await fetch('/api/upload-url', {
  method: 'POST',
  body: JSON.stringify({ filename: 'photo.jpg', contentType: 'image/jpeg' }),
}).then(r => r.json());

// 2. Upload direct vers S3
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'image/jpeg' },
  body: file, // File object du <input type="file">
});
```

### Sécurité

- **Expiration courte** : 5-15 min pour les uploads, 1h max pour les downloads
- **CORS** : configurer le bucket pour accepter les requêtes du domaine frontend
- **Content-Type** : forcer le type MIME dans la presigned URL pour éviter les abus
- **Taille max** : utiliser `createPresignedPost()` avec `Content-Length-Range` pour limiter la taille

```typescript
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

const { url, fields } = await createPresignedPost(s3, {
  Bucket: 'mon-bucket',
  Key: 'uploads/${filename}',
  Conditions: [
    ['content-length-range', 0, 10_000_000], // Max 10 MB
    ['starts-with', '$Content-Type', 'image/'],
  ],
  Expires: 300,
});
```

---

## Bonnes pratiques

### Checklist S3

1. **Sécurité**
   - [ ] Block Public Access activé au niveau du compte
   - [ ] ACL désactivées (BucketOwnerEnforced)
   - [ ] Bucket Policy pour DenyHTTP (forcer HTTPS)
   - [ ] SSE-KMS pour les données sensibles
   - [ ] Versioning activé sur les buckets critiques
   - [ ] MFA Delete pour les données réglementées

2. **Coûts**
   - [ ] Intelligent-Tiering pour les accès imprévisibles
   - [ ] Lifecycle policies pour les transitions automatiques
   - [ ] Nettoyage des uploads multipart incomplets
   - [ ] S3 Storage Lens pour l'analyse des coûts

3. **Performance**
   - [ ] Multipart upload pour les fichiers > 100 Mo
   - [ ] Transfer Acceleration pour les uploads intercontinentaux
   - [ ] VPC Gateway Endpoint pour le trafic depuis EC2/Lambda

4. **Nommage**
   - [ ] Nom de bucket descriptif : `{app}-{env}-{region}-{suffix}`
   - [ ] Préfixes organisés : `logs/`, `uploads/`, `reports/`
   - [ ] Pas de données sensibles dans les noms de clés

---

## Résumé du module

| Concept | Points clés |
|---------|-------------|
| Buckets | Nom unique mondial, régional, stockage illimité |
| Classes | Standard → IA → Glacier → Deep Archive (coût décroissant) |
| Versioning | Conserve toutes les versions, protège contre la suppression |
| Lifecycle | Automatise transitions et expirations |
| Sécurité | Bucket Policy (JSON), Block Public Access, SSE par défaut |
| Chiffrement | SSE-S3 (défaut), SSE-KMS (audit), SSE-C (clé client) |
| Events | Déclenchement Lambda/SQS/SNS/EventBridge sur modifications |
| Static Hosting | Site statique, idéalement derrière CloudFront |
| Performance | Multipart (>100 Mo), Transfer Acceleration (intercontinental) |

---

## Pour aller plus loin

- [S3 User Guide (AWS)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/)
- [S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [S3 Storage Classes](https://aws.amazon.com/s3/storage-classes/)
- [S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
