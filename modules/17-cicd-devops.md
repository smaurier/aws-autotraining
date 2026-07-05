---
titre: CI/CD vers AWS — déployer une stack CDK depuis un pipeline
cours: 12-aws-cloud
notions: [CI/CD vers AWS, "AWS Developer Tools (survol)", CodePipeline, CodeBuild, CodeDeploy, "buildspec.yml", "clés IAM long terme (anti-pattern)", "OIDC (OpenID Connect)", "fournisseur OIDC GitHub dans IAM", "rôle assumé par le pipeline", "sts:AssumeRoleWithWebIdentity", "condition sub (repo:org/repo:ref)", "aws-actions/configure-aws-credentials", "permissions id-token: write", "cdk deploy --require-approval never", "cdk diff en CI", environnements staging/prod, "approbation manuelle (environment protection)", "rollback CloudFormation", "moindre privilège du rôle de déploiement"]
outcomes:
  - situer CodePipeline/CodeBuild/CodeDeploy et savoir quand un pipeline GitHub Actions suffit pour déployer sur AWS
  - configurer l'authentification OIDC GitHub vers AWS (fournisseur + rôle + condition sub) sans aucune clé IAM long terme
  - écrire un workflow GitHub Actions qui assume un rôle et lance cdk deploy sur AWS
  - séparer staging et prod, exiger une approbation manuelle avant prod, et savoir comment un déploiement échoué revient en arrière
prerequis: [modules 00-16 du cours 12-aws-cloud, dont 01-iam (rôles, policies, principals, moindre privilège) et 05-cdk (App/Stack, cdk deploy/diff/destroy)]
next: 18-projet-final-architecture-cloud
libs: []
tribuzen: pipeline de déploiement de TribuZen sur AWS — le workflow GitHub Actions qui assume un rôle OIDC et déploie l'infra CDK (StorageStack, ApiStack…) vue aux modules précédents, avec staging puis prod gated
last-reviewed: 2026-07
---

# CI/CD vers AWS — déployer une stack CDK depuis un pipeline

