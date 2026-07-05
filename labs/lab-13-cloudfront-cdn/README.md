# Lab 13 — CloudFront : CDN devant S3 (OAC + invalidation)

> **Outcome :** à la fin, tu sais monter une **vraie** distribution CloudFront devant un bucket S3 **privé** avec **OAC** (bucket policy sur le service principal + `SourceArn`), prouver le **cache hit/miss** au `curl`, et **invalider** un chemin.
> **Vrai outil :** AWS réel — Console CloudFront + AWS CLI + `curl`. Pas de CDK ici (le module 05 le fera), pas de harnais simulé.
> **Feedback :** le coach valide en session avec toi (lecture des en-têtes `X-Cache`, du `403` direct S3, du statut `Deployed`). Il n'y a **pas** de test-runner auto-correcteur — c'est de l'infra vivante.

> ⚠️ **Coût AWS.** Ce lab crée une distribution CloudFront et un bucket S3. Le trafic est minuscule (quelques `curl`) : tu restes dans le **Free Tier** CloudFront (1 To sortant/mois + 10 M requêtes/mois la première année, puis un palier gratuit permanent) et sous les **1 000 invalidations/mois gratuites**. Le risque n'est pas le coût du lab, c'est **d'oublier de détruire**. La section **Teardown obligatoire** en fin de lab est **non négociable**.

---

## Contexte TribuZen

Tu reprends le bucket `tribuzen-avatars-<region>` posé au **lab 04** : privé, Block Public Access aux 4 réglages, ACL désactivées (Object Ownership = *Bucket owner enforced*). Le front TribuZen doit afficher les avatars et les assets, mais `<img src="https://...s3.amazonaws.com/...">` renvoie `403` puisque le bucket est privé — et le rendre public **rouvrirait** la faille fermée au lab 04.

La bonne réponse est un **CDN CloudFront devant le bucket**, qui reste strictement privé : seul CloudFront le lit, via **OAC**. C'est exactement la couche « CDN des avatars/assets » de l'infra TribuZen. Ce lab la monte à la main pour comprendre chaque pièce.

---

## Prérequis

- Un bucket S3 **régulier** (PAS un *website endpoint*) et **privé**, avec Object Ownership = **Bucket owner enforced**. Si tu n'as plus celui du lab 04, recrée-en un rapidement :

```bash
REGION="eu-west-3"
BUCKET="tribuzen-avatars-lab13-$RANDOM"   # nom globalement unique

aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

# Block Public Access aux 4 réglages (le bucket ne sera JAMAIS public)
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Un objet de test sous le préfixe avatars/
echo "coucou depuis S3 prive" > alice.txt
aws s3 cp alice.txt "s3://$BUCKET/avatars/tribu-42/alice.txt"
```

- AWS CLI v2 configuré (`aws sts get-caller-identity` répond).
- `curl` disponible.

---

## Énoncé

Objectif mesurable : servir `avatars/tribu-42/alice.txt` en **HTTPS via CloudFront**, le bucket restant **privé**, et prouver au `curl` :

