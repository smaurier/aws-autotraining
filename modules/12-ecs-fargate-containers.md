# Module 12 — ECS & Fargate — Conteneurs sur AWS

> **Objectif** : Comprendre les concepts fondamentaux d'ECS (Cluster, Service, Task Definition), déployer des conteneurs Docker avec Fargate, configurer le load balancing, l'auto scaling, le logging, et comparer ECS avec EKS.
>
> **Difficulté** : ⭐⭐⭐ (avancé)
>
> **Prérequis** : Module 01 (IAM), notions Docker de base, Module 10 (CDK recommandé)
>
> **Durée estimée** : 4h

---

## Table des matières

1. [Pourquoi des conteneurs sur AWS](#1-pourquoi-des-conteneurs-sur-aws)
2. [Docker : rappels essentiels](#2-docker--rappels-essentiels)
3. [ECS — Concepts fondamentaux](#3-ecs--concepts-fondamentaux)
4. [Launch Types : EC2 vs Fargate](#4-launch-types--ec2-vs-fargate)
5. [ECR — Elastic Container Registry](#5-ecr--elastic-container-registry)
6. [Créer et déployer un service](#6-créer-et-déployer-un-service)
7. [Load Balancing avec ALB](#7-load-balancing-avec-alb)
8. [Service Discovery](#8-service-discovery)
9. [Auto Scaling](#9-auto-scaling)
10. [Logging avec CloudWatch](#10-logging-avec-cloudwatch)
11. [ECS vs EKS](#11-ecs-vs-eks)
12. [CDK pour ECS Fargate](#12-cdk-pour-ecs-fargate)
13. [Bonnes pratiques](#13-bonnes-pratiques)
14. [Récapitulatif](#14-récapitulatif)

---

## 1. Pourquoi des conteneurs sur AWS

### 1.1 Le problème des déploiements traditionnels

Déployer des applications sur des machines virtuelles (EC2) pose des défis :

- **"Ça marche sur ma machine"** : différences entre les environnements
- **Densité faible** : une VM par application gaspille des ressources
- **Déploiements lents** : provisionner une VM prend des minutes
- **Dépendances conflictuelles** : deux apps sur la même VM peuvent avoir besoin de versions différentes de Node.js

Les conteneurs résolvent ces problèmes en **empaquetant l'application avec toutes ses dépendances** dans une image portable.

> **Analogie** : Un conteneur Docker, c'est comme un container maritime standardisé. Peu importe ce qu'il contient (meubles, voitures, nourriture), il se charge et se décharge de la même manière sur n'importe quel navire, camion ou train. Le conteneur Docker fait la même chose pour les applications.

### 1.2 Les options de conteneurs sur AWS

| Service | Description | Gestion des serveurs |
|---|---|---|
| **ECS + Fargate** | Orchestration AWS-native, serverless | Aucune (AWS gère) |
| **ECS + EC2** | Orchestration AWS-native sur vos instances | Vous gérez les EC2 |
| **EKS** | Kubernetes managé | Partielle (control plane géré) |
| **EKS + Fargate** | Kubernetes managé, serverless | Aucune |
| **App Runner** | PaaS conteneurs (le plus simple) | Aucune |

---

## 2. Docker : rappels essentiels

### 2.1 Dockerfile typique pour une app Node.js

```dockerfile
# Étape 1 : Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Étape 2 : Production
FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

### 2.2 Commandes Docker essentielles

```bash
# Construire l'image
docker build -t my-app:latest .

# Lancer localement
docker run -p 3000:3000 -e NODE_ENV=production my-app:latest

# Vérifier que le conteneur fonctionne
docker ps
docker logs <container-id>
```

### 2.3 Bonnes pratiques Docker

| Pratique | Raison |
|---|---|
| **Multi-stage build** | Image finale plus petite (pas de devDependencies) |
| **Image Alpine** | ~50 Mo au lieu de ~900 Mo (Debian) |
| **Utilisateur non-root** | Sécurité (ne pas exécuter en root) |
| **HEALTHCHECK** | ECS/Fargate l'utilise pour vérifier la santé du conteneur |
| **`.dockerignore`** | Exclure `node_modules`, `.git`, etc. du contexte de build |

---

## 3. ECS — Concepts fondamentaux

### 3.1 Architecture

```
ECS Cluster
  └── Service (maintient N tâches en cours d'exécution)
        └── Task (instance d'une Task Definition)
              └── Container(s) (un ou plusieurs conteneurs)
```

### 3.2 Les quatre composants clés

| Composant | Description | Analogie |
|---|---|---|
| **Cluster** | Regroupement logique de services | Un entrepôt qui contient des chaînes de production |
| **Task Definition** | Blueprint d'une tâche (image, CPU, mémoire, ports, env vars) | Le plan de fabrication d'un produit |
| **Task** | Instance en cours d'exécution d'une Task Definition | Un produit en cours de fabrication |
| **Service** | Maintient un nombre désiré de Tasks en cours d'exécution | Le contremaître qui s'assure que N produits sont toujours en production |

### 3.3 Task Definition — Le blueprint

Une Task Definition décrit **comment** exécuter un conteneur :

```json
{
  "family": "my-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "123456789.dkr.ecr.eu-west-1.amazonaws.com/my-api:latest",
      "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
      "environment": [
        { "name": "NODE_ENV", "value": "production" }
      ],
      "secrets": [
        { "name": "DB_PASSWORD", "valueFrom": "arn:aws:ssm:eu-west-1:123456789:parameter/prod/db-password" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/my-api",
          "awslogs-region": "eu-west-1",
          "awslogs-stream-prefix": "api"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

### 3.4 Deux rôles IAM distincts

| Rôle | Utilisé par | Permissions typiques |
|---|---|---|
| **Execution Role** | L'agent ECS (pull image, écrire logs) | ECR pull, CloudWatch Logs, SSM/Secrets Manager |
| **Task Role** | L'application dans le conteneur | DynamoDB, S3, SQS — selon les besoins métier |

> **Règle** : L'Execution Role est pour l'infrastructure (ECS a besoin de récupérer l'image). Le Task Role est pour votre code applicatif.

---

## 4. Launch Types : EC2 vs Fargate

| Critère | EC2 | Fargate |
|---|---|---|
| **Gestion des serveurs** | Vous gérez les instances EC2 | AWS gère tout |
| **Scaling** | Vous scalez les instances + les tâches | Vous scalez les tâches uniquement |
| **Coût** | Moins cher à forte charge (Reserved Instances) | Pay-per-task, plus cher par unité |
| **Accès SSH** | Oui | Non |
| **GPU** | Supporté | Non supporté |
| **Placement** | Contrôle fin (AZ, instance type) | Automatique |
| **Configuration réseau** | `bridge`, `host`, ou `awsvpc` | `awsvpc` uniquement |
| **Idéal pour** | Charges stables, besoin de GPU, coûts optimisés | Charges variables, équipes petites, pas d'ops |

> **Recommandation** : Commencez avec **Fargate**. Passez à EC2 uniquement si vous avez besoin de GPU, de charges très stables justifiant des Reserved Instances, ou d'un accès SSH pour le debugging.

---

## 5. ECR — Elastic Container Registry

### 5.1 Concept

ECR est le **registre d'images Docker privé** d'AWS. C'est comme Docker Hub, mais intégré à votre compte AWS avec le contrôle d'accès IAM.

### 5.2 Commandes essentielles

```bash
# Créer un repository
aws ecr create-repository \
  --repository-name my-api \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256

# S'authentifier auprès d'ECR
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.eu-west-1.amazonaws.com

# Tagger et pousser l'image
docker tag my-api:latest 123456789.dkr.ecr.eu-west-1.amazonaws.com/my-api:latest
docker push 123456789.dkr.ecr.eu-west-1.amazonaws.com/my-api:latest

# Lister les images
aws ecr list-images --repository-name my-api
```

### 5.3 Lifecycle Policies

Pour éviter l'accumulation d'images inutilisées (et les coûts de stockage) :

```bash
aws ecr put-lifecycle-policy \
  --repository-name my-api \
  --lifecycle-policy-text '{
    "rules": [
      {
        "rulePriority": 1,
        "description": "Garder les 10 dernières images",
        "selection": {
          "tagStatus": "any",
          "countType": "imageCountMoreThan",
          "countNumber": 10
        },
        "action": { "type": "expire" }
      }
    ]
  }'
```

---

## 6. Créer et déployer un service

### 6.1 Créer un cluster

```bash
aws ecs create-cluster --cluster-name my-app-cluster
```

### 6.2 Enregistrer une Task Definition

```bash
aws ecs register-task-definition \
  --cli-input-json file://task-definition.json
```

### 6.3 Créer un service Fargate

```bash
aws ecs create-service \
  --cluster my-app-cluster \
  --service-name my-api-service \
  --task-definition my-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["subnet-aaaaa", "subnet-bbbbb"],
      "securityGroups": ["sg-12345"],
      "assignPublicIp": "ENABLED"
    }
  }'
```

### 6.4 Mettre à jour un service (nouveau déploiement)

```bash
# Forcer un nouveau déploiement avec la dernière image
aws ecs update-service \
  --cluster my-app-cluster \
  --service my-api-service \
  --force-new-deployment
```

### 6.5 Rolling Update (stratégie de déploiement)

ECS déploie les nouvelles tâches progressivement :

```
Avant : [Task v1] [Task v1]
Étape 1 : [Task v1] [Task v1] [Task v2]  ← nouvelle tâche lancée
Étape 2 : [Task v1] [Task v2] [Task v2]  ← ancienne tâche arrêtée
Étape 3 : [Task v2] [Task v2]            ← déploiement terminé
```

Configuration :
- `minimumHealthyPercent: 100` — toujours au moins N tâches saines
- `maximumPercent: 200` — peut temporairement doubler le nombre de tâches

---

## 7. Load Balancing avec ALB

### 7.1 Architecture

```
Internet → ALB (Application Load Balancer)
              ├── Target Group → Task 1 (AZ a)
              └── Target Group → Task 2 (AZ b)
```

L'ALB distribue le trafic entre les tâches ECS et effectue des **health checks** pour retirer les tâches défaillantes.

### 7.2 Configuration via CLI

```bash
# Créer un Target Group
aws elbv2 create-target-group \
  --name my-api-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-12345 \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3

# Créer le service avec le load balancer
aws ecs create-service \
  --cluster my-app-cluster \
  --service-name my-api-service \
  --task-definition my-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --load-balancers '[{
    "targetGroupArn": "arn:aws:elasticloadbalancing:eu-west-1:123456789:targetgroup/my-api-tg/abc123",
    "containerName": "api",
    "containerPort": 3000
  }]' \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["subnet-aaaaa", "subnet-bbbbb"],
      "securityGroups": ["sg-12345"],
      "assignPublicIp": "DISABLED"
    }
  }'
```

> Quand les tâches sont derrière un ALB, `assignPublicIp` devrait être `DISABLED`. Le trafic passe par l'ALB.

---

## 8. Service Discovery

### 8.1 Concept

Le **Service Discovery** permet à vos services ECS de se trouver mutuellement par nom DNS, sans passer par un load balancer. C'est essentiel pour la communication inter-services.

```
Service A → orders.my-app.local (DNS) → Service B (tâches ECS)
```

### 8.2 AWS Cloud Map

ECS utilise **AWS Cloud Map** pour le service discovery :

```bash
# Créer un namespace privé (zone DNS interne au VPC)
aws servicediscovery create-private-dns-namespace \
  --name my-app.local \
  --vpc vpc-12345

# Créer un service dans le namespace
aws servicediscovery create-service \
  --name orders \
  --namespace-id ns-12345 \
  --dns-config '{
    "DnsRecords": [{"Type": "A", "TTL": 10}]
  }'
```

Le service est alors accessible à l'adresse `orders.my-app.local` depuis n'importe quel conteneur dans le VPC.

---

## 9. Auto Scaling

### 9.1 Types de scaling

| Type | Déclencheur | Exemple |
|---|---|---|
| **Target Tracking** | Maintenir une métrique à une valeur cible | CPU moyen à 60 % |
| **Step Scaling** | Seuils avec paliers | CPU > 70 % → +2 tâches, CPU > 90 % → +4 tâches |
| **Scheduled Scaling** | Horaire prédéfini | 10 tâches de 8h à 20h, 2 tâches la nuit |

### 9.2 Target Tracking (recommandé)

```bash
# Enregistrer le service comme cible scalable
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/my-app-cluster/my-api-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 20

# Politique de scaling basée sur le CPU
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/my-app-cluster/my-api-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 60.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

### 9.3 Métriques disponibles pour le scaling

| Métrique | Description |
|---|---|
| `ECSServiceAverageCPUUtilization` | Utilisation CPU moyenne des tâches |
| `ECSServiceAverageMemoryUtilization` | Utilisation mémoire moyenne |
| `ALBRequestCountPerTarget` | Nombre de requêtes par tâche via l'ALB |
| Métriques CloudWatch custom | N'importe quelle métrique personnalisée |

---

## 10. Logging avec CloudWatch

### 10.1 Configuration du log driver

Dans la Task Definition, chaque conteneur peut envoyer ses logs stdout/stderr vers CloudWatch Logs :

```json
{
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/my-api",
      "awslogs-region": "eu-west-1",
      "awslogs-stream-prefix": "api",
      "awslogs-create-group": "true"
    }
  }
}
```

### 10.2 Consulter les logs

```bash
# Créer le log group (si awslogs-create-group n'est pas activé)
aws logs create-log-group --log-group-name /ecs/my-api

# Consulter les logs récents
aws logs tail /ecs/my-api --follow --since 1h

# Filtrer les logs (erreurs uniquement)
aws logs filter-log-events \
  --log-group-name /ecs/my-api \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s000)
```

### 10.3 Structured logging

Pour exploiter efficacement les logs CloudWatch, utilisez le **logging structuré** (JSON) :

```typescript
// Dans votre application Node.js
console.log(JSON.stringify({
  level: 'info',
  message: 'Commande traitée',
  orderId: 'ord-001',
  duration: 145,
  timestamp: new Date().toISOString(),
}))
```

CloudWatch Logs Insights peut ensuite requêter ces logs structurés :

```
fields @timestamp, orderId, duration
| filter level = "error"
| sort @timestamp desc
| limit 50
```

---

## 11. ECS vs EKS

| Critère | ECS | EKS |
|---|---|---|
| **Orchestrateur** | Propriétaire AWS | Kubernetes (open source) |
| **Complexité** | Simple | Complexe |
| **Courbe d'apprentissage** | Faible (concepts AWS) | Élevée (écosystème K8s) |
| **Portabilité** | AWS uniquement | Multi-cloud (K8s standard) |
| **Coût control plane** | Gratuit | ~75 $/mois par cluster |
| **Écosystème** | Limité (AWS natif) | Vaste (Helm, Istio, ArgoCD, etc.) |
| **Networking** | Task-level (awsvpc) | Pod-level (CNI, Service Mesh) |
| **Scaling** | ECS Auto Scaling | HPA, VPA, Karpenter |
| **CI/CD** | CodePipeline, GitHub Actions | ArgoCD, Flux, Spinnaker |
| **Idéal pour** | Équipes AWS-native, applications simples | Multi-cloud, microservices complexes, équipes K8s |

### Arbre de décision

```
Avez-vous besoin de portabilité multi-cloud ?
  ├── Oui → EKS
  └── Non → Votre équipe connaît Kubernetes ?
              ├── Oui → EKS (pour l'écosystème)
              └── Non → Combien de services ?
                          ├── < 10 → ECS Fargate (simplicité)
                          └── > 10 avec service mesh → EKS
```

---

## 12. CDK pour ECS Fargate

Le CDK fournit un Construct L3 (`ApplicationLoadBalancedFargateService`) qui crée en une seule déclaration : le cluster, le service, la task definition, l'ALB, le target group et le security group.

```typescript
import * as cdk from 'aws-cdk-lib'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import type { Construct } from 'constructs'

export class ContainerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // VPC (ou utiliser un existant)
    const vpc = new ec2.Vpc(this, 'AppVpc', {
      maxAzs: 2,
      natGateways: 1,
    })

    // Cluster ECS
    const cluster = new ecs.Cluster(this, 'AppCluster', {
      vpc,
      containerInsights: true, // métriques détaillées
    })

    // Service Fargate avec ALB (L3 Pattern)
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'ApiService',
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 2,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset('./docker'), // build local
          containerPort: 3000,
          environment: {
            NODE_ENV: 'production',
          },
        },
        publicLoadBalancer: true,
        healthCheck: {
          command: [
            'CMD-SHELL',
            'wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1',
          ],
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
          startPeriod: cdk.Duration.seconds(60),
        },
      },
    )

    // Auto Scaling
    const scaling = service.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 20,
    })

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    })

    scaling.scaleOnRequestCount('RequestScaling', {
      requestsPerTarget: 1000,
      targetGroup: service.targetGroup,
    })

    // Health check du target group
    service.targetGroup.configureHealthCheck({
      path: '/health',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      interval: cdk.Duration.seconds(30),
    })

    // Output
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: service.loadBalancer.loadBalancerDnsName,
    })
  }
}
```

> Ce Construct L3 crée environ **15 ressources CloudFormation** en une trentaine de lignes de code. C'est la puissance des abstractions CDK.

---

## 13. Bonnes pratiques

### 13.1 Images Docker

1. **Multi-stage builds** pour des images minimales
2. **Image de base Alpine** ou distroless pour la sécurité
3. **Ne pas exécuter en root** (`USER appuser`)
4. **Scanner les vulnérabilités** (ECR image scanning activé)
5. **Tagger les images** avec le commit SHA, pas juste `latest`

### 13.2 Task Definitions

1. **Séparez Execution Role et Task Role** — principe du moindre privilège
2. **Utilisez Secrets Manager ou SSM** pour les secrets, pas les variables d'environnement en clair
3. **Définissez un HEALTHCHECK** pour permettre les rolling updates sans downtime
4. **Limitez CPU et mémoire** pour éviter qu'un conteneur consomme toutes les ressources

### 13.3 Services

1. **Minimum 2 tâches** en production (haute disponibilité)
2. **Répartissez sur plusieurs AZ** (subnets dans différentes AZ)
3. **Configurez l'auto scaling** basé sur CPU ou requêtes ALB
4. **Utilisez les rolling updates** avec `minimumHealthyPercent: 100`
5. **Surveillez les déploiements** avec `aws ecs describe-services`

### 13.4 Logging et monitoring

1. **Logging structuré** (JSON) pour CloudWatch Logs Insights
2. **Container Insights** pour les métriques détaillées du cluster
3. **Alarmes CloudWatch** sur CPU, mémoire, et nombre de tâches saines
4. **Rétention des logs** configurée (pas infinie — coûts de stockage)

---

## 14. Récapitulatif

| Concept | Description |
|---|---|
| **ECS** | Service d'orchestration de conteneurs natif AWS |
| **Fargate** | Launch type serverless (pas de serveurs à gérer) |
| **Cluster** | Regroupement logique de services |
| **Task Definition** | Blueprint : image, CPU, mémoire, ports, env vars |
| **Task** | Instance en cours d'exécution d'une Task Definition |
| **Service** | Maintient N tâches saines en permanence |
| **ECR** | Registre d'images Docker privé AWS |
| **ALB** | Load balancer qui distribue le trafic entre les tâches |
| **Service Discovery** | DNS interne pour la communication inter-services |
| **Auto Scaling** | Ajuste le nombre de tâches selon la charge |
| **Execution Role** | Permissions pour ECS (pull image, écrire logs) |
| **Task Role** | Permissions pour le code applicatif (DynamoDB, S3, etc.) |
| **EKS** | Alternative Kubernetes, plus complexe mais portable |
