# 08 — RDS & ElastiCache

> **Duree estimee** : 5h00
> **Difficulte** : 3/5
> **Prerequis** : Module 02 (VPC), Module 03 (EC2), notions de bases de donnees relationnelles
> **Objectifs** :
> - Comprendre les concepts de **RDS** (instances, multi-AZ, read replicas)
> - Decouvrir **Aurora** (architecture, serverless v2, global)
> - Maitriser les sauvegardes, restauration et **PITR**
> - Configurer **RDS Proxy** pour le connection pooling
> - Utiliser **ElastiCache** (Redis vs Memcached) avec les strategies de cache

---

## RDS — Relational Database Service

### Pourquoi RDS plutot qu'une base sur EC2 ?

Vous pourriez installer MySQL ou PostgreSQL directement sur une instance EC2. Mais vous devriez alors gerer vous-meme :

| Tache | EC2 (vous) | RDS (AWS) |
|-------|-----------|-----------|
| Installation du moteur | Manuel | Automatique |
| Patches de securite | Vous | AWS |
| Sauvegardes | Scripts custom | Automatiques |
| Haute disponibilite | Architecture custom | Multi-AZ en 1 clic |
| Scaling | Migration manuelle | Resize en quelques clics |
| Monitoring | A configurer | CloudWatch integre |

RDS est un service **manage** : AWS gere l'infrastructure, vous gerez les **donnees** et les **requetes**.

### Moteurs supportes

| Moteur | Version | Cas d'usage |
|--------|---------|-------------|
| **PostgreSQL** | 13-16 | Usage general, JSON, extensions |
| **MySQL** | 5.7, 8.0 | Web, WordPress, applications PHP |
| **MariaDB** | 10.6-11 | Alternative open-source a MySQL |
| **Oracle** | 19c, 21c | Applications enterprise legacy |
| **SQL Server** | 2019, 2022 | Ecosysteme Microsoft |
| **Aurora** | Compatible MySQL/PostgreSQL | Performance et scalabilite AWS |

### Classes d'instances

Les instances RDS sont categorisees par famille :

| Famille | Description | Exemple |
|---------|-------------|---------|
| **db.t4g** | Burstable (dev, petites charges) | db.t4g.micro (2 vCPU, 1 Go) |
| **db.r6g** | Optimisee memoire (production) | db.r6g.large (2 vCPU, 16 Go) |
| **db.m6g** | Usage general (equilibree) | db.m6g.large (2 vCPU, 8 Go) |
| **db.x2g** | Memoire extreme (SAP, gros caches) | db.x2g.large (2 vCPU, 32 Go) |

Le suffixe `g` indique les processeurs **Graviton** (ARM) — 20% moins chers que les equivalents Intel.

### Stockage

