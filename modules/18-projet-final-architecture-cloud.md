# Module 18 — Projet Final : Architecture Cloud Complète

> **Objectif** : Concevoir, construire et déployer une architecture serverless complète sur AWS, en intégrant tous les concepts vus dans les modules précédents : API, base de données, CDN, authentification, CI/CD, monitoring et sécurité.
> **Difficulté** : ⭐⭐⭐
> **Prérequis** : Modules 1 à 17
> **Durée estimée** : 8h

---

## Table des matières

1. [Vue d'ensemble du projet](#1-vue-densemble-du-projet)
2. [Architecture cible](#2-architecture-cible)
3. [Étape 1 — Infrastructure de base avec CDK](#3-étape-1--infrastructure-de-base-avec-cdk)
4. [Étape 2 — API Gateway + Lambda](#4-étape-2--api-gateway--lambda)
5. [Étape 3 — DynamoDB](#5-étape-3--dynamodb)
6. [Étape 4 — Authentification avec Cognito](#6-étape-4--authentification-avec-cognito)
7. [Étape 5 — Frontend S3 + CloudFront](#7-étape-5--frontend-s3--cloudfront)
8. [Étape 6 — CI/CD Pipeline](#8-étape-6--cicd-pipeline)
9. [Étape 7 — Monitoring et alerting](#9-étape-7--monitoring-et-alerting)
10. [Étape 8 — Sécurité avancée](#10-étape-8--sécurité-avancée)
11. [Estimation des coûts](#11-estimation-des-coûts)
12. [Checklist de production readiness](#12-checklist-de-production-readiness)
13. [Milestones et livrables](#13-milestones-et-livrables)

---

## 1. Vue d'ensemble du projet

Vous allez construire **TaskFlow**, une application de gestion de tâches collaborative. Ce projet est volontairement simple fonctionnellement pour vous permettre de vous concentrer sur l'**architecture cloud** et les **bonnes pratiques opérationnelles**.

### Fonctionnalités

- Inscription et connexion (Cognito)
- Création, modification, suppression de tâches (CRUD)
- Assignation de tâches à des utilisateurs
- Upload de fichiers joints (S3)
- Notifications en temps réel (WebSocket via API Gateway)

### Stack technique

| Composant | Service AWS | Justification |
|-----------|------------|---------------|
| Frontend | S3 + CloudFront | SPA statique, latence faible, coût minimal |
| API REST | API Gateway + Lambda | Serverless, scaling automatique |
| Base de données | DynamoDB | NoSQL managé, pay-per-request |
| Authentification | Cognito | Gestion utilisateurs clé en main |
| Fichiers | S3 (bucket dédié) | Stockage objet scalable |
| CI/CD | CDK Pipelines | Pipeline auto-mutatif |
| Monitoring | CloudWatch + X-Ray | Métriques, logs, traces distribuées |
| Sécurité | WAF + KMS + Secrets Manager | Protection périmétrique et chiffrement |

---

## 2. Architecture cible

```
                    ┌─────────────┐
                    │  Route 53   │
                    │ (DNS)       │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  CloudFront │◄──── WAF
                    │  (CDN)      │
                    └──┬───────┬──┘
                       │       │
              ┌────────▼──┐  ┌─▼──────────┐
              │  S3       │  │ API Gateway │◄──── Cognito
              │ (Frontend)│  │ (REST API)  │      Authorizer
              └───────────┘  └──────┬──────┘
                                    │
                           ┌────────▼────────┐
                           │  Lambda          │
                           │  (Fonctions API) │──── X-Ray
                           └──┬─────┬─────┬──┘
                              │     │     │
                    ┌─────────▼┐ ┌──▼──┐ ┌▼──────────┐
                    │ DynamoDB  │ │ S3  │ │ Secrets   │
                    │ (Données) │ │(UL) │ │ Manager   │
                    └───────────┘ └─────┘ └───────────┘
                         │
                    ┌────▼──────┐
                    │ DynamoDB  │
                    │ Streams   │──── Lambda (notifications)
                    └───────────┘
```

---

## 3. Étape 1 — Infrastructure de base avec CDK

### Initialisation du projet

```bash
mkdir taskflow && cd taskflow
npx cdk init app --language typescript

# Structure recommandée
mkdir -p src/lambda src/frontend infra/lib infra/bin
```

### Stack de base

```typescript
// infra/lib/base-stack.ts
import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";

export class BaseStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly uploadBucket: s3.Bucket;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Clé KMS pour le chiffrement
    this.encryptionKey = new kms.Key(this, "AppKey", {
      alias: "taskflow/main",
      description: "Clé de chiffrement principale TaskFlow",
      enableKeyRotation: true,
    });

    // Table DynamoDB
    this.table = new dynamodb.Table(this, "TasksTable", {
      tableName: "taskflow-tasks",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI pour requêtes par utilisateur
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Bucket d'uploads
    this.uploadBucket = new s3.Bucket(this, "UploadBucket", {
      bucketName: `taskflow-uploads-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: "CleanupOldVersions",
          noncurrentVersionExpiration: { noncurrentDays: 30 },
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, "TableName", { value: this.table.tableName });
    new CfnOutput(this, "BucketName", { value: this.uploadBucket.bucketName });
  }
}
```

---

## 4. Étape 2 — API Gateway + Lambda

### Modèle d'accès DynamoDB (Single Table Design)

Le Single Table Design, c'est comme un **classeur à intercalaires** : un seul meuble contient tout, mais chaque section est bien organisée.

| Entité | PK | SK | GSI1PK | GSI1SK |
|--------|----|----|--------|--------|
| User | `USER#<userId>` | `PROFILE` | `EMAIL#<email>` | `USER` |
| Task | `TASK#<taskId>` | `META` | `USER#<assigneeId>` | `TASK#<createdAt>` |
| Comment | `TASK#<taskId>` | `COMMENT#<timestamp>` | `USER#<authorId>` | `COMMENT#<timestamp>` |

### Stack API

```typescript
// infra/lib/api-stack.ts
import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as logs from "aws-cdk-lib/aws-logs";

interface ApiStackProps extends StackProps {
  table: dynamodb.Table;
  userPool: cognito.UserPool;
}

export class ApiStack extends Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Fonction Lambda de base avec X-Ray
    const taskHandler = new nodejs.NodejsFunction(this, "TaskHandler", {
      entry: "src/lambda/tasks/handler.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE, // X-Ray activé
      environment: {
        TABLE_NAME: props.table.tableName,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"], // déjà dans le runtime Lambda
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Permissions DynamoDB
    props.table.grantReadWriteData(taskHandler);

    // API Gateway
    this.api = new apigateway.RestApi(this, "TaskFlowApi", {
      restApiName: "TaskFlow API",
      description: "API principale de TaskFlow",
      deployOptions: {
        stageName: "v1",
        tracingEnabled: true, // X-Ray sur API Gateway
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, "ApiAccessLogs", {
            retention: logs.RetentionDays.ONE_MONTH,
          })
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        throttlingRateLimit: 1000,
        throttlingBurstLimit: 500,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Authorizer Cognito
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [props.userPool],
    });

    // Routes
    const tasks = this.api.root.addResource("tasks");
    const taskById = tasks.addResource("{taskId}");

    const lambdaIntegration = new apigateway.LambdaIntegration(taskHandler);
    const authOptions = { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO };

    tasks.addMethod("GET", lambdaIntegration, authOptions);
    tasks.addMethod("POST", lambdaIntegration, authOptions);
    taskById.addMethod("GET", lambdaIntegration, authOptions);
    taskById.addMethod("PUT", lambdaIntegration, authOptions);
    taskById.addMethod("DELETE", lambdaIntegration, authOptions);
  }
}
```

### Code Lambda

```typescript
// src/lambda/tasks/handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = event.requestContext.authorizer?.claims?.sub;
  const method = event.httpMethod;
  const taskId = event.pathParameters?.taskId;

  try {
    switch (`${method} ${taskId ? "/:id" : "/"}`) {
      case "GET /":
        return await listTasks(userId);
      case "POST /":
        return await createTask(userId, JSON.parse(event.body || "{}"));
      case "GET /:id":
        return await getTask(taskId!);
      case "DELETE /:id":
        return await deleteTask(taskId!);
      default:
        return response(405, { message: "Méthode non autorisée" });
    }
  } catch (error) {
    console.error("Erreur :", error);
    return response(500, { message: "Erreur interne du serveur" });
  }
}

async function listTasks(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": `USER#${userId}` },
  }));
  return response(200, result.Items);
}

async function createTask(userId: string, body: Record<string, string>) {
  const taskId = randomUUID();
  const now = new Date().toISOString();

  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `TASK#${taskId}`,
      SK: "META",
      GSI1PK: `USER#${userId}`,
      GSI1SK: `TASK#${now}`,
      taskId,
      title: body.title,
      description: body.description || "",
      status: "TODO",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    },
  }));

  return response(201, { taskId });
}

async function getTask(taskId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND SK = :sk",
    ExpressionAttributeValues: { ":pk": `TASK#${taskId}`, ":sk": "META" },
  }));
  if (!result.Items?.length) return response(404, { message: "Tâche introuvable" });
  return response(200, result.Items[0]);
}

