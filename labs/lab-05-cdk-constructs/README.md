# Lab 05 — CDK : ta première stack déployée

> **Outcome :** à la fin, tu sais initialiser un projet CDK v2, bootstrapper ton compte, décrire une stack S3 en TypeScript, la déployer réellement sur AWS, lire un `cdk diff`, et **tout détruire** proprement.
> **Vrai outil :** AWS CDK v2 (`aws-cdk-lib`) + CDK Toolkit CLI (`cdk`) + un vrai compte AWS. Aucun harnais de test simulé.
> **Feedback :** le coach valide en session — on regarde ensemble la sortie de `cdk deploy`, le bucket dans la console, puis la stack disparue après `cdk destroy`.

> ⚠️ **Coût & sécurité AWS.** Ce lab crée un bucket S3 réel. Le Free Tier couvre largement l'usage, **mais** : (1) fais le `cdk bootstrap` une seule fois par compte+région, (2) **exécute `cdk destroy` à la fin de la séance** — c'est une étape du lab, pas une option. Vérifie ensuite dans la console S3 que le bucket a disparu.

---

## Énoncé

Tu construis la **première brique d'infra de TribuZen** : `StorageStack`, la stack qui décrit le bucket S3 des avatars de familles.

Cahier des charges **exact** du bucket :

1. **Versioning activé** (historique des avatars).
2. **Chiffrement au repos** géré par S3 (`S3_MANAGED`).
3. **Tout accès public bloqué** (`BLOCK_ALL`).
4. **`RemovalPolicy.DESTROY` + `autoDeleteObjects: true`** — pour que `cdk destroy` nettoie tout (apprentissage, pas prod).
5. Un **`CfnOutput`** qui affiche le nom généré du bucket après déploiement.

Puis tu dérouleras le cycle complet : `bootstrap → synth → diff → deploy → destroy`.

**Pas de gap-fill.** Tu pars d'un projet `cdk init` vierge et tu écris la stack toi-même.

### Point de départ

```bash
# CLI CDK en global (si pas déjà fait)
npm install -g aws-cdk
cdk --version            # doit afficher 2.x

# Nouveau projet
mkdir tribuzen-infra && cd tribuzen-infra
cdk init app --language typescript
```

`cdk init` génère `bin/tribuzen-infra.ts` et `lib/tribuzen-infra-stack.ts`. Tu vas remplacer le contenu de la stack et adapter le point d'entrée.

Prérequis : compte AWS + credentials configurés (module 00, `aws configure`), IAM (module 01) et S3 (module 04) déjà vus.

---

## Étapes (en friction)

1. **Bootstrap** ton compte+région une seule fois :
   ```bash
   cdk bootstrap
   ```
   (Le CDK déduit compte+région de tes credentials. Sinon : `cdk bootstrap aws://<account-id>/<region>`.)
2. **Renomme** la stack : crée `lib/storage-stack.ts` avec une classe `StorageStack extends cdk.Stack`.
3. **Décris le bucket** dans le constructeur : `s3.Bucket` L2 avec les 5 réglages du cahier des charges.
4. **Ajoute le `CfnOutput`** exposant `bucket.bucketName`.
5. **Branche la stack** dans `bin/tribuzen-infra.ts` : instancie `StorageStack` sur l'App.
6. **Synthétise** : `cdk synth` — lis le template CloudFormation généré (repère `AWS::S3::Bucket` et `PublicAccessBlockConfiguration`).
7. **Diff** : `cdk diff` — première fois, tout est en `[+]` (création).
8. **Déploie** : `cdk deploy` — confirme, attends la fin, note le `AvatarsBucketName` en sortie. Va voir le bucket dans la console S3.
9. **Fais une modif + relis le diff** : ajoute une `lifecycleRule` (expiration des versions non courantes à 30 jours), refais `cdk diff` — observe le `[~]` (modification, pas recréation).
10. **DÉTRUIS TOUT** : `cdk destroy` — confirme. Vérifie dans la console que le bucket a disparu.

---

## Corrigé complet commenté

**`lib/storage-stack.ts`**

