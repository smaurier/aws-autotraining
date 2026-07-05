---
titre: "CloudFront : CDN devant S3"
cours: 12-aws-cloud
notions: [distributions, "origins (S3, ALB, custom)", "cache behaviors (path patterns)", "TTL (min/default/max)", cache policy, "Origin Access Control (OAC)", invalidation, "CloudFront Functions vs Lambda@Edge", "HTTPS et certificats ACM"]
outcomes:
  - sait créer une distribution CloudFront devant un bucket S3 privé
  - sait sécuriser l'accès S3 avec OAC et une bucket policy sur le service principal cloudfront.amazonaws.com
  - sait configurer cache behaviors, TTL et cache policy pour piloter le cache au edge
  - sait invalider le cache et sait pourquoi préférer le versioning de fichiers
  - sait choisir entre CloudFront Functions et Lambda@Edge
prerequis: [modules 00-12 du cours 12-aws-cloud (dont 04-s3 bucket privé, BPA, bucket policy)]
next: 14-cloudwatch-xray-observabilite
libs: []
tribuzen: infra cloud TribuZen — CDN CloudFront devant le bucket S3 des avatars/assets (HTTPS, cache, OAC)
last-reviewed: 2026-07
---

# CloudFront : CDN devant S3

> **Outcomes — tu sauras FAIRE :** créer une distribution CloudFront devant un bucket S3 **privé**, sécuriser l'accès avec **OAC** (bucket policy), régler les **cache behaviors / TTL**, **invalider** le cache et choisir entre **CloudFront Functions** et **Lambda@Edge**.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module met **CloudFront devant le bucket S3 du module 04**. On couvre distributions, origins, cache behaviors, TTL, OAC, invalidation, l'edge computing (survol) et HTTPS/ACM. Les **règles HTTP de cache pures** (`Cache-Control`, `ETag`, revalidation côté navigateur) sont le **cours 11 (HTTP caching)** — ici on ne fait que **relier** ces headers au comportement de CloudFront. Route 53 / DNS avancé et le contenu privé signé (signed URLs/cookies) sont mentionnés mais approfondis ailleurs.

## 1. Cas concret d'abord

Au module 04, tu as posé le bucket `tribuzen-avatars-<region>` : **privé**, Block Public Access aux 4 réglages, versionné. Les avatars y sont, en sécurité. Sauf que maintenant le front doit les **afficher**, et trois problèmes concrets surgissent :

1. **Le bucket est privé — donc `<img src="https://tribuzen-avatars.s3...">` renvoie `403`.** Le premier réflèxe (« je rends le bucket public ») rouvre exactement la faille qu'on a fermée au module 04.
2. **Latence.** Un membre à Tokyo qui charge un avatar hébergé dans le bucket `eu-west-3` (Paris) attend l'aller-retour transcontinental à **chaque** requête. Pour une grille de 30 avatars, ça se voit.
3. **Coût de sortie et charge.** Chaque affichage tape S3 directement : data transfer facturé, pas de cache, pas de HTTPS sur domaine custom, pas de compression.

La réponse AWS est **CloudFront** : un CDN qu'on place **devant** le bucket. Le bucket **reste strictement privé** ; seul CloudFront y accède, via **OAC** (Origin Access Control). Le contenu est **mis en cache** dans des centaines de points de présence proches des utilisateurs, servi en **HTTPS**, compressé, et le bucket ne voit plus qu'une fraction des requêtes (les cache miss).

```
AVANT (module 04)        APRÈS (ce module)
navigateur → S3 (403     navigateur → CloudFront (edge, cache, HTTPS)
si privé, ou public                     │ cache miss uniquement
= faille)                               ▼
                                    S3 privé  ←── OAC (SigV4), bucket policy
```

Ce module construit exactement ce montage.

---

## 2. Théorie complète, concise

### 2.1 CDN, edge locations, distribution

Un **CDN** (Content Delivery Network) réplique ton contenu sur des serveurs de cache répartis mondialement pour le servir **au plus près** de l'utilisateur. Vocabulaire CloudFront :

