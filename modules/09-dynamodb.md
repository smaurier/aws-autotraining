---
titre: DynamoDB — modélisation NoSQL clé-valeur pour le feed TribuZen
cours: 12-aws-cloud
notions: [tables items attributs, "partition key (hash attribute)", "sort key (range attribute)", "clé primaire simple vs composite PK+SK", "limite item 400 KB", "GSI (global secondary index)", "LSI (local secondary index)", "projection ALL/KEYS_ONLY/INCLUDE", on-demand vs provisioned, "RCU et WCU", auto scaling, "Query vs Scan", filter expression, single-table design survol, DynamoDB Streams]
outcomes:
  - sait concevoir une table DynamoDB (partition key, sort key) à partir des patterns d'accès
  - sait distinguer GSI et LSI et choisir le bon selon la contrainte (création, PK, consistance)
  - sait choisir entre mode on-demand et provisioned et dimensionner en RCU/WCU
  - sait pourquoi Query bat Scan et écrire une Query par clé primaire au CLI
  - sait à quoi servent DynamoDB Streams pour déclencher un traitement en aval
prerequis: [Modules 00-08 du cours 12-aws-cloud — compte/IAM/rôles, Lambda, et notions de base de données de RDS (module 08)]
next: 10-messaging-evenements
libs: []
tribuzen: infra cloud TribuZen — table du feed/timeline des familles en DynamoDB (partition = famille, sort = horodatage du message)
last-reviewed: 2026-07
---

# DynamoDB — modélisation NoSQL clé-valeur pour le feed TribuZen

> **Outcomes — tu sauras FAIRE :** concevoir une table (partition/sort key) depuis les patterns d'accès, distinguer GSI et LSI, choisir on-demand vs provisioned, écrire une Query au CLI, comprendre à quoi servent les Streams.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **DynamoDB seul** — modèle de données, clés, index, capacité, Query/Scan, single-table (survol), Streams. Le SDK TypeScript, les triggers Lambda concrets et les patterns event-driven complets relèvent des modules **06 (Lambda)** et **16 (architectures serverless)**. La messagerie découplée (SQS/SNS/EventBridge) est le sujet du **module 10**. RDS et le relationnel ont été vus au **module 08** — ici on répond à : *comment stocker et lire un feed à très grande échelle avec une latence constante ?*

## 1. Cas concret d'abord

Tu construis le **feed TribuZen** : le mur de messages d'une famille. Chaque famille poste des messages (texte, photo, événement), affichés du plus récent au plus ancien. À terme, des dizaines de milliers de familles, chacune consultant son feed en continu.

Ton réflexe RDS (module 08) serait une table SQL :

```sql
SELECT * FROM messages
WHERE family_id = 'family-42'
ORDER BY created_at DESC
LIMIT 20;
```

Ça marche… jusqu'à ce que le trafic explose. Sous forte charge, cette requête `ORDER BY` + `LIMIT` sur une table qui grossit sans fin devient un point de contention : il faut une instance plus grosse (scaling **vertical**), un index bien tenu, et la latence part en vrille aux heures de pointe.

DynamoDB pose la question autrement : **« quelles requêtes vais-je faire, exactement ? »** Ici, une seule domine — *les N derniers messages d'UNE famille, triés par date*. Si on modélise la table pour que cette requête soit une simple lecture d'une **partition** triée, on obtient une latence de quelques millisecondes **quelle que soit l'échelle**, sans gérer un seul serveur.

Le piège inverse existe : DynamoDB n'a **pas de jointures** et n'aime pas les requêtes qu'on n'a pas prévues. Choisir sa clé, c'est figer ses patterns d'accès. Ce module te donne les outils pour concevoir la table du feed correctement du premier coup — et savoir quand DynamoDB n'est *pas* le bon choix.

---

## 2. Théorie complète, concise

### 2.1 Le modèle : tables, items, attributs

DynamoDB est une base **NoSQL clé-valeur / document**, entièrement managée. Trois niveaux :

```
Table  →  Item (≈ une ligne)  →  Attribut (≈ une colonne, mais libre)
```

- Une **table** contient zéro ou plusieurs **items**. Pas de limite au nombre d'items ni à la taille totale de la table.
- Un **item** est un groupe d'**attributs** identifié de façon unique par sa **clé primaire**.
- Hors clé primaire, la table est **schemaless** : chaque item peut avoir ses propres attributs. Un message peut avoir `photoUrl`, un autre non — c'est valide.
- Attributs scalaires (String, Number, Binary, Boolean, Null) ou composés (List, Map, Set). Attributs imbriqués **jusqu'à 32 niveaux** de profondeur.

