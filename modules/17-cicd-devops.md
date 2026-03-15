# Module 17 — CI/CD & DevOps sur AWS

> **Objectif** : Maîtriser les outils et stratégies de déploiement continu sur AWS, de CodePipeline aux GitHub Actions, en passant par les déploiements Blue/Green et les CDK Pipelines.
> **Difficulté** : ⭐⭐⭐
> **Prérequis** : Module 16
> **Durée estimée** : 5h

---

## Table des matières

1. [Introduction au CI/CD sur AWS](#1-introduction-au-cicd-sur-aws)
2. [Les services AWS Developer Tools](#2-les-services-aws-developer-tools)
3. [CodeBuild en détail](#3-codebuild-en-détail)
4. [CodeDeploy et stratégies de déploiement](#4-codedeploy-et-stratégies-de-déploiement)
5. [CodePipeline — orchestration complète](#5-codepipeline--orchestration-complète)
6. [GitHub Actions avec AWS](#6-github-actions-avec-aws)
7. [CDK Pipelines — le pipeline auto-mutatif](#7-cdk-pipelines--le-pipeline-auto-mutatif)
8. [Artifact stores : S3 et ECR](#8-artifact-stores--s3-et-ecr)
9. [Tests dans la pipeline](#9-tests-dans-la-pipeline)
10. [Infrastructure as Code dans le pipeline](#10-infrastructure-as-code-dans-le-pipeline)
11. [Bonnes pratiques DevOps](#11-bonnes-pratiques-devops)
12. [Résumé et points clés](#12-résumé-et-points-clés)

---

## 1. Introduction au CI/CD sur AWS

Le CI/CD (Continuous Integration / Continuous Delivery) est le pilier du DevOps moderne. Imaginez une **chaîne de montage automobile** : chaque étape (soudure, peinture, assemblage, contrôle qualité) est automatisée et enchaînée. Si une pièce est défectueuse, la chaîne s'arrête immédiatement.

Sur AWS, cette chaîne de montage logicielle repose sur plusieurs services complémentaires :

| Étape | Service AWS | Équivalent open-source |
|-------|------------|----------------------|
| Source | CodeCommit (deprecated) / GitHub | Git |
| Build | CodeBuild | Jenkins, GitLab CI |
| Déploiement | CodeDeploy | Ansible, Spinnaker |
| Orchestration | CodePipeline | Jenkins Pipeline, GitLab CI/CD |
| IaC Pipeline | CDK Pipelines | Terraform Cloud |

### Pourquoi automatiser ?

- **Réduction des erreurs humaines** : un déploiement manuel un vendredi soir, c'est le début des ennuis
- **Rapidité** : de plusieurs heures à quelques minutes
- **Reproductibilité** : chaque déploiement est identique
- **Traçabilité** : chaque changement est auditable

---

## 2. Les services AWS Developer Tools

### CodeCommit (deprecated depuis 2024)

AWS a annoncé la dépréciation de CodeCommit en juillet 2024. Plus aucun nouveau compte ne peut l'activer. Les comptes existants conservent l'accès, mais AWS recommande de migrer vers **GitHub**, **GitLab** ou **Bitbucket**.

> **Note** : Si vous rencontrez CodeCommit dans un examen AWS ou un projet legacy, sachez qu'il fonctionnait comme un dépôt Git managé avec intégration IAM native. La migration vers GitHub avec OIDC est la voie recommandée.

### CodeBuild

Service de build managé qui exécute vos commandes dans des conteneurs éphémères. Pas de serveurs à gérer, facturation à la minute.

### CodeDeploy

Agent de déploiement installé sur vos instances EC2, ECS ou Lambda. Il orchestre le remplacement progressif des versions.

### CodePipeline

Chef d'orchestre qui enchaîne Source → Build → Test → Deploy avec des transitions automatiques ou manuelles.

```
┌──────────┐    ┌───────────┐    ┌──────────┐    ┌────────────┐
│  Source   │───▶│   Build   │───▶│   Test   │───▶│   Deploy   │
│ (GitHub)  │    │(CodeBuild)│    │(CodeBuild)│   │(CodeDeploy)│
└──────────┘    └───────────┘    └──────────┘    └────────────┘
```

---

## 3. CodeBuild en détail

### Le fichier buildspec.yml

Le `buildspec.yml` est le **plan de construction** de votre projet. Il se place à la racine du dépôt.

```yaml
# buildspec.yml
version: 0.2

env:
  variables:
    NODE_ENV: "production"
  parameter-store:
    DB_PASSWORD: "/myapp/prod/db-password"
  secrets-manager:
    API_KEY: "myapp/api-key:API_KEY"

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - npm ci

  pre_build:
    commands:
      - echo "Exécution des tests unitaires..."
      - npm run test:unit
      - echo "Lint du code..."
      - npm run lint

  build:
    commands:
      - echo "Build de l'application..."
      - npm run build
      - echo "Build de l'image Docker..."
      - docker build -t $ECR_REPO:$CODEBUILD_RESOLVED_SOURCE_VERSION .

  post_build:
    commands:
      - echo "Push de l'image vers ECR..."
      - docker push $ECR_REPO:$CODEBUILD_RESOLVED_SOURCE_VERSION
      - echo "Génération du fichier imagedefinitions.json..."
      - printf '[{"name":"app","imageUri":"%s"}]' $ECR_REPO:$CODEBUILD_RESOLVED_SOURCE_VERSION > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json
    - appspec.yml
    - scripts/**/*

cache:
  paths:
    - node_modules/**/*

reports:
  jest-reports:
    files:
      - "coverage/clover.xml"
    file-format: CLOVERXML
```

### Créer un projet CodeBuild via CLI

```bash
aws codebuild create-project \
  --name mon-projet-build \
  --source type=GITHUB,location=https://github.com/mon-org/mon-repo.git \
  --artifacts type=S3,location=mon-bucket-artifacts \
  --environment type=LINUX_CONTAINER,computeType=BUILD_GENERAL1_MEDIUM,image=aws/codebuild/amazonlinux2-x86_64-standard:5.0,privilegedMode=true \
  --service-role arn:aws:iam::123456789012:role/CodeBuildServiceRole
```

### Créer un projet CodeBuild avec le SDK TypeScript v3

```typescript
import { CodeBuildClient, CreateProjectCommand } from "@aws-sdk/client-codebuild";

const client = new CodeBuildClient({ region: "eu-west-1" });

const command = new CreateProjectCommand({
  name: "mon-projet-build",
  source: {
    type: "GITHUB",
    location: "https://github.com/mon-org/mon-repo.git",
    buildspec: "buildspec.yml",
  },
  artifacts: {
    type: "S3",
    location: "mon-bucket-artifacts",
  },
  environment: {
    type: "LINUX_CONTAINER",
    computeType: "BUILD_GENERAL1_MEDIUM",
    image: "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
    privilegedMode: true, // nécessaire pour Docker
    environmentVariables: [
      { name: "NODE_ENV", value: "production", type: "PLAINTEXT" },
      { name: "DB_PASSWORD", value: "/myapp/prod/db-password", type: "PARAMETER_STORE" },
    ],
  },
  serviceRole: "arn:aws:iam::123456789012:role/CodeBuildServiceRole",
});

const response = await client.send(command);
console.log("Projet créé :", response.project?.arn);
```

---

## 4. CodeDeploy et stratégies de déploiement

### Le fichier appspec.yml

L'`appspec.yml` définit **comment** déployer votre application. Pensez-y comme une **fiche de procédure chirurgicale** : chaque étape est précise et ordonnée.

#### Pour EC2/On-Premises

```yaml
# appspec.yml
version: 0.0
os: linux

files:
  - source: /build
    destination: /var/www/myapp

hooks:
  BeforeInstall:
    - location: scripts/stop-server.sh
      timeout: 300
      runas: root

  AfterInstall:
    - location: scripts/install-dependencies.sh
      timeout: 600
      runas: root

  ApplicationStart:
    - location: scripts/start-server.sh
      timeout: 300
      runas: root

  ValidateService:
    - location: scripts/health-check.sh
      timeout: 120
      runas: root
```

#### Pour Lambda

```yaml
version: 0.0
Resources:
  - MyFunction:
      Type: AWS::Lambda::Function
      Properties:
        Name: "mon-api-handler"
        Alias: "live"
        CurrentVersion: "1"
        TargetVersion: "2"
```

### Stratégies de déploiement

Les trois stratégies principales sont analogues à la **rénovation d'un immeuble** :

| Stratégie | Analogie | Risque | Vitesse de rollback |
|-----------|----------|--------|-------------------|
| **Rolling** | Rénover appartement par appartement | Moyen | Moyenne |
| **Blue/Green** | Construire un immeuble neuf à côté, puis déménager tout le monde | Faible | Très rapide |
| **Canary** | Installer un locataire test dans le nouvel immeuble avant les autres | Très faible | Très rapide |

#### Rolling

Les instances sont mises à jour par lots. Pendant la mise à jour, la capacité est réduite.

```bash
aws deploy create-deployment-group \
  --application-name MonApp \
  --deployment-group-name prod-rolling \
  --deployment-config-name CodeDeployDefault.OneAtATime \
  --ec2-tag-filters Key=Environment,Value=Production,Type=KEY_AND_VALUE \
  --service-role-arn arn:aws:iam::123456789012:role/CodeDeployRole
```

#### Blue/Green

Deux environnements identiques coexistent. Le trafic bascule d'un coup.

```bash
aws deploy create-deployment-group \
  --application-name MonApp \
  --deployment-group-name prod-bluegreen \
  --deployment-style deploymentType=BLUE_GREEN,deploymentOption=WITH_TRAFFIC_CONTROL \
  --blue-green-deployment-configuration '{
    "terminateBlueInstancesOnDeploymentSuccess": {
      "action": "TERMINATE",
      "terminationWaitTimeInMinutes": 60
    },
    "deploymentReadyOption": {
      "actionOnTimeout": "CONTINUE_DEPLOYMENT",
      "waitTimeInMinutes": 0
    }
  }' \
  --load-balancer-info elbInfoList=[{name=mon-alb}] \
  --service-role-arn arn:aws:iam::123456789012:role/CodeDeployRole
```

#### Canary

Un petit pourcentage du trafic est redirigé vers la nouvelle version. Si tout va bien, on bascule le reste.

```bash
# Déploiement Canary pour Lambda : 10% pendant 10 minutes, puis 100%
aws deploy create-deployment-config \
  --deployment-config-name Canary10Percent10Minutes \
  --traffic-routing-config '{
    "type": "TimeBasedCanary",
    "timeBasedCanary": {
      "canaryPercentage": 10,
      "canaryInterval": 10
    }
  }' \
  --compute-platform Lambda
```

---

## 5. CodePipeline — orchestration complète

### Création d'un pipeline complet via SDK

```typescript
import { CodePipelineClient, CreatePipelineCommand } from "@aws-sdk/client-codepipeline";

const client = new CodePipelineClient({ region: "eu-west-1" });

const command = new CreatePipelineCommand({
  pipeline: {
    name: "mon-pipeline-prod",
    roleArn: "arn:aws:iam::123456789012:role/CodePipelineRole",
    artifactStore: {
      type: "S3",
      location: "mon-bucket-pipeline-artifacts",
    },
    stages: [
      {
        name: "Source",
        actions: [
          {
            name: "GitHub-Source",
            actionTypeId: {
              category: "Source",
              owner: "ThirdParty",
              provider: "GitHub",
              version: "1",
            },
            outputArtifacts: [{ name: "SourceOutput" }],
            configuration: {
              Owner: "mon-org",
              Repo: "mon-repo",
              Branch: "main",
              OAuthToken: "{{resolve:secretsmanager:github-token}}",
            },
          },
        ],
      },
      {
        name: "Build",
        actions: [
          {
            name: "Build-App",
            actionTypeId: {
              category: "Build",
              owner: "AWS",
              provider: "CodeBuild",
              version: "1",
            },
            inputArtifacts: [{ name: "SourceOutput" }],
            outputArtifacts: [{ name: "BuildOutput" }],
            configuration: {
              ProjectName: "mon-projet-build",
            },
          },
        ],
      },
      {
        name: "Approval",
        actions: [
          {
            name: "Manual-Approval",
            actionTypeId: {
              category: "Approval",
              owner: "AWS",
              provider: "Manual",
              version: "1",
            },
            configuration: {
              NotificationArn: "arn:aws:sns:eu-west-1:123456789012:pipeline-approval",
              CustomData: "Veuillez vérifier le build avant déploiement en production.",
            },
          },
        ],
      },
      {
        name: "Deploy",
        actions: [
          {
            name: "Deploy-ECS",
            actionTypeId: {
              category: "Deploy",
              owner: "AWS",
              provider: "ECS",
              version: "1",
            },
            inputArtifacts: [{ name: "BuildOutput" }],
            configuration: {
              ClusterName: "mon-cluster-prod",
              ServiceName: "mon-service-api",
              FileName: "imagedefinitions.json",
            },
          },
        ],
      },
    ],
  },
});

const response = await client.send(command);
console.log("Pipeline créé :", response.pipeline?.name);
```

### Surveiller les exécutions du pipeline

```bash
# Lister les exécutions récentes
aws codepipeline list-pipeline-executions \
  --pipeline-name mon-pipeline-prod \
  --max-items 5

# Obtenir le statut détaillé
aws codepipeline get-pipeline-state \
  --name mon-pipeline-prod
```

---

## 6. GitHub Actions avec AWS

### Authentification OIDC (recommandée)

L'OIDC (OpenID Connect) remplace les clés d'accès statiques. C'est comme un **badge d'entrée temporaire** : GitHub prouve son identité à AWS, qui lui accorde un accès limité dans le temps.

#### Configuration du fournisseur d'identité dans AWS

```bash
# Créer le fournisseur OIDC
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com
```

#### Rôle IAM pour GitHub Actions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:mon-org/mon-repo:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

#### Workflow GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: eu-west-1

      - name: Login to Amazon ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to ECR
        env:
          ECR_REGISTRY: ${{ steps.ecr-login.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/mon-app:$IMAGE_TAG .
          docker push $ECR_REGISTRY/mon-app:$IMAGE_TAG

      - name: Deploy CDK Stack
        run: |
          npm ci
          npx cdk deploy --require-approval never
```

### Actions AWS officielles

| Action | Usage |
|--------|-------|
| `aws-actions/configure-aws-credentials` | Authentification OIDC ou clés |
| `aws-actions/amazon-ecr-login` | Connexion à ECR |
| `aws-actions/amazon-ecs-render-task-definition` | Mise à jour de la task definition ECS |
| `aws-actions/amazon-ecs-deploy-task-definition` | Déploiement ECS |
| `aws-actions/aws-codebuild-run-build` | Lancer un build CodeBuild |

---

## 7. CDK Pipelines — le pipeline auto-mutatif

Le concept clé de CDK Pipelines est l'**auto-mutation** : le pipeline peut se modifier lui-même. Imaginez un robot qui peut **améliorer ses propres instructions de montage** à chaque itération.

```typescript
import { Stack, StackProps, Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CodePipeline, CodePipelineSource, ShellStep } from "aws-cdk-lib/pipelines";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";

// Stage applicatif — ce qui sera déployé
class MyApplicationStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);
    new MyApiStack(this, "ApiStack");
  }
}

class MyApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const handler = new lambda.Function(this, "Handler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda"),
    });

    new apigateway.LambdaRestApi(this, "Api", { handler });
  }
}

// Stack du pipeline lui-même
class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const pipeline = new CodePipeline(this, "Pipeline", {
      pipelineName: "MonPipelineCDK",
      synth: new ShellStep("Synth", {
        input: CodePipelineSource.gitHub("mon-org/mon-repo", "main"),
        commands: [
          "npm ci",
          "npm run build",
          "npm run test:unit",
          "npx cdk synth",
        ],
      }),
      selfMutation: true, // le pipeline se met à jour automatiquement
    });

    // Environnement de staging
    const staging = pipeline.addStage(new MyApplicationStage(this, "Staging", {
      env: { account: "111111111111", region: "eu-west-1" },
    }));

    staging.addPost(new ShellStep("IntegrationTests", {
      commands: [
        "npm ci",
        "npm run test:integration",
      ],
    }));

    // Environnement de production avec approbation manuelle
    const prod = pipeline.addStage(new MyApplicationStage(this, "Production", {
      env: { account: "222222222222", region: "eu-west-1" },
    }), {
      pre: [
        new ManualApprovalStep("PromoteToProd", {
          comment: "Les tests d'intégration en staging sont-ils passés ?",
        }),
      ],
    });
  }
}
```

> **Attention** : Lors du premier déploiement, lancez `cdk deploy PipelineStack` manuellement. Ensuite, le pipeline gère tout, y compris ses propres modifications.

---

## 8. Artifact stores : S3 et ECR

### S3 comme artifact store

CodePipeline utilise S3 pour stocker les artefacts entre les étapes. Chaque transition crée un fichier ZIP dans le bucket.

```bash
# Créer un bucket d'artefacts avec chiffrement
aws s3 mb s3://mon-pipeline-artifacts-eu-west-1 --region eu-west-1

aws s3api put-bucket-encryption \
  --bucket mon-pipeline-artifacts-eu-west-1 \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
  }'

# Politique de cycle de vie pour nettoyer les anciens artefacts
aws s3api put-bucket-lifecycle-configuration \
  --bucket mon-pipeline-artifacts-eu-west-1 \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "CleanupOldArtifacts",
      "Status": "Enabled",
      "Expiration": {"Days": 30},
      "Filter": {"Prefix": ""}
    }]
  }'
```

### ECR comme registre d'images Docker

```typescript
import { ECRClient, CreateRepositoryCommand, PutLifecyclePolicyCommand } from "@aws-sdk/client-ecr";

const ecr = new ECRClient({ region: "eu-west-1" });

// Créer le dépôt
await ecr.send(new CreateRepositoryCommand({
  repositoryName: "mon-app",
  imageScanningConfiguration: { scanOnPush: true },
  imageTagMutability: "IMMUTABLE", // empêche l'écrasement d'un tag
  encryptionConfiguration: { encryptionType: "KMS" },
}));

// Politique de cycle de vie : garder 10 images max
await ecr.send(new PutLifecyclePolicyCommand({
  repositoryName: "mon-app",
  lifecyclePolicyText: JSON.stringify({
    rules: [{
      rulePriority: 1,
      description: "Garder les 10 images les plus récentes",
      selection: {
        tagStatus: "any",
        countType: "imageCountMoreThan",
        countNumber: 10,
      },
      action: { type: "expire" },
    }],
  }),
}));
```

---

## 9. Tests dans la pipeline

Une pipeline sans tests, c'est comme une usine sans contrôle qualité. Voici les niveaux de tests à intégrer :

| Niveau | Quand | Durée | Quoi |
|--------|-------|-------|------|
| **Lint + format** | Pre-build | ~30s | Qualité du code |
| **Tests unitaires** | Build | ~2min | Logique métier isolée |
| **Tests d'intégration** | Post-deploy staging | ~5min | Interactions entre services |
| **Tests e2e** | Post-deploy staging | ~10min | Parcours utilisateur complets |
| **Tests de charge** | Pré-prod | ~30min | Performance et limites |

### Exemple buildspec avec couverture

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - npm ci

  build:
    commands:
      - npm run lint
      - npm run test:unit -- --coverage --ci
      - npm run build

  post_build:
    commands:
      - |
        COVERAGE=$(node -e "
          const report = require('./coverage/coverage-summary.json');
          console.log(report.total.lines.pct);
        ")
        if (( $(echo "$COVERAGE < 80" | bc -l) )); then
          echo "Couverture insuffisante : ${COVERAGE}% (minimum 80%)"
          exit 1
        fi

reports:
  unit-tests:
    files:
      - "junit.xml"
    base-directory: "test-results"
    file-format: JUNITXML

  coverage:
    files:
      - "coverage/clover.xml"
    file-format: CLOVERXML
```

---

## 10. Infrastructure as Code dans le pipeline

L'IaC dans le pipeline garantit que **toute modification d'infrastructure passe par le même processus de revue et de test** que le code applicatif.

### Pattern : code applicatif et infra dans le même repo

```
mon-projet/
├── src/                  # Code applicatif
├── lambda/               # Fonctions Lambda
├── infra/                # Code CDK
│   ├── bin/
│   │   └── app.ts
│   └── lib/
│       ├── api-stack.ts
│       ├── database-stack.ts
│       └── monitoring-stack.ts
├── buildspec.yml
├── package.json
└── cdk.json
```

### Sécurité : diff avant déploiement

```yaml
# Étape de diff CDK dans le buildspec
phases:
  build:
    commands:
      - npx cdk diff 2>&1 | tee cdk-diff.txt
      - |
        if grep -q "IAMPolicy" cdk-diff.txt; then
          echo "⚠️ Changement IAM détecté — approbation requise"
          aws sns publish \
            --topic-arn arn:aws:sns:eu-west-1:123456789012:security-review \
            --message file://cdk-diff.txt \
            --subject "Changement IAM dans le pipeline"
        fi
```

---

## 11. Bonnes pratiques DevOps

### Trunk-based development

Plutôt que des branches de longue durée (gitflow), le trunk-based development préconise :

- **Une seule branche principale** (`main`)
- **Branches de feature courtes** (< 24h idéalement)
- **Feature flags** pour masquer le code incomplet en production
- **Déploiement continu** à chaque merge sur `main`

### Feature flags avec AWS AppConfig

```typescript
import {
  AppConfigDataClient,
  StartConfigurationSessionCommand,
  GetLatestConfigurationCommand,
} from "@aws-sdk/client-appconfigdata";

const client = new AppConfigDataClient({ region: "eu-west-1" });

// Démarrer une session
const session = await client.send(new StartConfigurationSessionCommand({
  ApplicationIdentifier: "mon-app",
  EnvironmentIdentifier: "production",
  ConfigurationProfileIdentifier: "feature-flags",
}));

// Récupérer la configuration
const config = await client.send(new GetLatestConfigurationCommand({
  ConfigurationToken: session.InitialConfigurationToken!,
}));

const flags = JSON.parse(new TextDecoder().decode(config.Configuration));

if (flags["nouvelle-page-accueil"]?.enabled) {
  // Afficher la nouvelle page d'accueil
} else {
  // Garder l'ancienne version
}
```

### Checklist des bonnes pratiques

| Pratique | Description |
|----------|------------|
| **Commits atomiques** | Un commit = un changement logique |
| **Pipeline rapide** | Feedback en < 10 minutes |
| **Fail fast** | Les tests les plus rapides en premier |
| **Environnements éphémères** | Un environnement par PR, détruit après merge |
| **Secrets dans Secrets Manager** | Jamais de secrets dans le code ou les variables d'environnement en clair |
| **Rollback automatique** | CloudWatch Alarm déclenche le rollback CodeDeploy |
| **Notifications** | Slack/Teams/SNS sur échec du pipeline |
| **Logs centralisés** | Tous les builds dans CloudWatch Logs |

---

## 12. Résumé et points clés

- **CodePipeline** orchestre le flux Source → Build → Test → Deploy, avec S3 comme stockage d'artefacts intermédiaire.
- **CodeBuild** exécute les builds et tests dans des conteneurs managés, configurés via `buildspec.yml`.
- **CodeDeploy** gère les déploiements sur EC2, ECS ou Lambda avec trois stratégies : Rolling, Blue/Green et Canary.
- **GitHub Actions + OIDC** est la méthode recommandée pour intégrer un dépôt GitHub avec AWS sans clés statiques.
- **CDK Pipelines** permet de créer des pipelines auto-mutatifs qui déploient l'infrastructure et l'application ensemble.
- Les **feature flags** (AppConfig) et le **trunk-based development** sont les pratiques DevOps modernes à privilégier.
- Chaque pipeline doit inclure des **tests à plusieurs niveaux** (lint, unit, intégration, e2e) et des **mécanismes de rollback automatique**.
