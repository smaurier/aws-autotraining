---
titre: CDK — Infrastructure as Code en TypeScript
cours: 12-aws-cloud
notions: [Infrastructure as Code, ClickOps, AWS CDK v2, "paquet unique aws-cdk-lib", "constructs L1 (Cfn)", "constructs L2 (curated)", "constructs L3 (patterns)", "App / Stack / Construct", "scope / id / props", CloudFormation synthétisé, "cdk init", "cdk bootstrap", "cdk synth", "cdk diff", "cdk deploy", "cdk destroy", RemovalPolicy, "grant*() IAM"]
outcomes:
  - sait expliquer pourquoi l'IaC remplace le ClickOps et ce que CDK génère sous le capot
  - sait distinguer un construct L1, L2 et L3 et choisir le bon niveau
  - sait structurer une App / Stack / Construct et déployer un bucket S3 versionné avec cdk deploy
  - connaît le cycle cdk init / bootstrap / synth / diff / deploy / destroy et sait détruire ses ressources
prerequis: [modules 00-04 du cours 12-aws-cloud — compte AWS et CLI configurés (module 00), IAM users/roles/policies et moindre privilège (module 01), S3 buckets/versioning/blocage accès public (module 04), TypeScript fondamentaux]
next: 06-lambda-serverless
libs: [{ name: aws-cdk-lib, version: "2" }]
tribuzen: infrastructure cloud de TribuZen décrite en CDK — première stack versionnée (bucket S3 des avatars) qui servira de socle aux stacks Lambda/API/DynamoDB des modules suivants
last-reviewed: 2026-07
---

# CDK — Infrastructure as Code en TypeScript

> **Outcomes — tu sauras FAIRE :** expliquer l'IaC vs le ClickOps, distinguer les constructs L1/L2/L3, structurer une App/Stack/Construct, et dérouler le cycle `cdk init → bootstrap → synth → diff → deploy → destroy`.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre les **fondamentaux CDK** en déployant des ressources déjà vues (un bucket S3 du module 04, un rôle IAM du module 01). Lambda, API Gateway, DynamoDB, SQS/SNS arrivent aux **modules 06+** : ici on apprend l'outil, pas de nouveaux services. Les tests de stack (`aws-cdk-lib/assertions`), les Aspects et les frameworks au-dessus du CDK (SST) sont hors périmètre.

## 1. Cas concret d'abord

Tu as créé pour TribuZen, à la main dans la console AWS, le bucket S3 qui stocke les avatars des familles : versioning activé, accès public bloqué, chiffrement `S3_MANAGED`. Ça marche. Puis on te demande **le même bucket en environnement de staging**, dans une autre région.

Tu rouvres la console. Tu cliques. Tu oublies de cocher « Block all public access ». Trois semaines plus tard, un avatar fuite publiquement. Personne ne peut dire **quand** ni **pourquoi** la case a changé : aucun historique, aucune revue, aucun moyen de recréer à l'identique.

C'est le problème du **ClickOps** (piloter l'infra à la souris) :

- **Non reproductible** : impossible de recréer exactement le même environnement.
- **Non versionné** : pas d'historique Git, pas de code review sur un changement d'infra.
- **Sujet aux erreurs** : une case oubliée = une faille en prod.
- **Non testable** : rien ne valide la config avant qu'elle soit en ligne.

Ce que tu veux à la place : **décrire** le bucket une fois, en TypeScript, versionné dans Git, et le déployer à l'identique en dev, staging et prod. C'est l'**Infrastructure as Code (IaC)**, et l'outil AWS pour le faire en TypeScript est le **CDK**. À la fin de ce module, le bucket avatars de TribuZen sera dans `lib/storage-stack.ts`, revu en pull request, déployable en une commande — et **détruisible** en une autre.

---

## 2. Théorie complète, concise

### 2.1 IaC : décrire l'infra, ne pas la cliquer

