# Lab 17 — CI/CD vers AWS : `cdk deploy` depuis GitHub Actions en OIDC (zéro clé)

> **Outcome :** à la fin, tu as un vrai workflow GitHub Actions qui **s'authentifie auprès d'AWS via OIDC** (rôle assumé, jeton temporaire) et lance `cdk deploy` sur ton compte — **sans aucune clé IAM long terme** stockée dans GitHub.
> **Vrai outil :** un vrai repo GitHub + GitHub Actions + un vrai compte AWS + AWS CDK. Aucun harnais simulé, aucun mock : tu regardes un run réel assumer le rôle et déployer une stack.
> **Feedback :** le coach valide en session — il lit les logs du run GitHub Actions (`sts get-caller-identity` = un rôle assumé, pas un user) et vérifie qu'aucune access key n'existe. Pas de test-runner auto-correcteur.

> ⚠️ **Coût AWS.** Ce lab reste dans le **Free Tier** si tu déploies une stack minimale (un bucket S3 vide ou une Lambda « hello ») et si tu **détruis tout à la fin** (section *Teardown obligatoire*, non optionnelle). Le fournisseur OIDC et le rôle IAM sont **gratuits** ; le seul risque de coût vient des ressources que tu déploies. Ne laisse rien tourner après le lab.

---

## Énoncé

Tu pars d'un repo d'infra CDK (celui du module 05, ou un repo neuf). Aujourd'hui tu déploies **depuis ton poste** avec tes credentials perso. Objectif : à chaque `push` sur `main`, **GitHub Actions déploie à ta place**, en s'authentifiant auprès d'AWS **sans clé stockée**.

Cahier des charges **exact** :

1. Créer côté AWS un **fournisseur d'identité OIDC** GitHub (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`).
2. Créer un **rôle IAM** assumable par ce fournisseur, dont la **trust policy** restreint le `sub` à **ton repo ET la branche `main`** (pas de `*`).
3. Écrire `.github/workflows/deploy.yml` qui :
   - déclare `permissions: id-token: write`,
   - assume le rôle via `aws-actions/configure-aws-credentials` (**sans** `aws-access-key-id`),
   - lance `npx cdk deploy` sur une stack minimale.
4. Pousser sur `main`, ouvrir l'onglet **Actions**, et **vérifier dans les logs** que l'identité utilisée est bien `assumed-role/...` et **pas** `user/...`.
5. **Détruire** ensuite la stack, le rôle et le fournisseur OIDC (teardown).