**Limite dure à retenir : un item pèse au maximum 400 KB** (noms d'attributs + valeurs compris, en unités binaires : 1 KB = 1024 octets). Une photo ne se stocke donc pas *dans* l'item — on met l'image dans **S3** et seulement son URL dans l'item DynamoDB.

### 2.2 Clé primaire : simple ou composite

À la création, tu **dois** définir la clé primaire. Deux formes (doc *Core components*) :

| Type | Composition | Unicité |
|------|-------------|---------|
| **Clé simple** | juste une **partition key** | deux items ne peuvent pas avoir la même partition key |
| **Clé composite** | **partition key + sort key** | la *combinaison* (PK, SK) doit être unique ; plusieurs items peuvent partager la même partition key s'ils diffèrent par la sort key |

- La **partition key** (aussi appelée *hash attribute*) est passée à une fonction de hachage interne : son résultat détermine la **partition physique** où l'item est stocké. Elle sert à **répartir** les données.
- La **sort key** (aussi appelée *range attribute*) : tous les items d'une même partition sont stockés **physiquement ensemble, triés par sort key**. Elle sert à **trier et à requêter des plages**.
- Les attributs de clé doivent être **scalaires** et uniquement de type **string, number ou binary**. Aucune restriction sur les autres attributs.

C'est exactement ce qu'il faut pour le feed : `partition key = familyId`, `sort key = createdAt`. Tous les messages d'une famille vivent dans la même partition, déjà triés par date.

### 2.3 Index secondaires : GSI vs LSI

Un **index secondaire** permet de requêter selon une **clé alternative**, en plus de la clé primaire. Deux types — et la différence est un classique d'entretien (tout vérifié doc *Core components* + *Service quotas*) :

| Caractéristique | **GSI** (Global Secondary Index) | **LSI** (Local Secondary Index) |
|---|---|---|
| Partition key | **différente** de la table | **la même** que la table |
| Sort key | différente de la table | différente de la table |
| Moment de création | **à tout moment** (après la table aussi) | **uniquement à la création de la table** |
| Capacité / débit | **propre** au GSI, indépendant de la table | **partagé** avec la table de base |
| Consistance de lecture | **eventually consistent uniquement** | eventually **ou** strongly consistent |
| Quota par table | **20** (par défaut) | **5** |

Deux points à ne jamais rater :
1. Un **LSI ne peut être ajouté qu'à la création** de la table — impossible après coup. Si tu penses en avoir besoin, décide-le dès le départ.
2. Un **GSI a sa propre capacité** (RCU/WCU) : une écriture répercutée sur un GSI provisionné insuffisant peut throttler la table. Un LSI, lui, **consomme la capacité de la table de base**.

Quand tu crées un index, tu choisis les attributs **projetés** de la table vers l'index — `ProjectionType` : `KEYS_ONLY` (clés seules), `INCLUDE` (clés + attributs listés), ou `ALL` (tout l'item). Au minimum, les clés sont toujours projetées.

### 2.4 Modes de capacité : on-demand vs provisioned

Le **throughput mode** détermine comment la capacité est gérée **et** comment tu es facturé (doc *Read/write capacity mode*) :

**On-demand (pay-per-request)** — mode **par défaut et recommandé** pour la plupart des charges.
- Pas de capacity planning : tu ne déclares aucun débit. DynamoDB scale seul de zéro à des millions de req/s.
- Tu paies **à la requête** (read/write request units consommées). **Zéro coût quand la table est inactive** — d'où l'intérêt pour un projet en dev ou une charge imprévisible.

**Provisioned** — tu déclares un débit fixe en **RCU** et **WCU**.
- Tu es facturé sur la capacité **provisionnée à l'heure**, pas sur ce que tu consommes réellement. Cohérent pour une charge **stable et prévisible**, et pour la prévisibilité budgétaire.
- Peut être couplé à l'**Auto Scaling** : DynamoDB ajuste RCU/WCU entre un min et un max selon une cible d'utilisation (via Application Auto Scaling). Ça absorbe les variations sans passer en on-demand.

Définitions exactes des unités (doc quotas) — **à mémoriser** :