L'IaC consiste à écrire la définition de l'infrastructure dans des fichiers versionnés, puis à laisser un outil créer/mettre à jour les ressources pour qu'elles correspondent au code. Le code **est** la source de vérité et la documentation.

| ClickOps (console) | IaC (CDK) |
|---|---|
| Reproductibilité manuelle, faillible | Même code = même infra, à chaque fois |
| Pas d'historique | Historique Git + code review |
| Config invisible | Le code décrit l'état attendu |
| Un clic casse la prod | Un `cdk diff` montre le changement avant `deploy` |

### 2.2 Ce qu'est le CDK v2 (et ce qu'il génère)

L'**AWS Cloud Development Kit (CDK)** est un framework IaC : tu écris ton infra dans un vrai langage (ici TypeScript), le CDK la **synthétise** en un template **CloudFormation** (JSON/YAML), et c'est CloudFormation qui provisionne réellement les ressources AWS et gère leur état.

```
Ton code TypeScript  →  cdk synth  →  template CloudFormation  →  déploiement AWS
```

Tu gardes donc la fiabilité de CloudFormation (état géré côté AWS, rollback automatique) avec la puissance d'un langage (variables, boucles, fonctions, types, autocomplétion IDE).

> **CDK v2 = un seul paquet npm.** Toute la bibliothèque de constructs stables tient dans **`aws-cdk-lib`** (+ le paquet `constructs` pour la classe de base). En CDK **v1**, il fallait installer des dizaines de paquets `@aws-cdk/aws-s3`, `@aws-cdk/aws-lambda`, etc. — **v1 est en fin de support, ne l'utilise pas.** En v2 on importe des sous-chemins du paquet unique : `import * as s3 from 'aws-cdk-lib/aws-s3'`.

La CLI `aws-cdk` (aussi appelée CDK Toolkit) est un paquet séparé, installé globalement, qui pilote `init`, `synth`, `deploy`, etc.

### 2.3 La hiérarchie : App → Stack → Construct

Un projet CDK est un **arbre de constructs**. Un *construct* est un composant qui représente une ou plusieurs ressources AWS.

- **App** (`cdk.App`) — la racine de l'arbre. Un projet CDK = une App.
- **Stack** (`cdk.Stack`) — une unité de déploiement. Chaque Stack devient **une** stack CloudFormation. On regroupe par domaine (une stack stockage, une stack API…).
- **Construct** — tout le reste : un bucket, un rôle, ou un composant réutilisable que tu écris toi-même.

```
App (cdk.App)
 └── StorageStack (cdk.Stack)   → 1 stack CloudFormation
      ├── Bucket  (s3.Bucket)   → AWS::S3::Bucket
      └── Role    (iam.Role)    → AWS::IAM::Role
```

Tout construct s'instancie avec **trois arguments** :

```ts
new s3.Bucket(this, 'AvatarsBucket', { versioned: true })
//            ↑scope  ↑id            ↑props
```

- **scope** : le parent dans l'arbre — presque toujours `this` (la Stack courante).
- **id** : un identifiant **unique dans ce scope** ; il sert à générer l'ID logique CloudFormation. Ce n'est **pas** le nom physique de la ressource.
- **props** : la configuration. Si toutes les props sont optionnelles, l'argument peut être omis.

### 2.4 Les trois niveaux de constructs (L1 / L2 / L3)

C'est le concept central du CDK : plus le niveau est haut, plus c'est abstrait et rapide à écrire ; plus il est bas, plus tu contrôles.

| Niveau | Nom officiel | Ce que c'est | Exemple |
|---|---|---|---|
| **L1** | *CFN resources* | Mapping **1:1** avec une ressource CloudFormation, aucune abstraction. Préfixe `Cfn`. Toutes les props sont obligatoires comme dans CFN. | `s3.CfnBucket` |
| **L2** | *curated constructs* | Abstraction intent-based, **valeurs par défaut sûres**, sécurité par défaut, méthodes utilitaires (`grant*()`, `addEventNotification`…). Le niveau le plus utilisé. | `s3.Bucket` |
| **L3** | *patterns* | Combinent **plusieurs ressources** configurées pour un cas d'usage complet. | `aws_ecs_patterns.ApplicationLoadBalancedFargateService` |

