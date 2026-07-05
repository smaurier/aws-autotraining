---
titre: ECS & Fargate — conteneurs longue durée sur AWS
cours: 12-aws-cloud
notions: [conteneur vs Lambda, orchestration de conteneurs, cluster ECS, "task definition (blueprint)", "family (versionnée)", containerDefinitions, "networkMode: awsvpc", "requiresCompatibilities: [FARGATE]", executionRoleArn vs taskRoleArn, "combinaisons CPU/mémoire Fargate", task, service, desired count, "launch type Fargate vs EC2", "ALB (Application Load Balancer)", "target group (target-type ip)", listener, health check, ECR, "URI de registre privé", get-login-password, lifecycle policy, rolling update, "minimumHealthyPercent / maximumPercent", service auto scaling, "target tracking (ECSServiceAverageCPUUtilization)"]
outcomes:
  - sait décider entre une Lambda et un conteneur ECS/Fargate à partir de la nature de la charge (durée, état, connexions persistantes)
  - sait lire et écrire une task definition Fargate valide (family, CPU/mémoire compatibles, networkMode awsvpc, execution role vs task role)
  - sait câbler un service ECS derrière un ALB avec target group target-type ip et health check
  - sait pousser une image vers ECR et configurer un service auto scaling en target tracking
prerequis: [Module 00 — compte, régions, CLI, Module 01 — IAM roles, Module 02 — VPC et subnets, Module 03 — EC2, Module 04 — S3, Module 05 — CDK, Module 06 — Lambda]
next: 13-cloudfront-cdn
libs: []
tribuzen: infra cloud TribuZen — service temps réel de présence familiale (WebSocket longue durée) déployé en conteneur Fargate derrière un ALB, complément de l'API Lambda
last-reviewed: 2026-07
---

# ECS & Fargate — conteneurs longue durée sur AWS

> **Outcomes — tu sauras FAIRE :** décider Lambda vs conteneur selon la charge, écrire une task definition Fargate valide, câbler un service ECS derrière un ALB, pousser une image vers ECR et configurer l'auto scaling en target tracking.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre **ECS et Fargate seuls** — l'orchestration de conteneurs longue durée. Il se **compare** à deux briques déjà vues : **Lambda** (module 06, calcul serverless par requête, 15 min max, stateless) et **EC2** (module 03, la VM brute que tu gères). Ici on répond à : *quand un conteneur qui tourne en permanence bat une Lambda, et comment le déployer sur AWS sans gérer de serveur ?* Le CDN devant l'ALB est le **module 13** ; l'observabilité (logs, X-Ray) le **module 14** ; Kubernetes/EKS est **hors périmètre** de ce parcours.

## 1. Cas concret d'abord

Tu montes l'infra AWS de TribuZen. L'API métier (poster un message, générer une miniature) tourne déjà en **Lambda + API Gateway** — parfait pour des requêtes courtes et sans état (module 06). Nouveau besoin : une **présence temps réel**. Quand une famille est connectée, chaque membre doit voir en direct qui est en ligne et recevoir les messages instantanément. Techniquement : un serveur **WebSocket** qui maintient des **connexions ouvertes en permanence** et pousse des events.

Un collègue propose : « on met ça en Lambda comme le reste ». Tu vois trois murs immédiats :

1. Une Lambda a un **timeout de 900 s (15 min) maximum** (module 06, §2.8). Une connexion WebSocket de présence reste ouverte **des heures**. Le modèle « une invocation = une requête qui finit » ne colle pas à une connexion longue durée.
2. Lambda est **stateless** : l'environnement est gelé/recyclé entre invocations. Maintenir en mémoire la liste des sockets connectés d'une famille, y pousser un message, ça suppose un **process qui vit** — pas une fonction qui s'éteint.
3. Le serveur WebSocket, c'est du code Node.js déjà écrit (`ws`, Socket.IO) qu'on veut **empaqueter tel quel** dans une image Docker et faire tourner, pas réécrire en handler événementiel.

L'autre extrême serait de louer une **EC2** (module 03), y installer Node, `git pull`, lancer le process avec pm2… et se retrouver à patcher l'OS, gérer le redémarrage, le scaling à la main. Trop d'ops.