1. **Accès direct S3 → `403`** (le bucket n'est pas public).
2. **Accès via CloudFront → `200`**, 1ʳᵉ requête `X-Cache: Miss from cloudfront`, 2ᵉ requête `X-Cache: Hit from cloudfront`.
3. Après modification de l'objet + **invalidation**, CloudFront resert la **nouvelle** version.

Tu montes le tout toi-même : distribution (Console), OAC, bucket policy, vérification, invalidation. **Pas de gap-fill.**

### Critères de réussite (le coach coche avec toi)

- [ ] `curl -I` sur l'URL **S3 directe** de l'objet renvoie `403`.
- [ ] La distribution affiche **Last modified / Status = `Deployed`** (ou `Enabled`).
- [ ] `curl -I https://<domaine>.cloudfront.net/avatars/tribu-42/alice.txt` renvoie `200`.
- [ ] Header `X-Cache: Miss from cloudfront` au 1ᵉʳ appel, `Hit from cloudfront` au 2ᵉ.
- [ ] La bucket policy contient `"Service": "cloudfront.amazonaws.com"` **et** une condition `AWS:SourceArn` = l'ARN de **ta** distribution (pas `*`).
- [ ] Block Public Access est **resté** activé sur les 4 réglages.
- [ ] Après `create-invalidation` + ré-upload, le `curl` renvoie le **nouveau** contenu.
- [ ] **Teardown fait** : distribution supprimée, bucket vidé + supprimé.

---

## Étapes (en friction)

1. **Crée l'OAC** (Console CloudFront → *Origin access* → *Create control setting* → **Origin type = S3**, **Sign requests (recommended)**). Note son nom.
2. **Crée la distribution** (Console → *Create distribution*) : origin = ton bucket S3 (choisis-le dans la liste, **pas** l'URL website), *Origin access* = **Origin access control settings**, sélectionne ton OAC. Viewer protocol policy = **Redirect HTTP to HTTPS**. Laisse la cache policy managée par défaut (`CachingOptimized`).
3. **Colle la bucket policy** : la Console te propose un bouton **Copy policy** — copie-la, va dans S3 → *Permissions* → *Bucket policy*, colle, vérifie que le `SourceArn` est bien l'ARN de ta distribution.
4. **Attends le déploiement** : la distribution passe de *Deploying* à un **Last modified** daté (statut `Deployed`). Note le **Distribution domain name** (`dxxxx.cloudfront.net`) et l'**ID** (`E...`).
5. **Prouve que S3 direct est fermé** — `curl -I` sur l'URL S3 de l'objet → doit être `403`.
6. **Prouve le hit/miss** — deux `curl -I` successifs sur l'URL CloudFront ; lis `X-Cache`.
7. **Invalide** — modifie l'objet (ré-upload), lance `create-invalidation` sur le chemin, attends `Completed`, re-`curl` → nouveau contenu.
8. **Teardown** — désactive puis supprime la distribution, vide + supprime le bucket. Coche que plus rien ne tourne.

> **Note friction :** tu peux tout faire en CLI, mais **créer une distribution en CLI** exige un gros fichier `distribution-config.json` peu pédagogique. Ici : **distribution à la Console** (tu vois les pièces), **vérification + invalidation en CLI** (reproductible). Le corrigé donne les deux chemins pour l'OAC et la bucket policy.

---

## Corrigé complet commenté

### 1. OAC — via CLI (alternative à la Console)

```bash
# Génère un squelette d'entrée, édite-le, puis crée l'OAC.
aws cloudfront create-origin-access-control \
  --generate-cli-skeleton yaml-input > oac.yaml

# Dans oac.yaml : Name=oac-tribuzen-avatars, SigningBehavior=always,
#                 SigningProtocol=sigv4, OriginAccessControlOriginType=s3
aws cloudfront create-origin-access-control --cli-input-yaml file://oac.yaml
# → note l'Id de l'OAC dans la sortie (tu l'attaches à l'origin de la distribution).
```

`SigningBehavior=always` = CloudFront **signe toujours** ses requêtes vers S3 en SigV4 (recommandé). Avec `never`, il faudrait rendre le bucket public — exactement ce qu'on refuse.

### 2. Distribution — à la Console

Origin = bucket S3 régulier, *Origin access control* = l'OAC ci-dessus, *Viewer protocol policy* = **Redirect HTTP to HTTPS**, cache policy managée `CachingOptimized`. On récupère :

```bash
DIST_ID="E1234567890ABC"                 # l'ID de TA distribution
DOMAIN="dxxxxxxxxxxxxx.cloudfront.net"    # le domaine de TA distribution
BUCKET="tribuzen-avatars-lab13-xxxxx"
ACCOUNT="111122223333"                    # aws sts get-caller-identity --query Account
```

### 3. Bucket policy OAC — le cœur de la sécurité

```bash
cat > bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipalReadOnly",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID"
      }
    }
  }]
}
EOF

aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://bucket-policy.json
```

Points clés, ligne à ligne :
- `Principal.Service = cloudfront.amazonaws.com` → on autorise **le service** CloudFront, pas un user.
- `Action = s3:GetObject` → **lecture seule** ; l'écriture des avatars reste par presigned URL (lab 04), elle ne passe pas par le CDN.
- `Condition AWS:SourceArn` → **restreint à TA distribution**. Sans cette condition, n'importe quelle distribution du monde pourrait lire le bucket. C'est le garde-fou du « confused deputy ».
- Block Public Access reste **actif** : cette policy accorde un accès nominatif à CloudFront, elle ne rend rien public.

### 4. Preuve : S3 direct fermé, CloudFront ouvert

```bash
# Accès DIRECT à S3 → doit échouer (bucket privé)
curl -I "https://$BUCKET.s3.$REGION.amazonaws.com/avatars/tribu-42/alice.txt"
# → HTTP/1.1 403 Forbidden        ✅ le bucket n'est pas public

# Accès via CloudFront, 1re requête → cache MISS (CloudFront va chercher à l'origin)
curl -I "https://$DOMAIN/avatars/tribu-42/alice.txt"
# → HTTP/2 200
# → x-cache: Miss from cloudfront
# → x-amz-cf-pop: CDG52-P3        (edge location qui a servi)
# → x-amz-cf-id: <identifiant de requête>

# 2e requête (même chemin, même edge) → cache HIT (servi depuis l'edge)
curl -I "https://$DOMAIN/avatars/tribu-42/alice.txt"
# → x-cache: Hit from cloudfront   ✅ servi au edge, S3 non retapé
```

> Selon l'edge qui te sert et la propagation, il peut falloir **2-3** appels avant le premier `Hit` (le `Miss` peuple d'abord l'edge le plus proche). Si tu tapes toujours `Miss`, vérifie que tu frappes le même chemin exact.

### 5. Invalidation — forcer la fraîcheur

```bash
# On modifie l'objet SANS changer sa clé (même URL)
echo "alice v2 - nouvelle version" > alice.txt
aws s3 cp alice.txt "s3://$BUCKET/avatars/tribu-42/alice.txt"

# Sans invalidation, CloudFront sert encore v1 tant que le TTL n'a pas expiré.
INVAL_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/avatars/tribu-42/alice.txt" \
  --query 'Invalidation.Id' --output text)

# Attendre la fin de l'invalidation
aws cloudfront wait invalidation-completed \
  --distribution-id "$DIST_ID" --id "$INVAL_ID"

curl -s "https://$DOMAIN/avatars/tribu-42/alice.txt"
# → alice v2 - nouvelle version   ✅ le cache edge a été purgé
```

Un chemin avec `*` (ex. `/avatars/*`) compte pour **UN seul** chemin de facturation même s'il vide des milliers d'objets ; les **1 000 premiers chemins/mois** (compte entier) sont gratuits. Pour des assets qui changent souvent (JS/CSS de build), on **versionne par hash** (`app.a3f5b2c.js`) plutôt que d'invalider — moins cher et ça maîtrise aussi le cache navigateur. Ici, pour un fichier stable, l'invalidation ponctuelle est le bon outil.

**Pourquoi ce corrigé est correct :**
- Le `403` direct + le `200` via CloudFront prouvent que le montage **privé + OAC** tient : CloudFront est le **seul** chemin d'accès.
- Le passage `Miss` → `Hit` prouve que le cache edge fonctionne (S3 n'est retapé qu'au miss).
- Le `SourceArn` scope l'accès à ta seule distribution — pas de porte dérobée.
- L'invalidation suivie du nouveau contenu prouve la maîtrise du cycle de vie du cache.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 13, en 30 minutes :**

1. Ajoute un **second cache behavior** : path pattern `/avatars/*` avec une **cache policy** dont le **Default TTL** est explicitement court (ex. 60 s), le behavior par défaut `*` gardant `CachingOptimized`. Vérifie via `curl -I` que l'objet sous `/avatars/*` re-devient `Miss` après expiration du TTL, alors qu'un autre chemin reste en `Hit` plus longtemps.
2. Ajoute une **CloudFront Function** en *Viewer Response* qui pose l'en-tête `strict-transport-security` ; prouve-le au `curl -I` (`strict-transport-security: max-age=...`).
3. **Critère de réussite :** les deux behaviors ont des comportements de cache distincts observables au `curl`, et l'en-tête HSTS apparaît sur les réponses. **Teardown fait** (function détachée + supprimée, distribution + bucket détruits).

Objectif du fading : reconstruire le montage **de tête** et ajouter la couche « cache behaviors + edge function » du module sans t'appuyer sur le pas-à-pas.

---

## Teardown obligatoire

> **À FAIRE en fin de session, avant de fermer.** Une distribution CloudFront oubliée ne coûte presque rien au repos, mais l'hygiène « je détruis ce que je crée » est **non négociable** en cloud. Le coach vérifie avec toi que la console CloudFront et S3 sont **vides** de ce lab.

Une distribution doit être **désactivée** avant d'être supprimée (AWS refuse de supprimer une distribution `Enabled`).

```bash
# 1) Récupérer la config + l'ETag courant
aws cloudfront get-distribution-config --id "$DIST_ID" > dist.json
ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" \
  --query 'ETag' --output text)

# 2) Passer Enabled à false dans le bloc DistributionConfig de dist.json,
#    puis mettre à jour (le plus simple : Console → distribution → Disable).
#    En CLI : éditer "Enabled": false dans dist.json (bloc DistributionConfig),
#    puis :
# aws cloudfront update-distribution --id "$DIST_ID" \
#   --distribution-config file://<config-modifiee.json> --if-match "$ETAG"

# 3) Attendre que la distribution soit à nouveau "Deployed" (désactivée)
aws cloudfront wait distribution-deployed --id "$DIST_ID"

# 4) Supprimer la distribution (nouvel ETag après désactivation)
ETAG=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'ETag' --output text)
aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"

# 5) (optionnel) supprimer l'OAC devenu orphelin
#    aws cloudfront delete-origin-access-control --id <OAC_ID> --if-match <ETAG_OAC>

# 6) Vider puis supprimer le bucket
aws s3 rm "s3://$BUCKET" --recursive
aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION"
```

> Le plus simple pour désactiver : **Console CloudFront → sélectionne la distribution → Disable → attends `Deployed` → Delete**. La CLI est donnée pour l'automatisation. Ordre imposé : **supprimer la distribution avant le bucket** (une distribution active pointant sur un bucket disparu génère des erreurs).

**Checklist teardown :**
- [ ] Distribution `Disabled` puis **supprimée**.
- [ ] OAC supprimé (ou noté comme réutilisable).
- [ ] Bucket **vidé** puis **supprimé**.
- [ ] `aws cloudfront list-distributions` ne liste plus ce lab.

---

## Application TribuZen

Dans le vrai produit, ce montage n'est **pas** manuel : il est **codé en CDK** (module 05). Ce lab t'a fait toucher chaque pièce à la main pour que le code CDK ne soit pas une boîte noire.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  infra/
    s3-avatars.ts           ← bucket privé (lab 04), référencé comme origin
    cloudfront-avatars.ts   ← Distribution + S3BucketOrigin.withOriginAccessControl(bucket) + cache policy
  edge/
    security-headers.js     ← CloudFront Function (Viewer Response : HSTS, X-Content-Type-Options)
```

**Différences par rapport au lab :**
- La distribution, l'OAC et la bucket policy sont générés par CDK (`Distribution`, `S3BucketOrigin.withOriginAccessControl(bucket)`) — pas de clic Console, pas de JSON à la main.
- Le domaine sera **custom** (`cdn.tribuzen.app`) avec un certificat **ACM créé dans `us-east-1`** (obligatoire pour CloudFront) — hors périmètre de ce lab (Console suffit ici avec le domaine `dxxxx.cloudfront.net`).
- Les avatars portent un `Cache-Control: max-age=...` posé à l'upload ; les assets de build sont **versionnés par hash** (pas d'invalidation à chaque déploiement).

**Commit cible :**
```
feat(infra): CloudFront devant S3 avatars — OAC, bucket policy SourceArn, cache behavior
```