```ts
// L1 — verbeux, contrôle total, aucune valeur par défaut
new s3.CfnBucket(this, 'Raw', {
  versioningConfiguration: { status: 'Enabled' },
})

// L2 — intent-based, défauts sûrs, méthodes utilitaires (à privilégier)
new s3.Bucket(this, 'Avatars', {
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
})
```

> **Règle :** utilise **L2 par défaut**. Descends en L1 seulement si une propriété n'est pas exposée par le L2. Monte en L3 quand un pattern tout fait couvre exactement ton besoin.

### 2.5 `grant*()` — les permissions IAM sans écrire de policy

La magie des L2 : au lieu d'écrire une policy IAM à la main (module 01), tu appelles une méthode `grant*()` et le CDK génère la policy **au moindre privilège**.

```ts
const bucket = new s3.Bucket(this, 'Avatars')
const role = new iam.Role(this, 'UploaderRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
})

bucket.grantReadWrite(role) // ← CDK écrit la policy IAM exacte (s3:GetObject, s3:PutObject…)
```

### 2.6 `RemovalPolicy` — que devient la ressource au `destroy`

Par défaut, certaines ressources porteuses de données (bucket, table) sont **conservées** (`RETAIN`) quand on détruit la stack, pour éviter une perte accidentelle. En dev/apprentissage on veut l'inverse — que tout parte au `cdk destroy` :

```ts
new s3.Bucket(this, 'Avatars', {
  removalPolicy: cdk.RemovalPolicy.DESTROY, // supprime le bucket au cdk destroy
  autoDeleteObjects: true,                  // vide le bucket d'abord (sinon destroy échoue)
})
```

> En **prod**, garde `RemovalPolicy.RETAIN` sur les données. En **apprentissage**, mets `DESTROY` + `autoDeleteObjects: true` pour ne rien laisser traîner (et ne rien payer).

### 2.7 Le cycle CLI : init → bootstrap → synth → diff → deploy → destroy

