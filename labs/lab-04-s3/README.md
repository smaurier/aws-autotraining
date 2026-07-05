# Lab 04 — S3 : bucket privé, versioning, presigned URL, policy

> **Outcome :** à la fin, tu as créé un vrai bucket S3 privé, uploadé/versionné des objets, généré une presigned URL d'upload qui marche depuis le navigateur, et posé une bucket policy — le tout en **AWS Console + AWS CLI**.
> **Vrai outil :** AWS Console S3 + AWS CLI v2 (`aws s3`, `aws s3api`). Pas de SDK, pas de harnais de test — tu opères le vrai service.
> **Feedback :** le coach valide en session (URL qui répond, `aws s3api` qui renvoie l'état attendu). Pas d'auto-correcteur.

> ⚠️ **Coût AWS.** S3 est dans le **Free Tier** (5 Go stockage Standard, 20 000 GET, 2 000 PUT / mois la première année) — ce lab reste largement dedans avec de petits fichiers. **Mais** un bucket versionné accumule des versions facturées, et un bucket oublié coûte. **La dernière étape (teardown) est obligatoire.**

---

## Énoncé

Tu poses la **couche stockage médias de TribuZen** : le bucket qui contiendra les avatars des membres. Cahier des charges **exact** :

1. Créer un bucket **privé** nommé `tribuzen-avatars-<tes-initiales>-<region>` (nom globalement unique — ajoute un suffixe si pris).
2. Vérifier / activer les **4 réglages Block Public Access**.
3. Activer le **versioning**.
4. Uploader un fichier `alice.jpg` sous la key `avatars/tribu-42/alice.jpg`, puis l'**écraser** par une 2ᵉ version et prouver que la 1ʳᵉ est toujours récupérable.
5. Générer une **presigned PUT URL** (expire 5 min) et uploader `bob.jpg` **directement** avec `curl` (sans passer par `aws cp`).
6. Poser une **bucket policy** qui **refuse tout accès non-HTTPS** (`aws:SecureTransport = false`).
7. **Teardown** : vider (toutes versions) et supprimer le bucket.

**Pas de gap-fill** — tu écris toi-même les commandes à partir du squelette ci-dessous.

### Prérequis

- AWS CLI v2 configurée (`aws configure`) avec un user IAM disposant des droits S3 (pas le compte root — cf. module 00/01).
- Deux petites images locales, ou crée-les : `printf 'v1' > alice.jpg` et `printf 'photo' > bob.jpg` (le contenu importe peu pour le lab).
- Note ta région, ex. `eu-west-3`.

### Squelette (à compléter, ne pas copier de solution)

```bash
BUCKET="tribuzen-avatars-<initiales>-eu-west-3"
REGION="eu-west-3"

# 1. mb ...
# 2. put-public-access-block ...
# 3. put-bucket-versioning ...
# 4. cp alice.jpg (x2) puis list-object-versions ...
# 5. presign + curl ...
# 6. put-bucket-policy ...
# 7. teardown
```

---

## Étapes (en friction)

1. **Crée le bucket** avec `aws s3 mb` en précisant `--region`. Si le nom est pris, change le suffixe (rappel : nom **globalement unique**).
2. **Verrouille l'accès public** : `aws s3api put-public-access-block` avec les 4 réglages à `true`. Vérifie ensuite avec `aws s3api get-public-access-block`.
3. **Active le versioning** (`put-bucket-versioning`, `Status=Enabled`), confirme avec `get-bucket-versioning`.
4. **Upload + écrasement** : `aws s3 cp alice.jpg s3://.../avatars/tribu-42/alice.jpg`, modifie le fichier local, re-upload. Liste les versions (`aws s3api list-object-versions`) : tu dois voir **deux** VersionId. Récupère la **1ʳᵉ** dans un fichier local via `aws s3api get-object --version-id ...`.
5. **Presigned URL** : `aws s3 presign s3://.../avatars/tribu-42/bob.jpg --expires-in 300`. Copie l'URL et uploade avec `curl -X PUT --upload-file bob.jpg "<url>"`. Vérifie que l'objet existe (`aws s3 ls`).
6. **Bucket policy HTTPS-only** : écris `policy.json` (Deny sur `s3:*` si `aws:SecureTransport=false`), applique avec `aws s3api put-bucket-policy`. Note : le squelette de policy est dans le module §2.5.
7. **Teardown** : le versioning empêche `rb` simple. Utilise `aws s3 rb s3://$BUCKET --force` (supprime objets courants) **et** purge les versions restantes + delete markers si besoin (voir corrigé), puis confirme que `aws s3 ls | grep $BUCKET` ne renvoie plus rien.

---

## Corrigé complet commenté

```bash
# ── Variables ──────────────────────────────────────────────
BUCKET="tribuzen-avatars-sm-eu-west-3"   # <initiales> = sm
REGION="eu-west-3"

# ── 1. Créer le bucket privé ───────────────────────────────
# --region obligatoire hors us-east-1 ; le nom doit être unique dans tout AWS
aws s3 mb "s3://$BUCKET" --region "$REGION"

# ── 2. Block Public Access : les 4 réglages ────────────────
# Déjà activés par défaut depuis avril 2023, mais on le rend explicite/idempotent
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
# Vérification : les 4 doivent être true
aws s3api get-public-access-block --bucket "$BUCKET"

# ── 3. Versioning ──────────────────────────────────────────
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api get-bucket-versioning --bucket "$BUCKET"   # -> Status: Enabled

# ── 4. Upload, écrasement, récupération d'une ancienne version ──
printf 'v1' > alice.jpg
aws s3 cp alice.jpg "s3://$BUCKET/avatars/tribu-42/alice.jpg"   # version 1
printf 'v2' > alice.jpg
aws s3 cp alice.jpg "s3://$BUCKET/avatars/tribu-42/alice.jpg"   # version 2

# Deux versions listées : la plus récente a IsLatest=true
aws s3api list-object-versions \
  --bucket "$BUCKET" --prefix avatars/tribu-42/alice.jpg \
  --query 'Versions[].{Id:VersionId,Latest:IsLatest}'

# Récupérer la 1re version (remplace VERSION_ID_V1 par le VersionId non-latest)
aws s3api get-object \
  --bucket "$BUCKET" \
  --key avatars/tribu-42/alice.jpg \
  --version-id VERSION_ID_V1 \
  alice-v1.jpg
cat alice-v1.jpg    # -> "v1" : la version d'origine est bien intacte

# ── 5. Presigned PUT URL + upload direct via curl ──────────
# presign génère une URL signée valable 300 s, aux droits de TON user CLI
URL=$(aws s3 presign "s3://$BUCKET/avatars/tribu-42/bob.jpg" --expires-in 300)
printf 'photo' > bob.jpg
# curl uploade DIRECTEMENT vers S3, sans credential AWS dans la requête
curl -X PUT --upload-file bob.jpg "$URL"
aws s3 ls "s3://$BUCKET/avatars/tribu-42/"   # bob.jpg apparaît

# ── 6. Bucket policy : refuser le non-HTTPS ────────────────
cat > policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": [
      "arn:aws:s3:::$BUCKET",
      "arn:aws:s3:::$BUCKET/*"
    ],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://policy.json
aws s3api get-bucket-policy --bucket "$BUCKET"   # confirme la policy en place

# ── 7. TEARDOWN (obligatoire — coût) ───────────────────────
# rb --force supprime les objets "courants" mais PAS les versions non courantes
# ni les delete markers d'un bucket versionné. On purge tout à la main :
aws s3api delete-objects --bucket "$BUCKET" --delete "$(aws s3api list-object-versions \
  --bucket "$BUCKET" \
  --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
  --output json)" 2>/dev/null

aws s3api delete-objects --bucket "$BUCKET" --delete "$(aws s3api list-object-versions \
  --bucket "$BUCKET" \
  --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
  --output json)" 2>/dev/null

# Une fois vidé (toutes versions), le bucket se supprime
aws s3 rb "s3://$BUCKET"
aws s3 ls | grep "$BUCKET" || echo "Bucket supprimé — teardown OK"
```

**Pourquoi ce corrigé est correct :**
- Les 4 réglages BPA + l'absence de policy publique garantissent qu'aucun objet n'est lisible depuis Internet — l'accès passe uniquement par des credentials (CLI) ou une presigned URL temporaire.
- La récupération de `alice-v1.jpg` prouve concrètement que le versioning protège de l'écrasement : sans lui, `v1` serait perdu.
- Le `curl -X PUT` sur l'URL signée démontre l'upload **direct** navigateur → S3, sans clé AWS dans la requête : c'est exactement le flux d'avatar TribuZen.
- Le teardown en deux `delete-objects` (versions **puis** delete markers) est nécessaire car sur un bucket versionné, `rb --force` seul laisse des versions résiduelles facturées et refuse de supprimer le bucket.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. Refais tout **en 20 minutes**, de mémoire.
2. Ajoute une **lifecycle rule** (`put-bucket-lifecycle-configuration`) qui **expire les versions non courantes après 7 jours** et **abandonne les uploads multipart inachevés après 3 jours** — écris le JSON toi-même.
3. Génère la presigned URL avec une **expiration de 60 secondes** et prouve qu'elle **échoue** passé le délai (attends puis re-tente le `curl` : tu dois obtenir une erreur `AccessDenied` / `Request has expired`).

**Critère de réussite :** bucket créé, versionné, lifecycle appliquée (visible via `get-bucket-lifecycle-configuration`), presigned URL expirée qui refuse l'upload, et **teardown complet** en fin.

---

## Application TribuZen

Dans `smaurier/tribuzen`, ce bucket devient la couche médias :

```
tribuzen/
  infra/
    s3-avatars.ts          ← ce bucket, mais défini en CDK (module 05) : BPA + versioning + lifecycle en code
  server/
    api/
      avatars/
        presign.post.ts     ← reproduit l'étape 5 côté serveur (SDK), renvoie l'URL au front (module 06/07)
```

**Différences par rapport au lab :**
- En prod, le bucket est créé en **CDK** (module 05), pas en CLI à la main — mais les réglages (BPA, versioning, lifecycle) sont identiques.
- La presigned URL est générée par une **fonction Lambda** avec un **role IAM** portant `s3:PutObject` restreint au préfixe `avatars/*` — pas par ta CLI perso.
- La lecture publique des avatars passera par **CloudFront + OAC** (module 13), le bucket restant strictement privé.

**Commit cible :**
```
feat(infra): bucket S3 avatars privé — BPA, versioning, lifecycle + presign upload
```
