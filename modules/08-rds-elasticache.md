---
titre: RDS & ElastiCache — base relationnelle managée et cache en mémoire
cours: 12-aws-cloud
notions: [RDS, "moteurs (PostgreSQL, MySQL, MariaDB, Oracle, SQL Server)", "Multi-AZ DB instance (1 standby, HA)", "Multi-AZ DB cluster (2 standbys lisibles)", read replicas, "replication synchrone vs asynchrone", failover, backups automatiques, snapshots manuels, PITR, parameter groups, subnet groups, Aurora, ElastiCache, "Redis/Valkey vs Memcached", cache-aside, "lazy loading", write-through, TTL, cache hit/miss]
outcomes:
  - sait choisir un moteur RDS et distinguer Multi-AZ (haute dispo) de read replicas (scale lecture)
  - sait expliquer pourquoi un standby Multi-AZ DB instance ne sert PAS le trafic de lecture
  - sait configurer backups automatiques, snapshots manuels, PITR, parameter et subnet groups
  - sait implémenter le pattern cache-aside avec ElastiCache et choisir Redis/Valkey vs Memcached
prerequis: [Module 00 — compte/régions/CLI, Module 01 — IAM, Module 02 — VPC/subnets/SG, Module 03 — EC2/EBS, Modules 04-07 — S3/CDK/Lambda/API Gateway]
next: 09-dynamodb
libs: []
tribuzen: infra cloud TribuZen — base relationnelle managée RDS PostgreSQL (familles, membres, événements) + cache Redis/Valkey devant les lectures chaudes du feed
last-reviewed: 2026-07
---

# RDS & ElastiCache — base relationnelle managée et cache en mémoire

> **Outcomes — tu sauras FAIRE :** choisir un moteur RDS, distinguer Multi-AZ (HA) de read replicas (scale lecture), configurer backups/snapshots/PITR et parameter/subnet groups, implémenter le cache-aside avec ElastiCache.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **RDS + ElastiCache uniquement** — le monde **relationnel** managé (SQL) et le **cache en mémoire** devant lui. **DynamoDB** (base **NoSQL** clé-valeur/document, partition key, GSI, single-table) est un modèle de données différent : c'est le **module 09**. Ne cherche pas ici comment modéliser en NoSQL — ici on gère du SQL et son cache.

## 1. Cas concret d'abord

TribuZen a besoin d'une vraie base relationnelle : familles, membres, événements du calendrier partagé, avec des jointures et des contraintes d'intégrité (une invitation référence une famille qui existe). Tu choisis **PostgreSQL**.

Premier réflexe tentant : lancer une instance **EC2** (module 03), y installer PostgreSQL avec `apt install postgresql`, ouvrir le port 5432. Ça marche… le lundi. Puis arrivent les vraies questions de production :

- Le disque de l'instance meurt à 3 h du matin. Ta dernière sauvegarde date de quand ? Tu l'as testée ?
- Un patch de sécurité PostgreSQL critique sort. Qui l'applique, quand, avec quelle fenêtre de maintenance ?
- L'AZ `eu-west-3a` tombe (ça arrive). Ton unique instance est dedans. TribuZen est down jusqu'à ce que *toi* répares.
- Le feed familial explose : 10 000 lectures/seconde du même « dernier message de la famille ». Ta base sue, les requêtes ralentissent, alors qu'elles renvoient **la même donnée** à chaque fois.

Les trois premiers problèmes sont exactement ce que **RDS** (Relational Database Service) prend en charge : sauvegardes automatiques, patching managé, **Multi-AZ** avec bascule automatique. Le quatrième — la lecture répétée de la même donnée chaude — c'est le travail d'**ElastiCache** : un cache en mémoire (microsecondes) devant la base, en pattern **cache-aside**.

À la fin de ce module, tu sais provisionner une base RDS PostgreSQL résiliente **et** décharger ses lectures chaudes avec un cache — et surtout tu sais *pourquoi* activer Multi-AZ ne suffit **pas** à répartir ces lectures.

---

## 2. Théorie complète, concise

### 2.1 RDS : une base relationnelle managée

