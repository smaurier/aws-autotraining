# Lab 09 — DynamoDB : la table du feed TribuZen

> **Outcome :** à la fin, tu sais créer une vraie table DynamoDB (clé composite, on-demand), y écrire des items au CLI, lire le feed avec `query`, mesurer pourquoi `scan` est coûteux, et **tout détruire**.
> **Vrai outil :** AWS CLI v2 sur un vrai compte AWS (région `eu-west-3` Paris) — ou la console DynamoDB si tu préfères le visuel. **Aucun harnais simulé.**
> **Feedback :** le coach valide en session (les valeurs `ConsumedCapacity` que tu rapportes, pas un test-runner auto-correcteur).

> ⚠️ **Coût :** en mode **on-demand**, une table **inactive ne coûte rien** (pas de capacité provisionnée idle). Ce lab manipule quelques items → coût négligeable, largement dans le Free Tier. **Mais** tu **dois** exécuter le teardown final (§ dernière étape) pour ne rien laisser traîner.

---

## Prérequis

- AWS CLI v2 installé et configuré (`aws configure`) avec un user/role ayant les droits DynamoDB (`dynamodb:*` sur une table de lab, ou au minimum `CreateTable`, `PutItem`, `Query`, `Scan`, `DeleteTable`, `DescribeTable`).
- Vérifie ta config :

```bash
aws sts get-caller-identity
aws configure get region   # attendu : eu-west-3 (ou ta région)
```

---

## Énoncé