async function deleteTask(taskId: string) {
  await ddb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: `TASK#${taskId}`, SK: "META" },
  }));
  return response(204, null);
}

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "",
  };
}
```

---

## 5. Étape 3 — DynamoDB

### Capacity Planning

Pour le mode **PAY_PER_REQUEST** (on-demand) :

| Opération | Coût (eu-west-1) |
|-----------|-----------------|
| Écriture (WRU) | 1,4846 $ / million |
| Lecture (RRU) | 0,2969 $ / million |
| Stockage | 0,28 $ / Go / mois |

### Sauvegardes automatiques

```typescript
// Déjà activé via pointInTimeRecovery: true dans la stack CDK
// Pour une sauvegarde manuelle via CLI :
```

```bash
aws dynamodb create-backup \
  --table-name taskflow-tasks \
  --backup-name "taskflow-backup-$(date +%Y%m%d)"
```

---

## 6. Étape 4 — Authentification avec Cognito

```typescript
// infra/lib/auth-stack.ts
import { Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";

export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "taskflow-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
    });

    this.userPoolClient = new cognito.UserPoolClient(this, "WebClient", {
      userPool: this.userPool,
      userPoolClientName: "taskflow-web",
      authFlows: {
        userSrp: true,
        custom: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ["https://taskflow.example.com/callback"],
        logoutUrls: ["https://taskflow.example.com/logout"],
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });
  }
}
```

### Tester l'authentification via CLI

```bash
# Inscription
aws cognito-idp sign-up \
  --client-id <client-id> \
  --username user@example.com \
  --password 'MonMotDePasse!123' \
  --user-attributes Name=given_name,Value=Jean Name=family_name,Value=Dupont