| Terme | Définition |
|---|---|
| **Edge location** | Data center de cache dans une ville (Tokyo, São Paulo…). Sert les cache hits. |
| **Origin** | La source qui détient l'original (bucket S3, ALB, serveur HTTP custom). |
| **Distribution** | La ressource CloudFront : elle relie des origins à des cache behaviors et expose un domaine `dxxxx.cloudfront.net`. |
| **Cache hit / miss** | Hit = servi depuis l'edge (rapide). Miss = CloudFront va chercher à l'origin, puis met en cache. |

À la **première** requête d'une région, cache miss → CloudFront interroge l'origin et stocke la réponse. Les requêtes suivantes de la même région sont des **hits** servis localement.

### 2.2 Types d'origins

Une distribution peut pointer vers plusieurs types de sources, et **plusieurs origins** dans la même distribution :

- **Origin S3** (le cas de ce module) — sert des fichiers statiques depuis un bucket. ⚠️ Un **bucket régulier** (pas un *website endpoint*) pour pouvoir utiliser OAC (voir 2.5).
- **Origin ALB / EC2 / custom HTTP** — pour du contenu dynamique généré par un backend. N'importe quel hôte HTTP(S) accessible.
- **Origins multiples** dans une distribution, aiguillés par les cache behaviors :

```
Distribution TribuZen
  ├── /api/*     → ALB (contenu dynamique, pas de cache)
  ├── /avatars/* → S3 tribuzen-avatars (cache long)
  └── /*         → S3 site statique (default behavior)
```

### 2.3 Cache behaviors et ordre d'évaluation

Un **cache behavior** est une règle : « pour les URLs qui matchent ce **path pattern**, utilise cette origin, ce protocole, cette cache policy, ces méthodes ». Une distribution a **un default behavior** (`*`, obligatoire) et 0..n behaviors additionnels.

| Paramètre | Rôle | Exemple |
|---|---|---|
| **Path pattern** | Quel chemin matche | `/avatars/*`, `*.jpg`, `*` (default) |
| **Origin** | Vers quelle source router | S3, ALB, custom |
| **Viewer protocol policy** | HTTP/HTTPS | Redirect HTTP to HTTPS |
| **Allowed methods** | Verbes acceptés | GET/HEAD pour du statique |
| **Cache policy** | Comment mettre en cache (cache key, TTL) | voir 2.4 |
| **Compress** | gzip/brotli | Oui pour texte/JS/CSS |

CloudFront évalue les behaviors **du plus spécifique au plus général** ; le **premier** path pattern qui matche gagne. Le default (`*`) est le filet de sécurité.

### 2.4 TTL et cache policy

Le **TTL** (Time To Live) est la durée pendant laquelle CloudFront garde un objet au edge avant de re-vérifier à l'origin. AWS recommande de le piloter via une **cache policy** attachée au behavior (les anciens réglages « legacy cache settings » existent encore). Trois bornes :

```
Minimum TTL ≤ Default TTL ≤ Maximum TTL
```

| Borne | Rôle | Valeur par défaut si pas de cache policy |
|---|---|---|
| **Minimum TTL** | Plancher, même si l'origin dit moins | 0 s |
| **Default TTL** | Utilisé quand l'origin n'envoie pas de `Cache-Control`/`Expires` | **86 400 s (24 h)** |
| **Maximum TTL** | Plafond, même si l'origin dit plus | 31 536 000 s (1 an) |

**Lien avec le cours 11 (HTTP caching).** L'origin pilote le TTL via les headers HTTP standard — c'est là que les deux cours se rejoignent :

```
Cache-Control: max-age=3600     → CloudFront cache min(3600, MaxTTL)
Cache-Control: s-maxage=600      → prioritaire côté CDN sur max-age
Cache-Control: no-store          → pas de cache (si MinTTL = 0)
```