Tu implémentes le stockage du **feed TribuZen** (le mur de messages d'une famille) sur DynamoDB. Cahier des charges **exact** :

1. Table `TribuZenFeed-lab`, clé **composite** : partition key `familyId` (String), sort key `createdAt` (String ISO 8601), mode **on-demand**.
2. Insérer **au moins 4 messages** répartis sur **2 familles** (`family-42` et `family-07`), avec un attribut `text` et parfois un `photoUrl` (schemaless assumé).
3. Lire le feed de `family-42` **du plus récent au plus ancien** avec une `query` (partition key obligatoire, tri décroissant).
4. Récupérer les messages de `family-42` **d'une journée précise** via `begins_with` sur la sort key.
5. Faire volontairement un `scan` avec filtre équivalent, activer `--return-consumed-capacity TOTAL` sur la query ET le scan, et **comparer la capacité consommée**.
6. **Teardown** : supprimer la table et vérifier qu'elle a disparu.

**Pas de gap-fill.** Tu écris toi-même chaque commande à partir du starter minimal ci-dessous. La solution complète est plus bas — n'y va qu'après avoir tenté.

### Starter minimal

```bash
# 1. Créer la table (à compléter : key-schema HASH/RANGE, billing-mode)
aws dynamodb create-table \
  --table-name TribuZenFeed-lab \
  --attribute-definitions AttributeName=familyId,AttributeType=S AttributeName=createdAt,AttributeType=S \
  # ... à toi : --key-schema, --billing-mode

# 2. Attendre que la table soit ACTIVE avant d'écrire
aws dynamodb wait table-exists --table-name TribuZenFeed-lab

# 3. put-item x4  → à toi
# 4. query family-42 (tri décroissant) → à toi
# 5. query begins_with + scan comparés → à toi
# 6. delete-table → à toi
```

---

## Étapes (en friction)

1. **Crée la table** avec `--key-schema AttributeName=familyId,KeyType=HASH AttributeName=createdAt,KeyType=RANGE` et `--billing-mode PAY_PER_REQUEST`. Réfléchis : pourquoi n'a-t-on **pas** à passer `--provisioned-throughput` ici ?
2. **Attends** `wait table-exists` — écrire avant que la table soit `ACTIVE` échoue.
3. **Écris 4 items** avec `put-item` : 2+ pour `family-42`, 2 pour `family-07`, des `createdAt` distincts dans la même famille (sinon collision de clé composite → écrasement). Ajoute `photoUrl` sur un seul.
4. **Query `family-42`** décroissant : `--key-condition-expression`, `--expression-attribute-values`, `--no-scan-index-forward`. Observe l'ordre.
5. **Query `begins_with`** : ajoute `AND begins_with(createdAt, :jour)` pour ne prendre qu'une journée.
6. **Scan équivalent** avec `--filter-expression`, puis compare `ConsumedCapacity` query vs scan (ajoute `--return-consumed-capacity TOTAL` aux deux). Note l'écart et **explique-le**.
7. **Teardown** : `delete-table`, puis `wait table-not-exists`, puis un `describe-table` qui doit échouer (`ResourceNotFoundException` = succès).

**Cas limite à provoquer :** ré-écris un item avec **exactement** la même `familyId` + `createdAt` → il est **remplacé** (pas de doublon), car `put-item` écrase la même clé composite. Vérifie-le.

---

## Corrigé complet commenté

```bash
# ─── 1. Créer la table : clé composite, on-demand ───────────────────────
# HASH = partition key (répartition), RANGE = sort key (tri).
# PAY_PER_REQUEST = on-demand → aucun RCU/WCU à déclarer, zéro coût idle.
aws dynamodb create-table \
  --table-name TribuZenFeed-lab \
  --attribute-definitions \
    AttributeName=familyId,AttributeType=S \
    AttributeName=createdAt,AttributeType=S \
  --key-schema \
    AttributeName=familyId,KeyType=HASH \
    AttributeName=createdAt,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# ─── 2. Bloquer jusqu'à ce que la table soit ACTIVE ─────────────────────
aws dynamodb wait table-exists --table-name TribuZenFeed-lab

# ─── 3. Écrire 4 messages (2 familles) ──────────────────────────────────
# Seuls familyId + createdAt sont des clés ; text/photoUrl sont libres (schemaless).
aws dynamodb put-item --table-name TribuZenFeed-lab --item '{
  "familyId":{"S":"family-42"}, "createdAt":{"S":"2026-07-03T10:00:00Z"},
  "author":{"S":"alice"}, "text":{"S":"On part au lac ce week-end !"}
}'

aws dynamodb put-item --table-name TribuZenFeed-lab --item '{
  "familyId":{"S":"family-42"}, "createdAt":{"S":"2026-07-03T11:30:00Z"},
  "author":{"S":"bob"}, "text":{"S":"Je ramène le kayak"},
  "photoUrl":{"S":"s3://tribuzen-media/family-42/kayak.jpg"}
}'

aws dynamodb put-item --table-name TribuZenFeed-lab --item '{
  "familyId":{"S":"family-42"}, "createdAt":{"S":"2026-07-04T09:15:00Z"},
  "author":{"S":"alice"}, "text":{"S":"RDV 8h devant la maison"}
}'

aws dynamodb put-item --table-name TribuZenFeed-lab --item '{
  "familyId":{"S":"family-07"}, "createdAt":{"S":"2026-07-03T20:00:00Z"},
  "author":{"S":"carla"}, "text":{"S":"Photos du repas ajoutées"}
}'

# ─── 4. Lire le feed de family-42, plus récent d'abord ──────────────────
# key-condition-expression porte UNIQUEMENT sur la clé (partition obligatoire).
# --no-scan-index-forward = ScanIndexForward=false → sort key décroissante.
aws dynamodb query \
  --table-name TribuZenFeed-lab \
  --key-condition-expression "familyId = :fid" \
  --expression-attribute-values '{":fid":{"S":"family-42"}}' \
  --no-scan-index-forward \
  --return-consumed-capacity TOTAL
# → 3 items de family-42, du 2026-07-04 au 2026-07-03. family-07 absent.

# ─── 5a. Query d'une seule journée via begins_with sur la sort key ──────
aws dynamodb query \
  --table-name TribuZenFeed-lab \
  --key-condition-expression "familyId = :fid AND begins_with(createdAt, :jour)" \
  --expression-attribute-values '{":fid":{"S":"family-42"}, ":jour":{"S":"2026-07-03"}}' \
  --return-consumed-capacity TOTAL
# → les 2 messages du 3 juillet uniquement. Efficace : une partition, une plage triée.

# ─── 5b. MÊME besoin en Scan (anti-pattern) pour comparer le coût ───────
# filter-expression appliqué APRÈS lecture : le scan lit TOUS les items de la table,
# family-07 comprise, puis jette ce qui ne matche pas.
aws dynamodb scan \
  --table-name TribuZenFeed-lab \
  --filter-expression "familyId = :fid AND begins_with(createdAt, :jour)" \
  --expression-attribute-values '{":fid":{"S":"family-42"}, ":jour":{"S":"2026-07-03"}}' \
  --return-consumed-capacity TOTAL
# → même résultat (2 items), mais ScannedCount = 4 (tous les items lus) et
#   ConsumedCapacity ≥ celui de la query. Sur une table à millions d'items : catastrophe.

# ─── 6. Prouver l'écrasement sur clé composite identique ────────────────
aws dynamodb put-item --table-name TribuZenFeed-lab --item '{
  "familyId":{"S":"family-42"}, "createdAt":{"S":"2026-07-03T10:00:00Z"},
  "author":{"S":"alice"}, "text":{"S":"(message corrigé)"}
}'
aws dynamodb query --table-name TribuZenFeed-lab \
  --key-condition-expression "familyId = :fid AND createdAt = :ts" \
  --expression-attribute-values '{":fid":{"S":"family-42"}, ":ts":{"S":"2026-07-03T10:00:00Z"}}'
# → UN seul item, text = "(message corrigé)". put-item a remplacé, pas dupliqué.

# ─── 7. TEARDOWN — obligatoire ──────────────────────────────────────────
aws dynamodb delete-table --table-name TribuZenFeed-lab
aws dynamodb wait table-not-exists --table-name TribuZenFeed-lab
aws dynamodb describe-table --table-name TribuZenFeed-lab
# → ResourceNotFoundException attendue = la table est bien supprimée. Rien ne coûte plus.
```

**Pourquoi ce corrigé est correct :**
- La clé composite `familyId` (HASH) + `createdAt` (RANGE) colle au seul pattern d'accès du feed : « les messages d'une famille, triés par date ». La query touche une partition, pas la table entière.
- `--no-scan-index-forward` inverse le tri par sort key → affichage « plus récent d'abord » sans trier côté client.
- La comparaison query/scan rend visible la règle du module : `ConsumedCapacity` et `ScannedCount` du scan grossissent avec **toute** la table ; ceux de la query, avec les seuls items renvoyés.
- On-demand → pas de `--provisioned-throughput`, pas de capacité idle facturée ; le teardown élimine tout coût résiduel de stockage.

---

## Variante J+30 (fading)

**Même table, contrainte ajoutée — en 25 min, sans rouvrir ce corrigé :**

1. Recrée `TribuZenFeed-lab` et 4 messages **de mémoire**.
2. Ajoute un **GSI** `author-index` (partition key `author`, sort key `createdAt`) — à faire soit à la création (`--global-secondary-indexes`), soit en **update-table** après coup (rappelle-toi : un GSI est créable à tout moment, contrairement à un LSI).
3. **Query le GSI** pour obtenir tous les messages de `alice`, toutes familles confondues, triés par date.
4. Explique à voix haute au coach : pourquoi un **GSI** ici et pas un **LSI** ? (indice : la partition key change → `author` ≠ `familyId`, donc LSI impossible.)
5. **Teardown** (supprimer la table supprime aussi ses GSI).

**Critère de réussite :** la query sur `author-index` renvoie les messages de `alice` des deux familles, et tu sais justifier GSI vs LSI sans notes.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette table **ne se crée pas à la main** en production : elle est décrite en **CDK** (module 05) et déployée avec l'infra.

```
tribuzen/
  infra/
    lib/
      feed-table.ts   ← construct CDK : Table on-demand, PK familyId, SK createdAt, GSI author-index
```

**Différences par rapport au lab :**
- La table s'appelle `TribuZenFeed` (sans `-lab`) et vit dans un stack CDK versionné, pas en commandes CLI ponctuelles.
- Les écritures/lectures passent par une **Lambda** (module 06) via `@aws-sdk/lib-dynamodb` (`DynamoDBDocumentClient`) — plus de `{"S": ...}` à la main.
- Un **DynamoDB Stream** est branché sur la table → Lambda de notification push (module 16).
- Le mode reste **on-demand** tant que le trafic beta est imprévisible, puis bascule provisioned + Auto Scaling si la charge se stabilise.

**Commit cible :**
```
feat(feed): table DynamoDB TribuZenFeed (PK familyId, SK createdAt, on-demand) + GSI author-index
```
