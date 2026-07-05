# Lab 12 — ECS & Fargate : conteneur derrière un ALB

> **Outcome :** à la fin, tu sais empaqueter un service HTTP dans une image Docker, la pousser dans **ECR**, la déployer en **service Fargate derrière un ALB**, `curl` l'ALB pour obtenir une réponse HTTP 200, puis **tout détruire**.
> **Vrai outil :** Docker + AWS CLI + **AWS CDK** (`cdk deploy`) sur ton compte AWS réel — pas de harnais simulé, tu déploies pour de vrai.
> **Feedback :** le coach valide en session (l'ALB renvoie-t-il 200 ? la task est-elle `RUNNING` ? le teardown est-il complet ?). Pas de test-runner auto-correcteur.

> ⚠️ **Coût réel.** Un service Fargate facture tant que ses tasks tournent, et un **ALB facture à l'heure** dès sa création. Ce lab **n'est pas Free Tier**. Compte quelques dizaines de centimes si tu détruis dans l'heure. **Le teardown (dernière section) est OBLIGATOIRE** — ne ferme pas ce lab sans l'avoir fait.

---

## Prérequis

- Compte AWS + `aws configure` OK (module 00), région par ex. `eu-west-1`.
- **Docker** installé et démarré localement.
- **Node.js** + CDK : `npm install -g aws-cdk`, et `cdk bootstrap` déjà fait sur le compte/région (module 05).
- Modules 06 (Lambda, pour la comparaison) et 02/03 (VPC/EC2) digérés.

---

## Énoncé

Tu déploies un mini-service de **présence** TribuZen (version simplifiée : un serveur HTTP qui répond `200` sur `/health` et renvoie un message sur `/`). Objectif : le faire tourner en **conteneur Fargate**, joignable **publiquement via un ALB**, exactement comme le vrai service temps réel plus tard.

Cahier des charges **exact** :

1. Une **image Docker** d'un serveur HTTP Node.js écoutant sur le port `3000`, avec une route `GET /health` → `200 OK` et `GET /` → un texte.
2. L'image **poussée dans un dépôt ECR** de ton compte.
3. Un **service Fargate** (`desired-count 1` suffit pour le lab) **derrière un ALB**, target group **`target-type ip`**, health check sur `/health`.
4. **`curl http://<DNS-de-l-ALB>/`** renvoie ton message ; `curl .../health` renvoie `200`.
5. **Teardown complet** à la fin.

**Deux chemins possibles** — choisis-en un :
- **Chemin A (recommandé)** : **CDK** avec le construct L3 `ApplicationLoadBalancedFargateService` (build + push d'image automatiques via `ContainerImage.fromAsset`). Le plus rapide, le plus proche du vrai TribuZen.
- **Chemin B** : **CLI pas à pas** (ECR push manuel + task definition JSON + `create-service` + target group). Plus laborieux, mais tu vois chaque brique.

**Pas de gap-fill** — tu écris l'app, le Dockerfile et la stack à partir des starters minimaux.

### Starter — l'application (commune aux deux chemins)

`app/server.js` :

```js
// server.js — mini-service HTTP (stand-in du service presence)
import { createServer } from 'node:http'

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('ok')
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('TribuZen presence — running on Fargate')
})

server.listen(3000, () => console.log('listening on 3000'))
```

`app/Dockerfile` :

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
EXPOSE 3000
CMD ["node", "server.js"]
```

`app/package.json` : `{ "name": "presence", "type": "module", "private": true }`

Teste localement AVANT AWS :

```bash
docker build -t presence ./app
docker run -p 3000:3000 presence
# autre terminal :
curl http://localhost:3000/health   # -> ok
```

### Starter — Chemin A (CDK)

`lib/presence-stack.ts` (squelette à compléter) :

```ts
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import type { Construct } from 'constructs'

export class PresenceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)
    // À toi : VPC (2 AZ) -> Cluster -> ApplicationLoadBalancedFargateService
    // taskImageOptions.image = ecs.ContainerImage.fromAsset('./app')  (build+push auto)
    // containerPort 3000, cpu 512, memoryLimitMiB 1024, desiredCount 1
    // Ajoute un healthCheck target group sur /health
    // CfnOutput du DNS de l'ALB
  }
}
```

---

## Étapes (en friction)

1. **Écris et teste l'app en local** (starter ci-dessus). `curl localhost:3000/health` doit répondre `ok` **avant** de toucher à AWS.
2. **Choisis ton chemin** (A = CDK recommandé, B = CLI).
3. **Chemin A** : complète la stack (VPC 2 AZ → Cluster → `ApplicationLoadBalancedFargateService` avec `fromAsset('./app')`, `cpu 512`, `memoryLimitMiB 1024`, `containerPort 3000`, `desiredCount 1`), configure le health check `/health`, sors le DNS en `CfnOutput`, puis `cdk deploy`.
   **Chemin B** : `create-repository` → build/tag/push (les 4 commandes ECR) → écris `task-definition.json` (Fargate, awsvpc, 512/1024, execution role) → `register-task-definition` → crée target group `target-type ip` + ALB + listener → `create-service` lié au target group.
4. **Attends le déploiement** : `aws ecs describe-services --cluster <c> --services <s>` jusqu'à `runningCount: 1` et target group `healthy`.
5. **Frappe l'ALB** : `curl http://<ALB-DNS>/` → ton message ; `curl -i http://<ALB-DNS>/health` → `HTTP/1.1 200`.
6. **Observe** : dans la console ECS, regarde la task `RUNNING`, ses logs CloudWatch (`/ecs/...`), et le target group « healthy ».
7. **TEARDOWN** (obligatoire, voir plus bas). Vérifie qu'il ne reste **ni service, ni ALB, ni task**.