Règles vérifiées (doc AWS, MinTTL = 0) : avec `max-age`, CloudFront cache pour **le plus petit** de `max-age` et Maximum TTL ; `s-maxage` l'emporte sur `max-age` côté CDN ; sans header, c'est le **Default TTL** qui s'applique.

⚠️ **Piège fréquent** : si Minimum TTL > 0, CloudFront **ignore** `no-cache`/`no-store`/`private` de l'origin et cache quand même pour la durée du Minimum TTL. Laisse Minimum TTL = 0 sauf besoin précis.

La **cache key** détermine ce qui rend deux requêtes « différentes » pour le cache : par défaut le **chemin URL** (+ éventuellement query strings/headers/cookies selon la cache policy). `/img?w=100` et `/img?w=200` sont deux entrées distinctes **seulement si** la query string fait partie de la cache key. **Bonne pratique** : inclure le **minimum** dans la cache key → plus de cache hits.

### 2.5 OAC — Origin Access Control (méthode actuelle)

**Le problème.** Pour que CloudFront lise un bucket privé, il faut l'y autoriser sans rendre le bucket public (sinon on contourne CloudFront en tapant S3 directement).

**La solution actuelle : OAC** (Origin Access Control). Le bucket **reste privé** ; CloudFront **signe** chaque requête vers S3 en **SigV4**, et une **bucket policy** autorise le **service principal** `cloudfront.amazonaws.com` — mais **uniquement** pour la distribution concernée (condition `AWS:SourceArn`).

> **OAC remplace OAI** (Origin Access Identity), l'ancien mécanisme *legacy*. AWS **recommande OAC** : il supporte tous les buckets de **toutes les régions** (y compris les régions opt-in récentes), le chiffrement **SSE-KMS**, et les requêtes **dynamiques** `PUT`/`DELETE`. OAI ne fait rien de tout ça. Pour toute nouvelle distribution : **OAC**.

Contraintes vérifiées (doc AWS) :
- Le bucket doit avoir **S3 Object Ownership = Bucket owner enforced** (le défaut des nouveaux buckets — ACL désactivées).
- Un bucket configuré en **website endpoint** ne peut **pas** utiliser OAC (il faut le traiter en *custom origin*). Ici on garde un **bucket régulier** privé.
- Pour toujours signer (recommandé), le **Signing behavior** de l'OAC doit être `always`.