**Critère de réussite (ce que le coach regarde) :**
- Le run GitHub Actions est **vert** et a réellement déployé sur AWS.
- Dans les secrets du repo GitHub : **aucun** `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
- Le rôle a une trust policy avec une condition `sub` **restreinte au repo + ref** (pas de `*`, pas de `repo:...:*`).
- Le rôle **n'a pas** `AdministratorAccess` collé « pour que ça marche ».

> **Stack à déployer.** Prends la plus petite possible. Si tu n'as pas de repo CDK sous la main, un `new s3.Bucket(this, 'LabBucket')` (bucket vide, Free Tier) suffit. Le sujet du lab est **le pipeline et l'auth**, pas la stack.

---

## Prérequis

- Un compte AWS avec ton CDK **bootstrapé** dans la région cible (`npx cdk bootstrap`, fait au module 05).
- AWS CLI configuré en local (pour créer/vérifier/détruire les ressources IAM).
- Un repo GitHub **à toi** (public ou privé), avec un projet CDK qui `cdk deploy` déjà en local.
- Node + CDK installés (`npx cdk --version`).

Note ton **Account ID** (12 chiffres), ta **région** (ex. `eu-west-3`) et ton **`org/repo`** GitHub : tu en as besoin partout ci-dessous.

---

## Étapes (en friction)

Tu produis à chaque étape — pas de gap-fill, pas de copier-coller aveugle du corrigé avant d'avoir essayé.

1. **Crée le fournisseur OIDC** sur ton compte. Deux voies au choix (fais-en **une**) :
   - en **CDK** (recommandé — l'infra de CI est aussi de l'IaC) : une `CiStack` avec `OpenIdConnectProvider` + `Role`,
   - ou en **AWS CLI** pour comprendre les primitives (voir corrigé, bloc CLI).
2. **Écris la trust policy du rôle** : `Action: sts:AssumeRoleWithWebIdentity`, condition `aud = sts.amazonaws.com` **et** `sub = repo:<org>/<repo>:ref:refs/heads/main`. Résiste à la tentation du `*`.
3. **Donne au rôle une policy de permissions** au moindre privilège : de quoi faire un déploiement CDK (CloudFormation + assumer les rôles de bootstrap `cdk-*`) + la ressource que tu déploies. **Pas** `AdministratorAccess`.
4. **Écris `.github/workflows/deploy.yml`** : `on: push branches [main]`, bloc `permissions` avec `id-token: write` + `contents: read`, l'étape `configure-aws-credentials` avec `role-to-assume`, puis `npm ci` + `npx cdk deploy --require-approval never`.
5. **Pousse sur `main`.** Va dans **Actions**, ouvre le run.
6. **Vérifie l'identité assumée.** Ajoute (ou lis) une étape qui affiche `aws sts get-caller-identity`. Tu dois voir `assumed-role/<TonRole>/<session>`. Si tu vois `user/...` → des clés traînent, supprime-les.
7. **Provoque une erreur exprès** (facultatif mais instructif) : retire `id-token: write` et repousse. Observe l'échec *« Unable to get OIDC token »*. Remets-le.
8. **Teardown** (section dédiée plus bas) : `cdk destroy` + suppression du rôle et du provider. Non optionnel.

---

## Corrigé complet commenté

### 1. Le fournisseur OIDC + le rôle — en CDK (voie recommandée)

```ts
// lib/ci-stack.ts — l'infra de CI est de l'IaC, comme le reste
import { Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'

export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    // (a) Le fournisseur d'identité OIDC GitHub — UNE FOIS par compte.
    //     Depuis 2023, AWS gère lui-même la chaîne de confiance TLS de GitHub :
    //     plus besoin de renseigner un "thumbprint" à la main.
    const ghProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'], // = l'audience (aud) attendue
    })

    // (b) Le rôle que le workflow assumera.
    //     OpenIdConnectPrincipal = principal fédéré + conditions sur le jeton.
    //     La condition sub est LE verrou : repo précis + branche précise.
    const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: 'GitHubActionsDeployRole',
      assumedBy: new iam.OpenIdConnectPrincipal(ghProvider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          // ⚠️ remplace org/repo par le TIEN. Restreint à la branche main.
          'token.actions.githubusercontent.com:sub':
            'repo:smaurier/tribuzen-infra:ref:refs/heads/main',
        },
      }),
    })

    // (c) Permissions au MOINDRE PRIVILÈGE (pas AdministratorAccess).
    //     Pour un cdk deploy, le rôle doit pouvoir assumer les rôles de
    //     bootstrap CDK (cdk-<qualifier>-deploy-role-*, file-publishing-role-*, etc.),
    //     qui portent eux-mêmes les vraies permissions. C'est le pattern CDK moderne.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-deploy-role-${this.account}-${this.region}`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-file-publishing-role-${this.account}-${this.region}`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-lookup-role-${this.account}-${this.region}`,
        ],
      }),
    )
    // hnb659fds = qualifier CDK par défaut. Adapte si tu as bootstrapé avec un autre.
  }
}
```

Déploie **cette** stack de CI une fois, en local, avec tes credentials perso :

```bash
npx cdk deploy CiStack
# Récupère l'ARN du rôle affiché (ou via la console IAM) :
# arn:aws:iam::123456789012:role/GitHubActionsDeployRole
```

### 1-bis. La même chose en AWS CLI (pour voir les primitives)

Si tu préfères comprendre les objets bruts avant de les abstraire en CDK :

```bash
# (a) Créer le fournisseur OIDC. Plus de --thumbprint-list requis pour ce provider.
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com