RDS gère l'infrastructure d'une base relationnelle ; toi tu gères les **données** et les **requêtes**. Tu pourrais tout faire sur EC2, mais tu récupérerais toutes ces tâches :

| Tâche | EC2 (toi) | RDS (AWS) |
|-------|-----------|-----------|
| Installation du moteur | manuelle | automatique |
| Patches de sécurité | toi | AWS (fenêtre de maintenance) |
| Sauvegardes | scripts custom | automatiques + PITR |
| Haute disponibilité | archi custom | Multi-AZ en une option |
| Réplicas de lecture | réplication manuelle | read replicas managés |
| Monitoring | à configurer | CloudWatch intégré |

RDS reste une base « classique » : tu te connectes en `psql`/`mysql`, tu écris du SQL. Ce n'est **pas** serverless au sens Lambda — une instance tourne en permanence et se facture à l'heure (d'où le teardown au lab : RDS n'est **pas** gratuit longtemps).

### 2.2 Moteurs supportés

RDS propose plusieurs **moteurs**. Le choix se fait surtout selon l'existant et l'écosystème :

| Moteur | Cas d'usage typique |
|--------|---------------------|
| **PostgreSQL** | usage général, JSON, extensions (PostGIS…) — défaut moderne |
| **MySQL** | web, applications PHP, écosystème historique |
| **MariaDB** | fork open-source de MySQL |
| **Oracle** | applications enterprise legacy (licence) |
| **SQL Server** | écosystème Microsoft (licence) |

À part, **Aurora** : moteur maison AWS **compatible** PostgreSQL / MySQL (§2.8) — même dialecte SQL, architecture de stockage différente.

### 2.3 Où vit la base : subnet group et sécurité réseau

Une instance RDS vit dans **ton VPC** (module 02), pas « sur internet ». Deux objets réseau structurants :

- **DB subnet group** : la **liste de subnets** (dans au moins **2 AZ**) où RDS a le droit de placer ses instances. Multi-AZ pioche le primaire et le standby dans des AZ **différentes** de ce group — d'où l'obligation d'au moins 2 AZ. En production, ces subnets sont **privés** : la base n'a pas d'IP publique.
- **Security group** : le pare-feu (module 02). On autorise le port du moteur (5432 PostgreSQL, 3306 MySQL) **uniquement** depuis les SG des clients légitimes (Lambda, tâche ECS), jamais `0.0.0.0/0`.

### 2.4 Multi-AZ — haute disponibilité, PAS scale de lecture

C'est **le** point à ne jamais rater. « Multi-AZ » recouvre en réalité **deux** déploiements distincts (doc RDS) :

**Multi-AZ DB instance deployment (1 standby)** — le classique :

```
   AZ-a (primaire)              AZ-b (standby)
 ┌──────────────┐   réplication  ┌──────────────┐
 │  RDS primary │ ══ synchrone ══│  RDS standby │
 │  lecture +   │                │  AUCUN trafic│
 │  écriture    │                │  (failover   │
 └──────┬───────┘                │   seulement) │
        │                        └──────────────┘
   application (un seul endpoint DNS)
```

- Réplication **synchrone** vers le standby.
- **Le standby ne sert AUCUN trafic** — ni lecture, ni écriture. Citation doc : *« has one standby DB instance that provides failover support, but doesn't serve read traffic »*. Il existe **uniquement** pour la bascule.
- En cas de panne du primaire : AWS **bascule automatiquement**, promeut le standby, met à jour le **même endpoint DNS**. L'application se reconnecte à la même URL. Objectif = **disponibilité**, pas performance.

**Multi-AZ DB cluster deployment (2 standbys lisibles)** — plus récent : 1 writer + **2 reader** instances sur 3 AZ. Là, les standbys **peuvent** servir du trafic de **lecture** (doc : *« standby DB instances that provide failover support and can also serve read traffic »*). C'est le seul mode « Multi-AZ » où les secondaires sont lisibles.

> **Retiens la nuance :** un **Multi-AZ DB instance** (le cas par défaut quand on coche « Multi-AZ » sur une instance) → standby **non lisible**. Pour répartir des lectures, ce n'est **pas** Multi-AZ qu'il te faut, ce sont des **read replicas** (§2.5) ou le mode **DB cluster**.