Bucket policy OAC (lecture seule) — telle que la doc la donne :

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipalReadOnly",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::tribuzen-avatars-eu-west-3/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::111122223333:distribution/E1234567890"
      }
    }
  }]
}
```

| Critère | OAI (legacy) | **OAC (actuel)** |
|---|---|---|
| Signature | Identité spéciale | **SigV4** standard |
| SSE-KMS | Non | **Oui** |
| Toutes régions (opt-in) | Non | **Oui** |
| `PUT`/`DELETE` dynamiques vers S3 | Non | **Oui** |

### 2.6 Invalidation vs versioning de fichiers

Tu déploies une nouvelle version, mais CloudFront sert encore l'ancienne (TTL non expiré). Deux façons de forcer la fraîcheur :

**Invalidation** — supprimer un chemin du cache edge. La prochaine requête repart à l'origin.

```bash
# Un fichier / un préfixe / tout
aws cloudfront create-invalidation --distribution-id E123 --paths "/index.html"
aws cloudfront create-invalidation --distribution-id E123 --paths "/avatars/*"
aws cloudfront create-invalidation --distribution-id E123 --paths "/*"
```

Coût/limites vérifiés (doc AWS) : **les 1 000 premiers chemins d'invalidation par mois sont gratuits** (total sur **toutes** tes distributions du compte) ; au-delà, chaque chemin est facturé (facturation **par chemin**, même bundlés dans une requête). Un chemin avec **`*` compte pour UN seul chemin** même s'il invalide des milliers de fichiers.

**Versioning de fichiers** — la méthode **recommandée** par AWS pour du contenu qui change souvent : donner une **URL unique** à chaque version, donc pas besoin d'invalider.

```
/js/app.a3f5b2c.js   → le hash change à chaque build = nouvelle URL = nouveau cache
```

AWS préfère le versioning : il maîtrise le cache **navigateur** (pas juste l'edge), il est **moins cher** (pas de frais d'invalidation) et il simplifie rollback/A-B. Réserve l'invalidation aux cas ponctuels.

### 2.7 CloudFront Functions vs Lambda@Edge (survol)

CloudFront peut exécuter du code **au edge**. Deux options, à ne pas confondre (chiffres vérifiés doc AWS) :

| | **CloudFront Functions** | **Lambda@Edge** |
|---|---|---|
| Langage | JavaScript (ECMAScript 5.1) | Node.js et Python |
| Durée max | **Sub-milliseconde** | Jusqu'à **30 s** (viewer et origin) |
| Mémoire | 2 Mo | 128 Mo (viewer) / 10 Go (origin) |
| Taille code + libs | 10 Ko | 50 Mo |
| Accès réseau / système de fichiers / body | **Non** | **Oui** |
| Déclencheurs | Viewer Request, Viewer Response | Viewer + Origin (Request/Response) |
| Échelle | Millions de req/s | 10 000 req/s par région |

**CloudFront Functions** = manipulations légères et ultra-rapides : réécriture d'URL, normalisation de cache key, ajout de headers de sécurité (HSTS, CSP), redirections, validation de token simple (JWT).

**Lambda@Edge** = logique lourde : accès réseau (autre service AWS, SDK), lecture du **body** de la requête, A/B testing avec routage d'origin, traitement d'image. Les 4 points d'exécution :

```
Client → [Viewer Request] → cache → [Origin Request] → Origin
Client ← [Viewer Response] ← cache ← [Origin Response] ← ┘
```

Règle : **CloudFront Functions par défaut** (moins cher, plus rapide) ; Lambda@Edge **seulement** si tu as besoin de réseau, du body, de libs tierces ou d'un runtime Python/Node.

Exemple CloudFront Functions — ajouter des headers de sécurité (Viewer Response) :

```javascript
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  headers['strict-transport-security'] = { value: 'max-age=63072000; includeSubdomains; preload' };
  headers['x-content-type-options']    = { value: 'nosniff' };
  headers['x-frame-options']           = { value: 'DENY' };
  return response;
}
```

### 2.8 HTTPS et certificats ACM

CloudFront sert en HTTPS **out of the box** sur le domaine `dxxxx.cloudfront.net` (certificat CloudFront par défaut). Pour un **domaine custom** (`cdn.tribuzen.app`), il faut un certificat **ACM** (AWS Certificate Manager, gratuit, renouvellement auto) :

- Le certificat pour CloudFront **doit** être créé dans **`us-east-1`**, quelle que soit la région de ton bucket (contrainte AWS).
- Validation **DNS** : ACM te donne un CNAME à ajouter à ta zone ; une fois validé, le certificat est émis et renouvelé seul.
- On associe le certificat à la distribution + les *alternate domain names* (CNAMEs), puis un **ALIAS record** (Route 53) pointe le domaine vers la distribution.

```bash
aws acm request-certificate \
  --domain-name "cdn.tribuzen.app" \
  --validation-method DNS \
  --region us-east-1        # OBLIGATOIRE pour CloudFront
```

Côté behavior, force **Redirect HTTP to HTTPS** (ou HTTPS only) pour ne jamais servir en clair.

---

## 3. Worked examples

### Exemple 1 — CloudFront + OAC devant le bucket privé d'avatars (de zéro, CLI)

Objectif : servir `avatars/tribu-42/alice.jpg` en HTTPS via CloudFront, le bucket restant **privé**. Le flux général :

```bash
BUCKET="tribuzen-avatars-eu-west-3"

# 1. Créer l'OAC (signe toujours, SigV4)
aws cloudfront create-origin-access-control \
  --origin-access-control-config \
  Name=oac-tribuzen-avatars,SigningBehavior=always,SigningProtocol=sigv4,OriginAccessControlOriginType=s3