# (b) Fichier trust-policy.json — remplace ACCOUNT_ID et org/repo
cat > trust-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:smaurier/tribuzen-infra:ref:refs/heads/main"
      }
    }
  }]
}
JSON

aws iam create-role \
  --role-name GitHubActionsDeployRole \
  --assume-role-policy-document file://trust-policy.json
# Puis attache une policy de permissions au moindre privilège (voir bloc CDK (c)).
```

### 2. Le workflow — `.github/workflows/deploy.yml`

Les <code v-pre>${{ ... }}</code> (contextes GitHub Actions) restent **dans ce bloc de code** — ils ne s'exécutent qu'à l'intérieur du runner.

```yaml
# .github/workflows/deploy.yml
name: Deploy infra to AWS

on:
  push:
    branches: [main]

# OBLIGATOIRE pour l'OIDC. Sans id-token: write, GitHub n'émet PAS de jeton
# et configure-aws-credentials échoue ("Unable to get OIDC token").
# Le défaut est "none" : il faut le déclarer explicitement.
permissions:
  id-token: write   # autorise l'émission du jeton OIDC pour CE workflow
  contents: read    # nécessaire à actions/checkout

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      # Le cœur du lab : échange du jeton OIDC contre des credentials
      # temporaires (STS). AUCUN aws-access-key-id ici — c'est tout l'intérêt.
      - name: Configure AWS credentials (OIDC, sans clés)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeployRole
          aws-region: eu-west-3
          role-session-name: gha-tribuzen-staging

      # PREUVE : doit afficher assumed-role/GitHubActionsDeployRole/..., pas user/...
      - name: Prouver l'identité assumée
        run: aws sts get-caller-identity

      - name: Install & deploy
        run: |
          npm ci
          # --require-approval never : pas de prompt interactif en CI
          # (personne au clavier). Le garde-fou humain se déplace sur
          # l'environment GitHub / la revue de PR, il n'est pas supprimé.
          npx cdk deploy LabStack --require-approval never
```

**Pourquoi ce corrigé est correct :**
- **Zéro secret AWS** dans le repo : la seule chose que le workflow connaît, c'est l'**ARN du rôle** (une valeur publique, pas un secret). Le jeton OIDC est généré à la volée, vit quelques minutes, et n'est jamais stocké.
- La ligne `permissions: id-token: write` est ce qui différencie un workflow OIDC d'un workflow classique — c'est l'erreur n°1 quand « ça ne marche pas ».
- La condition `sub` du rôle (`repo:org/repo:ref:refs/heads/main`) garantit qu'un **autre** repo GitHub, même en connaissant l'ARN, **ne peut pas** assumer le rôle : son jeton porte un `sub` différent, et la trust policy le rejette.
- `role-session-name` sert uniquement à **tracer** qui a déployé dans CloudTrail — mets un nom parlant.

---

## Feedback coach

Le coach ne lance aucun script de correction. En session, il vérifie **la réalité** :

1. **Ouvre l'onglet Actions** du repo et lis le run. Vert = déployé. Dans l'étape *Prouver l'identité* : `assumed-role/GitHubActionsDeployRole/gha-...`. Si c'est `user/...`, le lab **n'est pas réussi** — des clés traînent, on les traque et on les supprime.
2. **Settings → Secrets and variables → Actions** : la liste doit être **vide** de tout `AWS_*`. Un seul secret AWS = objectif de sécurité manqué.
3. **Console IAM → le rôle → Trust relationships** : la condition `sub` doit citer ton repo **et** `ref:refs/heads/main`. Si c'est `*` ou `repo:...:*` → on corrige ensemble (PIÈGE #3 du module).
4. **Le rôle n'a pas `AdministratorAccess`.** On regarde les policies attachées : elles doivent se limiter au déploiement CDK.
5. **Test de résistance oral :** « si demain un attaquant fork ton repo, peut-il assumer le rôle ? » Réponse attendue : non, son `sub` ne matche pas la condition (repo différent).

Points de coaching fréquents :
- Confusion « pas de prompt TTY » (`--require-approval never`) vs « pas de contrôle humain » → le contrôle passe sur l'`environment` GitHub.
- Tentation de coller `AdministratorAccess` quand un `AccessDenied` apparaît → non : on lit l'erreur et on ajoute **la** permission manquante.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. Ajoute un **second palier `deploy-prod`** avec `needs: deploy-staging` + `environment: production`. Configure l'environment GitHub avec **required reviewers** (toi). Vérifie que le job prod **se met en pause** et attend ton clic « Approve ».
2. Ajoute un workflow **`pr-diff.yml`** séparé qui, sur `pull_request`, assume un rôle **read-only** distinct et lance `npx cdk diff` (sans déployer). Le `sub` de ce rôle doit cibler `repo:org/repo:pull_request` (ou un environment de review), **pas** `main`.
3. Fais tout ça **en 30 minutes**, de mémoire.

**Critère de réussite :** prod ne se déploie jamais sans ton approbation manuelle ; le job PR affiche le diff d'infra sans pouvoir écrire quoi que ce soit sur AWS (rôle read-only vérifiable en tentant un `cdk deploy` depuis ce rôle → refusé).

---

## Teardown obligatoire

**Ne saute pas cette section.** Laisser traîner un rôle assumable depuis GitHub = une surface d'attaque ; laisser tourner la stack = un risque de coût.

```bash
# 1. Détruire la stack applicative déployée par la CI
npx cdk destroy LabStack