### 2.5 Read replicas — scale de lecture (asynchrone, lisible)

Un **read replica** est une **copie en lecture seule** de la base, alimentée par réplication **asynchrone** (doc RDS). But : décharger le primaire des lectures lourdes.

```
                 réplication ASYNCHRONE
 primaire (R+W) ──────────────────────►  Read Replica 1  (lecture seule)
      │                             └──►  Read Replica 2  (autre AZ)
      │                             └──►  Read Replica 3  (autre RÉGION)
 écritures ─────► primaire
 lectures  ─────► un read replica
```

Propriétés (vérifiées doc) :

- Réplication **asynchrone** → un léger **lag** possible : un read replica peut renvoyer une donnée un peu **périmée** (stale). Acceptable pour du reporting, un fil d'actu, pas pour « lire ce que je viens d'écrire ».
- **Lisible** par l'application (connexions read-only) — contrairement au standby Multi-AZ DB instance.
- **Cross-region** possible (latence globale, disaster recovery).
- **Pas de failover automatique** : un read replica peut être **promu manuellement** en instance autonome (solution de DR), mais AWS ne bascule pas tout seul dessus.

**Multi-AZ vs read replica — le tableau à mémoriser :**

| Critère | Multi-AZ (DB instance) | Read replica |
|---------|------------------------|--------------|
| Réplication | **synchrone** | **asynchrone** |
| Objectif | **haute disponibilité** | **scale de lecture** |
| Secondaire lisible ? | **NON** (standby) | **OUI** |
| Failover automatique | **oui** | non (promotion manuelle) |
| Cross-region | non (même région) | **oui** |

Les deux se **combinent** : une base peut être Multi-AZ (HA) **et** avoir des read replicas (scale). Ce sont des axes orthogonaux, pas un choix exclusif.

### 2.6 Backups automatiques, snapshots manuels, PITR

RDS protège tes données de deux façons :

- **Backups automatiques** : snapshot quotidien complet + **transaction logs** en continu. **Rétention 0 à 35 jours** (0 = désactivé). Supprimés quand tu supprimes l'instance (sauf snapshot final).
- **Snapshots manuels** : à la demande (`create-db-snapshot`). Conservés **indéfiniment** jusqu'à suppression explicite — pratique avant une migration risquée.

Grâce aux transaction logs, les backups automatiques activent le **PITR (Point-In-Time Recovery)** : restaurer la base à **n'importe quel instant** dans la fenêtre de rétention (à la seconde près).

> **PITR crée une NOUVELLE instance** : la restauration ne modifie pas la base existante, elle en crée une nouvelle à partir de l'instant choisi. Tu bascules ensuite l'application dessus. Idem pour restaurer un snapshot : toujours une nouvelle instance.

### 2.7 Parameter groups & option groups