Le bon outil au milieu : **ECS sur Fargate**. Tu construis une **image Docker** de ton serveur WebSocket, tu la pousses dans **ECR** (le Docker Hub privé d'AWS), tu décris une **task definition** (image + CPU + mémoire + rôle), et un **service** ECS maintient en permanence N copies (**tasks**) derrière un **ALB**. **Fargate** exécute ces conteneurs **sans que tu gères la moindre machine** : pas d'OS à patcher, pas de SSH. À la fin de ce module, tu sais faire exactement ça, et surtout **choisir** entre Lambda, Fargate et EC2 sur des critères, pas au feeling.

---

## 2. Théorie complète, concise

### 2.1 Conteneur vs Lambda vs EC2 — le bon niveau d'abstraction

Trois façons d'exécuter du code sur AWS, du plus « géré » au plus « brut » :

| Brique | Tu fournis | AWS gère | Modèle |
|--------|------------|----------|--------|
| **Lambda** (mod. 06) | un handler | tout (OS, runtime, scaling) | 1 invocation = 1 requête, ≤ 15 min, stateless |
| **ECS + Fargate** | une **image Docker** | l'OS et l'hôte (serverless) | un **process qui tourne en continu** |
| **ECS + EC2** / EC2 brut (mod. 03) | image (ou tout) + **les instances** | rien de l'hôte | tu gères les VM |

Règle de décision : **charge courte, événementielle, sans état → Lambda**. **Process longue durée, connexions persistantes, image existante, framework qui veut un serveur (NestJS, WebSocket, worker) → conteneur**. **Besoin de GPU, d'accès SSH, de charges très stables optimisées en Reserved Instances → EC2**.

### 2.2 ECS — le vocabulaire (vérifié doc « What is Amazon ECS »)

**Amazon ECS** (Elastic Container Service) est le service d'**orchestration de conteneurs** natif d'AWS : il place, démarre, surveille et remplace tes conteneurs. Quatre objets, du contenant au contenu :

| Objet | Définition (doc AWS) | Analogie |
|-------|----------------------|----------|
| **Cluster** | l'infrastructure sur laquelle tourne l'application (regroupement logique) | l'atelier |
| **Task definition** | le **blueprint** de l'application (image, CPU, mémoire, ports, rôles) | le plan de fabrication |
| **Task** | une **instance en cours** d'une task definition (1+ conteneurs) | un exemplaire produit |
| **Service** | une **application longue durée** qui maintient N tasks saines | le contremaître qui garantit N exemplaires |

Une **task** peut être ponctuelle (un batch qui fait un travail puis s'arrête). Un **service** est fait pour le **long-running** : il relance une task qui meurt, tient le **desired count**, s'intègre à l'ALB et à l'auto scaling. Pour la présence TribuZen, c'est un **service**.

### 2.3 La task definition — le blueprint

C'est un document JSON versionné. Chaque enregistrement crée une nouvelle **révision** d'une **family** (`my-api:1`, `my-api:2`…). Champs structurants pour Fargate :

```json
{
  "family": "tribuzen-presence",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/tribuzenPresenceTaskRole",
  "containerDefinitions": [
    {
      "name": "presence",
      "image": "123456789012.dkr.ecr.eu-west-1.amazonaws.com/tribuzen-presence:latest",
      "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
      "environment": [{ "name": "NODE_ENV", "value": "production" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/tribuzen-presence",
          "awslogs-region": "eu-west-1",
          "awslogs-stream-prefix": "presence"
        }
      }
    }
  ]
}
```

- **`family`** : le nom logique ; chaque `register-task-definition` incrémente la révision.
- **`networkMode: awsvpc`** : chaque task reçoit sa **propre interface réseau (ENI)** et sa propre IP dans le VPC. C'est **obligatoire pour Fargate**.
- **`requiresCompatibilities`** : `["FARGATE"]` et/ou `["EC2"]` — le(s) launch type(s) visé(s).
- **`cpu` / `memory`** : au **niveau task** ; en Fargate ils doivent former une **combinaison valide** (voir 2.4).
- **`containerDefinitions`** : un ou plusieurs conteneurs (image ECR, ports, env, logs).

### 2.4 Combinaisons CPU / mémoire Fargate (valeurs exactes — vérifiées doc)

En Fargate, on ne choisit pas n'importe quel couple : le `cpu` détermine une **plage de mémoire** autorisée (doc « Invalid CPU or memory »). Mémoire exprimée en MiB.

| CPU (task) | Valeurs mémoire autorisées |
|------------|-----------------------------|
| **256** (.25 vCPU) | 512 MiB, 1 Go, 2 Go |
| **512** (.5 vCPU) | 1 à 4 Go (pas de 512 Mo) — 1, 2, 3, 4 Go |
| **1024** (1 vCPU) | 2 à 8 Go (par 1 Go) |
| **2048** (2 vCPU) | 4 à 16 Go (par 1 Go) |
| **4096** (4 vCPU) | 8 à 30 Go (par 1 Go) |
| **8192** (8 vCPU) | 16 à 60 Go (par 4 Go) |
| **16384** (16 vCPU) | 32 à 120 Go (par 8 Go) |

Un couple hors table → l'API renvoie `ClientException: Invalid 'cpu' setting`. Pour la présence TribuZen (peu gourmande, surtout des sockets I/O), **512 CPU / 1024 MiB** suffit.

### 2.5 Deux rôles IAM distincts (piège classique)

| Rôle | Endossé par | Sert à |
|------|-------------|--------|
| **Execution role** (`executionRoleArn`) | l'**agent ECS / Fargate** | **pull** l'image depuis ECR, écrire les logs CloudWatch, lire les secrets |
| **Task role** (`taskRoleArn`) | **ton code** dans le conteneur | appeler DynamoDB, S3, SQS… selon le besoin métier |

L'execution role est de l'**infrastructure** (récupérer l'image, sinon la task ne démarre pas). Le task role suit le **moindre privilège** (module 01) pour l'appli. Les confondre est l'erreur n°1 des débutants ECS.

### 2.6 Launch type : Fargate vs EC2

Deux façons de fournir la **capacité** (où tournent les conteneurs) pour la même task definition :

| Critère | **Fargate** | **EC2 launch type** |
|---------|-------------|----------------------|
| Serveurs | AWS gère tout (serverless) | tu gères les instances EC2 du cluster |
| Scaling | tu scales les **tasks** | tu scales **tasks + instances** |
| Accès SSH / GPU | non | oui |
| networkMode | `awsvpc` imposé | `awsvpc`, `bridge`, `host` |
| Coût | pay-per-task, plus cher/unité | moins cher à forte charge stable (Reserved) |
| Idéal | petites équipes, zéro ops, charge variable | GPU, très gros volume stable |

**Recommandation** : démarre en **Fargate**. Passe à EC2 seulement si un besoin précis (GPU, coût à l'échelle) le justifie. TribuZen = Fargate.

### 2.7 ECR — le registre d'images privé (vérifié doc)

**Amazon ECR** (Elastic Container Registry) est le **registre Docker privé** d'AWS, avec contrôle d'accès **IAM** et **scan de vulnérabilités**. C'est de là que Fargate **pull** l'image au démarrage d'une task.

Cycle de vie d'une image (commandes exactes doc) :

```bash
# 1. Créer un dépôt
aws ecr create-repository --repository-name tribuzen-presence --region eu-west-1

# 2. Authentifier Docker auprès du registre (token via get-login-password)
aws ecr get-login-password --region eu-west-1 \
  | docker login --username AWS --password-stdin 123456789012.dkr.ecr.eu-west-1.amazonaws.com

# 3. Taguer l'image locale avec l'URI du registre
docker tag tribuzen-presence:latest \
  123456789012.dkr.ecr.eu-west-1.amazonaws.com/tribuzen-presence:latest

# 4. Pousser
docker push 123456789012.dkr.ecr.eu-west-1.amazonaws.com/tribuzen-presence:latest
```

- **URI de registre** : `AWS_ACCOUNT_ID.dkr.ecr.RÉGION.amazonaws.com`, suivi de `/dépôt:tag`.
- **`get-login-password`** : demande `ecr:GetAuthorizationToken` ; le username Docker est littéralement `AWS`.
- **Lifecycle policy** : règles de nettoyage automatique (ex. « ne garder que les 10 dernières images ») pour ne pas payer du stockage mort.
- **Scan on push** : active `scanOnPush` pour détecter les CVE à chaque poussée.

### 2.8 Exposer le service : ALB, target group, listener (vérifié doc ELB)

Un **Application Load Balancer** (ALB, couche 7 HTTP/HTTPS) distribue le trafic entrant entre les tasks et fait des **health checks** pour retirer une task défaillante.

```
Internet → ALB (listener :443)
              └── règle → Target Group (target-type: ip, port 3000)
                              ├── task A (IP privée, AZ a)
                              └── task B (IP privée, AZ b)
```

- **Listener** : écoute un port/protocole (ex. HTTPS 443) et route selon des règles.
- **Target group** : le groupe de cibles. En Fargate `awsvpc`, chaque task a **sa propre IP** → le target group doit être **`target-type: ip`** (pas `instance`).
- **Health check** : chemin (`/health`), intervalle, seuils sain/malsain. Une task qui échoue est sortie de la rotation ; le service en relance une.
- On lie le service à l'ALB via `--load-balancers` (targetGroupArn + containerName + containerPort). Derrière un ALB, les tasks sont en **subnets privés** → `assignPublicIp: DISABLED`.

### 2.9 Créer et déployer un service

```bash
aws ecs create-cluster --cluster-name tribuzen-cluster

aws ecs register-task-definition --cli-input-json file://task-definition.json

aws ecs create-service \
  --cluster tribuzen-cluster \
  --service-name tribuzen-presence \
  --task-definition tribuzen-presence:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --load-balancers targetGroupArn=arn:...:targetgroup/tz-presence-tg/abc,containerName=presence,containerPort=3000 \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-a,subnet-b],securityGroups=[sg-123],assignPublicIp=DISABLED}'
```

- **`desired-count`** : nombre de tasks que le service maintient (≥ 2 en prod, réparties sur plusieurs AZ = haute dispo).
- **Rolling update** : à chaque nouvelle révision (`update-service --task-definition ...:2` ou `--force-new-deployment`), ECS remplace les tasks **progressivement**, encadré par `minimumHealthyPercent` (défaut 100 % — jamais moins de N saines) et `maximumPercent` (défaut 200 % — peut doubler temporairement). Zéro downtime.

### 2.10 Service auto scaling (target tracking — vérifié doc)

ECS **augmente ou diminue le desired count** automatiquement via Application Auto Scaling. Le plus simple : **target tracking** — vise une métrique cible, ECS ajuste seul.

```bash
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/tribuzen-cluster/tribuzen-presence \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 --max-capacity 10

aws application-autoscaling put-scaling-policy \
  --service-namespace ecs --policy-name cpu60 \
  --resource-id service/tribuzen-cluster/tribuzen-presence \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
    '{"TargetValue":60.0,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"ScaleInCooldown":300,"ScaleOutCooldown":60}'
```

Métriques prédéfinies : **`ECSServiceAverageCPUUtilization`**, `ECSServiceAverageMemoryUtilization`, `ALBRequestCountPerTarget`. Cooldowns : monter vite (60 s), redescendre prudemment (300 s) pour ne pas osciller.

### 2.11 Où va le calcul serverless — comparaison finale

| Question | Réponse |
|----------|---------|
| Requête courte, sans état, ≤ 15 min ? | **Lambda** (mod. 06) |
| Process qui vit, connexions ouvertes, image existante ? | **ECS / Fargate** |
| GPU, SSH, charge stable optimisée ? | **EC2** (mod. 03) |
| Zéro serveur à gérer ? | **Lambda** ou **Fargate** (les deux serverless) |

---

## 3. Worked examples

### Exemple 1 — Décider Lambda vs Fargate pour deux besoins TribuZen

Deux charges à placer. On décide **par critères**, pas au feeling.

**A. `generateThumbnail`** (miniature d'avatar, module 06) : déclenchée par un upload S3, tourne ~300 ms, sans état, s'arrête. → Événementiel, court, stateless : **Lambda**. La mettre en Fargate obligerait à tenir un process 24/7 pour un travail qui dure une fraction de seconde → gaspillage.

**B. `presence`** (qui est en ligne) : maintient des **WebSockets ouverts des heures**, garde en mémoire les sockets d'une famille, pousse des events. → Longue durée, avec état en mémoire, dépasse largement 15 min : **Fargate**. La mettre en Lambda casserait sur le timeout et le modèle stateless.

Raisonnement traçable :

| Critère | `generateThumbnail` | `presence` |
|---------|---------------------|------------|
| Durée d'exécution | ~300 ms | heures |
| État en mémoire entre requêtes | non | oui (sockets) |
| Déclenchement | événement S3 | connexion cliente permanente |
| **Verdict** | **Lambda** | **Fargate** |

Les deux **coexistent** dans l'infra TribuZen : Lambda pour l'événementiel court, Fargate pour le temps réel long.

### Exemple 2 — Task definition Fargate valide + service derrière ALB

Objectif : déployer `presence` en 512 CPU / 1024 MiB, 2 tasks, derrière un ALB.

1. **Choisir CPU/mémoire** dans la table 2.4 : 512 CPU autorise 1, 2, 3, 4 Go → **512 / 1024 MiB** valide. (Écrire 512 / 768 échouerait : hors table.)
2. **Écrire la task definition** (celle du §2.3), avec `networkMode: awsvpc` et `requiresCompatibilities: ["FARGATE"]`. Deux rôles : `ecsTaskExecutionRole` (pull ECR + logs) et `tribuzenPresenceTaskRole` (accès DynamoDB pour lire l'état des familles).
3. **Pousser l'image** vers ECR (les 4 commandes du §2.7).
4. **Créer le target group** en `target-type ip` (obligatoire en awsvpc) :

```bash
aws elbv2 create-target-group \
  --name tz-presence-tg --protocol HTTP --port 3000 \
  --vpc-id vpc-123 --target-type ip \
  --health-check-path /health --healthy-threshold-count 2 --unhealthy-threshold-count 3
```

5. **Créer le service** lié au target group (commande §2.9), `desired-count 2`, subnets dans **deux AZ**, `assignPublicIp DISABLED` (tasks privées, l'ALB est le seul point d'entrée public).
6. **Vérifier** : `aws ecs describe-services --cluster tribuzen-cluster --services tribuzen-presence` → `runningCount: 2`, puis `curl https://<ALB-DNS>/health` → `200`.

Chaque choix découle d'une contrainte : CPU/mémoire de la table, `target-type ip` du mode réseau, 2 AZ pour la haute dispo. Rien au hasard.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Mettre un process longue durée en Lambda « pour rester serverless »

Fargate est **aussi serverless** (aucun serveur à gérer). « Serverless » ne veut pas dire « Lambda ». Une connexion WebSocket de plusieurs heures cognera le **timeout de 900 s** de Lambda et se heurtera à son modèle stateless. Le bon serverless pour du long-running, c'est **Fargate**, pas un contorsionnement en Lambda.

### PIÈGE #2 — Confondre execution role et task role

L'**execution role** sert à **ECS/Fargate** (pull l'image ECR, écrire les logs) ; sans lui, la task ne **démarre pas**. Le **task role** sert à **ton code** (DynamoDB, S3…). Mettre les permissions applicatives dans l'execution role, ou l'inverse, casse soit le démarrage soit l'appli. Ce sont **deux rôles distincts**, deux responsabilités.

### PIÈGE #3 — Choisir un couple CPU/mémoire hors table Fargate

`cpu: 512` **n'autorise pas** 512 MiB de mémoire (la première ligne valide à 512 CPU est 1 Go). Un couple hors table renvoie `ClientException: Invalid 'cpu' setting`. On **vérifie la table** (2.4) avant d'inventer un couple « logique ». Fargate n'accepte que des combinaisons prédéfinies.

### PIÈGE #4 — Target group en `target-type instance` avec Fargate

En Fargate, `networkMode awsvpc` donne à **chaque task sa propre IP**. Le target group doit donc être **`target-type: ip`**. Le défaut `instance` (adapté à EC2) ne trouvera aucune cible et le health check échouera en boucle. Toujours `ip` avec awsvpc/Fargate.

### PIÈGE #5 — Une seule task, un seul AZ

`desired-count: 1` = **zéro haute dispo** : la task meurt (déploiement, panne AZ) → service indisponible le temps du redémarrage. En prod, **au moins 2 tasks** réparties sur **≥ 2 subnets dans 2 AZ**, derrière l'ALB. C'est la base de la résilience, pas une option.

### PIÈGE #6 — Croire qu'ECS ≈ Kubernetes/EKS obligatoire

ECS est l'orchestrateur **propriétaire AWS**, **simple**, sans control plane à payer. On n'a **pas besoin de Kubernetes (EKS)** pour faire tourner des conteneurs sur AWS. EKS n'a de sens que pour la **portabilité multi-cloud** ou un écosystème K8s existant — hors périmètre TribuZen. Ne pas surdimensionner.

### PIÈGE #7 — Oublier que Fargate + ALB sont facturés en continu

Contrairement à une Lambda (zéro coût à l'arrêt), un **service Fargate** facture **tant que des tasks tournent**, et un **ALB** facture **à l'heure** dès qu'il existe. Laisser un lab tourner un week-end coûte réellement de l'argent. **Teardown systématique** après manip (voir lab).

---

## 5. Ancrage TribuZen

Dans l'infra TribuZen, ECS/Fargate est la brique **« process qui vit »**, en complément de Lambda (« événement court »).

| Charge TribuZen | Où | Pourquoi |
|-----------------|-----|----------|
| `presence` (WebSocket temps réel) | **Fargate service** derrière ALB | connexions longues, état en mémoire, > 15 min |
| API métier (poster message, feed) | **Lambda + API Gateway** (mod. 06/07) | requêtes courtes, sans état |
| `generateThumbnail` (miniature avatar) | **Lambda** (mod. 06) | événement S3, ~300 ms |
| worker de modération (batch nocturne long) | **Fargate task** ponctuelle | traitement lourd > 15 min |

Principes appliqués :

- **Image dans ECR** avec `scanOnPush` + lifecycle policy (garder 10 images) ; Fargate pull via l'**execution role**.
- **Task role de moindre privilège** (module 01) : `presence` n'a que `dynamodb:Query` sur la table des familles, rien d'autre.
- **CPU/mémoire dimensionnés** par la table Fargate : 512 / 1024 MiB pour un service I/O-bound.
- **ALB `target-type ip`**, health check `/health`, 2 tasks sur 2 AZ, `assignPublicIp DISABLED` (tasks privées, module 02).
- **Auto scaling target tracking** sur `ECSServiceAverageCPUUtilization` à 60 %, min 2 / max 10.
- **Provisionné par le CDK** (module 05) : le construct L3 `ApplicationLoadBalancedFargateService` crée cluster + service + task def + ALB + target group + security group en une déclaration. L'ALB sera plus tard **derrière CloudFront** (module 13), les logs partiront en CloudWatch (module 14).

> L'API Lambda et le service Fargate **cohabitent** : ce n'est pas « l'un ou l'autre » mais « le bon outil par charge ».

---

## 6. Points clés

1. **Conteneur vs Lambda** : Lambda = requête courte, sans état, ≤ 15 min ; **ECS/Fargate** = process **longue durée**, connexions persistantes, image Docker existante ; EC2 = VM brute (GPU, SSH, coût stable).
2. **Vocabulaire ECS** : **cluster** (infra) → **service** (maintient N tasks longue durée) → **task** (instance en cours) → **task definition** (le blueprint versionné en `family`).
3. **Task definition Fargate** : `networkMode: awsvpc` **imposé**, `requiresCompatibilities: ["FARGATE"]`, **execution role** (pull ECR + logs) ≠ **task role** (accès applicatif).
4. **CPU/mémoire Fargate** = combinaisons **prédéfinies** (256 → 512 MiB–2 Go ; 512 → 1–4 Go ; 1024 → 2–8 Go…). Hors table = `Invalid 'cpu' setting`.
5. **Launch type** : **Fargate** (serverless, zéro serveur, à privilégier) vs **EC2** (tu gères les instances, pour GPU/SSH/coût stable).
6. **ECR** : registre Docker privé ; URI `ACCOUNT.dkr.ecr.RÉGION.amazonaws.com/dépôt:tag` ; auth via `get-login-password` (username `AWS`) ; lifecycle policy + scan on push.
7. **ALB** : listener → **target group `target-type ip`** (obligatoire en awsvpc) → tasks ; health check retire les tasks malsaines ; tasks en subnets privés (`assignPublicIp DISABLED`).
8. **Service** : `desired-count` ≥ 2 sur ≥ 2 AZ ; **rolling update** encadré par `minimumHealthyPercent`/`maximumPercent` ; **auto scaling target tracking** sur `ECSServiceAverageCPUUtilization`. **Fargate + ALB sont payants en continu → teardown.**

---

## 7. Seeds Anki

```
Quand préférer un conteneur ECS/Fargate à une Lambda ?|Quand la charge est un process longue durée, garde de l'état en mémoire, maintient des connexions persistantes (WebSocket), dépasse le timeout Lambda de 15 min, ou empaquette une image/framework existant. Lambda reste meilleur pour les requêtes courtes, événementielles et sans état.
Différence entre task, service et task definition dans ECS ?|Task definition = le blueprint versionné (family) : image, CPU, mémoire, ports, rôles. Task = une instance en cours d'exécution de ce blueprint. Service = une application longue durée qui maintient N tasks saines (desired count), gère l'ALB et l'auto scaling.
Quel networkMode est obligatoire pour Fargate, et quelle conséquence sur l'ALB ?|networkMode awsvpc : chaque task reçoit sa propre interface réseau et sa propre IP. Conséquence : le target group de l'ALB doit être target-type ip (pas instance).
Execution role vs task role sur une task ECS ?|Execution role : endossé par l'agent ECS/Fargate pour pull l'image ECR et écrire les logs (infrastructure ; sans lui la task ne démarre pas). Task role : endossé par ton code applicatif pour appeler DynamoDB, S3, etc. (moindre privilège).
Que se passe-t-il si on met cpu=512 et memory=512 en Fargate ?|Erreur ClientException: Invalid 'cpu' setting. À 512 CPU (.5 vCPU) la mémoire valide commence à 1 Go (1, 2, 3 ou 4 Go). Les couples CPU/mémoire Fargate sont prédéfinis par une table.
Fargate vs EC2 launch type ?|Fargate : serverless, AWS gère l'hôte, tu scales seulement les tasks, awsvpc imposé, pas de SSH/GPU, pay-per-task. EC2 : tu gères les instances du cluster, tu scales tasks + instances, SSH/GPU possibles, moins cher à forte charge stable. Démarrer en Fargate.
Comment pousser une image vers ECR ?|1) aws ecr create-repository ; 2) aws ecr get-login-password | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.RÉGION.amazonaws.com ; 3) docker tag image ACCOUNT.dkr.ecr.RÉGION.amazonaws.com/dépôt:tag ; 4) docker push ...:tag.
Comment configurer l'auto scaling d'un service ECS en target tracking ?|register-scalable-target (dimension ecs:service:DesiredCount, min/max), puis put-scaling-policy de type TargetTrackingScaling avec la métrique prédéfinie ECSServiceAverageCPUUtilization et une valeur cible (ex. 60 %), avec cooldowns scale-in/scale-out.
Pourquoi un service Fargate doit-il être détruit après un lab, contrairement à une Lambda ?|Une Lambda ne coûte rien à l'arrêt. Un service Fargate facture tant que des tasks tournent, et l'ALB facture à l'heure dès qu'il existe : les laisser tourner coûte réellement de l'argent. D'où le teardown systématique.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-12-ecs-containers/README.md`. Tu construis une **vraie** image Docker d'un mini-service HTTP, tu la pousses dans **ECR**, tu la déploies en **service Fargate derrière un ALB** (via CDK ou CLI), tu **`curl` l'ALB** pour voir la réponse, puis tu **détruis tout** (Fargate + ALB = payants). Corrigé complet, feedback coach, variante J+30.