- **1 RCU** = **1 lecture fortement consistante par seconde** pour un item **jusqu'à 4 KB**, **ou 2 lectures eventually consistent** par seconde. La taille est arrondie au multiple de 4 KB supérieur.
- **1 WCU** = **1 écriture par seconde** pour un item **jusqu'à 1 KB**. Arrondi au multiple de 1 KB supérieur.

On peut basculer entre les deux modes. Côté provisioned, les **augmentations** de débit sont libres, mais les **diminutions** sont plafonnées (par défaut 4/jour + 1 de plus par heure, ~27/jour) — un détail qui piège les optimisations de coût agressives.

| Charge | Mode conseillé |
|--------|----------------|
| Imprévisible, en pics, nouveau projet | **On-demand** |
| Stable et prévisible, fort trafic constant | **Provisioned** (+ Auto Scaling) |

### 2.5 Query vs Scan — le choix qui fait ou casse la performance

**Query** lit des items **par valeur de clé primaire** (doc *Query*) :
- tu fournis **obligatoirement** la partition key (valeur unique) ; Query renvoie tous les items de cette partition.
- optionnellement, une condition sur la **sort key** (`=`, `<`, `begins_with`, `between`…) pour raffiner.
- c'est l'opération **efficace** : DynamoDB va directement à la bonne partition, lit une plage triée. Idéal pour le feed (« les messages de `family-42` triés par date »).

**Scan** lit **tous les items de la table (ou de l'index)** (doc *Scan*) :
- un Scan renvoie au max **1 MB de données** par requête, puis pagine (`LastEvaluatedKey` → `ExclusiveStartKey`).
- une **filter expression** est appliquée **après** la lecture, **avant** le retour : le Scan **consomme la capacité de tous les items lus**, filtrés ou non. `ScannedCount` (items lus) peut être énorme pour un `Count` (items retournés) minuscule = signal d'un Scan inefficace.
- eventually consistent par défaut ; `ConsistentRead=true` double le coût en RCU.

> **Règle d'or :** conçois la table pour utiliser **Query** (ou GetItem), jamais Scan en production. Si tu as *besoin* d'un Scan pour un pattern d'accès courant, c'est le signe que ta clé (ou un GSI manquant) est mal choisie. Filter expression ≠ index : elle ne réduit pas la capacité consommée, seulement les octets renvoyés.

### 2.6 Single-table design (survol)

En SQL, on fait une table par entité (Users, Messages, Events). DynamoDB pousse souvent l'inverse pour les apps complexes : **toutes les entités dans une seule table** avec des clés génériques (`PK`, `SK`) et des préfixes.

```
PK                SK                       type / data
FAMILY#42         PROFILE                  { name: "Les Martin" }
FAMILY#42         MSG#2026-07-03T10:00     { text, author }
FAMILY#42         MSG#2026-07-03T11:30     { text, photoUrl }
FAMILY#42         MEMBER#alice             { role: "admin" }
```

Une seule Query `PK = FAMILY#42, SK begins_with MSG#` récupère le feed ; `SK = PROFILE` récupère le profil. Avantage : moins de tables, requêtes très efficaces, moins de GSI. Coût : modèle difficile à lire au début, patterns d'accès à figer **à l'avance**, debugging console plus ardu. **Survol volontaire ici** — la conception avancée single-table est un sujet à part entière (module 16). Pour TribuZen, on démarre avec une table du feed dédiée, claire, avant d'envisager la fusion.

### 2.7 DynamoDB Streams — capter les changements

**DynamoDB Streams** est une option qui capture un **flux ordonné, quasi temps réel, des modifications** d'une table (doc *Core components*). Chaque modification produit un **stream record** :

- **INSERT** : image complète du nouvel item.
- **MODIFY** : image « avant » et « après » des attributs modifiés.
- **REMOVE** : image complète de l'item supprimé.

`StreamViewType` choisit ce que contient l'enregistrement : `KEYS_ONLY`, `NEW_IMAGE`, `OLD_IMAGE`, `NEW_AND_OLD_IMAGES`. Les stream records ont une **durée de vie de 24 h**, puis disparaissent.

L'usage typique : brancher une **Lambda** sur le stream pour réagir à chaque changement — envoyer une notification push quand un message est posté, mettre à jour un index de recherche, agréger un compteur. C'est le socle du CDC (change data capture) et de l'event-driven côté data (approfondi au module 16). Ici, retiens le concept : *une écriture DynamoDB peut déclencher automatiquement un traitement en aval, sans coupler le producteur au consommateur.*

---

## 3. Worked examples

### Exemple 1 — Concevoir et remplir la table du feed TribuZen (CLI)

Objectif : la table `TribuZenFeed`, clé composite `familyId` (partition) + `createdAt` (sort), en **on-demand** (pas de capacity planning, zéro coût idle en dev).

**Étape 1 — créer la table.** `HASH` = partition key, `RANGE` = sort key ; seuls les attributs de clé sont déclarés (le reste est schemaless) :

```bash
aws dynamodb create-table \
  --table-name TribuZenFeed \
  --attribute-definitions \
    AttributeName=familyId,AttributeType=S \
    AttributeName=createdAt,AttributeType=S \
  --key-schema \
    AttributeName=familyId,KeyType=HASH \
    AttributeName=createdAt,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

**Étape 2 — écrire deux messages** (un item ≤ 400 KB ; la photo est une URL S3, pas l'image) :

```bash
aws dynamodb put-item --table-name TribuZenFeed --item '{
  "familyId":  {"S": "family-42"},
  "createdAt": {"S": "2026-07-03T10:00:00Z"},
  "author":    {"S": "alice"},
  "text":      {"S": "On part au lac ce week-end !"}
}'