| Type | IOPS | Cas d'usage |
|------|------|-------------|
| **gp3** | 3000 base (jusqu'a 16000) | Usage general |
| **io2** | Jusqu'a 256000 | Charges lourdes, faible latence |
| **magnetic** | Variable | Legacy, non recommande |

**gp3** est le choix par defaut — performant et economique.

---

## Multi-AZ et Read Replicas

### Multi-AZ : haute disponibilite

Le deploiement **Multi-AZ** cree une copie synchrone de votre base dans une autre zone de disponibilite :

```
Zone A (primaire)          Zone B (standby)
┌──────────────┐          ┌──────────────┐
│  RDS Master  │ ──sync── │  RDS Standby │
│  (lecture +  │  replique │  (pas de     │
│   ecriture)  │  synchron │   trafic)    │
└──────────────┘          └──────────────┘
       ↑
  Votre application
```

**En cas de panne de la Zone A** :
1. AWS detecte la panne (~30 secondes)
2. Le standby est promu en primaire
3. Le DNS est mis a jour (meme endpoint)
4. Votre application se reconnecte automatiquement

**Important** : le standby n'est **pas** accessible en lecture. Il existe uniquement pour le failover.

### Multi-AZ avec 2 standbys (readable)

Depuis 2022, RDS propose un mode Multi-AZ avec **2 standbys lisibles** :

```
Zone A (primaire)     Zone B (standby 1)    Zone C (standby 2)
┌──────────────┐     ┌──────────────┐      ┌──────────────┐
│  RDS Writer  │ ──→ │  RDS Reader  │      │  RDS Reader  │
└──────────────┘     └──────────────┘      └──────────────┘
```

Les standbys sont accessibles en **lecture**, ce qui repartit la charge.

### Read Replicas : scalabilite en lecture

Les **read replicas** sont des copies **asynchrones** de votre base, utilisables pour les lectures :

```
                    ┌── Read Replica 1 (eu-west-1a)
Application ──→ Writer ──→ Read Replica 2 (eu-west-1b)
  (ecritures)      └── Read Replica 3 (us-east-1)  ← cross-region !

Application ──→ Read Replica 1
  (lectures)
```

| Critere | Multi-AZ | Read Replica |
|---------|----------|-------------|
| Replication | Synchrone | Asynchrone |
| Objectif | Haute disponibilite | Performance lecture |
| Accessible | Non (standby) | Oui (lecture seule) |
| Regions | Meme region | Cross-region possible |
| Nombre max | 1 ou 2 standbys | 5 par instance |
| Failover auto | Oui | Non (promotion manuelle) |

### Quand utiliser quoi ?

- **Multi-AZ** : toujours en production pour la resilience
- **Read Replicas** : quand les lectures depassent les capacites du writer
- **Cross-region replica** : pour la latence globale ou le disaster recovery

---

## Amazon Aurora

### Qu'est-ce qu'Aurora ?

**Aurora** est le moteur de base de donnees proprietaire d'AWS, compatible MySQL et PostgreSQL. Il offre des performances jusqu'a **5x MySQL** et **3x PostgreSQL** grace a une architecture de stockage distribuee.

### Architecture Aurora

```
┌─────────────────────────────────────────────────┐
│                  Aurora Cluster                   │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Writer   │  │ Reader 1 │  │ Reader 2 │       │
│  │ Instance │  │ Instance │  │ Instance │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │
│  ┌────┴──────────────┴──────────────┴────┐       │
│  │     Stockage distribue Aurora          │       │
│  │  6 copies sur 3 AZ (auto-reparation)  │       │
│  │  Jusqu'a 128 To auto-scaling          │       │
│  └───────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
```

Avantages cles :
- **Stockage distribue** : 6 copies sur 3 AZ, auto-reparation
- **Auto-scaling** : le stockage croit automatiquement (10 Go → 128 To)
- **Failover rapide** : < 30 secondes (vs ~60 s pour RDS standard)
- **Jusqu'a 15 read replicas** (vs 5 pour RDS)
- **Endpoints** : writer endpoint + reader endpoint (load balancing automatique)

### Aurora Serverless v2

Aurora Serverless v2 ajuste automatiquement la capacite en fonction de la charge :

```
Charge faible (nuit) :     0.5 ACU  →  ~$0.06/h
Charge moyenne (jour) :    4 ACU    →  ~$0.48/h
Pic de charge (soldes) :  64 ACU    →  ~$7.68/h
Retour au calme :          0.5 ACU  →  ~$0.06/h
```

**ACU** (Aurora Capacity Unit) = ~2 Go de RAM + CPU proportionnel.

**Cas d'usage** : charges impredictibles, applications avec des pics saisonniers, environnements de dev/test.

### Aurora Global Database

Pour les applications mondiales, Aurora Global Database replique les donnees dans **plusieurs regions** :

```
Region primaire (eu-west-1)     Region secondaire (us-east-1)
┌───────────────────┐           ┌───────────────────┐
│ Writer + Readers  │ ──────→   │    Readers only    │
│                   │  < 1s     │  (promotion possible│
│                   │  de lag   │   en cas de DR)     │
└───────────────────┘           └───────────────────┘
```

- Replication cross-region en **moins d'1 seconde**
- Jusqu'a **5 regions secondaires**
- Promotion d'une region secondaire en < 1 minute

---

## Sauvegardes et restauration

### Sauvegardes automatiques

RDS effectue des sauvegardes automatiques :
- **Snapshot quotidien** complet
- **Transaction logs** enregistres toutes les 5 minutes
- **Retention** : 0 a 35 jours (0 = desactive)

### PITR — Point-in-Time Recovery

Grace aux transaction logs, vous pouvez restaurer votre base a **n'importe quel moment** dans la fenetre de retention :

```
Lundi 10:00 ─── Mardi 15:00 ─── Mercredi 08:00
    │                │                 │
    ▼                ▼                 ▼
Snapshot         Vous pouvez        Snapshot
automatique      restaurer a        automatique
                 Mardi 15:32:47
                 exactement !
```

**Important** : PITR cree une **nouvelle instance** RDS. L'ancienne instance n'est pas modifiee.

### Snapshots manuels

Vous pouvez creer des snapshots a la demande :

```bash
aws rds create-db-snapshot \
  --db-instance-identifier ma-base \
  --db-snapshot-identifier snap-avant-migration
```

Les snapshots manuels sont conserves **indefiniment** (jusqu'a suppression manuelle).

### Restauration cross-region

Vous pouvez copier un snapshot dans une autre region pour le disaster recovery :

```bash
aws rds copy-db-snapshot \
  --source-db-snapshot-identifier arn:aws:rds:eu-west-1:123456:snapshot:snap-prod \
  --target-db-snapshot-identifier snap-prod-copy \
  --region us-east-1
```

---

## Parameter Groups

### Quoi et pourquoi ?

Un **parameter group** est un ensemble de parametres de configuration du moteur de base de donnees. C'est l'equivalent du fichier `my.cnf` (MySQL) ou `postgresql.conf` (PostgreSQL), mais gere via AWS.

### Parametres courants

| Parametre | Description | Defaut | Recommandation |
|-----------|-------------|--------|----------------|
| `max_connections` | Connexions simultanees max | ~{RAM/12Mo} | Adapter a l'usage |
| `shared_buffers` | Cache memoire (PG) | 25% RAM | 25-40% RAM |
| `innodb_buffer_pool_size` | Cache InnoDB (MySQL) | 75% RAM | 70-80% RAM |
| `log_min_duration_statement` | Log les requetes lentes (PG) | -1 (off) | 1000 (1s) |
| `slow_query_log` | Log les requetes lentes (MySQL) | 0 (off) | 1 |

### Types de parametres

- **Statiques** : necessitent un redemarrage de l'instance
- **Dynamiques** : appliques immediatement

---

## RDS Proxy

### Le probleme des connexions

Chaque connexion a une base de donnees consomme de la memoire et du CPU. Avec Lambda, chaque invocation cree potentiellement une nouvelle connexion :

```
1000 invocations Lambda simultanees
       ↓
1000 connexions a RDS  ← La base ne peut pas gerer !
       ↓
Erreur : "Too many connections"
```

### La solution : RDS Proxy

**RDS Proxy** est un proxy de connexion manage qui fait du **connection pooling** :

```
1000 invocations Lambda
       ↓
RDS Proxy (pool de 100 connexions)
       ↓
RDS (100 connexions reelles)
```

### Avantages

| Avantage | Description |
|----------|-------------|
| **Connection pooling** | Reutilise les connexions existantes |
| **Failover plus rapide** | 66% plus rapide que sans proxy |
| **Authentification IAM** | Pas besoin de stocker les credentials dans le code |
| **TLS** | Chiffrement obligatoire entre proxy et RDS |

### Configuration avec Lambda

```typescript
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

// Avec RDS Proxy, l'endpoint change mais le code reste le meme
const connectionString = process.env.DATABASE_URL;
// Ex: postgresql://user:pass@proxy-endpoint.rds.amazonaws.com:5432/mydb
```

RDS Proxy est particulierement utile pour :
- **Lambda** (connexions ephemeres)
- **Applications avec beaucoup de connexions courtes**
- **Failover transparent** (Multi-AZ)

---

## ElastiCache

### Pourquoi un cache ?

Meme avec une base de donnees performante, certaines requetes sont lentes ou executees tres frequemment. Un cache **en memoire** permet de stocker les resultats pour y acceder en **microsecondes** au lieu de millisecondes.

```
Sans cache :
  Application → RDS (5ms) → Reponse

Avec cache :
  Application → ElastiCache (0.1ms) → Cache hit → Reponse rapide
  Application → ElastiCache (0.1ms) → Cache miss → RDS (5ms) → Stocke en cache → Reponse
```

### Redis vs Memcached

| Critere | Redis | Memcached |
|---------|-------|-----------|
| **Structures de donnees** | Strings, Lists, Sets, Hashes, Sorted Sets | Strings uniquement |
| **Persistance** | Oui (snapshots, AOF) | Non |
| **Replication** | Oui (read replicas) | Non |
| **Cluster mode** | Oui (sharding) | Oui (sharding) |
| **Pub/Sub** | Oui | Non |
| **Transactions** | Oui (MULTI/EXEC) | Non |
| **Lua scripting** | Oui | Non |
| **Multi-thread** | Single-thread (6.x+ I/O multithread) | Multi-thread |

**Recommandation** : choisissez **Redis** sauf si vous avez un cas d'usage tres simple et que le multi-threading de Memcached est critique.

---

## Strategies de cache

### 1. Lazy Loading (Cache-Aside)

Le plus courant : l'application verifie d'abord le cache, puis va a la base si necessaire.

```typescript
async function getUser(userId: string): Promise<User> {
  // 1. Chercher dans le cache
  const cached = await redis.get(`user:${userId}`);
  if (cached) {
    return JSON.parse(cached);  // Cache hit
  }

  // 2. Cache miss — chercher en base
  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

  // 3. Stocker en cache pour la prochaine fois
  await redis.set(`user:${userId}`, JSON.stringify(user), 'EX', 3600);

  return user;
}
```

| Avantage | Inconvenient |
|----------|-------------|
| Seules les donnees demandees sont cachees | Cache miss = latence elevee (2 appels) |
| Le cache se remplit naturellement | Donnees potentiellement perimees (stale) |
| Resilient si le cache tombe | |

### 2. Write-Through

Chaque ecriture en base met aussi a jour le cache :

```typescript
async function updateUser(userId: string, data: Partial<User>): Promise<void> {
  // 1. Ecrire en base
  await db.query('UPDATE users SET ... WHERE id = $1', [userId]);

  // 2. Mettre a jour le cache
  const updatedUser = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  await redis.set(`user:${userId}`, JSON.stringify(updatedUser), 'EX', 3600);
}
```

| Avantage | Inconvenient |
|----------|-------------|
| Cache toujours a jour | Ecriture plus lente (2 ecritures) |
| Pas de donnees stale | Cache rempli avec des donnees jamais lues |

### 3. Write-Behind (Write-Back)

L'ecriture va d'abord dans le cache, puis est propagee en base de maniere **asynchrone** :

```
Application → Redis (ecriture) → File d'attente → Base de donnees
                                  (asynchrone)
```

| Avantage | Inconvenient |
|----------|-------------|
| Ecriture tres rapide | Risque de perte de donnees si Redis tombe |
| Batch les ecritures en base | Plus complexe a implementer |
| Reduit la charge sur la base | |

### Quelle strategie choisir ?

| Strategie | Cas d'usage |
|-----------|-------------|
| **Lazy Loading** | Lectures frequentes, donnees tolerantes au stale |
| **Write-Through** | Donnees critiques, coherence importante |
| **Write-Behind** | Ecritures massives, latence d'ecriture critique |
| **Combinaison** | Lazy Loading + Write-Through = couverture complete |

---

## Structures de donnees Redis

### Strings

Le type de base — une cle associee a une valeur :

```
SET user:123:name "Alice"
GET user:123:name  → "Alice"

INCR page:views  → 1, 2, 3...  (compteur atomique)
```

### Hashes

Un objet avec des champs — ideal pour les entites :

```
HSET user:123 name "Alice" email "alice@example.com" age "30"
HGET user:123 name   → "Alice"
HGETALL user:123     → {name: "Alice", email: "alice@example.com", age: "30"}
```

### Lists

Liste ordonnee — file d'attente (FIFO) :

```
LPUSH queue:orders "order-1"
LPUSH queue:orders "order-2"
RPOP queue:orders   → "order-1"  (le plus ancien)
```

### Sets

Ensemble de valeurs uniques :

```
SADD tags:article:1 "aws" "cloud" "devops"
SADD tags:article:2 "aws" "serverless"
SINTER tags:article:1 tags:article:2  → {"aws"}  (intersection)
```

### Sorted Sets

Ensemble avec un **score** pour le classement — ideal pour les leaderboards :

```
ZADD leaderboard 1500 "alice"
ZADD leaderboard 2300 "bob"
ZADD leaderboard 1800 "charlie"

ZREVRANGE leaderboard 0 2  → ["bob", "charlie", "alice"]  (top 3)
ZRANK leaderboard "bob"    → 0  (1er)
```

---

## Redis Cluster Mode

### Sans cluster mode (Replication)

```
┌────────────┐     ┌────────────┐
│  Primary   │ ──→ │ Replica 1  │
│ (R+W)      │ ──→ │ Replica 2  │
│ 1 shard    │     │ (lecture)   │
└────────────┘     └────────────┘
```

Toutes les donnees sont sur un seul noeud primaire. Les replicas servent pour la lecture et le failover.

**Limite** : la taille max est celle d'un seul noeud (~600 Go).

### Avec cluster mode (Sharding)

```
Shard 1:  Primary ──→ Replica    (cles A-F)
Shard 2:  Primary ──→ Replica    (cles G-N)
Shard 3:  Primary ──→ Replica    (cles O-Z)
```

Les donnees sont **reparties** (shardees) sur plusieurs noeuds :
- **Plus de stockage** : chaque shard ajoute de la capacite
- **Plus de debit** : les ecritures sont reparties
- **Scaling horizontal** : ajouter des shards en ligne

---

## Session Store avec ElastiCache

### Pourquoi stocker les sessions dans Redis ?

Dans une architecture distribuee, les sessions ne doivent pas etre stockees en memoire sur un serveur specifique :

```
Requete 1 → Serveur A (session creee)
Requete 2 → Serveur B (session introuvable !)  ← Probleme

Avec Redis :
Requete 1 → Serveur A → Redis (session creee)
Requete 2 → Serveur B → Redis (session retrouvee)  ← OK
```

### Implementation

```typescript
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL  // ex: redis://mon-cluster.cache.amazonaws.com:6379
});

// Creer une session
async function createSession(sessionId: string, userId: string): Promise<void> {
  await redis.hSet(`session:${sessionId}`, {
    userId,
    createdAt: Date.now().toString(),
    lastAccess: Date.now().toString()
  });
  await redis.expire(`session:${sessionId}`, 3600);  // Expire dans 1h
}

// Recuperer une session
async function getSession(sessionId: string): Promise<Record<string, string> | null> {
  const session = await redis.hGetAll(`session:${sessionId}`);
  if (Object.keys(session).length === 0) return null;

  // Rafraichir le TTL a chaque acces
  await redis.expire(`session:${sessionId}`, 3600);
  return session;
}
```

---

## Bonnes pratiques

### RDS
- Activez **Multi-AZ** en production pour la haute disponibilite
- Utilisez des **read replicas** pour decharger les lectures lourdes
- Configurez le **PITR** avec une retention adaptee (7-14 jours)
- Utilisez **RDS Proxy** avec Lambda pour le connection pooling
- Activez les **slow query logs** pour identifier les requetes lentes
- Preferez **Aurora** pour les charges importantes (meilleure performance et scalabilite)

### ElastiCache
- Implementez **Lazy Loading** par defaut, ajoutez Write-Through pour les donnees critiques
- Definissez un **TTL** sur toutes les cles (evite le cache infini)
- Utilisez les **structures de donnees** adaptees (Hashes pour les objets, Sorted Sets pour les classements)
- Monitorez le **cache hit ratio** (objectif : > 90%)
- Dimensionnez la memoire avec une **marge de 20%**
- Planifiez la strategie d'**eviction** (allkeys-lru est un bon defaut)

---

## Recapitulatif

| Concept | A retenir |
|---------|-----------|
| **RDS** | Base de donnees relationnelle managee (6 moteurs) |
| **Multi-AZ** | Haute disponibilite avec failover automatique |
| **Read Replicas** | Scalabilite en lecture (asynchrone, cross-region) |
| **Aurora** | Moteur AWS haute performance, stockage distribue 6 copies |
| **Aurora Serverless v2** | Capacite auto-scalante (0.5 a 128 ACU) |
| **PITR** | Restauration a n'importe quel moment dans la fenetre |
| **RDS Proxy** | Connection pooling, ideal pour Lambda |
| **ElastiCache Redis** | Cache en memoire avec structures de donnees riches |
| **Lazy Loading** | Cache-aside : lire cache, puis base si miss |
| **Write-Through** | Ecrire en cache + base simultanement |
| **Cluster Mode** | Sharding Redis pour le scaling horizontal |