# Confirmation (admin)
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id eu-west-1_XXXXXXXX \
  --username user@example.com

# Connexion
aws cognito-idp initiate-auth \
  --client-id <client-id> \
  --auth-flow USER_SRP_AUTH \
  --auth-parameters USERNAME=user@example.com,SRP_A=<srp-value>
```

---

## 7. Étape 5 — Frontend S3 + CloudFront

```typescript
// infra/lib/frontend-stack.ts
import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

interface FrontendStackProps extends StackProps {
  apiUrl: string;
  domainName?: string;
  certificateArn?: string;
}

export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Fonction CloudFront pour les SPA (réécriture des URLs)
    const rewriteFunction = new cloudfront.Function(this, "RewriteFunction", {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;
          if (uri.endsWith('/')) {
            request.uri += 'index.html';
          } else if (!uri.includes('.')) {
            request.uri = '/index.html';
          }
          return request;
        }
      `),
    });

    // Security headers
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: rewriteFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
        responseHeadersPolicy,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // Déploiement du frontend
    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset("./src/frontend/dist")],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new CfnOutput(this, "DistributionUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
```

---

## 8. Étape 6 — CI/CD Pipeline

Le pipeline est le **système nerveux** de votre application : il relie le code source au déploiement en production.

```typescript
// infra/lib/pipeline-stack.ts
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  CodePipeline,
  CodePipelineSource,
  ShellStep,
  ManualApprovalStep,
} from "aws-cdk-lib/pipelines";
import { TaskFlowStage } from "./taskflow-stage";

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const pipeline = new CodePipeline(this, "Pipeline", {
      pipelineName: "TaskFlowPipeline",
      crossAccountKeys: true,
      synth: new ShellStep("Synth", {
        input: CodePipelineSource.gitHub("mon-org/taskflow", "main", {
          authentication: SecretValue.secretsManager("github-token"),
        }),
        commands: [
          "npm ci",
          "npm run lint",
          "npm run test:unit",
          "cd src/frontend && npm ci && npm run build && cd ../..",
          "npx cdk synth",
        ],
        primaryOutputDirectory: "cdk.out",
      }),
      selfMutation: true,
      dockerEnabledForSynth: true,
    });

    // Staging
    const staging = pipeline.addStage(new TaskFlowStage(this, "Staging", {
      env: { account: "111111111111", region: "eu-west-1" },
    }));

    staging.addPost(
      new ShellStep("IntegrationTests", {
        commands: [
          "npm ci",
          "npm run test:integration -- --stage staging",
        ],
      }),
      new ShellStep("E2ETests", {
        commands: [
          "npm ci",
          "npx playwright install --with-deps",
          "npm run test:e2e -- --base-url $STAGING_URL",
        ],
      })
    );

    // Production
    pipeline.addStage(new TaskFlowStage(this, "Production", {
      env: { account: "222222222222", region: "eu-west-1" },
    }), {
      pre: [
        new ManualApprovalStep("ApprobationProd", {
          comment: "Les tests staging sont passés. Approuver le déploiement en production ?",
        }),
      ],
    });
  }
}
```

### Workflow GitHub Actions alternatif

```yaml
# .github/workflows/deploy.yml
name: TaskFlow Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit -- --coverage

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111111111111:role/GitHubActionsRole
          aws-region: eu-west-1
      - run: npm ci && npx cdk deploy --all --require-approval never

  e2e-staging:
    needs: deploy-staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npx playwright install --with-deps
      - run: npm run test:e2e

  deploy-prod:
    needs: e2e-staging
    runs-on: ubuntu-latest
    environment: production  # requiert approbation manuelle dans GitHub
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::222222222222:role/GitHubActionsRole
          aws-region: eu-west-1
      - run: npm ci && npx cdk deploy --all --require-approval never
```

---

## 9. Étape 7 — Monitoring et alerting

### CloudWatch — Métriques et alarmes

Pensez au monitoring comme au **tableau de bord d'un avion** : vous devez surveiller les instruments critiques en permanence.

```typescript
// infra/lib/monitoring-stack.ts
import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as lambda from "aws-cdk-lib/aws-lambda";

interface MonitoringStackProps extends StackProps {
  apiName: string;
  lambdaFunctions: lambda.Function[];
  alertEmail: string;
}

export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: "taskflow-alerts",
    });
    alertTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));

    // Alarme : taux d'erreurs API > 5%
    const apiErrors = new cloudwatch.Alarm(this, "ApiErrorRate", {
      alarmName: "TaskFlow-API-ErrorRate",
      metric: new cloudwatch.MathExpression({
        expression: "(errors / requests) * 100",
        usingMetrics: {
          errors: new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "5XXError",
            dimensionsMap: { ApiName: props.apiName },
            statistic: "Sum",
            period: Duration.minutes(5),
          }),
          requests: new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "Count",
            dimensionsMap: { ApiName: props.apiName },
            statistic: "Sum",
            period: Duration.minutes(5),
          }),
        },
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiErrors.addAlarmAction(new actions.SnsAction(alertTopic));

    // Alarme pour chaque Lambda : durée > 80% du timeout
    for (const fn of props.lambdaFunctions) {
      new cloudwatch.Alarm(this, `${fn.node.id}-Duration`, {
        alarmName: `TaskFlow-${fn.node.id}-HighDuration`,
        metric: fn.metricDuration({ statistic: "p99", period: Duration.minutes(5) }),
        threshold: 8000, // 8s sur un timeout de 10s
        evaluationPeriods: 3,
      }).addAlarmAction(new actions.SnsAction(alertTopic));

      new cloudwatch.Alarm(this, `${fn.node.id}-Errors`, {
        alarmName: `TaskFlow-${fn.node.id}-Errors`,
        metric: fn.metricErrors({ statistic: "Sum", period: Duration.minutes(5) }),
        threshold: 5,
        evaluationPeriods: 1,
      }).addAlarmAction(new actions.SnsAction(alertTopic));
    }

    // Dashboard
    new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "TaskFlow-Production",
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "Requêtes API",
            left: [new cloudwatch.Metric({
              namespace: "AWS/ApiGateway",
              metricName: "Count",
              dimensionsMap: { ApiName: props.apiName },
              statistic: "Sum",
              period: Duration.minutes(1),
            })],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Latence API (p50, p90, p99)",
            left: ["p50", "p90", "p99"].map(stat => new cloudwatch.Metric({
              namespace: "AWS/ApiGateway",
              metricName: "Latency",
              dimensionsMap: { ApiName: props.apiName },
              statistic: stat,
              period: Duration.minutes(1),
            })),
            width: 12,
          }),
        ],
      ],
    });
  }
}
```

### X-Ray — Traces distribuées

```bash
# Vérifier que les traces remontent correctement
aws xray get-trace-summaries \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --sampling-rule '{"RuleName":"taskflow","Priority":1,"FixedRate":0.1}'

# Analyser les segments lents
aws xray get-service-graph \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s)
```

---

## 10. Étape 8 — Sécurité avancée

### WAF — Protection périmétrique

```typescript
// infra/lib/waf-stack.ts
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";

export class WafStack extends Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.webAcl = new wafv2.CfnWebACL(this, "WebACL", {
      name: "taskflow-waf",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "taskflow-waf",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "common-rules",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "RateLimit",
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000, // requêtes par 5 minutes par IP
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "rate-limit",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "AWSManagedRulesSQLiRuleSet",
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesSQLiRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "sqli-rules",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
  }
}
```

### Secrets Manager

```bash
# Stocker un secret
aws secretsmanager create-secret \
  --name "taskflow/prod/api-keys" \
  --description "Clés API tierces pour TaskFlow" \
  --secret-string '{"stripe":"sk_live_xxx","sendgrid":"SG.xxx"}'

# Activer la rotation automatique (tous les 30 jours)
aws secretsmanager rotate-secret \
  --secret-id "taskflow/prod/api-keys" \
  --rotation-lambda-arn arn:aws:lambda:eu-west-1:123456789012:function:secret-rotation \
  --rotation-rules AutomaticallyAfterDays=30
```

### Accéder aux secrets depuis Lambda

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({ region: "eu-west-1" });

// Cache en mémoire pour éviter des appels répétés
let cachedSecrets: Record<string, string> | null = null;

async function getSecrets(): Promise<Record<string, string>> {
  if (cachedSecrets) return cachedSecrets;

  const response = await sm.send(new GetSecretValueCommand({
    SecretId: "taskflow/prod/api-keys",
  }));

  cachedSecrets = JSON.parse(response.SecretString!);
  return cachedSecrets!;
}
```

---

## 11. Estimation des coûts

Pour une application avec **10 000 utilisateurs actifs mensuels** et **100 000 requêtes API/jour** :

| Service | Usage estimé | Coût mensuel estimé |
|---------|-------------|-------------------|
| **Lambda** | 3M invocations, 512 Mo, 200ms moy. | ~6 $ |
| **API Gateway** | 3M requêtes REST | ~10 $ |
| **DynamoDB** | 3M écritures, 10M lectures, 5 Go | ~8 $ |
| **S3** (frontend) | 1 Go stockage, 500K requêtes | ~1 $ |
| **S3** (uploads) | 50 Go stockage | ~1 $ |
| **CloudFront** | 100 Go transfert | ~9 $ |
| **Cognito** | 10 000 MAU | 0 $ (free tier : 50K MAU) |
| **CloudWatch** | Logs + métriques + dashboard | ~10 $ |
| **X-Ray** | 3M traces (5% sampling) | ~1 $ |
| **WAF** | 1 WebACL + 3 règles | ~8 $ |
| **KMS** | 1 clé + requêtes | ~2 $ |
| **Secrets Manager** | 3 secrets | ~2 $ |
| **Total estimé** | | **~58 $/mois** |

> **Astuce** : Utilisez l'[AWS Pricing Calculator](https://calculator.aws/) pour affiner ces estimations selon votre cas d'usage réel.

### Comparer avec une architecture traditionnelle

| Architecture | Coût estimé/mois | Effort opérationnel |
|-------------|-----------------|-------------------|
| EC2 (2x t3.medium) + RDS + ALB | ~200 $ | Élevé (patches, scaling, backups) |
| ECS Fargate + RDS | ~150 $ | Moyen |
| **Serverless (ce projet)** | **~58 $** | **Faible** |

Le serverless brille pour les charges de travail variables. Si votre trafic est constant et élevé (> 1M req/heure), une architecture conteneurisée peut devenir plus économique.

---

## 12. Checklist de production readiness

Avant de déclarer votre application prête pour la production, vérifiez chaque point :

### Infrastructure

- [ ] Toutes les ressources sont définies en IaC (CDK), aucune ressource manuelle
- [ ] `RemovalPolicy.RETAIN` sur les données critiques (DynamoDB, S3 uploads)
- [ ] Point-in-time recovery activé sur DynamoDB
- [ ] Versioning activé sur les buckets S3 contenant des données utilisateur
- [ ] Chiffrement KMS avec rotation automatique des clés

### Sécurité

- [ ] WAF actif sur CloudFront avec les règles managées AWS
- [ ] Rate limiting configuré (WAF + API Gateway throttling)
- [ ] Aucun secret en dur dans le code ou les variables d'environnement
- [ ] Secrets Manager avec rotation automatique
- [ ] Politique de mots de passe Cognito conforme (12 caractères minimum)
- [ ] MFA activé (au moins optionnel)
- [ ] Headers de sécurité sur CloudFront (HSTS, X-Frame-Options, etc.)
- [ ] Bucket S3 frontend avec `BlockPublicAccess.BLOCK_ALL`
- [ ] Least privilege : chaque Lambda n'a que les permissions nécessaires

### Monitoring

- [ ] CloudWatch Alarms sur : taux d'erreurs API, latence p99, erreurs Lambda
- [ ] Dashboard CloudWatch avec les métriques clés
- [ ] X-Ray activé sur API Gateway et Lambda
- [ ] Access logs API Gateway activés
- [ ] Log retention configurée (pas de rétention infinie)
- [ ] SNS notifications vers email/Slack sur alarme critique

### CI/CD

- [ ] Pipeline automatisé : push → build → test → staging → approval → prod
- [ ] Tests unitaires avec couverture > 80%
- [ ] Tests d'intégration sur l'environnement staging
- [ ] Tests e2e avec Playwright
- [ ] Rollback automatique en cas d'échec de déploiement
- [ ] Self-mutation du pipeline CDK activée

### Performance

- [ ] Lambda ARM64 (Graviton2) pour un meilleur rapport coût/performance
- [ ] Lambda memory sizing optimisé (utiliser AWS Lambda Power Tuning)
- [ ] CloudFront cache policy correctement configurée
- [ ] DynamoDB en mode on-demand (ou provisioned avec auto-scaling si trafic prévisible)
- [ ] Bundling Lambda avec minification et tree-shaking

### Résilience

- [ ] Retry avec exponential backoff dans le code applicatif
- [ ] Dead Letter Queue (DLQ) sur les Lambdas asynchrones
- [ ] Circuit breaker sur les appels vers des services externes
- [ ] Plan de disaster recovery documenté
- [ ] Tests de charge effectués (Artillery, k6)

---

## 13. Milestones et livrables

### Milestone 1 — Fondations (Jour 1)

**Objectif** : Infrastructure de base fonctionnelle.

- [ ] Initialiser le projet CDK
- [ ] Déployer la BaseStack (DynamoDB, S3, KMS)
- [ ] Déployer l'AuthStack (Cognito)
- [ ] Vérifier la création des ressources dans la console AWS

**Livrable** : `cdk deploy BaseStack AuthStack` réussit sans erreur.

### Milestone 2 — API (Jour 2)

**Objectif** : API CRUD fonctionnelle avec authentification.

- [ ] Écrire les fonctions Lambda (CRUD tâches)
- [ ] Déployer l'ApiStack
- [ ] Tester avec `curl` ou Postman : inscription, connexion, CRUD
- [ ] Ajouter les tests unitaires Lambda

**Livrable** : Les 5 endpoints (GET/POST/PUT/DELETE) répondent correctement avec un token Cognito valide.

### Milestone 3 — Frontend (Jour 3)

**Objectif** : Application frontend déployée et accessible.

- [ ] Créer la SPA (React, Vue ou autre)
- [ ] Intégrer l'authentification Cognito (Amplify ou SDK directement)
- [ ] Déployer la FrontendStack (S3 + CloudFront)
- [ ] Vérifier l'accès HTTPS et la navigation SPA

**Livrable** : L'application est accessible via l'URL CloudFront, l'inscription et la gestion de tâches fonctionnent.

### Milestone 4 — CI/CD (Jour 4)

**Objectif** : Pipeline de déploiement continu opérationnel.

- [ ] Créer la PipelineStack (CDK Pipelines)
- [ ] Configurer les environnements staging et production
- [ ] Ajouter les étapes de test dans le pipeline
- [ ] Pousser un changement et vérifier le déploiement automatique

**Livrable** : Un `git push` sur `main` déclenche le pipeline complet jusqu'au staging. Le déploiement en production nécessite une approbation manuelle.

### Milestone 5 — Monitoring & Sécurité (Jour 5)

**Objectif** : Observabilité et sécurité de niveau production.

- [ ] Déployer la MonitoringStack (alarmes, dashboard, X-Ray)
- [ ] Déployer la WafStack
- [ ] Configurer Secrets Manager pour les clés tierces
- [ ] Simuler une erreur et vérifier la notification
- [ ] Exécuter la checklist de production readiness

**Livrable** : Dashboard CloudWatch visible, alarmes testées, WAF actif, checklist complétée à 100%.

### Milestone 6 — Optimisation & Documentation (Jour 6)

**Objectif** : Peaufiner et documenter.

- [ ] Optimiser le coût (Lambda Power Tuning, cache CloudFront)
- [ ] Tests de charge avec Artillery ou k6
- [ ] Estimation des coûts finalisée
- [ ] Architecture Decision Records (ADR) rédigés
- [ ] Présentation du projet (architecture diagram, démo)

**Livrable** : Rapport final avec architecture, estimation de coûts, résultats des tests de charge et ADR.

---

> **Félicitations !** Si vous avez suivi tous les modules et complété ce projet final, vous maîtrisez les fondamentaux de l'architecture cloud sur AWS. Vous êtes capable de concevoir, déployer et opérer une application serverless complète, sécurisée et observable. La prochaine étape ? Passer la certification **AWS Solutions Architect Associate** — vous avez déjà toutes les bases.