# 2. Détruire la stack de CI (supprime le rôle ET le provider OIDC si créés en CDK)
npx cdk destroy CiStack
```

Si tu as créé le rôle et le provider **à la main (CLI/console)**, détruis-les explicitement :

```bash
# Détacher/supprimer le rôle
aws iam delete-role --role-name GitHubActionsDeployRole
#   (détache d'abord les policies attachées si delete-role refuse :
#    aws iam list-attached-role-policies --role-name GitHubActionsDeployRole
#    puis aws iam detach-role-policy ... / delete-role-policy ...)

# Supprimer le fournisseur OIDC (récupère son ARN d'abord)
aws iam list-open-id-connect-providers
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com
```

**Vérifie que tout est parti :** la console IAM ne doit plus lister ni le rôle `GitHubActionsDeployRole`, ni le provider `token.actions.githubusercontent.com`, et CloudFormation ne doit plus montrer `LabStack`/`CiStack`.

> **Rappel Free Tier.** Le provider OIDC et le rôle IAM sont gratuits ; seule la stack déployée peut coûter. Un bucket S3 vide ou une Lambda « hello » restent dans le Free Tier, mais **détruis quand même** : l'hygiène (rien qui traîne) est une compétence du lab, pas une option.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen-infra`, ce lab produit trois fichiers versionnés et revus en PR :

```
tribuzen-infra/
  lib/
    ci-stack.ts            ← ce lab : OpenIdConnectProvider + GitHubActionsDeployRole
  .github/
    workflows/
      deploy.yml           ← ce lab : OIDC → cdk deploy staging puis (J+30) prod gated
      pr-diff.yml          ← variante J+30 : cdk diff read-only sur chaque PR
```

**Différences avec le lab :**
- La stack déployée n'est pas un bucket jouet mais les vraies stacks TribuZen des modules précédents (`StorageStack`, `ApiStack`, `DataStack`, `AuthStack`).
- Staging et prod visent **deux comptes AWS séparés** → deux rôles, deux ARN `role-to-assume`, isolation maximale.
- Objectif de sécurité **vérifiable et durable** : le compte AWS de TribuZen ne contient **aucune clé IAM long terme** pour la CI.

**Commit cible :**
```
feat(ci): deploy TribuZen via GitHub Actions OIDC (role assume, zero long-lived keys)
```
