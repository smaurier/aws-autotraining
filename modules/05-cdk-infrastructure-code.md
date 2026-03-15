# Module 05 — CDK — Infrastructure as Code avec TypeScript

> **Objectif** : Comprendre les principes de l'Infrastructure as Code, maîtriser les concepts CDK (App, Stack, Construct), déployer des ressources AWS avec du code TypeScript, tester les stacks avec des assertions, et appliquer les bonnes pratiques de structuration.
>
> **Difficulté** : ⭐⭐⭐ (avancé)
>
> **Prérequis** : Module 01 (IAM), Module 05 (Lambda), TypeScript de base
>
> **Durée estimée** : 4h

---

## Table des matières

1. [Pourquoi l'Infrastructure as Code](#1-pourquoi-linfrastructure-as-code)
2. [CloudFormation vs CDK vs Terraform](#2-cloudformation-vs-cdk-vs-terraform)
3. [Concepts CDK](#3-concepts-cdk)
4. [Démarrer un projet CDK](#4-démarrer-un-projet-cdk)
5. [Premiers Constructs](#5-premiers-constructs)
6. [Commandes CLI essentielles](#6-commandes-cli-essentielles)
7. [Exemples pratiques](#7-exemples-pratiques)
8. [Aspects, Context et Parameters](#8-aspects-context-et-parameters)
9. [Tester les Stacks CDK](#9-tester-les-stacks-cdk)
10. [Bonnes pratiques](#10-bonnes-pratiques)
11. [Récapitulatif](#11-récapitulatif)

---

## 1. Pourquoi l'Infrastructure as Code

### 1.1 Le problème du "ClickOps"

Créer des ressources AWS via la console (ClickOps) pose des problèmes majeurs :

- **Non reproductible** : impossible de recréer exactement le même environnement
- **Non versionné** : pas d'historique des changements, pas de code review
- **Sujette aux erreurs** : un clic de travers peut casser la production
- **Non testable** : impossible de valider la configuration avant de l'appliquer
- **Lente** : chaque environnement (dev, staging, prod) doit être configuré manuellement

> **Analogie** : Le ClickOps, c'est comme cuisiner sans recette. Vous pouvez faire un bon plat une fois, mais impossible de le reproduire exactement. L'IaC, c'est la recette détaillée — reproductible, partageable, améliorable.

### 1.2 Avantages de l'IaC

| Avantage | Description |
|---|---|
| **Reproductibilité** | Même code = même infrastructure, à chaque fois |
| **Versioning** | Historique Git de tous les changements d'infra |
| **Code review** | Revue des changements d'infra comme du code applicatif |
| **Tests** | Valider la configuration avant le déploiement |
| **Automatisation** | CI/CD pour l'infrastructure |
| **Documentation** | Le code EST la documentation de l'infrastructure |

---

## 2. CloudFormation vs CDK vs Terraform

| Critère | CloudFormation | CDK | Terraform |
|---|---|---|---|
| **Langage** | YAML/JSON | TypeScript, Python, Java, Go, C# | HCL (HashiCorp) |
| **Fournisseur** | AWS uniquement | AWS uniquement (via CloudFormation) | Multi-cloud |
| **Abstraction** | Bas niveau (chaque propriété) | Haut niveau (Constructs L2/L3) | Moyen (modules) |
| **State** | Géré par AWS | Géré par AWS (via CFN) | Fichier local ou remote |
| **Boucles/conditions** | Limité (`Fn::If`, `Conditions`) | Natif (TypeScript) | `count`, `for_each` |
| **IDE support** | Limité | Excellent (TypeScript) | Bon |
| **Courbe d'apprentissage** | YAML verbeux | Facile si vous connaissez TypeScript | Nouveau langage (HCL) |

> **Recommandation** : Si vous êtes 100 % AWS et développeur TypeScript, CDK est le meilleur choix. Il génère du CloudFormation sous le capot, mais avec la puissance d'un vrai langage de programmation.

---

## 3. Concepts CDK

### 3.1 Architecture CDK

```
App (cdk.App)
  └── Stack 1 (cdk.Stack) → CloudFormation Stack
  │     ├── Construct A (ex: s3.Bucket)
  │     ├── Construct B (ex: lambda.Function)
  │     └── Construct C (ex: apigateway.RestApi)
  └── Stack 2 (cdk.Stack) → CloudFormation Stack
        └── ...
```

### 3.2 Les trois niveaux de Constructs

| Niveau | Nom | Description | Exemple |
|---|---|---|---|
| **L1** | CFN Resources | Mapping 1:1 avec CloudFormation. Préfixe `Cfn`. | `CfnBucket` |
| **L2** | Curated Constructs | Abstractions AWS avec des valeurs par défaut sensées. | `Bucket` |
| **L3** | Patterns | Combinaisons de plusieurs ressources. | `LambdaRestApi` |

```typescript
// L1 — Bas niveau, verbeux, contrôle total
new s3.CfnBucket(this, 'MyBucket', {
  bucketName: 'my-bucket',
  versioningConfiguration: { status: 'Enabled' },
})

// L2 — Haut niveau, valeurs par défaut, méthodes utilitaires
new s3.Bucket(this, 'MyBucket', {
  versioned: true,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
})

// L3 — Pattern complet (API Gateway + Lambda en une ligne)
new apigateway.LambdaRestApi(this, 'MyApi', {
  handler: myLambda,
})
```

> **Règle** : Utilisez les Constructs L2 par défaut. Descendez en L1 uniquement si une propriété n'est pas exposée par le L2.

---

## 4. Démarrer un projet CDK

### 4.1 Installation

```bash
# Installer le CLI CDK globalement
npm install -g aws-cdk

# Vérifier la version
cdk --version
```

### 4.2 Initialiser un projet

```bash
mkdir my-infra && cd my-infra
cdk init app --language typescript
```

Structure générée :

```
my-infra/
├── bin/
│   └── my-infra.ts          ← Point d'entrée (App)
├── lib/
│   └── my-infra-stack.ts    ← Définition de la Stack
├── test/
│   └── my-infra.test.ts     ← Tests
├── cdk.json                  ← Configuration CDK
├── tsconfig.json
└── package.json
```

### 4.3 Bootstrap

Avant le premier déploiement, il faut **bootstrapper** le compte AWS (crée un bucket S3 et des rôles IAM pour CDK) :

```bash
cdk bootstrap aws://123456789012/eu-west-1
```

---

## 5. Premiers Constructs

### 5.1 Le fichier App (`bin/my-infra.ts`)

```typescript
import * as cdk from 'aws-cdk-lib'
import { MyInfraStack } from '../lib/my-infra-stack'

const app = new cdk.App()

new MyInfraStack(app, 'MyInfraStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-1',
  },
})
```

### 5.2 Le fichier Stack (`lib/my-infra-stack.ts`)

```typescript
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'

export class MyInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Créer un bucket S3
    const bucket = new s3.Bucket(this, 'MyBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // supprime les objets quand le bucket est détruit
    })

    // Exporter l'ARN du bucket
    new cdk.CfnOutput(this, 'BucketArn', {
      value: bucket.bucketArn,
      description: 'ARN du bucket S3',
    })
  }
}
```

---

## 6. Commandes CLI essentielles

| Commande | Description |
|---|---|
| `cdk init` | Initialise un nouveau projet CDK |
| `cdk synth` | Génère le template CloudFormation (sans déployer) |
| `cdk diff` | Affiche les différences entre le code et ce qui est déployé |
| `cdk deploy` | Déploie la stack sur AWS |
| `cdk destroy` | Supprime la stack et toutes ses ressources |
| `cdk ls` | Liste toutes les stacks de l'application |
| `cdk doctor` | Vérifie la configuration CDK |

### 6.1 Workflow typique

```bash
# 1. Écrire/modifier le code TypeScript
# 2. Synthétiser pour voir le CloudFormation généré
cdk synth

# 3. Voir ce qui va changer
cdk diff

# 4. Déployer
cdk deploy

# 5. Déployer avec approbation automatique (CI/CD)
cdk deploy --require-approval never

# 6. Déployer une stack spécifique
cdk deploy MyInfraStack

# 7. Déployer toutes les stacks
cdk deploy --all
```

### 6.2 Sortie de `cdk diff`

```
Stack MyInfraStack
Resources
[+] AWS::S3::Bucket MyBucket MyBucket560B80BC
[~] AWS::Lambda::Function MyFunction
 └── [~] Runtime
     ├── [-] nodejs18.x
     └── [+] nodejs20.x
```

- `[+]` = nouvelle ressource
- `[-]` = ressource supprimée
- `[~]` = ressource modifiée

---

## 7. Exemples pratiques

### 7.1 Lambda + API Gateway

```typescript
import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as path from 'path'
import type { Construct } from 'constructs'

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Fonction Lambda
    const handler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: 'MyTable',
        NODE_ENV: 'production',
      },
    })

    // API Gateway (L3 Pattern — crée automatiquement le proxy)
    const api = new apigateway.LambdaRestApi(this, 'MyApi', {
      handler,
      proxy: false, // désactiver le proxy pour définir les routes manuellement
    })

    // Définir les routes
    const users = api.root.addResource('users')
    users.addMethod('GET', new apigateway.LambdaIntegration(handler))
    users.addMethod('POST', new apigateway.LambdaIntegration(handler))

    const singleUser = users.addResource('{userId}')
    singleUser.addMethod('GET', new apigateway.LambdaIntegration(handler))
    singleUser.addMethod('PUT', new apigateway.LambdaIntegration(handler))
    singleUser.addMethod('DELETE', new apigateway.LambdaIntegration(handler))
  }
}
```

### 7.2 DynamoDB + Lambda avec permissions

```typescript
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'

// Dans le constructeur de la Stack :

const table = new dynamodb.Table(this, 'OrdersTable', {
  partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  pointInTimeRecovery: true,
  stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
})

// GSI
table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
})

// Lambda avec accès à la table
const orderHandler = new lambda.Function(this, 'OrderHandler', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/orders')),
  environment: {
    TABLE_NAME: table.tableName,
  },
})

// CDK génère automatiquement la politique IAM minimale
table.grantReadWriteData(orderHandler)
```

> La méthode `table.grantReadWriteData(handler)` est la magie du CDK L2 : elle crée automatiquement la politique IAM avec le principe du moindre privilège.

### 7.3 SQS + SNS + Lambda (Fan-out)

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources'

// Topic SNS
const orderTopic = new sns.Topic(this, 'OrderTopic', {
  topicName: 'order-events',
})

// Queue SQS pour l'envoi d'emails
const emailQueue = new sqs.Queue(this, 'EmailQueue', {
  visibilityTimeout: cdk.Duration.seconds(60),
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'EmailDLQ'),
    maxReceiveCount: 3,
  },
})

// Queue SQS pour la mise à jour du stock
const stockQueue = new sqs.Queue(this, 'StockQueue', {
  visibilityTimeout: cdk.Duration.seconds(30),
})

// Abonner les queues au topic
orderTopic.addSubscription(new subscriptions.SqsSubscription(emailQueue))
orderTopic.addSubscription(new subscriptions.SqsSubscription(stockQueue))

// Lambda worker pour les emails
const emailWorker = new lambda.Function(this, 'EmailWorker', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/email')),
})

// Connecter la queue à la Lambda
emailWorker.addEventSource(new lambdaEvents.SqsEventSource(emailQueue, {
  batchSize: 10,
  reportBatchItemFailures: true,
}))
```

---

## 8. Aspects, Context et Parameters

### 8.1 Aspects

Les **Aspects** permettent d'appliquer des règles ou des modifications à **toutes les ressources** d'une stack. Cas d'usage typique : ajouter des tags, vérifier la conformité.

```typescript
import * as cdk from 'aws-cdk-lib'
import type { IConstruct } from 'constructs'

class TaggingAspect implements cdk.IAspect {
  visit(node: IConstruct): void {
    if (cdk.Tags.of(node)) {
      cdk.Tags.of(node).add('Environment', 'production')
      cdk.Tags.of(node).add('Team', 'backend')
      cdk.Tags.of(node).add('ManagedBy', 'CDK')
    }
  }
}

// Appliquer l'aspect à toute l'application
cdk.Aspects.of(app).add(new TaggingAspect())
```

### 8.2 Context

Le **context** permet de passer des valeurs de configuration au moment du déploiement :

```json
// cdk.json
{
  "context": {
    "environment": "production",
    "vpcId": "vpc-12345"
  }
}
```

```typescript
// Dans la stack
const environment = this.node.tryGetContext('environment') // 'production'
const vpcId = this.node.tryGetContext('vpcId')
```

```bash
# Ou via la ligne de commande
cdk deploy -c environment=staging -c vpcId=vpc-67890
```

### 8.3 Parameters (CloudFormation)

Bien que CDK supporte les `CfnParameter`, il est **déconseillé** de les utiliser. Préférez le context ou les variables d'environnement.

```typescript
// Déconseillé (mais possible)
const envParam = new cdk.CfnParameter(this, 'Environment', {
  type: 'String',
  default: 'dev',
  allowedValues: ['dev', 'staging', 'prod'],
})
```

---

## 9. Tester les Stacks CDK

### 9.1 Pourquoi tester l'infrastructure ?

- Vérifier que les bonnes ressources sont créées
- S'assurer que les politiques de sécurité sont respectées
- Détecter les régressions avant le déploiement
- Documenter le comportement attendu de l'infra

### 9.2 Types de tests

| Type | Description | Outil |
|---|---|---|
| **Snapshot** | Compare le template CFN généré à un snapshot | Jest |
| **Fine-grained assertions** | Vérifie des propriétés spécifiques de ressources | `aws-cdk-lib/assertions` |
| **Validation** | Vérifie que la stack se synthétise sans erreur | `cdk synth` |

### 9.3 Assertions (recommandé)

```typescript
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { MyInfraStack } from '../lib/my-infra-stack'

describe('MyInfraStack', () => {
  let template: Template

  beforeAll(() => {
    const app = new cdk.App()
    const stack = new MyInfraStack(app, 'TestStack')
    template = Template.fromStack(stack)
  })

  test('crée un bucket S3 avec versioning activé', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    })
  })

  test('crée exactement 2 fonctions Lambda', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2)
  })

  test('la Lambda a les bonnes variables d\'environnement', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          TABLE_NAME: Match.anyValue(),
          NODE_ENV: 'production',
        },
      },
    })
  })

  test('la table DynamoDB est en mode PAY_PER_REQUEST', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    })
  })

  test('le bucket S3 bloque l\'accès public', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })
})
```

### 9.4 Snapshot testing

```typescript
test('correspond au snapshot', () => {
  const app = new cdk.App()
  const stack = new MyInfraStack(app, 'TestStack')
  const template = Template.fromStack(stack)

  expect(template.toJSON()).toMatchSnapshot()
})
```

> **Attention** : Les snapshots sont fragiles. Préférez les assertions ciblées pour les propriétés critiques.

---

## 10. Bonnes pratiques

### 10.1 Structure de projet

```
my-infra/
├── bin/
│   └── app.ts                   ← Point d'entrée unique
├── lib/
│   ├── stacks/
│   │   ├── api-stack.ts         ← Stack API (Gateway + Lambda)
│   │   ├── database-stack.ts    ← Stack BDD (DynamoDB)
│   │   └── messaging-stack.ts   ← Stack Messaging (SQS, SNS)
│   └── constructs/
│       ├── secure-bucket.ts     ← Construct réutilisable
│       └── monitored-lambda.ts  ← Lambda avec alarmes CloudWatch
├── lambda/
│   ├── api/index.ts
│   └── workers/email.ts
├── test/
│   ├── api-stack.test.ts
│   └── database-stack.test.ts
└── cdk.json
```

### 10.2 Règles essentielles

1. **Une stack par domaine** : séparez API, database, messaging en stacks distinctes
2. **Utilisez les Constructs L2** : ils appliquent les bonnes pratiques de sécurité par défaut
3. **Utilisez `grant*()`** : `table.grantReadWriteData(lambda)` au lieu de politiques IAM manuelles
4. **Nommez les ressources avec parcimonie** : laissez CDK générer les noms pour éviter les conflits
5. **Testez vos stacks** : au minimum des assertions sur les propriétés de sécurité
6. **Utilisez `RemovalPolicy.RETAIN`** en production pour les données persistantes (DynamoDB, S3)
7. **Versionnez `cdk.json`** et le fichier `cdk.context.json` dans Git
8. **Pas de secrets en dur** : utilisez `cdk.SecretValue.secretsManager()` ou SSM Parameter Store

### 10.3 Anti-patterns à éviter

| Anti-pattern | Meilleure alternative |
|---|---|
| Noms de ressources en dur | Laisser CDK générer les noms |
| Politique IAM `Action: *` | Utiliser les méthodes `grant*()` |
| Une seule stack monolithique | Séparer par domaine |
| `CfnParameter` pour la config | Utiliser le context CDK |
| Secrets dans le code | `SecretValue.secretsManager()` |

---

## 11. SST — Le framework serverless moderne pour TypeScript

### Qu'est-ce que SST ?

**SST** (anciennement Serverless Stack) est un framework open source qui simplifie le developpement d'applications serverless sur AWS. Construit au-dessus du CDK, SST ajoute des fonctionnalites qui manquent cruellement en developpement : le rechargement en temps reel des fonctions Lambda, une gestion simplifiee des environnements, et des constructs de haut niveau pour les cas d'usage courants.

Site officiel : [sst.dev](https://sst.dev)

### Live Lambda Development

La fonctionnalite phare de SST est le **Live Lambda Development**. Au lieu de deployer votre code Lambda sur AWS a chaque modification, SST cree un tunnel entre votre machine locale et AWS. Quand une Lambda est invoquee, la requete est redirigee vers votre code local. Vous editez votre code, sauvegardez, et la prochaine invocation utilise immediatement le nouveau code — sans deploiement, sans attente.

```bash
# Lancer le mode dev
npx sst dev
```

```
SST v3.x
→ App:     my-app
→ Stage:   dev-sophie
→ Region:  eu-west-3