---

## Corrigé complet commenté (Chemin A — CDK)

```ts
// lib/presence-stack.ts — corrigé
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import type { Construct } from 'constructs'

export class PresenceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // VPC sur 2 AZ = haute dispo. natGateways:1 pour limiter le coût du lab
    // (les tasks privées ont besoin d'un NAT pour pull l'image ECR).
    const vpc = new ec2.Vpc(this, 'PresenceVpc', { maxAzs: 2, natGateways: 1 })

    // Cluster = l'infra logique du service
    const cluster = new ecs.Cluster(this, 'PresenceCluster', { vpc })

    // Construct L3 : crée en une déclaration cluster wiring + task def + service
    // Fargate + ALB public + target group (target-type ip) + security groups.
    const svc = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Presence', {
      cluster,
      cpu: 512,               // couple valide avec 1024 MiB (table Fargate)
      memoryLimitMiB: 1024,
      desiredCount: 1,        // 1 suffit pour le lab ; en prod >= 2 sur 2 AZ
      publicLoadBalancer: true,
      taskImageOptions: {
        // fromAsset : le CDK BUILD l'image ./app et la PUSH dans un ECR géré,
        // puis référence son URI dans la task definition. Zéro push manuel.
        image: ecs.ContainerImage.fromAsset('./app'),
        containerPort: 3000,  // doit matcher server.listen(3000) et le Dockerfile
        environment: { NODE_ENV: 'production' },
      },
    })

    // Health check du target group : l'ALB sonde /health ; une task qui
    // échoue est sortie de la rotation et relancée par le service.
    svc.targetGroup.configureHealthCheck({
      path: '/health',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      interval: cdk.Duration.seconds(30),
    })

    // Auto scaling target tracking (bonus) : CPU moyen visé 60 %, min 1 / max 4.
    const scaling = svc.service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 })
    scaling.scaleOnCpuUtilization('Cpu60', {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    })

    // Le DNS public de l'ALB — c'est ce qu'on curl.
    new cdk.CfnOutput(this, 'AlbDns', { value: svc.loadBalancer.loadBalancerDnsName })
  }
}
```

Déploiement et vérification :

```bash
cdk deploy
# ... CDK build l'image, la push, crée ~15 ressources CloudFormation ...
# Output attendu : PresenceStack.AlbDns = Presence-XXXX.eu-west-1.elb.amazonaws.com

curl http://Presence-XXXX.eu-west-1.elb.amazonaws.com/
# -> TribuZen presence — running on Fargate
curl -i http://Presence-XXXX.eu-west-1.elb.amazonaws.com/health
# -> HTTP/1.1 200 OK ... ok
```