- **Parameter group** : les paramètres de configuration **du moteur** — l'équivalent managé de `postgresql.conf` / `my.cnf` (ex. `max_connections`, `shared_buffers`, `log_min_duration_statement`). Certains paramètres sont **dynamiques** (appliqués à chaud), d'autres **statiques** (nécessitent un redémarrage de l'instance).
- **Option group** : des fonctionnalités **optionnelles** propres à certains moteurs (ex. options Oracle/SQL Server). PostgreSQL/MySQL de base n'en ont guère besoin — à connaître, pas à sur-utiliser.

### 2.8 Aurora (survol)

**Aurora** est le moteur maison d'AWS, **compatible** MySQL et PostgreSQL (même dialecte SQL, mêmes drivers), mais avec une **architecture de stockage distribuée** : les données sont réparties en **6 copies sur 3 AZ**, auto-réparées, avec un stockage qui grossit tout seul. Points saillants :

- Endpoints **writer** et **reader** (répartition auto des lectures sur les réplicas du cluster) ; jusqu'à **15** réplicas Aurora (vs read replicas RDS classiques).
- **Aurora Serverless v2** : la capacité (en **ACU**) s'ajuste automatiquement à la charge — utile pour des charges imprévisibles / dev.
- Reste du SQL relationnel : Aurora **n'est pas** une base NoSQL. On le mentionne car c'est souvent le défaut « performance » côté AWS ; le détail relève d'un approfondissement, pas de ce module.

### 2.9 ElastiCache : cache en mémoire devant la base

Même une base performante répond en **millisecondes** et sature si on lui redemande 10 000 fois/s la même donnée. **ElastiCache** est un magasin **clé-valeur en mémoire** (micro­secondes) qu'on place **devant** la base pour absorber les lectures chaudes.

Trois moteurs : **Valkey** (fork open-source de Redis, désormais mis en avant par AWS), **Redis OSS**, et **Memcached**. Valkey/Redis se pilotent avec les mêmes commandes ; on parlera de « Redis/Valkey » indistinctement pour l'API.

**Redis/Valkey vs Memcached** (vérifié doc « choosing an engine ») :

| Critère | Redis / Valkey | Memcached |
|---------|----------------|-----------|
| Types de données | riches (strings, listes, sets, sorted sets, hashes…) | simples (strings/objets) |
| Réplication / haute dispo | **oui** | **non** |
| Failover automatique | oui (optionnel, requis en cluster mode) | **non** |
| Persistance / backup | oui | non |
| Pub/Sub | oui | non |
| Sorted sets (classements) | oui | non |
| Multi-thread | non (mono-thread) | **oui** (multi-cœurs) |
| Sharding (partitionnement) | oui (cluster mode) | oui |

**Règle de choix (doc AWS) :** Memcached si tu veux **le modèle le plus simple possible**, de gros nœuds multi-thread, juste cacher des objets. Redis/Valkey dès que tu veux **réplication/HA**, des **structures de données** (leaderboard, file, pub/sub), de la persistance. Pour TribuZen → **Redis/Valkey** (HA + structures riches).

### 2.10 Le pattern cache-aside (lazy loading)

Le pattern de cache le plus courant. L'application interroge **le cache d'abord**, la base seulement en cas de **miss** (doc ElastiCache « Lazy loading ») :

- **Cache hit** : la donnée est dans le cache (non expirée) → on la renvoie directement (microsecondes).
- **Cache miss** : absente/expirée → on interroge la **base**, on **écrit** le résultat dans le cache, on renvoie. Coût du miss = **3 aller-retours** (cache lu vide → base → écriture cache).

Avantages : seules les données **réellement demandées** sont cachées ; une panne du cache n'est **pas fatale** (l'app retombe sur la base, plus lente mais fonctionnelle). Inconvénients : **pénalité de miss** (latence) et **données périmées** (stale) tant que la base change sans invalider le cache.

**TTL — l'antidote au stale :** on associe à chaque clé un **TTL** (time-to-live, en secondes). À l'expiration, la lecture est traitée comme un miss et la donnée est rafraîchie depuis la base. Le TTL ne garantit pas la fraîcheur absolue, mais **borne** la péremption. **Toujours** mettre un TTL (sinon le cache se remplit à l'infini et sert du stale éternel).

**Write-through** (alternative/complément) : on écrit dans le cache **à chaque écriture** en base → cache jamais périmé, mais chaque écriture coûte 2 aller-retours et on cache des données jamais lues. En pratique : **cache-aside + TTL** par défaut, write-through ajouté pour les données critiques à cohérence forte.

---

## 3. Worked examples

### Exemple 1 — Choisir la bonne réplication pour deux besoins TribuZen

**Besoin A** — « Si l'AZ de la base tombe, TribuZen doit rester debout sans intervention humaine. »
**Besoin B** — « L'écran d'accueil charge la liste des événements de la famille des milliers de fois par heure ; la base rame. »

Raisonnement :

- Besoin A = **disponibilité**. Réponse : **Multi-AZ DB instance**. Un standby synchrone dans une autre AZ, bascule automatique sur le même endpoint. ⚠️ Erreur classique : croire que « comme j'ai un standby, il peut aussi absorber les lectures de B ». **Non** — le standby Multi-AZ DB instance ne sert **aucun** trafic. Il ne répond pas au besoin B.
- Besoin B = **scale de lecture**. Réponse : un ou des **read replicas** (lisibles, asynchrones), vers lesquels on route les requêtes de lecture de l'accueil. Le léger lag est acceptable (afficher un événement 200 ms plus vieux n'a aucune importance).

