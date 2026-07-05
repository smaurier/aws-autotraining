# Lab 08 — RDS PostgreSQL : provisionner, connecter, snapshot, teardown

> **Outcome :** à la fin, tu as provisionné une **vraie** instance RDS PostgreSQL dans ton VPC, tu t'y es connecté en `psql`, tu as créé un schéma TribuZen minimal, pris un **snapshot manuel**, observé les paramètres Multi-AZ / backup — puis **tout détruit**.
> **Vrai outil :** AWS CLI v2 + Console RDS + client `psql` (PostgreSQL). Aucun harnais de test simulé.
> **Feedback :** le coach valide en session (lecture des commandes, du schéma, de la config affichée). Pas de test-runner auto-correcteur.
>
> ⚠️ **Coût — LIS AVANT DE COMMENCER.** RDS n'est **pas gratuit indéfiniment**. Le Free Tier couvre **750 h/mois de `db.t3.micro` (ou `db.t4g.micro`) en Single-AZ pendant 12 mois** + 20 Go de stockage. Au-delà (ou hors éligibilité), une instance RDS **tourne 24/7 et se facture à l'heure même inutilisée**. Deux règles non négociables :
> 1. Crée l'instance en **Single-AZ**, classe **`db.t3.micro`**, **20 Go gp3**, **sans** read replica (le Multi-AZ, on l'**observe** en config, on ne le **provisionne** pas — ça double le coût).
> 2. **Teardown obligatoire** en fin de lab (section dédiée). Une instance oubliée = facture qui court. Ne quitte pas la session sans avoir vérifié la suppression.
>
> ElastiCache : on **ne provisionne pas** de cluster (coût + temps de création). Le pattern cache-aside se traite **sur papier / pseudocode** en étape 6 — la logique est le vrai livrable, pas l'infra.

---

## Prérequis

- Compte AWS, **AWS CLI v2** configurée (`aws configure`), user IAM (pas root) avec droits RDS/EC2.
- Un **VPC avec au moins 2 subnets dans 2 AZ différentes** (le défaut region en a — module 02). RDS l'exige pour le subnet group.
- Client **`psql`** installé localement (`psql --version`). Sur Windows : installeur PostgreSQL ou `winget install PostgreSQL.PostgreSQL`.
- Région de travail : `eu-west-3` (Paris). Adapte les AZ (`eu-west-3a`, `eu-west-3b`).

Vérifie ton point de départ :

```bash
aws sts get-caller-identity                 # qui suis-je
aws ec2 describe-vpcs --query "Vpcs[].VpcId" # note ton VpcId
psql --version                               # le client est là
```

---

## Énoncé

Tu poses la couche base relationnelle de TribuZen. Cahier des charges **exact** :

1. **Un DB subnet group** `tribuzen-db-subnets` couvrant **2 subnets dans 2 AZ**.
2. **Un security group** `tribuzen-db-sg` autorisant le port **5432** — **uniquement depuis ton IP** pour ce lab (en prod : depuis le SG des Lambda/ECS, jamais `0.0.0.0/0`).
3. **Une instance RDS PostgreSQL** `tribuzen-db` : `db.t3.micro`, **Single-AZ**, 20 Go gp3, **backups automatiques rétention 7 jours**, dans le subnet group et le SG ci-dessus.
4. **Te connecter en `psql`** et créer un schéma TribuZen minimal (tables `families`, `members` avec une clé étrangère).
5. **Prendre un snapshot manuel** `tribuzen-db-snap-avant-migration`.
6. **Sur papier** : écrire le pseudocode **cache-aside** (+ TTL) qui servirait la lecture « membres de la famille X » depuis un cache Redis/Valkey devant cette base, et **répondre** : pourquoi activer Multi-AZ sur cette instance ne réglerait **pas** un problème de lectures trop nombreuses ?
7. **Teardown complet.**

Tu écris toi-même les commandes et le SQL. Pas de gap-fill.

---

## Étapes (en friction)

Remplace `vpc-xxxx`, `subnet-aaaa`/`subnet-bbbb` et `TON_IP` par tes valeurs réelles.

1. **Subnet group** (2 AZ)
   ```bash
   aws rds create-db-subnet-group \
     --db-subnet-group-name tribuzen-db-subnets \
     --db-subnet-group-description "TribuZen RDS subnets" \
     --subnet-ids subnet-aaaa subnet-bbbb
   ```