**Pourquoi ce corrigé est correct :**
- `ApplicationLoadBalancedFargateService` est le **construct L3** : il câble cluster, task definition Fargate, ALB public, listener, **target group `target-type ip`** (imposé par Fargate/awsvpc) et security groups — ce qu'on ferait à la main en 6 commandes CLI au chemin B.
- `cpu: 512` + `memoryLimitMiB: 1024` est une **combinaison valide** de la table Fargate. `512`/`512` planterait (`Invalid 'cpu' setting`).
- `containerPort: 3000` est cohérent avec `server.listen(3000)`, le `EXPOSE 3000` du Dockerfile et le port du target group. Une incohérence ici = health check qui échoue en boucle.
- `fromAsset('./app')` fait le **build + push ECR** automatiquement : pas de `docker login`/`tag`/`push` manuel.
- Le health check `/health` permet à l'ALB de ne router que vers des tasks saines et au service de relancer une task morte (rolling update sans downtime).

### Note Chemin B (CLI)

Si tu as pris le CLI : la seule subtilité qui piège est le **`--target-type ip`** du target group (pas `instance` : en awsvpc chaque task a sa propre IP) et la **cohérence execution role** (`AmazonECSTaskExecutionRolePolicy` pour pull ECR + logs). Le reste = les commandes du module §2.7–2.9.

---

## Teardown (OBLIGATOIRE — Fargate + ALB sont payants)

**Chemin A (CDK)** — une commande détruit tout :

```bash
cdk destroy
# confirme 'y'. Supprime service, ALB, target group, cluster, VPC, NAT, etc.
```

**Chemin B (CLI)** — dans l'ordre :

```bash
# 1. Ramener le service à 0 puis le supprimer
aws ecs update-service --cluster <c> --service <s> --desired-count 0
aws ecs delete-service --cluster <c> --service <s> --force
# 2. Supprimer le listener, l'ALB, le target group
aws elbv2 delete-load-balancer --load-balancer-arn <alb-arn>
aws elbv2 delete-target-group --target-group-arn <tg-arn>
# 3. Supprimer le cluster
aws ecs delete-cluster --cluster <c>
# 4. Vider et supprimer le dépôt ECR
aws ecr delete-repository --repository-name presence --force
```

**Vérifie qu'il ne reste rien de payant :**

```bash
aws ecs list-services --cluster <c>        # -> []  (ou cluster supprimé)
aws elbv2 describe-load-balancers          # -> plus ton ALB
```

> Règle : **tant que `describe-load-balancers` montre ton ALB, tu paies.** Ne quitte pas le lab avant liste vide.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 12 :**

1. Refais le déploiement **en Chemin B (CLI pas à pas)** si tu avais pris le CDK (ou l'inverse) — pour maîtriser l'autre face.
2. Passe **`desired-count` à 2** sur **2 AZ** et vérifie que `curl` répond toujours pendant que tu forces un nouveau déploiement (`--force-new-deployment`) : **rolling update sans coupure**.
3. Ajoute une **route `/whoami`** qui renvoie l'`hostname` du conteneur, et observe qu'avec 2 tasks, des `curl` répétés alternent entre deux hostnames (l'ALB répartit).
4. **Chronomètre-toi : 40 minutes**, teardown compris.

**Critère de réussite :** l'ALB répond 200 pendant le rolling update, `/whoami` montre bien 2 hostnames distincts, et le teardown laisse `describe-load-balancers` vide.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce service devient le vrai temps réel :

```
tribuzen-infra/
  app/presence/            # serveur WebSocket (ws / Socket.IO), pas juste HTTP
    Dockerfile
    src/server.ts
  lib/presence-stack.ts    # ApplicationLoadBalancedFargateService
```

**Différences par rapport au lab :**
- L'app est un vrai **serveur WebSocket** (connexions longues), pas un HTTP `/health`. Le listener ALB gère l'upgrade WebSocket ; le health check reste une route HTTP `/health`.
- Le **task role** aura `dynamodb:Query` de moindre privilège (état des familles), pas de rôle vide.
- `desiredCount: 2` minimum sur 2 AZ + auto scaling sur CPU **et** `ALBRequestCountPerTarget`.
- L'ALB sera **derrière CloudFront** (module 13) ; les logs partiront en CloudWatch (module 14) ; les secrets viendront de Secrets Manager (module 15).

**Commit cible :**
```
feat(infra): service presence en Fargate derrière ALB (CDK L3, target-type ip, health /health)
```