aws dynamodb put-item --table-name TribuZenFeed --item '{
  "familyId":  {"S": "family-42"},
  "createdAt": {"S": "2026-07-03T11:30:00Z"},
  "author":    {"S": "bob"},
  "text":      {"S": "Je ramène le kayak"},
  "photoUrl":  {"S": "s3://tribuzen-media/family-42/kayak.jpg"}
}'
```

Note : le second item a `photoUrl`, pas le premier — schemaless assumé.

**Étape 3 — lire le feed avec Query** (les messages de `family-42`, plus récents d'abord) :

```bash
aws dynamodb query \
  --table-name TribuZenFeed \
  --key-condition-expression "familyId = :fid" \
  --expression-attribute-values '{":fid": {"S": "family-42"}}' \
  --no-scan-index-forward \
  --limit 20
```

- `key-condition-expression` porte **sur la clé** : partition key obligatoire. On pourrait ajouter `AND createdAt > :since` pour ne prendre que les messages récents.
- `--no-scan-index-forward` (équivalent `ScanIndexForward=false`) trie par sort key **décroissante** → plus récent d'abord.
- Query touche **une seule partition**, lit une plage triée : latence constante même avec des millions de messages. C'est la requête du cas concret, résolue proprement.

### Exemple 2 — Query vs Scan sur le même besoin

Besoin : « tous les messages de `family-42` de juillet 2026 ».

**Bonne approche — Query par clé** (partition + plage sur la sort key) :

```bash
aws dynamodb query \
  --table-name TribuZenFeed \
  --key-condition-expression "familyId = :fid AND begins_with(createdAt, :mois)" \
  --expression-attribute-values '{":fid": {"S": "family-42"}, ":mois": {"S": "2026-07"}}'
```

DynamoDB va directement à la partition `family-42` et lit seulement la tranche `2026-07…`. Capacité consommée ∝ aux items **renvoyés**.

**Mauvaise approche — Scan + filter** (à ne pas faire) :

```bash
aws dynamodb scan \
  --table-name TribuZenFeed \
  --filter-expression "familyId = :fid AND begins_with(createdAt, :mois)" \
  --expression-attribute-values '{":fid": {"S": "family-42"}, ":mois": {"S": "2026-07"}}'