2. **Security group** + règle 5432 depuis ton IP seulement
   ```bash
   aws ec2 create-security-group \
     --group-name tribuzen-db-sg \
     --description "TribuZen RDS access" \
     --vpc-id vpc-xxxx
   # -> note le GroupId (sg-yyyy)

   aws ec2 authorize-security-group-ingress \
     --group-id sg-yyyy \
     --protocol tcp --port 5432 \
     --cidr TON_IP/32     # ex: 90.12.34.56/32 (jamais 0.0.0.0/0)
   ```

3. **Instance RDS** (Single-AZ, Free-Tier-friendly). Choisis un mot de passe fort.
   ```bash
   aws rds create-db-instance \
     --db-instance-identifier tribuzen-db \
     --engine postgres \
     --db-instance-class db.t3.micro \
     --allocated-storage 20 --storage-type gp3 \
     --master-username tribuzenadmin \
     --master-user-password 'ChangeMe_TribuZen2026!' \
     --db-name tribuzen \
     --vpc-security-group-ids sg-yyyy \
     --db-subnet-group-name tribuzen-db-subnets \
     --backup-retention-period 7 \
     --no-multi-az \
     --publicly-accessible \
     --no-deletion-protection
   ```
   > `--publicly-accessible` est un **raccourci de lab** pour te connecter depuis ta machine. En prod : subnets privés, **pas** d'accès public, connexion via bastion/VPN/Lambda dans le VPC.

   Attends que l'instance soit `available` (5-10 min) et récupère l'endpoint :
   ```bash
   aws rds wait db-instance-available --db-instance-identifier tribuzen-db
   aws rds describe-db-instances --db-instance-identifier tribuzen-db \
     --query "DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,MultiAZ:MultiAZ,Backup:BackupRetentionPeriod}"
   ```
   Lis la sortie : `MultiAZ: false`, `Backup: 7`. **Observe** ici que Multi-AZ est un simple booléen de config.

4. **Connexion `psql`** + schéma (remplace `ENDPOINT`)
   ```bash
   psql "host=ENDPOINT port=5432 dbname=tribuzen user=tribuzenadmin sslmode=require"
   ```
   Puis dans `psql`, écris toi-même le schéma (2 tables + FK). Objectif attendu : `families(id, name)` et `members(id, family_id -> families, name, is_admin)`.

5. **Snapshot manuel**
   ```bash
   aws rds create-db-snapshot \
     --db-instance-identifier tribuzen-db \
     --db-snapshot-identifier tribuzen-db-snap-avant-migration
   aws rds wait db-snapshot-available \
     --db-snapshot-identifier tribuzen-db-snap-avant-migration
   ```

6. **Sur papier** : pseudocode cache-aside + réponse à la question Multi-AZ (voir corrigé).

7. **Teardown** (section dédiée ci-dessous) — **ne saute pas cette étape.**

---

## Corrigé complet commenté

### Étape 4 — schéma TribuZen minimal (dans `psql`)

```sql
-- Table des familles : la racine du modèle TribuZen
CREATE TABLE families (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Table des membres : chaque membre appartient à UNE famille (intégrité référentielle)
CREATE TABLE members (
  id        SERIAL PRIMARY KEY,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  is_admin  BOOLEAN NOT NULL DEFAULT false
);

-- Données de test
INSERT INTO families (name) VALUES ('Famille Maurier');       -- id = 1
INSERT INTO members (family_id, name, is_admin)
VALUES (1, 'Alice', true), (1, 'Bob', false);

-- Vérifie la jointure : c'est TOUT l'intérêt du relationnel
SELECT f.name AS famille, m.name AS membre, m.is_admin
FROM members m JOIN families f ON f.id = m.family_id;
```

- `REFERENCES families(id)` = **contrainte d'intégrité référentielle** : impossible d'insérer un membre pour une famille inexistante. C'est ce que RDS/relationnel garantit et que DynamoDB (module 09) ne fait pas nativement.
- `ON DELETE CASCADE` : supprimer une famille supprime ses membres — cohérence côté base.

### Étape 6 — pseudocode cache-aside + question Multi-AZ

```
# Servir "les membres de la famille X" via un cache Redis/Valkey devant RDS
fonction getMembers(familyId):
    clé = "members:" + familyId

    cached = cache.get(clé)
    si cached n'est pas null:
        retourner cached                 # CACHE HIT (microsecondes)

    # CACHE MISS
    rows = db.query(
      "SELECT id, name, is_admin FROM members WHERE family_id = $1", familyId)
    cache.set(clé, rows, TTL = 60)       # TTL obligatoire : borne la péremption
    retourner rows

# À l'ajout d'un membre, invalider pour éviter le stale :
fonction addMember(familyId, ...):
    db.query("INSERT INTO members ...")
    cache.del("members:" + familyId)     # le prochain read repartira de la base
```