# → note l'Id de l'OAC dans la sortie

# 2. Créer la distribution avec le bucket comme origin S3 + l'OAC attaché
#    (via un fichier de config JSON généré puis édité)
aws cloudfront create-distribution --distribution-config file://dist-config.json
# → note l'Id (E123...) et le DomainName (dxxxx.cloudfront.net)

# 3. Autoriser CloudFront à lire le bucket, SANS le rendre public :
cat > bucket-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipalReadOnly",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::tribuzen-avatars-eu-west-3/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::111122223333:distribution/E123"
      }
    }
  }]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://bucket-policy.json

# 4. Attendre le déploiement (Status: Deployed), puis tester
curl -I "https://dxxxx.cloudfront.net/avatars/tribu-42/alice.jpg"
#   1re requête : X-Cache: Miss from cloudfront
#   2e requête : X-Cache: Hit from cloudfront
```

Ce que ce montage garantit :
- Le bucket reste **privé** : `curl` directement sur l'URL S3 renvoie `403`, seul CloudFront (signature SigV4, SourceArn = cette distribution) passe.
- La 2ᵉ requête est un **hit** au edge : latence réduite, S3 n'est pas retapé.
- HTTPS de bout en bout, sans exposer une seule clé.

### Exemple 2 — Déployer un nouvel avatar et rafraîchir le cache

Un membre change d'avatar (même key `alice.jpg`). CloudFront sert l'ancienne image tant que le TTL n'a pas expiré.

```bash
# On ré-uploade la nouvelle image sous la même key
aws s3 cp alice-new.jpg s3://tribuzen-avatars-eu-west-3/avatars/tribu-42/alice.jpg

# Option A (ponctuel) : invalider ce chemin — 1 chemin, gratuit sous 1000/mois
aws cloudfront create-invalidation \
  --distribution-id E123 \
  --paths "/avatars/tribu-42/alice.jpg"