| Commande | Rôle |
|---|---|
| `cdk init app --language typescript` | Crée un projet CDK depuis un template |
| `cdk bootstrap` | Prépare le compte/région : déploie la stack **`CDKToolkit`** (bucket d'assets + rôles). **Une fois par compte+région.** |
| `cdk synth` | Synthétise le template CloudFormation (sans déployer) |
| `cdk diff` | Compare le code au déployé : `[+]` ajout, `[-]` suppression, `[~]` modif |
| `cdk deploy` | Déploie / met à jour la ou les stacks sur AWS |
| `cdk destroy` | **Supprime** la ou les stacks et leurs ressources |
| `cdk ls` | Liste les stacks de l'App |

> **`cdk bootstrap` est un prérequis unique.** Sans lui, le premier `cdk deploy` échoue : le CDK a besoin d'un bucket S3 (pour uploader les assets) et de rôles IAM, regroupés dans la stack `CDKToolkit`. Tu ne le lances qu'**une fois par couple compte+région**, pas à chaque déploiement.

### 2.8 Anatomie d'un projet `cdk init`

```
my-infra/
├── bin/my-infra.ts        ← point d'entrée : instancie l'App et les Stacks
├── lib/my-infra-stack.ts  ← définition de la Stack (tes ressources)
├── cdk.json               ← config CDK (commande de run, feature flags)
├── package.json           ← dépend de aws-cdk-lib et constructs
└── tsconfig.json
```

---

## 3. Worked examples

### Exemple 1 — La stack stockage de TribuZen (bucket avatars), de zéro au déploiement

**But :** décrire en CDK le bucket S3 des avatars du cas concret, puis le déployer et le détruire.

```bash
# 1. CLI CDK en global + nouveau projet
npm install -g aws-cdk
mkdir tribuzen-infra && cd tribuzen-infra
cdk init app --language typescript

# 2. Bootstrap du compte+région (UNE seule fois par compte+région)
cdk bootstrap aws://123456789012/eu-west-3
```

Le point d'entrée `bin/tribuzen-infra.ts` instancie l'App et la Stack :

```ts
// bin/tribuzen-infra.ts
import * as cdk from 'aws-cdk-lib'
import { StorageStack } from '../lib/storage-stack'

const app = new cdk.App()

new StorageStack(app, 'TribuzenStorageStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT, // injecté par la CLI
    region: 'eu-west-3',                       // Paris
  },
})
```

La Stack décrit le bucket avec les mêmes réglages que le module 04 :

```ts
// lib/storage-stack.ts
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'

export class StorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // L2 s3.Bucket : sécurité par défaut + réglages explicites
    const avatars = new s3.Bucket(this, 'AvatarsBucket', {
      versioned: true,                                  // module 04 : versioning
      encryption: s3.BucketEncryption.S3_MANAGED,       // chiffrement au repos
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // la case jamais oubliée
      removalPolicy: cdk.RemovalPolicy.DESTROY,         // dev : part au destroy
      autoDeleteObjects: true,                          // vide le bucket avant suppression
    })

    // Exporte le nom généré pour le lire après déploiement
    new cdk.CfnOutput(this, 'AvatarsBucketName', {
      value: avatars.bucketName,
      description: 'Nom du bucket des avatars TribuZen',
    })
  }
}
```

Déploiement et vérification :

```bash
cdk synth                 # affiche le CloudFormation généré — rien n'est déployé
cdk diff                  # première fois : tout en [+] (création)
cdk deploy                # crée réellement le bucket ; affiche AvatarsBucketName en sortie

# ... quand tu as fini, NE LAISSE RIEN TRAÎNER :
cdk destroy               # supprime la stack et le bucket (autoDeleteObjects le vide d'abord)
```

**Ce qui vient d'être exercé :** App → Stack → construct L2, les trois arguments `(scope, id, props)`, `RemovalPolicy.DESTROY`, `CfnOutput`, et le cycle complet `bootstrap → synth → diff → deploy → destroy`.

### Exemple 2 — Lire un `cdk diff` avant de casser la prod

Tu ajoutes une règle de cycle de vie au bucket existant. Avant de déployer, `cdk diff` montre **exactement** l'impact :

```ts
const avatars = new s3.Bucket(this, 'AvatarsBucket', {
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  lifecycleRules: [
    { // supprime les anciennes versions après 30 jours
      noncurrentVersionExpiration: cdk.Duration.days(30),
    },
  ],
})
```

```
$ cdk diff
Stack TribuzenStorageStack
Resources
[~] AWS::S3::Bucket AvatarsBucket AvatarsBucket8B4E...
 └── [+] LifecycleConfiguration
     └── Rules: [ { NoncurrentVersionExpiration: { NoncurrentDays: 30 } } ]
```

- `[~]` : la ressource est **modifiée** (pas recréée).
- `[+]` sous la ressource : une propriété est **ajoutée**.

Tu vois que le bucket n'est pas détruit/recréé (ce qui perdrait les avatars) avant de taper `cdk deploy`. C'est la revue d'infra que le ClickOps ne permet jamais.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que CDK v2 s'installe comme v1 (paquets `@aws-cdk/*`)

```ts
// ❌ CDK v1 — dépréciée, fin de support. Ne l'utilise pas.
import * as s3 from '@aws-cdk/aws-s3'
import * as cdk from '@aws-cdk/core'

// ✅ CDK v2 — un seul paquet, sous-chemins
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
```

Un tuto qui te fait `npm install @aws-cdk/aws-s3` est du **v1 périmé**. En v2, `aws-cdk-lib` + `constructs` suffisent.

### PIÈGE #2 — Confondre l'`id` du construct et le nom physique de la ressource

```ts
new s3.Bucket(this, 'AvatarsBucket') // 'AvatarsBucket' = id CDK, PAS le nom du bucket
```

L'`id` sert à générer l'**ID logique CloudFormation**. Le nom réel du bucket est **auto-généré** (`tribuzenstorage-avatarsbucket8b4e...`). C'est voulu : laisser CDK nommer évite les collisions et les conflits entre environnements. Ne mets un `bucketName` explicite que si c'est indispensable.

### PIÈGE #3 — Oublier `cdk bootstrap` et lire l'erreur de travers

Au premier `cdk deploy` sur un compte+région neuf sans bootstrap, tu obtiens une erreur du type « *This stack uses assets, so the toolkit stack must be deployed… Run `cdk bootstrap`* ». Ce n'est **pas** un bug de ton code : c'est le bucket d'assets `CDKToolkit` qui manque. `cdk bootstrap aws://<account>/<region>` une fois, puis redeploie.

### PIÈGE #4 — `cdk synth` / `cdk diff` ne déploient rien (et c'est le but)

`synth` génère le template, `diff` le compare au déployé. **Aucun** des deux ne touche à AWS. Beaucoup de débutants croient avoir « déployé » après un `synth` réussi. Seul **`cdk deploy`** provisionne réellement. À l'inverse, ne jamais `deploy` sans avoir lu le `diff`.

### PIÈGE #5 — Détruire une stack avec un bucket non vide

```ts
// ❌ removalPolicy DESTROY seul : le cdk destroy ÉCHOUE si le bucket contient des objets
new s3.Bucket(this, 'Avatars', { removalPolicy: cdk.RemovalPolicy.DESTROY })

// ✅ ajoute autoDeleteObjects pour vider le bucket avant suppression
new s3.Bucket(this, 'Avatars', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
})
```

CloudFormation refuse de supprimer un bucket non vide. `autoDeleteObjects: true` ajoute une Lambda custom qui le vide d'abord. Sans les deux, ton `cdk destroy` reste bloqué et **tu continues à payer** le stockage.

### PIÈGE #6 — Descendre en L1 « pour comprendre » alors que le L2 suffit

Le L1 (`CfnBucket`) n'a **aucune** valeur par défaut de sécurité : oublier `blockPublicAccess` en L1 laisse le bucket exposable. Le L2 (`Bucket`) applique les bonnes pratiques par défaut. Reste en **L2** sauf propriété manquante réelle.

---

## 5. Ancrage TribuZen

Le CDK est le **socle infra** de tout le backend TribuZen des modules 06+. Ce module pose la **première stack** ; les suivantes viendront s'y greffer.

**`StorageStack` (ce module)** — le bucket S3 des avatars de familles (Exemple 1). C'est la brique la plus simple à décrire, donc le point d'entrée idéal pour apprendre CDK avant d'y ajouter du compute.

**Ce qui s'y ajoutera ensuite (aperçu, pas ce module) :**

```
tribuzen-infra/
  bin/tribuzen-infra.ts        ← App : instancie toutes les stacks
  lib/
    storage-stack.ts           ← CE MODULE : bucket avatars S3
    api-stack.ts               ← module 06-07 : Lambda + API Gateway
    data-stack.ts              ← module 09 : table DynamoDB (feed)
    auth-stack.ts              ← module 11 : Cognito User Pool
```

Chaque service TribuZen étudié plus loin deviendra un construct dans une stack CDK, revu en pull request sur `smaurier/tribuzen-infra`. Le `bucket.grantReadWrite(lambdaRole)` de ce module est exactement ce qui reliera la future Lambda d'upload d'avatar au bucket, **sans policy IAM écrite à la main**.

---

## 6. Points clés

1. L'IaC remplace le ClickOps : infra décrite en code versionné, reproductible, revue en PR, détruisible en une commande.
2. Le CDK écrit ton infra en TypeScript, la **synthétise en CloudFormation**, et c'est CloudFormation qui provisionne et gère l'état.
3. CDK v2 = **un seul paquet `aws-cdk-lib`** (+ `constructs`) ; les paquets `@aws-cdk/*` sont du v1 périmé.
4. Hiérarchie **App → Stack → Construct** ; chaque Stack = une stack CloudFormation ; chaque construct s'instancie avec `(scope, id, props)`.
5. **L1** = mapping 1:1 CFN (`Cfn…`, aucun défaut) ; **L2** = curated, défauts sûrs + `grant*()` (à privilégier) ; **L3** = patterns multi-ressources.
6. `grant*()` (L2) génère la policy IAM au moindre privilège sans l'écrire à la main.
7. Cycle : `cdk init → bootstrap (1×/compte+région) → synth → diff → deploy → destroy`. Toujours lire `diff` avant `deploy`.
8. Pour ne rien laisser payer : `removalPolicy: DESTROY` + `autoDeleteObjects: true`, puis **`cdk destroy`** en fin de séance.

---

## 7. Seeds Anki

```
Qu'est-ce que le ClickOps et pourquoi le CDK le remplace ?|ClickOps = piloter l'infra à la souris dans la console : non reproductible, non versionné, faillible, non testable. Le CDK décrit l'infra en code TypeScript versionné, reproductible et revu en PR.
Que génère le CDK sous le capot et qui provisionne réellement les ressources ?|cdk synth transforme le code TypeScript en template CloudFormation. C'est CloudFormation qui provisionne les ressources et gère leur état (rollback, drift). Le CDK ne parle pas directement aux services AWS.
En CDK v2, combien de paquets npm pour toute la bibliothèque de constructs stables ?|Un seul : aws-cdk-lib (+ le paquet constructs pour la classe de base). Les paquets @aws-cdk/aws-* sont du CDK v1 déprécié. On importe des sous-chemins : aws-cdk-lib/aws-s3.
Quelle est la différence entre un construct L1, L2 et L3 ?|L1 (Cfn…) = mapping 1:1 avec une ressource CloudFormation, aucun défaut. L2 (curated) = abstraction intent-based, valeurs par défaut sûres, méthodes grant*(). L3 (patterns) = plusieurs ressources combinées pour un cas d'usage complet. On privilégie L2.
Quels sont les trois arguments d'un construct et à quoi sert l'id ?|(scope, id, props). scope = parent dans l'arbre (souvent this). id = identifiant unique dans le scope, sert à générer l'ID logique CloudFormation — ce n'est PAS le nom physique de la ressource (auto-généré). props = configuration.
À quoi sert cdk bootstrap et à quelle fréquence le lancer ?|Il déploie la stack CDKToolkit (bucket d'assets S3 + rôles IAM) nécessaire au déploiement. Une seule fois par couple compte+région. Sans lui, le premier cdk deploy échoue avec une erreur sur les assets.
Différence entre cdk synth, cdk diff et cdk deploy ?|synth génère le template CloudFormation sans rien déployer. diff compare le code au déployé ([+]/[-]/[~]) sans rien déployer. Seul deploy provisionne réellement sur AWS. Toujours lire diff avant deploy.
Comment garantir qu'un cdk destroy supprime bien un bucket S3 sans échouer ni laisser de coûts ?|removalPolicy: RemovalPolicy.DESTROY (sinon RETAIN par défaut) + autoDeleteObjects: true pour vider le bucket avant suppression, puis cdk destroy. Sans autoDeleteObjects, CloudFormation refuse de supprimer un bucket non vide.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-05-cdk-constructs/README.md`. Tu initialises un vrai projet CDK, tu bootstrap, tu déploies la `StorageStack` de TribuZen sur ton compte AWS, tu lis un `cdk diff`, puis tu **détruis** tout avec `cdk destroy` — vrai outil, zéro harnais simulé.