✓ Deployed:
  API: https://abc123.execute-api.eu-west-3.amazonaws.com

Live Lambda connected. Watching for changes...
```

Chaque developpeur travaille dans son propre **stage** (`dev-sophie`, `dev-marc`), isole des autres. Pas de conflits, pas d'environnements de dev partages. Chaque stage deploie sa propre stack AWS.

### Constructs SST de haut niveau

SST fournit des constructs specialises qui encapsulent les patterns courants avec des valeurs par defaut sensees :

```typescript
// sst.config.ts
export default $config({
  app(input) {
    return {
      name: 'my-app',
      region: 'eu-west-3',
    };
  },
  async run() {
    // API — cree API Gateway + Lambda + routes automatiquement
    const api = new sst.aws.ApiGatewayV2('Api');
    api.route('GET /users', 'packages/functions/src/users.list');
    api.route('POST /users', 'packages/functions/src/users.create');

    // Table DynamoDB
    const table = new sst.aws.Dynamo('Orders', {
      fields: { pk: 'string', sk: 'string' },
      primaryIndex: { hashKey: 'pk', rangeKey: 'sk' },
    });

    // Site statique (React, Vue, Next.js...)
    const site = new sst.aws.StaticSite('Web', {
      path: 'packages/web',
      buildCommand: 'npm run build',
      buildOutput: 'dist',
      environment: {
        VITE_API_URL: api.url,
      },
    });
  },
});
```

SST injecte automatiquement les URLs et ARN entre les ressources. Le site statique recoit l'URL de l'API en variable d'environnement au moment du build, sans configuration manuelle.

### Comparaison SST vs SAM vs CDK

| Critere | CDK pur | SAM | SST |
|---|---|---|---|
| **Langage** | TypeScript, Python, etc. | YAML + code Lambda | TypeScript |
| **Dev local** | Aucun (deploy a chaque changement) | `sam local invoke` (emulation) | Live Lambda (tunnel vers AWS reel) |
| **Abstraction** | Constructs L1/L2/L3 | Templates serverless | Constructs haut niveau + CDK |
| **Environnements** | Manuel (context CDK) | Parametre de stage | Un stage par dev automatique |
| **Frontend** | Non gere | Non gere | Constructs `StaticSite`, `NextjsSite` |
| **Courbe d'apprentissage** | Moyenne (CDK + CloudFormation) | Faible (YAML simple) | Faible (TypeScript + conventions) |
| **Flexibilite** | Totale | Limitee au serverless | Totale (acces a CDK sous le capot) |

**SAM** (Serverless Application Model) est l'outil officiel d'AWS pour le serverless. Il utilise des templates YAML etendus avec des raccourcis (`AWS::Serverless::Function`). Son emulateur local (`sam local`) est pratique mais lent et ne reproduit pas fidelement l'environnement AWS (permissions IAM, VPC, event sources).

**CDK pur** est le plus flexible mais le plus verbeux. Chaque changement de code Lambda necessite un `cdk deploy` (plusieurs minutes). Pas de boucle de feedback rapide pour le developpement.

**SST** combine le meilleur des deux : la flexibilite du CDK (vous pouvez utiliser n'importe quel construct CDK) avec une experience developpeur superieure (Live Lambda, stages automatiques, constructs simplifies).

### Quand utiliser SST

SST est particulierement adapte quand :

- Votre equipe travaille en **TypeScript** sur des applications **serverless**
- Vous voulez un cycle de developpement rapide (feedback en secondes, pas en minutes)
- Votre projet combine **backend serverless + frontend** (React, Vue, Next.js)
- Vous avez besoin d'**environnements isoles** par developpeur

SST n'est pas adapte si vous avez une infrastructure complexe non-serverless (clusters ECS, RDS avec replication complexe) ou si vous travaillez dans un langage autre que TypeScript. Dans ces cas, le CDK pur reste le meilleur choix.

```bash
# Creer un nouveau projet SST
npx create-sst@latest my-app
cd my-app
npx sst dev     # Mode developpement avec Live Lambda
npx sst deploy  # Deployer en production
npx sst remove  # Supprimer toutes les ressources
```

---

## 12. Récapitulatif

| Concept | Description |
|---|---|
| **CDK** | Framework IaC qui génère du CloudFormation à partir de TypeScript |
| **App** | Racine de l'arbre CDK, contient une ou plusieurs Stacks |
| **Stack** | Unité de déploiement, correspond à une stack CloudFormation |
| **Construct L1** | Mapping 1:1 avec CloudFormation (préfixe `Cfn`) |
| **Construct L2** | Abstraction haut niveau avec valeurs par défaut sensées |
| **Construct L3** | Pattern combinant plusieurs ressources |
| **`cdk synth`** | Génère le template CloudFormation |
| **`cdk diff`** | Compare le code local avec ce qui est déployé |
| **`cdk deploy`** | Déploie la stack sur AWS |
| **Aspects** | Applique des règles/modifications à toutes les ressources |
| **Context** | Valeurs de configuration passées au déploiement |
| **Assertions** | Tests unitaires sur le template CloudFormation généré |
| **`grant*()`** | Méthodes L2 pour accorder des permissions IAM minimales |