**Conclusion :** on active **Multi-AZ pour A** *et* on ajoute **un read replica pour B**. Les deux mécanismes coexistent — ce n'est pas l'un ou l'autre. Si l'on refusait tout lag (rare pour de l'affichage), on garderait le mode DB cluster (standbys lisibles) plutôt qu'un read replica.

### Exemple 2 — Cache-aside sur le feed TribuZen, pas à pas

Objectif : servir « les 20 derniers messages de la famille 42 » depuis le cache, avec un TTL de 60 s.

Pseudocode (indépendant du langage, calqué sur la doc ElastiCache) :

```
fonction getFeed(familyId):
    clé = "feed:" + familyId

    # 1. Lire le cache d'abord
    cached = cache.get(clé)
    si cached n'est pas null:
        retourner cached            # CACHE HIT (microsecondes)

    # 2. CACHE MISS : aller en base
    rows = db.query(
      "SELECT * FROM messages WHERE family_id = $1 ORDER BY created_at DESC LIMIT 20",
      familyId)

    # 3. Écrire dans le cache avec un TTL, puis renvoyer
    cache.set(clé, rows, TTL = 60)  # expire dans 60 s -> re-lecture base ensuite
    retourner rows
```

Déroulé :

1. **1re requête** (cache vide) → miss → requête SQL → écriture cache → réponse. Lent (3 trajets), mais une seule fois.
2. **Requêtes suivantes pendant 60 s** → hit → réponse en microsecondes, **zéro** charge sur la base. C'est là que la base respire.
3. **Après 60 s** → la clé a expiré → prochain appel = miss → refresh depuis la base. Le TTL **borne** la péremption : au pire on affiche un feed vieux de 60 s.

Complément si on veut la cohérence immédiate après un **nouveau message** : à l'écriture (`postFeedMessage`), on **invalide** la clé (`cache.del("feed:42")`) ou on la ré-écrit (write-through). Sinon le TTL suffit pour un feed familial où 60 s de délai sont invisibles.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que le standby Multi-AZ absorbe les lectures

Le plus fréquent, et vérifié dans la doc. Un **Multi-AZ DB instance** a **un standby qui ne sert aucun trafic** — ni lecture ni écriture. Il n'existe que pour le failover. Pour répartir des lectures, il faut des **read replicas** (lisibles) ou le mode **Multi-AZ DB cluster** (2 standbys lisibles, plus récent). Multi-AZ = **disponibilité**, pas performance de lecture.

### PIÈGE #2 — Confondre Multi-AZ et read replica

| | Multi-AZ (DB instance) | Read replica |
|-|------------------------|--------------|
| Répl. | synchrone | asynchrone |
| But | HA / failover | scale lecture |
| Lisible ? | non | oui |
| Failover auto | oui | non |

Ce ne sont **pas** deux noms pour la même chose : réplication différente (sync vs async), but différent (dispo vs lecture), et ils se **combinent**. « J'ai Multi-AZ donc je scale mes lectures » est faux.

### PIÈGE #3 — Réplication synchrone ⇒ zéro lag ; asynchrone ⇒ stale

Le standby Multi-AZ est **synchrone** : pas de lag, mais **non lisible** (le no-lag ne te sert donc à rien pour lire). Le read replica est **asynchrone** : lisible, mais peut renvoyer une donnée légèrement **périmée**. Donc « je lis sur un read replica ce que je viens d'écrire sur le primaire » peut **rater** à cause du lag de réplication. À prendre en compte pour tout flux « écris puis relis immédiatement ».

### PIÈGE #4 — Oublier le TTL sur le cache

Un cache-aside **sans TTL** sert des données périmées **indéfiniment** (la base change, le cache non) et se remplit sans jamais se vider. **Toujours** un TTL. Il ne garantit pas la fraîcheur parfaite mais **borne** la péremption et force un refresh régulier depuis la base.

### PIÈGE #5 — Traiter le cache comme la source de vérité

ElastiCache est un **cache**, volatile : un nœud peut disparaître. La **source de vérité** reste RDS. Le cache-aside est justement résilient : sur panne du cache, l'app retombe sur la base (plus lente, mais correcte). Ne **jamais** stocker uniquement dans le cache une donnée qu'on ne peut pas reconstruire depuis la base (write-behind pur = risque de perte).

### PIÈGE #6 — Choisir Memcached « parce que multi-thread » sans réfléchir aux besoins

Memcached est multi-thread et simple, mais **pas** de réplication, **pas** de failover, **pas** de structures riches, **pas** de persistance. Dès que tu veux de la **haute dispo**, des **sorted sets** (classement), du **pub/sub** → c'est **Redis/Valkey**. Le multi-threading de Memcached ne compense pas l'absence de HA pour un service comme TribuZen.

### PIÈGE #7 — Confondre ce module avec DynamoDB

RDS/Aurora = **relationnel** (SQL, jointures, transactions ACID « classiques »). **DynamoDB** = **NoSQL** clé-valeur/document, autre modèle de données, autre module (09). Choisir RDS vs DynamoDB est une décision d'architecture ; ici on maîtrise le **relationnel** et son cache, pas le NoSQL.

---

## 5. Ancrage TribuZen

La couche « données relationnelles » de TribuZen repose sur **RDS PostgreSQL** ; le **cache** devant les lectures chaudes est **ElastiCache (Redis/Valkey)**.

| Élément TribuZen | Choix | Pourquoi |
|------------------|-------|----------|
| Base principale (familles, membres, événements, invitations) | **RDS PostgreSQL** | relationnel, jointures, intégrité référentielle, JSON natif |
| Résilience de cette base | **Multi-AZ DB instance** | si une AZ tombe, bascule auto, TribuZen reste debout |
| Reporting / lectures lourdes (stats familiales, exports) | **read replica** | décharge le primaire, lag toléré |
| Feed familial très lu (accueil) | **cache-aside Redis/Valkey**, TTL 60 s | absorbe les lectures répétées en microsecondes |
| Sessions / compteurs / classements légers | structures Redis (hashes, sorted sets) | pas possible avec Memcached |
| Réseau | subnets **privés** (2 AZ) via DB subnet group, SG ouvert au seul SG des Lambda/ECS | base jamais exposée à internet (module 02) |
| Sauvegarde | backups automatiques (rétention 14 j) + PITR + snapshot manuel avant migration | restauration à la seconde en cas d'incident |

Cohérence avec le reste du fil-rouge cloud :

- Les **Lambda** (module 06) et la **tâche ECS** (module 12) accèdent à RDS via un **role IAM** au moindre privilège (module 01), pas des credentials en dur. Avec beaucoup de Lambda, on ajouterait **RDS Proxy** pour mutualiser les connexions.
- L'infra (instance RDS, subnet group, SG, cluster ElastiCache) est décrite en **CDK** (module 05), pas cliquée à la main en prod.
- Le **feed** dont on cache les lectures ici pourra, selon le besoin d'échelle, vivre en **DynamoDB** (module 09) — décision d'archi comparée au capstone (module 18).

---

## 6. Points clés

1. **RDS** = base **relationnelle managée** (PostgreSQL, MySQL, MariaDB, Oracle, SQL Server) : AWS gère infra/patches/backups, toi les données/requêtes. Une instance tourne en permanence et **se facture** (teardown au lab).
2. **Multi-AZ DB instance** = **haute disponibilité** : standby **synchrone**, **non lisible**, failover **automatique** sur le même endpoint DNS. Ce n'est **pas** du scale de lecture.
3. **Multi-AZ DB cluster** (2 standbys) = variante plus récente où les standbys **peuvent** servir la lecture.
4. **Read replica** = **scale de lecture** : copie **asynchrone**, **lisible**, cross-region possible, **pas** de failover auto (promotion manuelle). Se **combine** avec Multi-AZ.
5. Protection données : **backups automatiques** (rétention 0-35 j) + **PITR** (restaure à un instant précis, dans une **nouvelle** instance) + **snapshots manuels** (conservés indéfiniment).
6. **Parameter group** = config du moteur ; **DB subnet group** = subnets (≥ 2 AZ) où RDS place les instances ; SG = pare-feu réseau.
7. **Aurora** = moteur AWS **compatible** Pg/MySQL, stockage distribué 6 copies/3 AZ, Serverless v2 auto-scalant — reste du relationnel, pas du NoSQL.
8. **ElastiCache** = cache **en mémoire** (µs) ; **Redis/Valkey** (structures riches, HA, pub/sub) vs **Memcached** (simple, multi-thread, sans HA).
9. **Cache-aside** : lire cache → miss → base → écrire cache (**+ TTL obligatoire**). Cache = accélérateur volatile ; la **source de vérité** reste RDS.

---

## 7. Seeds Anki

```
Le standby d'un déploiement Multi-AZ DB instance sert-il le trafic de lecture ?|Non. Un Multi-AZ DB instance a un standby synchrone qui n'existe QUE pour le failover ; il ne sert aucun trafic (ni lecture ni écriture). Pour scaler la lecture il faut des read replicas (ou le mode Multi-AZ DB cluster à 2 standbys lisibles).
Multi-AZ vs read replica : réplication, but, lisibilité, failover ?|Multi-AZ (DB instance) = réplication synchrone, but = haute dispo, standby NON lisible, failover automatique. Read replica = réplication asynchrone, but = scale de lecture, lisible, PAS de failover auto (promotion manuelle). Ils se combinent.
Pourquoi un read replica peut-il renvoyer une donnée périmée ?|Sa réplication est asynchrone : il y a un lag possible entre le primaire et le réplica. Donc lire immédiatement sur un read replica ce qu'on vient d'écrire sur le primaire peut rater.
Qu'est-ce que le PITR dans RDS et que crée-t-il ?|Point-In-Time Recovery : grâce aux transaction logs des backups automatiques, on restaure la base à n'importe quel instant (à la seconde) dans la fenêtre de rétention (0-35 j). La restauration crée une NOUVELLE instance, elle ne modifie pas l'existante.
À quoi sert un DB subnet group et pourquoi ≥ 2 AZ ?|Il liste les subnets où RDS a le droit de placer ses instances. Il faut au moins 2 AZ car Multi-AZ place primaire et standby dans des AZ différentes. En prod on y met des subnets privés.
Redis/Valkey vs Memcached : quand choisir lequel ?|Memcached : modèle le plus simple, gros nœuds multi-thread, cacher des objets — mais pas de réplication/HA, pas de structures riches. Redis/Valkey : réplication/HA, failover, structures riches (sorted sets, hashes, pub/sub), persistance. TribuZen -> Redis/Valkey.
Décris le pattern cache-aside (lazy loading) et le rôle du TTL.|Lire le cache d'abord : hit -> renvoyer. Miss -> interroger la base, écrire le résultat dans le cache, renvoyer (3 trajets). Le TTL borne la péremption : à l'expiration la clé est traitée comme un miss et rafraîchie depuis la base. Toujours mettre un TTL.
Le cache ElastiCache est-il la source de vérité ?|Non, c'est un accélérateur volatile ; la source de vérité reste RDS. Le cache-aside est résilient : si le cache tombe, l'app retombe sur la base (plus lente mais correcte).
RDS/Aurora vs DynamoDB : quelle différence de modèle ?|RDS/Aurora = relationnel (SQL, jointures, transactions). DynamoDB = NoSQL clé-valeur/document (autre modèle, module 09). Ce module couvre le relationnel et son cache, pas le NoSQL.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-08-rds-elasticache/README.md`. Tu provisionnes une **vraie** instance RDS PostgreSQL (Free Tier / db.t-micro) dans ton VPC, tu t'y connectes en `psql`, tu observes Multi-AZ, tu crées un snapshot manuel — puis tu **détruis tout** (RDS coûte cher : teardown impératif). Corrigé complet, feedback coach, variante J+30.