**Question : pourquoi Multi-AZ ne règle-t-il PAS un problème de lectures trop nombreuses ?**

> Parce qu'un **Multi-AZ DB instance** ne fait que maintenir un **standby synchrone** dans une autre AZ **pour le failover** — ce standby **ne sert aucun trafic** (ni lecture ni écriture). Il apporte de la **disponibilité**, pas de la capacité de lecture. Pour absorber des lectures massives, il faut soit un **read replica** (copie asynchrone **lisible**), soit un **cache** (ElastiCache, cache-aside) devant la base — c'est ce cache qui, ici, décharge réellement RDS.

---

## Teardown (obligatoire — RDS coûte cher)

Une instance RDS oubliée facture **jour et nuit**. Détruis dans l'ordre (les dépendances bloquent la suppression) :

```bash
# 1. Instance RDS — --skip-final-snapshot pour un lab (sinon AWS en exige un)
aws rds delete-db-instance \
  --db-instance-identifier tribuzen-db \
  --skip-final-snapshot \
  --delete-automated-backups
aws rds wait db-instance-deleted --db-instance-identifier tribuzen-db

# 2. Snapshot manuel (il SURVIT à la suppression de l'instance et se facture au stockage)
aws rds delete-db-snapshot \
  --db-snapshot-identifier tribuzen-db-snap-avant-migration

# 3. Subnet group (supprimable seulement une fois l'instance partie)
aws rds delete-db-subnet-group --db-subnet-group-name tribuzen-db-subnets

# 4. Security group
aws ec2 delete-security-group --group-id sg-yyyy
```

Vérifie que **rien ne reste facturable** :

```bash
aws rds describe-db-instances --query "DBInstances[?DBInstanceIdentifier=='tribuzen-db']"
aws rds describe-db-snapshots --snapshot-type manual \
  --query "DBSnapshots[?DBSnapshotIdentifier=='tribuzen-db-snap-avant-migration']"
# -> les deux doivent renvoyer [] (liste vide)
```

> ⚠️ Le **snapshot manuel** ne disparaît **pas** avec l'instance : c'est le piège de facturation classique. L'étape 2 est indispensable. Passe aussi un œil sur la Console **Billing** le lendemain.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. En **25 minutes**, provisionne `tribuzen-db-v2` (mêmes contraintes Free-Tier), connecte-toi en `psql`, recrée le schéma `families`/`members` **de mémoire**.
2. Cette fois, **restaure** une base à partir d'un snapshot : prends un snapshot manuel, puis `aws rds restore-db-instance-from-db-snapshot` vers une **nouvelle** instance `tribuzen-db-restored`. Vérifie que tes données sont là.
3. **Explique par écrit** en une phrase pourquoi la restauration crée une *nouvelle* instance plutôt que d'écraser l'existante.
4. **Teardown complet des deux instances + tous les snapshots.** Prouve avec `describe-db-instances`/`describe-db-snapshots` que tout renvoie `[]`.

**Critère de réussite :** les deux instances et tous les snapshots sont supprimés (listes vides), et tu as su restaurer des données depuis un snapshot sans regarder le corrigé.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette base ne sera **pas** créée à la CLI à la main : elle sera décrite en **CDK** (module 05), qui produit l'instance RDS, le subnet group, le SG (ouvert au seul SG des Lambda/ECS) et le cluster ElastiCache, avec les bons **roles IAM** (module 01).

**Ce que tu portes du lab vers le produit :**

- Le **modèle relationnel** (`families`, `members`, plus tard `events`, `invitations`) avec ses contraintes d'intégrité — le cœur SQL de TribuZen.
- Le **réflexe Multi-AZ pour la dispo, read replica / cache pour la lecture** — deux axes distincts, jamais confondus.
- Le pattern **cache-aside + TTL** devant les lectures chaudes (feed, liste des membres), avec **invalidation** à l'écriture.
- Le **réflexe teardown / coût** : une ressource RDS de test se détruit en fin de session, snapshots compris.

**Commit cible :**
```
chore(data): base RDS PostgreSQL TribuZen (schéma familles/membres) + note cache-aside (baseline manuelle avant CDK)
```