```ts
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'

// Une Stack = une unité de déploiement = une stack CloudFormation
export class StorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // s3.Bucket = construct L2 : défauts sûrs + méthodes utilitaires.
    // (scope=this, id='AvatarsBucket', props={...})
    const avatars = new s3.Bucket(this, 'AvatarsBucket', {
      versioned: true,                                    // (1) historique des versions
      encryption: s3.BucketEncryption.S3_MANAGED,         // (2) chiffrement au repos géré par S3
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,  // (3) aucun accès public — la case jamais oubliée
      removalPolicy: cdk.RemovalPolicy.DESTROY,           // (4a) dev : le bucket part au cdk destroy
      autoDeleteObjects: true,                            // (4b) vide le bucket avant suppression (sinon destroy échoue)
    })

    // (5) Expose le nom PHYSIQUE auto-généré (l'id 'AvatarsBucket' n'est PAS ce nom)
    new cdk.CfnOutput(this, 'AvatarsBucketName', {
      value: avatars.bucketName,
      description: 'Nom du bucket des avatars TribuZen',
    })
  }
}
```

**`bin/tribuzen-infra.ts`**

```ts
import * as cdk from 'aws-cdk-lib'
import { StorageStack } from '../lib/storage-stack'

// App = racine de l'arbre de constructs
const app = new cdk.App()

// Instancie la stack sur l'App. env laissé implicite = compte+région des credentials.
new StorageStack(app, 'TribuzenStorageStack')
```

**Étape 9 — la lifecycle rule à ajouter dans les props du bucket :**

```ts
lifecycleRules: [
  { noncurrentVersionExpiration: cdk.Duration.days(30) }, // supprime les vieilles versions après 30 j
],
```

**Sortie attendue du `cdk diff` de l'étape 9 :**

```
Stack TribuzenStorageStack
Resources
[~] AWS::S3::Bucket AvatarsBucket AvatarsBucket8B4E...
 └── [+] LifecycleConfiguration
     └── Rules: [ { NoncurrentVersionExpiration: { NoncurrentDays: 30 } } ]
```

`[~]` = la ressource est **modifiée en place**, pas détruite/recréée : les avatars déjà stockés survivent. C'est exactement la garantie que le ClickOps ne donne jamais.

**Pourquoi ce corrigé est correct :**
- On reste en **L2** (`s3.Bucket`, pas `CfnBucket`) : sécurité par défaut, code court.
- `removalPolicy: DESTROY` **et** `autoDeleteObjects: true` vont ensemble — l'un sans l'autre laisse le `cdk destroy` bloqué sur un bucket non vide.
- L'`id` `'AvatarsBucket'` génère l'ID logique CloudFormation ; le nom réel du bucket est auto-généré et affiché par le `CfnOutput`.
- On lit toujours `cdk diff` avant `cdk deploy`, et on termine par `cdk destroy`.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 05, en 30 minutes :**

1. Repars d'un `cdk init` vierge et recrée la `StorageStack` **de mémoire**.
2. Ajoute une **seconde stack** `LogsStack` dans le même projet, avec un bucket de logs (versioning **désactivé**, `RemovalPolicy.DESTROY`, `autoDeleteObjects: true`). Instancie les **deux** stacks dans `bin/`.
3. Utilise `cdk ls` pour lister les deux stacks, puis `cdk deploy --all` pour tout déployer d'un coup.
4. **Critère de réussite :** les deux buckets existent dans la console, puis `cdk destroy --all` les fait disparaître tous les deux. Vérification console obligatoire.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen-infra`, `StorageStack` vit ici :

```
tribuzen-infra/
  bin/tribuzen-infra.ts        ← App : instancie StorageStack (+ stacks futures)
  lib/
    storage-stack.ts           ← CE LAB : bucket avatars S3
    api-stack.ts               ← plus tard : Lambda + API Gateway (modules 06-07)
    data-stack.ts              ← plus tard : DynamoDB (module 09)
```

**Différences par rapport au lab :**

- En vrai produit, `removalPolicy` sera **`RETAIN`** sur le bucket avatars (données réelles à ne jamais perdre) — le `DESTROY` du lab est uniquement pour ne rien laisser payer en apprentissage.
- Le bucket sera relié à la future Lambda d'upload via `avatars.grantReadWrite(uploaderRole)` (aperçu du module 06) — aucune policy IAM écrite à la main.
- La région et le compte viendront d'un `env` explicite par environnement (dev/staging/prod), pas des credentials implicites.

**Commit cible :**
```
feat(infra): StorageStack CDK — bucket avatars S3 versionné, chiffré, accès public bloqué
```