> **Outcomes — tu sauras FAIRE :** situer les AWS Developer Tools, brancher GitHub Actions sur AWS en **OIDC sans clés long terme**, lancer `cdk deploy` en CI, et gater staging → prod avec approbation manuelle et rollback.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module traite **uniquement le déploiement vers AWS**. Les fondamentaux CI/CD génériques (étapes d'un pipeline, tests en CI, trunk-based, feature flags, stratégies blue/green vs canary en détail) sont le sujet du **cours dédié 15-cicd-devops** — on ne les réexplique pas ici. Focus : comment un pipeline **s'authentifie** auprès d'AWS et **déploie l'infra CDK** des modules 05-16. Les CDK Pipelines (pipeline auto-mutatif hébergé dans AWS) sont mentionnées mais pas approfondies.

## 1. Cas concret d'abord

L'infra TribuZen est en CDK (module 05) : `StorageStack`, `ApiStack`, `DataStack`. Jusqu'ici tu déploies **depuis ton poste** : `cdk deploy --all` avec tes credentials perso dans `~/.aws/credentials`.

Trois problèmes surgissent dès qu'une équipe s'y met :

1. **Qui a déployé quoi ?** Un `cdk deploy` local ne laisse aucune trace revue. La prod peut diverger du `main` de Git sans que personne ne le sache.
2. **Les credentials.** Pour déployer sans être sur ton poste (un collègue, un serveur CI), la tentation est de créer un **IAM user avec une access key** et de coller `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` dans les secrets GitHub. Ces clés **ne périment jamais** : si le repo fuite, l'attaquant a un accès AWS permanent.
3. **Pas de garde-fou prod.** Rien n'empêche un `cdk deploy` direct en prod un vendredi soir, sans passer par staging.

Ce que tu veux : à chaque merge sur `main`, un **pipeline** déploie `cdk deploy` sur **staging** automatiquement, puis attend une **approbation humaine** avant la **prod** — et il s'authentifie auprès d'AWS **sans aucune clé stockée**, via un jeton temporaire (OIDC). À la fin de ce module, le déploiement de TribuZen est un fichier `.github/workflows/deploy.yml` versionné, revu en PR, et le compte AWS ne contient **zéro clé long terme** pour la CI.

---

## 2. Théorie complète, concise

### 2.1 Les AWS Developer Tools (survol)

AWS fournit une suite managée pour construire un pipeline **entièrement dans AWS** :

| Service | Rôle | Équivalent hors-AWS |
|---|---|---|
| **CodePipeline** | Orchestrateur : enchaîne des **stages** (Source → Build → Deploy…), chaque stage contient des **actions**, les **artefacts** transitent via S3. | GitHub Actions (workflow), GitLab CI |
| **CodeBuild** | Service de build managé : exécute tes commandes dans un conteneur éphémère, piloté par un **`buildspec.yml`**. | GitHub Actions runner, Jenkins agent |
| **CodeDeploy** | Déploie sur EC2/ECS/Lambda avec des stratégies (rolling, blue/green, canary). | Ansible, Spinnaker |

> **Quand utiliser quoi ?** Si ton code est **déjà sur GitHub** et que tu déploies de l'**IaC CDK/CloudFormation**, un workflow **GitHub Actions** qui appelle `cdk deploy` suffit et évite de gérer CodePipeline. CodePipeline/CodeBuild deviennent intéressants pour rester 100 % dans AWS (contraintes réseau/conformité), déclencher sur ECR, ou orchestrer plusieurs comptes. **CodeCommit est déprécié depuis 2024** (plus de nouveaux comptes) : la source est GitHub/GitLab. Ce module prend GitHub Actions comme fil conducteur car c'est le cas le plus courant pour déployer une stack CDK.

### 2.2 Le vrai problème : comment la CI s'authentifie auprès d'AWS

Un pipeline qui déploie doit prouver son identité à AWS. Deux approches :

**❌ Clés IAM long terme (l'anti-pattern).** On crée un IAM user, on génère une access key (`AKIA…` + secret), on la met dans les secrets GitHub. Défauts : la clé **ne périme jamais**, elle est **copiée** hors d'AWS (dans GitHub), et sa rotation est manuelle et souvent oubliée. Une fuite = accès AWS permanent.

**✅ OIDC (OpenID Connect) — la pratique recommandée.** GitHub Actions peut émettre un **jeton OIDC** signé, court, prouvant « *ce job tourne pour le repo `org/repo` sur la branche `main` »*. AWS, configuré pour **faire confiance** à ce fournisseur, échange ce jeton contre des **credentials temporaires** (via STS). Aucune clé n'est stockée nulle part ; le jeton vit quelques minutes. C'est un **badge d'entrée jetable** au lieu d'une clé permanente.

```
GitHub Actions (job)  ──jeton OIDC signé──▶  AWS STS
        ▲                                        │
        └──── credentials temporaires (15 min) ──┘
                     └─▶ cdk deploy
```

### 2.3 Configurer OIDC côté AWS (fait une fois)

Deux ressources IAM, décrites idéalement… en CDK (une `BootstrapStack` de CI). En concept :

**a) Le fournisseur d'identité OIDC** — déclare qu'AWS fait confiance à GitHub :

- URL : `https://token.actions.githubusercontent.com`
- Audience (`aud`) : `sts.amazonaws.com`

**b) Un rôle IAM assumable par ce fournisseur**, avec une **trust policy** qui restreint **quel repo/branche** peut l'assumer :

```json
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
      "token.actions.githubusercontent.com:sub": "repo:smaurier/tribuzen-infra:ref:refs/heads/main"
    }
  }
}
```

> **La condition `sub` est le verrou de sécurité.** Sans elle (ou avec un `*` trop large), **n'importe quel** repo GitHub pourrait assumer ton rôle. `sub` encode `repo:<org>/<repo>:ref:refs/heads/<branche>` — ou `repo:<org>/<repo>:environment:<env>` si tu gates par environnement GitHub. Restreins toujours au repo **et** à la ref attendue.