```

Le Scan lit **toute la table** (tous les messages de toutes les familles), pagine par 1 MB, puis jette tout ce qui ne matche pas. La capacité consommée est proportionnelle au **nombre total d'items lus**, pas aux 20 messages voulus. Sur une table à des millions d'items, c'est lent et cher pour un résultat identique. Même besoin, deux mondes : le premier scale, le second s'écroule.

Et si on avait besoin de « tous les messages écrits par `alice`, toutes familles confondues » ? Ce n'est pas la clé primaire → on créerait un **GSI** `author-createdAt` (partition = `author`) et on **Query**-erait ce GSI. Jamais un Scan.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Vouloir ajouter un LSI après la création de la table

Faux départ classique. Un **LSI ne peut être créé qu'au moment du `create-table`** — jamais après. Si tu réalises plus tard qu'il te faut un tri alternatif sur la **même** partition key, tu ne peux pas ajouter de LSI : il faut recréer la table (migration) ou utiliser un **GSI** (créable à tout moment, mais avec une partition key potentiellement différente et sa propre capacité). Décide de tes LSI dès la conception.

### PIÈGE #2 — Croire qu'une filter expression remplace un index

Une `filter-expression` (Query ou Scan) est appliquée **après** la lecture. Elle **ne réduit pas** la capacité consommée ni le nombre d'items lus — seulement les octets renvoyés. Filtrer sur un attribut non-clé lit quand même tous les items de la plage/table. Pour réduire *vraiment* le coût, il faut une **clé** ou un **GSI** adapté, pas un filtre.

### PIÈGE #3 — Confondre GSI et LSI sur la consistance et la capacité

- **GSI** : eventually consistent **uniquement**, capacité **propre** (RCU/WCU indépendants — un GSI sous-provisionné peut throttler les écritures de la table).
- **LSI** : peut faire du strongly consistent, capacité **partagée** avec la table de base.

Attendre une lecture fortement consistante d'un GSI, ou oublier de provisionner un GSI, sont deux bugs de prod fréquents.

### PIÈGE #4 — Stocker un gros blob dans l'item

Un item plafonne à **400 KB**. Y coller une image, un PDF ou un gros JSON casse l'écriture ou explose le coût en WCU (1 WCU = 1 KB → un item de 300 KB coûte 300 WCU par écriture). Pattern correct : **binaire dans S3**, seulement l'`URL`/la clé S3 dans DynamoDB. C'est exactement ce que fait le feed avec `photoUrl`.

### PIÈGE #5 — Choisir une partition key à faible cardinalité (hot partition)

Si la partition key prend peu de valeurs distinctes (ex. `status = "actif"` pour 90 % des items), tout le trafic tape la **même partition** : c'est une *hot partition*, throttlée malgré une capacité globale suffisante. La partition key doit **distribuer** la charge (ici `familyId`, à forte cardinalité). Modéliser DynamoDB = penser d'abord à la répartition.

### PIÈGE #6 — Traiter DynamoDB comme du SQL

Pas de jointures, pas de `GROUP BY`, pas de requête ad hoc improvisée. On **conçoit la table à partir de la liste exhaustive des patterns d'accès**, on dénormalise, et toute requête non prévue devient un Scan (lent) ou impose un nouveau GSI. Si tes besoins sont des jointures complexes et du reporting flexible → c'est **RDS** (module 08), pas DynamoDB. Le bon outil pour le bon pattern.

---

## 5. Ancrage TribuZen

DynamoDB porte les **données à fort volume et pattern d'accès simple** de TribuZen — au premier rang, le **feed/timeline** des familles. Les données relationnelles riches (comptes, liens familiaux, facturation) restent sur **RDS** (module 08) : chaque outil sur son terrain.

| Donnée TribuZen | Store | Clé / accès |
|-----------------|-------|-------------|
| **Feed des familles** (messages du mur) | DynamoDB `TribuZenFeed` | PK `familyId`, SK `createdAt` — Query « N derniers messages d'une famille » |
| Notifications par utilisateur | DynamoDB | PK `userId`, SK `createdAt` + **TTL** pour purge auto |
| Recherche « messages d'un auteur » | GSI sur le feed | PK `author`, SK `createdAt` |
| Comptes, familles, abonnements | RDS (module 08) | relationnel, jointures |
| Photos / pièces jointes | S3 (module 04) | seule l'URL S3 vit dans l'item DynamoDB |

Décisions de conception appliquées :

- **Mode on-demand au démarrage** : trafic imprévisible en beta, **zéro coût quand personne ne poste** — décisif pour un side-project. Bascule vers provisioned + Auto Scaling seulement quand la charge devient stable et prévisible.
- **Partition = `familyId`** : forte cardinalité → pas de hot partition, chaque famille isolée sur ses partitions.
- **Sort = `createdAt` ISO 8601** : tri chronologique natif, Query décroissante pour l'affichage « plus récent d'abord », `begins_with` pour filtrer un mois.
- **DynamoDB Streams** sur le feed → Lambda qui envoie la **notification push** aux membres à chaque nouveau message (le producteur du message ignore tout du système de notif — découplage ; approfondi module 16).
- La table sera **créée par le CDK** (module 05), pas à la main en prod ; le CLI de ce module sert à comprendre et prototyper.

> Le SDK TypeScript (`@aws-sdk/lib-dynamodb`, `DynamoDBDocumentClient`) pour appeler la table depuis une Lambda est vu au **module 06** ; les patterns event-driven complets (Streams → Lambda → SNS) au **module 16**.

---

## 6. Points clés

1. DynamoDB = NoSQL clé-valeur managé, latence ~ms constante à toute échelle, **pas de jointure** ; item ≤ **400 KB** (blobs → S3).
2. **Clé primaire** simple (partition key) ou composite (**partition + sort key**) ; attributs de clé = scalaires string/number/binary uniquement ; partition = répartition (hash), sort = tri/plage (range).
3. On **conçoit la table à partir des patterns d'accès** — la clé fige les requêtes possibles.
4. **GSI** : PK/SK libres, créable à tout moment, capacité propre, eventually consistent seulement, 20/table. **LSI** : même PK, SK différente, **création à la création de la table uniquement**, capacité partagée, strongly consistent possible, 5/table.
5. **On-demand** (défaut, pay-per-request, zéro coût idle) vs **provisioned** (RCU/WCU fixes, + Auto Scaling) ; **1 RCU** = 1 lecture forte de 4 KB/s (ou 2 eventually), **1 WCU** = 1 écriture de 1 KB/s.
6. **Query** (par clé primaire) est efficace ; **Scan** lit toute la table (1 MB/page) et **filtre après** lecture → coûteux. Filter expression ≠ index.
7. **Single-table design** : toutes les entités dans une table à clés génériques — puissant mais patterns à figer d'avance (survol ici).
8. **DynamoDB Streams** capture INSERT/MODIFY/REMOVE (records 24 h) → déclenche une Lambda en aval, sans coupler producteur et consommateur.

---

## 7. Seeds Anki

```
DynamoDB : à quoi servent respectivement la partition key et la sort key ?|La partition key (hash) est hachée pour choisir la partition physique — elle répartit les données. La sort key (range) trie les items d'une même partition et permet les requêtes de plage (begins_with, between). PK+SK = clé composite unique.
Quelle est la taille maximale d'un item DynamoDB, et qu'implique-t-elle pour une photo ?|400 KB (noms + valeurs d'attributs compris). On ne stocke pas l'image dans l'item : elle va dans S3, et seule son URL/clé S3 est un attribut de l'item DynamoDB.
GSI vs LSI : trois différences clés ?|GSI : partition key différente, créable à tout moment, capacité propre, eventually consistent seulement, 20/table. LSI : même partition key que la table, créable UNIQUEMENT à la création de la table, capacité partagée, strongly consistent possible, 5/table.
Pourquoi ne peut-on pas ajouter un LSI après coup ?|Un LSI doit être défini au moment du create-table : il partage la partition key et s'appuie sur la structure de stockage de la table. Après création, seul un GSI (créable à tout moment) reste possible.
On-demand vs provisioned : quand choisir chacun, et quel avantage coût en dev ?|On-demand (pay-per-request, défaut) pour charge imprévisible / nouveau projet : zéro coût quand la table est inactive. Provisioned (RCU/WCU fixes + Auto Scaling) pour charge stable et prévisible : facturé à la capacité provisionnée à l'heure.
Définitions exactes d'un RCU et d'un WCU ?|1 RCU = 1 lecture fortement consistante par seconde pour un item jusqu'à 4 KB (ou 2 lectures eventually consistent). 1 WCU = 1 écriture par seconde pour un item jusqu'à 1 KB. Arrondi au multiple supérieur.
Pourquoi Query bat Scan, et une filter expression suffit-elle à rendre un Scan efficace ?|Query lit par clé primaire une seule partition triée (capacité ∝ items renvoyés). Scan lit toute la table (1 MB/page). Non : la filter expression s'applique APRÈS lecture, consomme la capacité de tous les items lus — elle ne remplace pas un index.
À quoi servent DynamoDB Streams ?|Capturer le flux ordonné des modifications (INSERT/MODIFY/REMOVE, records valables 24 h) pour déclencher une Lambda en aval (notif push, indexation…) sans coupler le producteur de l'écriture au consommateur.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-09-dynamodb/README.md`. Tu crées la vraie table `TribuZenFeed` (on-demand) au AWS CLI, tu écris des messages avec `put-item`, tu lis le feed avec `query`, tu observes le coût d'un `scan`, puis tu **détruis la table** (teardown). Corrigé complet, feedback coach, variante J+30.