# Option B (recommandée pour des assets qui changent souvent) :
# versionner la key → /avatars/tribu-42/alice.v2.jpg (nouvelle URL = pas d'invalidation)
```

Pour un avatar (changement rare, une key stable attendue par le front), l'invalidation ponctuelle est OK. Pour du **JS/CSS de build** qui change à chaque déploiement, le **versioning par hash** est la bonne réponse — pas 1 000 invalidations par mois.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « Je rends le bucket public pour que CloudFront lise »

C'est annuler tout le module 04. Le bon montage est **bucket privé + OAC** : la bucket policy autorise `cloudfront.amazonaws.com` **pour cette distribution seulement** (`AWS:SourceArn`), et Block Public Access reste actif. CloudFront devient le **seul** chemin d'accès.

### PIÈGE #2 — Utiliser OAI (l'ancien mécanisme)

OAI est *legacy*. Il ne supporte ni **SSE-KMS**, ni les buckets des **régions opt-in** récentes, ni les requêtes **`PUT`/`DELETE`**. Pour toute nouvelle distribution : **OAC**. Si tu tombes sur de l'OAI dans un projet existant, la doc AWS décrit la migration (bucket policy à deux statements pendant la transition, puis on retire l'OAI).

### PIÈGE #3 — Confondre CloudFront et le cache HTTP du cours 11

CloudFront est un **CDN** (cache **partagé** au edge, géré par TTL/cache policy). Le cours 11 traite du cache **HTTP** au sens protocole (`Cache-Control`, `ETag`, `304`, cache **navigateur**). Ils se **branchent** l'un sur l'autre — l'origin envoie `Cache-Control`, CloudFront l'interprète — mais ce ne sont pas la même couche. Ici on configure le CDN ; le détail des directives HTTP est le cours 11.

### PIÈGE #4 — Croire que l'invalidation `/*` coûte « des milliers de chemins »

Un chemin avec `*` compte pour **UN seul** chemin de facturation, même s'il vide des milliers de fichiers. Le piège inverse est plus courant : **abuser** de l'invalidation à chaque déploiement au lieu de **versionner les fichiers** (moins cher, maîtrise aussi le cache navigateur).

### PIÈGE #5 — Minimum TTL > 0 qui « ignore » `no-store`

Si tu mets un Minimum TTL > 0, CloudFront **cache quand même** pour cette durée, même si l'origin envoie `no-cache`/`no-store`/`private`. Résultat : du contenu que tu croyais non caché reste au edge. Laisse **Minimum TTL = 0** sauf raison précise, et pilote la durée via `Cache-Control` de l'origin.

### PIÈGE #6 — Certificat ACM créé dans la mauvaise région

Un certificat ACM pour CloudFront **doit** vivre dans **`us-east-1`**, même si ton bucket et ton app sont en `eu-west-3`. Un certificat créé dans la région de l'app ne sera **pas** proposé à la distribution. C'est l'erreur classique du premier domaine custom.

### PIÈGE #7 — CloudFront Functions vs Lambda@Edge sur le mauvais besoin

CloudFront Functions est **sub-milliseconde**, sans réseau ni accès au body. Si tu as besoin d'appeler DynamoDB, de lire le corps de la requête ou d'une lib tierce → **Lambda@Edge**. Vouloir faire un appel réseau depuis une CloudFront Function échoue par conception.

---

## 5. Ancrage TribuZen

Dans l'infra `tribuzen`, CloudFront est le **CDN devant la couche médias S3** posée au module 04. Le bucket `tribuzen-avatars-<region>` reste **privé** ; CloudFront (OAC) est le seul à le lire, et le front ne connaît que le domaine CDN.

```
front (Nuxt)  ──GET https://cdn.tribuzen.app/avatars/tribu-42/alice.jpg──▶ CloudFront
                                                          │ cache miss
                                                          ▼
                                    S3 privé tribuzen-avatars ←── OAC (SigV4)
                                    bucket policy: cloudfront.amazonaws.com + SourceArn
```

- **Lecture des avatars** : le front pointe `src` vers `cdn.tribuzen.app` (certificat ACM us-east-1, Redirect HTTP→HTTPS), jamais vers l'URL S3. Cache long (`Cache-Control: max-age` posé sur les objets), compression activée.
- **Écriture** reste inchangée : upload direct navigateur → S3 par **presigned URL** (module 04). CloudFront est en **lecture** ; l'écriture ne passe pas par lui.
- **Assets de build** (JS/CSS du front) : servis via CloudFront avec **versioning par hash** (`app.<hash>.js`) → pas d'invalidation à chaque déploiement.
- **Headers de sécurité** (HSTS, `X-Content-Type-Options`, `X-Frame-Options`) ajoutés par une **CloudFront Function** en Viewer Response — pas besoin de Lambda@Edge ici.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/
  infra/
    cloudfront-avatars.ts   ← distribution + OAC + cache policy (CDK, module 05)
    s3-avatars.ts           ← bucket privé du module 04 (référencé comme origin)
  edge/
    security-headers.js     ← CloudFront Function (Viewer Response)
```

> La distribution est **définie en CDK** (module 05) : `Distribution`, `S3BucketOrigin.withOriginAccessControl(bucket)`, cache policy. Ici on l'a montée en CLI pour comprendre chaque pièce ; en prod, c'est du code.

---

## 6. Points clés

1. **CloudFront** est un **CDN** : cache le contenu au **edge** proche des utilisateurs ; la **distribution** relie origins et cache behaviors et expose un domaine HTTPS.
2. On met CloudFront **devant un bucket S3 privé** — jamais public : c'est OAC qui donne l'accès, pas l'ouverture du bucket.
3. Un **cache behavior** = règle par **path pattern** (origin, méthodes, cache policy) ; évaluation du plus spécifique au plus général ; le default `*` est obligatoire.
4. Le **TTL** (min ≤ default ≤ max) pilote le cache ; Default TTL = **24 h** sans header ; l'origin ajuste via `Cache-Control`/`s-maxage` — **c'est le pont avec le cours 11** (HTTP caching).
5. **OAC** (méthode actuelle, remplace **OAI**) : bucket privé, CloudFront signe en **SigV4**, bucket policy sur `cloudfront.amazonaws.com` + condition `AWS:SourceArn` ; supporte SSE-KMS, toutes régions, `PUT`/`DELETE`.
6. **Invalidation** : 1 000 chemins/mois gratuits (compte entier), `*` = **1 chemin** ; AWS recommande plutôt le **versioning de fichiers** (moins cher, gère aussi le cache navigateur).
7. **CloudFront Functions** (JS, sub-ms, sans réseau) pour les manipulations légères ; **Lambda@Edge** (Node/Python, ≤ 30 s, réseau + body) pour la logique lourde.
8. **HTTPS/ACM** : domaine custom = certificat ACM dans **`us-east-1`** (obligatoire pour CloudFront), validation DNS, Redirect HTTP→HTTPS.

---

## 7. Seeds Anki

```
Pourquoi mettre CloudFront devant un bucket S3 privé plutôt que rendre le bucket public ?|Public rouvre la faille : n'importe qui tape S3 directement, contournant cache/HTTPS/sécurité. Avec CloudFront + OAC, le bucket reste privé (Block Public Access actif) et CloudFront est le SEUL à y accéder, via signature SigV4 autorisée par la bucket policy.
OAC ou OAI pour sécuriser un origin S3, et pourquoi ?|OAC (Origin Access Control) est la méthode ACTUELLE ; OAI est legacy. OAC seul supporte SSE-KMS, tous les buckets de toutes régions (opt-in incluses) et les requêtes PUT/DELETE. Toute nouvelle distribution : OAC.
Que contient la bucket policy pour autoriser CloudFront via OAC ?|Principal = service cloudfront.amazonaws.com, Action s3:GetObject, et une Condition StringEquals sur AWS:SourceArn = l'ARN de la distribution. Ça limite l'accès à CETTE distribution, bucket restant privé.
Quel est le Default TTL de CloudFront sans cache policy, et qui peut le surcharger ?|24 h (86 400 s) quand l'origin n'envoie ni Cache-Control ni Expires. L'origin surcharge via Cache-Control: max-age (CloudFront cache min(max-age, Max TTL)) ; s-maxage est prioritaire côté CDN sur max-age.
Combien coûte une invalidation, et que compte un chemin avec un wildcard ?|Les 1000 premiers chemins/mois sont gratuits (sur tout le compte). Au-delà, facturation par chemin. Un chemin avec * (ex : /* ) compte pour UN seul chemin même s'il invalide des milliers de fichiers. AWS recommande plutôt le versioning de fichiers.
Quand choisir CloudFront Functions plutôt que Lambda@Edge ?|CloudFront Functions (JS ES5.1, sub-milliseconde, 2 Mo, PAS de réseau ni body) pour manipulations légères : réécriture d'URL, headers de sécurité, cache key. Lambda@Edge (Node/Python, jusqu'à 30 s, accès réseau + body + libs) pour la logique lourde. Par défaut : Functions.
Pourquoi préférer le versioning de fichiers à l'invalidation de cache ?|Le versioning (URL unique par version, ex : app.<hash>.js) maîtrise aussi le cache NAVIGATEUR (pas juste l'edge), ne coûte rien (pas de frais d'invalidation), et simplifie rollback/A-B. L'invalidation reste pour les cas ponctuels.
Dans quelle région créer un certificat ACM pour CloudFront ?|us-east-1 OBLIGATOIREMENT, même si le bucket/l'app sont ailleurs (eu-west-3). Un certificat créé dans la région de l'app ne sera pas proposé à la distribution.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-13-cloudfront-cdn/README.md`. Monter une **vraie** distribution CloudFront devant un bucket S3 **privé** avec **OAC** + bucket policy, prouver le hit/miss au `curl`, invalider un chemin — avec rappel **teardown** (coût AWS). Corrigé CLI intégral, feedback coach en session.