Le rôle porte ensuite une **policy de permissions** (séparée de la trust policy) : ce qu'il a le droit de faire une fois assumé. Pour du CDK, il faut au minimum de quoi lire/écrire les stacks CloudFormation et assumer les rôles de bootstrap CDK (`cdk-*-deploy-role-*`). **Moindre privilège** : ne donne pas `AdministratorAccess` « pour que ça marche ».

### 2.4 Le workflow GitHub Actions (côté repo)

Trois ingrédients : la **permission `id-token: write`** (sans elle, pas de jeton OIDC), l'action officielle **`aws-actions/configure-aws-credentials`** qui fait l'échange, puis `cdk deploy`.

```yaml
# .github/workflows/deploy.yml
name: Deploy infra to AWS

on:
  push:
    branches: [main]

permissions:
  id-token: write   # OBLIGATOIRE : autorise GitHub à émettre le jeton OIDC
  contents: read    # pour actions/checkout

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC, sans clés)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeployRole
          aws-region: eu-west-3
          role-session-name: gha-tribuzen-staging

      - name: Install & deploy
        run: |
          npm ci
          npx cdk deploy TribuzenStaging --require-approval never
```

- `permissions.id-token: write` — active l'émission du jeton OIDC pour **ce** workflow. Le défaut est `none`.
- `configure-aws-credentials@v4` — échange le jeton contre des credentials temporaires et les expose aux étapes suivantes (le SDK/CDK les lit via l'environnement). Aucune `aws-access-key-id` : c'est tout l'intérêt.
- `--require-approval never` — en CI il n'y a personne pour répondre au prompt CDK sur les changements sensibles (IAM/sécurité). On désactive le prompt **interactif** ; le garde-fou humain est déplacé sur l'**environnement GitHub** (§2.5), pas sur le TTY.

### 2.5 Environnements : staging automatique, prod gated

On ne déploie jamais en prod sans filet. Deux paliers :

- **Staging** : déployé **automatiquement** à chaque merge sur `main`. C'est le miroir de prod où on valide.
- **Prod** : déployé **après approbation manuelle**. GitHub offre les **Environments** avec *required reviewers* : un job ciblant `environment: production` **se met en pause** jusqu'à ce qu'un humain approuve dans l'UI GitHub.

```yaml
  deploy-prod:
    needs: deploy-staging          # prod seulement si staging a réussi
    runs-on: ubuntu-latest
    environment: production        # ← déclenche la règle "required reviewers"
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::999999999999:role/GitHubActionsProdRole
          aws-region: eu-west-3
          role-session-name: gha-tribuzen-prod
      - run: |
          npm ci
          npx cdk deploy TribuzenProd --require-approval never
```

`needs: deploy-staging` sérialise les jobs (prod seulement si staging passe). `environment: production` branche l'approbation humaine. En général staging et prod sont des **comptes AWS séparés** (deux `role-to-assume` différents) — l'isolation la plus forte.

### 2.6 `cdk diff` en CI et rollback

- **`cdk diff` sur les pull requests.** Un job qui lance `cdk diff` sur la PR (sans déployer) affiche **l'impact infra** dans les logs / en commentaire : c'est la revue d'infra avant merge. Le rôle OIDC de ce job peut être **read-only**.
- **Rollback : c'est CloudFormation qui l'assure.** Un `cdk deploy` est un update de stack CloudFormation. Si une ressource échoue à se créer/mettre à jour, CloudFormation **rollback automatiquement** la stack vers son dernier état stable — le job CI ressort en échec, mais l'infra n'est pas laissée à moitié cassée. C'est un avantage direct de faire l'IaC en CDK/CloudFormation plutôt qu'en scripts impératifs. (Le rollback **applicatif** progressif — canary, bascule de trafic — relève de CodeDeploy et du cours 15.)

---

## 3. Worked examples

### Exemple 1 — Du `cdk deploy` local au pipeline OIDC (TribuZen)

**Situation de départ :** tu déploies `TribuzenStaging` à la main. On veut automatiser sur merge `main`, sans clé.

**Étape 1 — créer la confiance OIDC côté AWS** (une fois, idéalement en CDK). En pseudo-CDK :

```ts
import * as iam from 'aws-cdk-lib/aws-iam'

// Le fournisseur OIDC GitHub (une fois par compte)
const ghProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
  url: 'https://token.actions.githubusercontent.com',
  clientIds: ['sts.amazonaws.com'],
})

// Le rôle que le pipeline assumera — restreint au repo ET à la branche main
const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
  roleName: 'GitHubActionsDeployRole',
  assumedBy: new iam.OpenIdConnectPrincipal(ghProvider, {
    StringLike: {
      'token.actions.githubusercontent.com:sub':
        'repo:smaurier/tribuzen-infra:ref:refs/heads/main',
    },
    StringEquals: {
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
    },
  }),
})
// deployRole reçoit ensuite une policy au moindre privilège (déploiement CDK),
// pas AdministratorAccess.
```

**Étape 2 — le workflow** (`.github/workflows/deploy.yml`) : celui du §2.4. Rien d'autre à configurer côté secrets GitHub — **aucun secret AWS** n'est créé.

**Étape 3 — vérifier.** Sur le premier run, l'étape *Configure AWS credentials* doit afficher un `sts get-caller-identity` correspondant au rôle assumé (`assumed-role/GitHubActionsDeployRole/gha-tribuzen-staging`), **pas** un user. Si tu vois `arn:aws:iam::…:user/…`, c'est que des clés traînent encore : supprime-les.

**Ce qui vient d'être exercé :** fournisseur OIDC + rôle avec condition `sub`, `id-token: write`, `configure-aws-credentials`, `cdk deploy` en CI — le tout sans clé long terme.

### Exemple 2 — Ajouter le palier prod gated

On étend le workflow avec le job `deploy-prod` du §2.5. Chronologie d'un merge sur `main` :

```
merge main
  │
  ├─▶ job deploy-staging  ── cdk deploy TribuzenStaging (compte 123…) ── ✅
  │
  └─▶ job deploy-prod  [needs: deploy-staging]
         │  environment: production  →  ⏸ EN ATTENTE D'APPROBATION
         │  (un reviewer clique "Approve" dans l'onglet Actions)
         ▼
         cdk deploy TribuzenProd (compte 999…) ── ✅
```

Si `deploy-staging` échoue, `deploy-prod` ne démarre **jamais** (`needs`). Si personne n'approuve, le job prod reste en pause puis expire — **la prod n'est pas touchée**. Si `cdk deploy TribuzenProd` échoue en cours, **CloudFormation rollback** la stack prod à son état antérieur et le job ressort rouge.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Mettre une access key IAM dans les secrets GitHub

```yaml
# ❌ Anti-pattern : clé long terme copiée hors d'AWS, jamais expirée
- uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: eu-west-3

# ✅ OIDC : rôle assumé, credentials temporaires, zéro secret stocké
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeployRole
    aws-region: eu-west-3
```

La même action supporte les deux modes. Le mode OIDC (avec `role-to-assume` et **sans** `aws-access-key-id`) est la pratique recommandée. Une clé dans les secrets = un accès AWS permanent si le repo fuite.

### PIÈGE #2 — Oublier `permissions: id-token: write`

Sans ce bloc, GitHub **n'émet pas** de jeton OIDC (défaut `none`) et `configure-aws-credentials` échoue avec *« Unable to get OIDC token »* ou *« Credentials could not be loaded »*. Ce n'est pas un problème de rôle AWS : c'est la permission **côté workflow** qui manque. `contents: read` reste nécessaire pour `checkout`.

### PIÈGE #3 — Une condition `sub` trop permissive

```json
// ❌ N'IMPORTE QUEL repo peut assumer le rôle → escalade
"token.actions.githubusercontent.com:sub": "*"

// ❌ Tout le repo, toutes branches/PR/forks
"token.actions.githubusercontent.com:sub": "repo:smaurier/tribuzen-infra:*"

// ✅ Repo précis + branche précise
"token.actions.githubusercontent.com:sub": "repo:smaurier/tribuzen-infra:ref:refs/heads/main"
```

Le `sub` est le seul rempart entre ton compte AWS et le reste de GitHub. Un `*` transforme ton rôle de déploiement en porte ouverte. Restreins au repo **et** à la ref (ou à l'`environment`).

### PIÈGE #4 — Croire que `--require-approval never` supprime tout garde-fou

`--require-approval never` désactive seulement le **prompt interactif** de CDK sur les changements IAM/sécurité — indispensable en CI où aucun humain n'est au clavier. Le vrai garde-fou humain n'est pas supprimé : il est **déplacé** sur l'`environment` GitHub (required reviewers) et sur la revue de PR. Ne confonds pas « pas de prompt TTY » et « pas de contrôle ».

### PIÈGE #5 — Donner `AdministratorAccess` au rôle de déploiement

Un rôle de CI compromis avec `AdministratorAccess` = compte entier compromis. Le rôle de déploiement doit porter une **policy au moindre privilège** (CloudFormation + assumer les rôles de bootstrap CDK + les services réellement déployés). Le job de `cdk diff` sur PR, lui, peut être **strictement read-only**.

### PIÈGE #6 — Déployer en prod sans passer par staging

Un seul job qui `cdk deploy` directement en prod sur chaque merge, sans palier staging ni approbation, ramène le « déploiement vendredi soir ». Sépare `deploy-staging` (auto) et `deploy-prod` (`needs:` + `environment:` avec reviewers), idéalement sur **deux comptes AWS**.

---

## 5. Ancrage TribuZen

Tout le backend TribuZen est décrit en CDK (module 05) : `StorageStack` (avatars S3), `ApiStack` (Lambda + API Gateway, modules 06-07), `DataStack` (DynamoDB, module 09), `AuthStack` (Cognito, module 11). Ce module fournit **le moyen de les déployer** proprement, en équipe.

Le repo `smaurier/tribuzen-infra` gagne :

```
tribuzen-infra/
  bin/tribuzen-infra.ts
  lib/
    storage-stack.ts
    api-stack.ts
    data-stack.ts
    ci-stack.ts              ← CE MODULE : OpenIdConnectProvider + GitHubActionsDeployRole
  .github/
    workflows/
      deploy.yml             ← CE MODULE : OIDC → cdk deploy staging puis prod gated
      pr-diff.yml            ← CE MODULE : cdk diff read-only sur chaque PR
```

- `ci-stack.ts` décrit **en CDK** le fournisseur OIDC et le rôle de déploiement (l'infra de CI est aussi de l'IaC).
- `deploy.yml` assume le rôle en OIDC et déroule `cdk deploy TribuzenStaging` puis, après approbation, `cdk deploy TribuzenProd`.
- Le compte AWS de TribuZen **ne contient aucune clé IAM long terme** pour la CI — objectif de sécurité concret et vérifiable.

> Les stratégies de déploiement applicatif fines (blue/green, canary via CodeDeploy) et les fondamentaux CI/CD génériques sont couverts par le **cours 15-cicd-devops** ; ici on s'arrête au déploiement de l'**infra AWS** de TribuZen.

---

## 6. Points clés

1. **AWS Developer Tools** : CodePipeline (orchestration), CodeBuild (build via `buildspec.yml`), CodeDeploy (déploiement/stratégies). Pour déployer une stack CDK depuis GitHub, un **workflow GitHub Actions** suffit souvent.
2. Le vrai enjeu CI→AWS est **l'authentification** : les clés IAM long terme dans les secrets sont un **anti-pattern** (jamais expirées, copiées hors d'AWS).
3. **OIDC** est la pratique recommandée : GitHub émet un jeton court, AWS l'échange (STS) contre des credentials temporaires — **zéro clé stockée**.
4. Côté AWS : un **fournisseur OIDC** (`token.actions.githubusercontent.com`, `aud=sts.amazonaws.com`) + un **rôle** dont la trust policy restreint le **`sub`** au repo **et** à la ref/environment.
5. Côté workflow : `permissions: id-token: write` + `aws-actions/configure-aws-credentials` avec `role-to-assume` (pas de `aws-access-key-id`), puis `cdk deploy --require-approval never`.
6. **Staging auto, prod gated** : job prod avec `needs:` + `environment:` (required reviewers), idéalement sur des **comptes AWS séparés**.
7. `cdk diff` sur les PR (rôle read-only) = revue d'infra ; un `cdk deploy` échoué **rollback** automatiquement grâce à CloudFormation.
8. **Moindre privilège** partout : jamais `AdministratorAccess` sur le rôle de déploiement ; `--require-approval never` déplace le garde-fou humain sur l'environment, il ne le supprime pas.

---

## 7. Seeds Anki

```
Pourquoi mettre une access key IAM dans les secrets GitHub est-il un anti-pattern ?|La clé long terme (AKIA…) ne périme jamais et est copiée hors d'AWS (dans GitHub). Si le repo fuite, l'attaquant a un accès AWS permanent. La rotation est manuelle et souvent oubliée. On préfère OIDC (credentials temporaires, rien de stocké).
Comment GitHub Actions s'authentifie-t-il auprès d'AWS en OIDC ?|GitHub émet un jeton OIDC signé et court prouvant repo+branche du job. AWS, configuré pour faire confiance au fournisseur token.actions.githubusercontent.com, échange ce jeton via STS (sts:AssumeRoleWithWebIdentity) contre des credentials temporaires. Aucune clé n'est stockée.
Quelles deux ressources IAM configurer côté AWS pour l'OIDC GitHub ?|(1) un fournisseur d'identité OIDC : url https://token.actions.githubusercontent.com, audience sts.amazonaws.com. (2) un rôle IAM avec une trust policy sts:AssumeRoleWithWebIdentity dont la condition sub restreint le repo et la ref autorisés.
À quoi sert la condition sub dans la trust policy du rôle OIDC ?|Elle restreint QUI peut assumer le rôle : repo:org/repo:ref:refs/heads/main (ou :environment:prod). Sans elle ou avec un *, n'importe quel repo GitHub pourrait assumer le rôle. C'est le principal rempart de sécurité.
Quelle permission de workflow est obligatoire pour l'OIDC, et que se passe-t-il sans elle ?|permissions: id-token: write (défaut = none). Sans elle, GitHub n'émet pas de jeton OIDC et configure-aws-credentials échoue (Unable to get OIDC token). contents: read reste nécessaire pour checkout.
Que fait --require-approval never dans cdk deploy en CI, et quel garde-fou reste ?|Il désactive le prompt interactif de CDK sur les changements IAM/sécurité (personne au clavier en CI). Le garde-fou humain n'est pas supprimé : il passe sur l'environment GitHub (required reviewers) et la revue de PR.
Comment séparer staging et prod dans un workflow de déploiement AWS ?|Deux jobs : deploy-staging (auto sur merge main) et deploy-prod avec needs: deploy-staging + environment: production (required reviewers). Prod ne démarre que si staging passe et qu'un humain approuve. Idéalement deux comptes AWS distincts (deux rôles).
Qui assure le rollback quand un cdk deploy échoue en CI ?|CloudFormation : un cdk deploy est un update de stack ; si une ressource échoue, CloudFormation rollback automatiquement la stack vers son dernier état stable. Le job CI ressort rouge mais l'infra n'est pas laissée à moitié cassée.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-17-cicd/README.md`. Tu configures un vrai fournisseur OIDC + rôle sur ton compte AWS, tu écris `.github/workflows/deploy.yml`, tu pousses, et tu regardes GitHub Actions assumer le rôle et lancer `cdk deploy` **sans aucune clé** — puis tu **détruis** le rôle et la stack (teardown). Vrai outil, zéro harnais.
