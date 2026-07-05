---
titre: Déployer une app Nuxt / Next sur AWS
cours: 12-aws-cloud
notions: [statique S3 plus CloudFront, SSR serverless sur Lambda, "SST v3 (sst.aws.Nextjs)", "sst.aws.Nuxt", "OpenNext (adaptateur build)", Amplify Hosting compute, "conteneur ECS Fargate", variables d'environnement de build vs runtime, "SSM Parameter Store", "domaine custom et certificat ACM (us-east-1)", invalidation CloudFront, teardown des ressources]
outcomes:
  - sait choisir la stratégie de déploiement (statique, SSR serverless, conteneur, Amplify) selon le rendu de l'app
  - sait déployer une app Nuxt/Next SSR sur AWS avec SST v3 (OpenNext) et brancher un domaine ACM
  - sait déployer une app statique sur S3 + CloudFront et invalider le cache après un push
  - sait gérer les variables d'environnement (build vs runtime, préfixe public) et détruire proprement les ressources
prerequis: [modules 00-18 du cours 12-aws-cloud — S3 (04), CDK (05), Lambda (06), API Gateway (07), CloudFront (13), CI/CD OIDC (17), capstone archi cloud (18)]
next: fin-parcours-12-aws-cloud
libs: []
tribuzen: mise en ligne du front-office TribuZen (Nuxt SSR) sur AWS — le point d'aboutissement de toute l'infra cloud décrite dans les modules précédents
last-reviewed: 2026-07
---

# Déployer une app Nuxt / Next sur AWS

> **Outcomes — tu sauras FAIRE :** choisir la bonne stratégie de déploiement selon le mode de rendu, déployer une app Nuxt/Next SSR sur AWS avec SST v3 (OpenNext) + domaine ACM, déployer une app statique sur S3 + CloudFront, gérer les variables d'environnement et **détruire** proprement les ressources.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module **assemble** des briques déjà vues (S3 module 04, CDK 05, Lambda 06, CloudFront 13, CI/CD OIDC 17) pour mettre une vraie app front en ligne. On ne réexplique pas ces services : on les **orchestre**. L'écosystème de déploiement Next/Nuxt sur AWS bouge vite (OpenNext, SST) — les commandes et noms de composants sont vérifiés à la date de revue ci-dessus ; revérifie la doc officielle avant un déploiement de production.

## 1. Cas concret d'abord

Tout le parcours 12-aws-cloud a construit le **backend** de TribuZen : Cognito pour l'auth (module 11), Lambda + API Gateway pour l'API (06-07), DynamoDB pour le feed (09), S3 pour les avatars (04), le tout décrit en CDK (05) et livré par un pipeline OIDC (17). Il manque une chose : **le front n'est visible nulle part**. Il tourne sur `localhost:3000` sur ta machine.

Le front-office TribuZen est une app **Nuxt 3 en SSR** : la page famille doit être rendue côté serveur (SEO, partage de lien, premier affichage rapide). On te demande de la mettre en ligne sur `app.tribuzen.fr`, en HTTPS, connectée à l'API existante.

Première tentation : « je build et je pousse les fichiers sur un bucket S3 comme le site vitrine ». **Piège.** Un bucket S3 sert des fichiers statiques — il n'exécute pas de code serveur. Le SSR de Nuxt a besoin d'un **compute** (Lambda ou conteneur) pour rendre le HTML à chaque requête. Choisir S3 seul, c'est casser le SSR sans s'en rendre compte.

Ce module répond à trois questions :
1. **Quel type de rendu** a mon app (statique, SSR, hybride) — et donc quelle cible AWS ?
2. **Quel outil** utiliser pour ne pas câbler Lambda + S3 + CloudFront + Route 53 à la main (spoiler : SST/OpenNext) ?
3. Comment gérer **domaine, HTTPS, variables d'env**, et surtout **tout détruire** quand la démo est finie pour ne rien payer ?

À la fin, `app.tribuzen.fr` sert le front Nuxt SSR en HTTPS, déployable en une commande — et détruisible en une autre.

---

## 2. Théorie complète, concise

### 2.1 Le point de départ : quel mode de rendu ?

La cible AWS dépend **entièrement** de comment ton app produit son HTML. C'est la première décision, avant tout choix d'outil.

| Mode de rendu | Ce que produit le build | Besoin d'un serveur ? | Cible AWS naturelle |
|---|---|---|---|
| **Statique (SSG / prerender)** | Des fichiers HTML/JS/CSS figés | Non | **S3 + CloudFront** |
| **SSR (server-side rendering)** | Un serveur qui rend le HTML à chaque requête | Oui | **Lambda** (serverless) ou **conteneur** |
| **Hybride** (quelques pages SSR, le reste prerender) | Les deux à la fois | Oui, pour les pages SSR | **Lambda + S3 + CloudFront** combinés |

- Nuxt : `nuxi generate` = statique ; `nuxi build` (défaut) = SSR (sortie Nitro dans `.output/`).
- Next : `output: 'export'` dans `next.config.js` = statique (dossier `out/`) ; `next build` par défaut = SSR/hybride (dossier `.next/`).

> **Règle d'or :** ne choisis pas la cible AWS d'abord. Regarde d'abord ce que ton build produit. Un SSR déployé sur S3 seul **perd le SSR** silencieusement (les pages dynamiques cassent).

### 2.2 Le tableau des stratégies

| Stratégie | SSR ? | Coût | Complexité | Cas d'usage |
|---|---|---|---|---|
| **S3 + CloudFront** | Non | $ | Faible | Site statique : landing, docs, blog prerendu |
| **SST v3 (OpenNext) → Lambda** | Oui | $$ | Moyenne | SSR serverless, DX TypeScript, trafic variable |
| **Amplify Hosting compute** | Oui | $$ | Faible | Prototype, git-connecté, DX maximale |
| **ECS Fargate (conteneur)** | Oui | $$$ | Élevée | Contrôle total, trafic constant/soutenu |

Les quatre lignes déploient la **même app**. La différence est le compromis coût / contrôle / effort.

### 2.3 Option A — Statique sur S3 + CloudFront

Pour une app **sans SSR**. Le build produit des fichiers, on les sync sur un bucket, CloudFront les sert en HTTPS avec cache (revoir modules 04 et 13).

```bash
# Nuxt statique → sortie dans .output/public/
npx nuxi generate

# Next statique (output: 'export' dans next.config.js) → sortie dans out/
npm run build

# Sync des fichiers vers le bucket (--delete retire les fichiers obsolètes)
aws s3 sync .output/public/ s3://tribuzen-vitrine/ --delete

# Invalider le cache CloudFront pour servir la nouvelle version tout de suite
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

**Pourquoi l'invalidation ?** CloudFront met en cache les fichiers en edge. Sans invalidation après un `sync`, les visiteurs continuent de recevoir l'ancienne version jusqu'à expiration du TTL. `--paths "/*"` purge tout (les 1000 premiers chemins/mois sont gratuits).

Le bucket ne doit **pas** être public : on l'expose via une **Origin Access Control (OAC)** CloudFront (module 13), pas via un bucket public.

### 2.4 Option B — SSR serverless avec SST v3 + OpenNext (recommandé)

Câbler à la main un SSR Nuxt/Next sur AWS demande : une Lambda pour le rendu serveur, un bucket S3 pour les assets, une distribution CloudFront devant, du routage, éventuellement Route 53 + ACM. **OpenNext** et **SST** automatisent tout ça.

- **OpenNext** est un *adaptateur de build* open-source : il prend la sortie de `next build` (ou de Nitro pour Nuxt) et la transforme en artefacts déployables sur AWS (fonctions Lambda, assets, config CloudFront). C'est lui qui « traduit » le framework en ressources AWS.
- **SST v3** est un framework de déploiement (basé sur Pulumi) qui **utilise OpenNext sous le capot** et provisionne l'infra AWS pour toi. Tu décris ton site en TypeScript, `sst deploy` fait le reste.

Config SST v3 pour un site **Next.js** :

```ts
// sst.config.ts
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'tribuzen-web',
      // en prod on conserve les ressources ; ailleurs on les supprime au destroy
      removal: input?.stage === 'prod' ? 'retain' : 'remove',
      home: 'aws',
    }
  },
  async run() {
    new sst.aws.Nextjs('Web', {
      path: 'apps/web',
      environment: {
        // exposée au navigateur → préfixe NEXT_PUBLIC_ obligatoire (Next)
        NEXT_PUBLIC_API_URL: 'https://api.tribuzen.fr',
      },
      domain: {
        name: 'app.tribuzen.fr',
        redirects: ['www.app.tribuzen.fr'],
      },
    })
  },
})
```

Config SST v3 pour un site **Nuxt** — même schéma, composant `sst.aws.Nuxt` :

```ts
new sst.aws.Nuxt('Web', {
  path: 'apps/web',
  environment: {
    // SST expose au navigateur les vars préfixées VUE_APP_ pour le composant Nuxt
    VUE_APP_API_URL: 'https://api.tribuzen.fr',
  },
  domain: 'app.tribuzen.fr',
})
```

<!-- FLAG-DOC: SST doc (component/aws/nuxt) indique le préfixe VUE_APP_ pour exposer une var au navigateur via le composant Nuxt. Le préfixe Nuxt natif habituel est NUXT_PUBLIC_ (runtimeConfig). Revérifier sur sst.dev le préfixe exact attendu par sst.aws.Nuxt avant un déploiement prod. -->

Le composant crée automatiquement : la (les) Lambda de SSR, le bucket S3 des assets, la distribution CloudFront, et le certificat ACM + les enregistrements Route 53 pour le domaine.

Cycle de commandes :

```bash
npx sst deploy --stage prod   # déploie tout sur AWS
npx sst remove --stage prod   # DÉTRUIT tout (respecte removal: retain/remove)
```

### 2.5 Le domaine et HTTPS : ACM en us-east-1

Un domaine custom en HTTPS exige un **certificat ACM**. Point critique souvent raté : **CloudFront n'accepte que des certificats ACM créés dans la région `us-east-1`** (Virginie), quelle que soit la région où tourne le reste de ton infra.

- Avec **SST**, si le domaine est géré par Route 53, SST crée le certificat en `us-east-1` et valide par DNS **automatiquement** — tu ne touches rien.
- **À la main** (S3 + CloudFront) : tu dois demander le certificat ACM **explicitement en us-east-1**, le valider par DNS, puis l'attacher à la distribution.

> **Piège classique :** certificat créé dans `eu-west-3` (Paris) → CloudFront ne le voit pas → « no certificate available ». Toujours `us-east-1` pour CloudFront.

### 2.6 Variables d'environnement : build vs runtime, public vs secret

Deux distinctions à ne jamais confondre.

**Build-time vs runtime.** Une variable lue pendant `next build` / `nuxi build` est **figée dans les artefacts** — la changer ensuite exige un **rebuild + redéploiement**. Une variable lue à l'exécution (dans la Lambda de SSR) peut changer sans rebuild.

**Publique vs secrète.** Une variable exposée au **navigateur** est visible par tout le monde (elle finit dans le JS téléchargé). Les frameworks forcent un préfixe pour rendre ce choix explicite :
- Next : `NEXT_PUBLIC_*` → exposée au client ; sans préfixe → serveur uniquement.
- Nuxt : `runtimeConfig.public.*` (préfixe `NUXT_PUBLIC_*`) → client ; `runtimeConfig.*` → serveur.

**Un secret (clé API, URL de BDD) ne doit JAMAIS être `NEXT_PUBLIC_` / `public`.** Il se stocke dans **SSM Parameter Store** (type `SecureString`) ou Secrets Manager, et se lit côté serveur uniquement (revoir module 15).

```bash
# Stocker un secret côté serveur (jamais dans le bundle client)
aws ssm put-parameter \
  --name "/tribuzen/prod/DATABASE_URL" \
  --value "postgresql://..." \
  --type SecureString
```

En SST, on référence un secret via `sst.Secret` plutôt que de le hardcoder dans `sst.config.ts`.

### 2.7 Option C — Amplify Hosting, et Option D — conteneur

**Amplify Hosting compute** : le plus simple. On connecte le dépôt Git dans la console Amplify, on choisit la branche, Amplify détecte le framework, build et déploie à chaque push (preview branches, rollback inclus). Amplify Hosting compute gère le SSR Next.js (versions 12 à 15 à la date de revue). Idéal pour un prototype ou une petite équipe ; moins de contrôle et coût plus élevé à fort trafic.

**Conteneur (ECS Fargate)** : on empaquette l'app SSR dans une image Docker (`node .output/server/index.mjs` pour Nuxt), on la fait tourner sur Fargate derrière un ALB (modules 12-13). Contrôle total, pas de cold start, mais tu paies le conteneur en continu même sans trafic — pertinent seulement pour un trafic constant.

```dockerfile
# Dockerfile — Nuxt SSR en conteneur
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # sortie Nitro dans .output/

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

### 2.8 Livrer par CI/CD (rappel module 17)

En production, on ne tape pas `sst deploy` depuis son poste : un workflow GitHub Actions le fait sur `push`, en s'authentifiant à AWS par **OIDC** (aucune clé AWS stockée dans GitHub — module 17).

```yaml
# .github/workflows/deploy.yml (extrait)
permissions:
  id-token: write   # requis pour l'échange OIDC
  contents: read
steps:
  - uses: actions/checkout@v4
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/tribuzen-deploy
      aws-region: eu-west-3
  - uses: actions/setup-node@v4
    with: { node-version: 20, cache: npm }
  - run: npm ci
  - run: npx sst deploy --stage prod
```

---

## 3. Worked examples

### Exemple 1 — Mettre le front Nuxt SSR de TribuZen en ligne avec SST v3

**But :** `app.tribuzen.fr` sert le front Nuxt SSR en HTTPS, branché sur l'API existante, déployable et détruisible en une commande.

```bash
# 1. À la racine de l'app Nuxt, ajouter SST
npx sst@latest init
# → SST détecte Nuxt et génère un sst.config.ts pré-rempli
```

```ts
// sst.config.ts
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'tribuzen-web',
      // prod : on ne détruit pas par accident. dev/perso : tout part au remove.
      removal: input?.stage === 'prod' ? 'retain' : 'remove',
      home: 'aws',
    }
  },
  async run() {
    // URL de l'API TribuZen : côté serveur pour le SSR, non secrète ici
    const site = new sst.aws.Nuxt('Web', {
      path: '.',                    // l'app Nuxt est à la racine
      environment: {
        // exposée au navigateur (fetch client) → préfixe attendu par le composant
        VUE_APP_API_URL: 'https://api.tribuzen.fr',
      },
      domain: {
        name: 'app.tribuzen.fr',    // suppose la zone Route 53 tribuzen.fr existante
      },
    })

    // Affiche l'URL déployée à la fin du deploy
    return { url: site.url }
  },
})
```

```bash
# 2. Déployer sur le stage perso (removal: remove → détruisible)
npx sst deploy --stage dev
# SST : build Nuxt (Nitro) → OpenNext/adaptateur → Lambda SSR + S3 assets
#       + CloudFront + certificat ACM (us-east-1) + Route 53. Affiche l'URL.

# 3. Vérifier dans le navigateur : la page famille est rendue côté serveur
#    (view-source montre le HTML complet, pas une coquille vide).

# 4. FIN DE SÉANCE — NE RIEN LAISSER TOURNER :
npx sst remove --stage dev   # détruit Lambda, S3, CloudFront, ACM, DNS
```

**Ce qui vient d'être exercé :** choix SSR → Lambda, composant `sst.aws.Nuxt`, variable d'env publique, domaine + ACM automatique, et le **teardown** complet.

### Exemple 2 — Le site vitrine statique sur S3 + CloudFront (à la main)

TribuZen a aussi une **landing page** marketing, 100 % statique. Pas besoin de SSR : S3 + CloudFront suffit et coûte quasi rien.

```bash
# 1. Générer le statique (Nuxt : ssr désactivé / prerender)
npx nuxi generate            # sortie : .output/public/

# 2. Créer le bucket (privé) et la distribution CloudFront avec OAC
#    → fait une fois en CDK (module 05) ou console (module 13). Bucket JAMAIS public.

# 3. Publier une nouvelle version
aws s3 sync .output/public/ s3://tribuzen-landing/ --delete

# 4. Purger le cache edge pour servir la nouvelle version immédiatement
aws cloudfront create-invalidation \
  --distribution-id E2ABCDEF012345 \
  --paths "/*"
```

**Lecture :**
- `--delete` retire du bucket les fichiers qui n'existent plus dans le build (sinon des orphelins s'accumulent).
- Sans l'étape 4, les visiteurs gardent l'ancienne version jusqu'à expiration du TTL CloudFront — d'où le `create-invalidation`.
- Le certificat HTTPS de cette distribution doit être un **ACM en us-east-1** (§2.5).

**Teardown :** `aws s3 rm s3://tribuzen-landing --recursive` puis supprimer la distribution CloudFront (ou `cdk destroy` si créée en CDK).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Déployer une app SSR sur S3 seul

```
❌ nuxi build (SSR) → aws s3 sync .output/ s3://bucket/
   S3 sert des fichiers statiques, il n'EXÉCUTE pas le serveur Nitro.
   Les pages dynamiques renvoient du HTML vide ou du 403/404.

✅ App SSR → SST (Lambda), Amplify compute, ou conteneur.
   S3 + CloudFront seul = uniquement pour du STATIQUE (nuxi generate / output: 'export').
```

Le symptôme trompeur : la home marche (prerendue), mais toute page rendue à la volée casse. Vérifie le mode de rendu **avant** de choisir la cible.

### PIÈGE #2 — Certificat ACM dans la mauvaise région

```
❌ Certificat ACM créé dans eu-west-3 (Paris), attaché à CloudFront → introuvable.
✅ CloudFront n'accepte QUE des certificats ACM de us-east-1 (N. Virginia),
   même si ton bucket / ta Lambda sont à Paris.
```

Avec SST + Route 53, c'est automatique. À la main, demande le certificat explicitement en `us-east-1`.

### PIÈGE #3 — Mettre un secret dans une variable `NEXT_PUBLIC_` / `public`

```ts
// ❌ Exposé dans le bundle JS téléchargé par TOUS les visiteurs
environment: { NEXT_PUBLIC_DB_PASSWORD: '...' }

// ✅ Secret côté serveur uniquement : SSM SecureString / sst.Secret, sans préfixe public
```

Le préfixe `NEXT_PUBLIC_` / `NUXT_PUBLIC_` signifie « je veux que ce soit visible dans le navigateur ». Une clé de BDD ou une clé API privée n'y a jamais sa place.

### PIÈGE #4 — Oublier l'invalidation CloudFront après un `s3 sync`

```
❌ aws s3 sync ... → « mon site n'affiche pas la nouvelle version »
   CloudFront sert encore l'ancienne depuis le cache edge (TTL non expiré).

✅ Toujours : aws cloudfront create-invalidation --paths "/*" après le sync.
```

Le déploiement « a marché » côté S3 mais les utilisateurs voient l'ancien contenu — d'où l'illusion de bug.

### PIÈGE #5 — Confondre variable build-time et runtime

```
❌ Changer NEXT_PUBLIC_API_URL dans la console sans rebuild → sans effet.
   Une var lue au build est FIGÉE dans les artefacts.

✅ Modifier une var build-time = rebuild + redeploy. Seules les vars lues à
   l'exécution (côté serveur SSR) changent sans rebuild.
```

### PIÈGE #6 — Laisser la stack tourner après la démo

Une distribution CloudFront, une Lambda et un bucket oubliés continuent d'exister (et un domaine actif peut coûter). Après un déploiement d'apprentissage : **`sst remove`** (ou `cdk destroy`, ou suppression console). Le Free Tier ne couvre pas tout indéfiniment. Le teardown fait partie du déploiement, pas d'une corvée optionnelle.

### PIÈGE #7 (Nuxt/SST) — `TooManyCacheBehaviors` sur CloudFront

Une distribution CloudFront a une limite de **25 cache behaviors**. Chaque fichier/dossier de premier niveau dans le dossier d'assets publics en crée un. Les apps Nuxt/SvelteKit avec beaucoup d'entrées top-level peuvent dépasser la limite au déploiement SST. Solution : **regrouper les assets dans des sous-dossiers** plutôt que de les éparpiller à la racine du dossier public.

---

## 5. Ancrage TribuZen

Ce module est **l'aboutissement** de tout le cours 12-aws-cloud : les modules précédents ont bâti l'infra ; celui-ci met le front en ligne devant.

**Front-office Nuxt SSR (`app.tribuzen.fr`)** — déployé via `sst.aws.Nuxt` (Exemple 1). Rendu serveur pour le SEO et le partage de liens de familles. Il consomme l'API TribuZen (Lambda + API Gateway, modules 06-07) et s'authentifie via Cognito (module 11). Le domaine et le HTTPS (ACM us-east-1) sont gérés par SST sur la zone Route 53 de TribuZen.

**Landing marketing (statique)** — S3 + CloudFront avec OAC (Exemple 2), publiée par `s3 sync` + invalidation. Zéro compute, coût minimal.

**Secrets** — l'URL de l'API publique est en clair (`VUE_APP_API_URL`), mais toute clé sensible (ex. clé de service serveur) passe par SSM Parameter Store / `sst.Secret`, jamais dans une var `public`.

**Livraison** — le déploiement est déclenché par GitHub Actions en OIDC (module 17) sur `push` vers `main`, pas depuis un poste local.

```
smaurier/tribuzen/
  apps/
    web/                     ← app Nuxt 3 SSR (front-office)
      sst.config.ts          ← CE MODULE : sst.aws.Nuxt + domaine app.tribuzen.fr
      nuxt.config.ts
  .github/workflows/
    deploy.yml               ← module 17 : sst deploy --stage prod via OIDC
```

Avec ce module, TribuZen est **entièrement en ligne** : front SSR + API serverless + auth + stockage, le tout sur AWS, décrit en code et détruisible en une commande.

---

## 6. Points clés

1. La cible AWS découle du **mode de rendu** : statique → S3 + CloudFront ; SSR → Lambda (SST/OpenNext), Amplify compute ou conteneur.
2. Un **SSR déployé sur S3 seul casse** : S3 sert des fichiers, il n'exécute pas de serveur. Vérifie le rendu avant la cible.
3. **SST v3** (`sst.aws.Nextjs` / `sst.aws.Nuxt`) provisionne Lambda + S3 + CloudFront + ACM + Route 53 en une commande, en utilisant **OpenNext** sous le capot.
4. Un **certificat ACM pour CloudFront doit être en `us-east-1`**, quelle que soit la région du reste de l'infra ; SST le fait automatiquement avec Route 53.
5. **Build-time vs runtime** : une var lue au build est figée (rebuild pour la changer) ; **public vs secret** : un secret ne va jamais dans `NEXT_PUBLIC_`/`public` — il passe par SSM/Secrets Manager.
6. Après un `s3 sync`, **invalider CloudFront** (`create-invalidation --paths "/*"`) sinon l'ancienne version reste servie depuis le cache edge.
7. **Amplify** = git-connecté, simple, SSR Next 12-15 ; **ECS Fargate** = contrôle total mais coût continu (trafic soutenu).
8. Le **teardown** (`sst remove` / `cdk destroy` / suppression console) fait partie du déploiement — ne rien laisser tourner après une démo.

---

## 7. Seeds Anki

```
Comment choisir la cible AWS pour déployer une app Nuxt/Next ?|Regarder d'abord le mode de rendu : statique (nuxi generate / output: export) → S3 + CloudFront ; SSR (nuxi build / next build) → Lambda via SST/OpenNext, Amplify compute ou conteneur ECS. Le rendu décide la cible, pas l'inverse.
Pourquoi ne peut-on pas déployer une app SSR sur S3 seul ?|S3 sert des fichiers statiques et n'exécute aucun code serveur. Le SSR a besoin d'un compute (Lambda ou conteneur) pour rendre le HTML à chaque requête. Sur S3 seul, les pages dynamiques renvoient du vide ou une erreur.
Que fait OpenNext et quel est son rapport avec SST ?|OpenNext est un adaptateur de build open-source : il transforme la sortie de next build (ou de Nitro pour Nuxt) en artefacts déployables sur AWS (Lambda, assets, config CloudFront). SST v3 est un framework de déploiement qui utilise OpenNext sous le capot et provisionne l'infra AWS.
Dans quelle région doit se trouver le certificat ACM d'une distribution CloudFront ?|us-east-1 (N. Virginia) obligatoirement, quelle que soit la région du reste de l'infra. Un certificat créé ailleurs (ex. eu-west-3) est invisible pour CloudFront. Avec SST + Route 53, la création en us-east-1 est automatique.
Quelle est la différence entre une variable NEXT_PUBLIC_ et une variable sans préfixe ?|NEXT_PUBLIC_ (ou NUXT_PUBLIC_ / runtimeConfig.public) est exposée au navigateur : elle finit dans le bundle JS téléchargé, donc visible de tous. Sans préfixe public, la variable reste côté serveur. Un secret ne doit jamais être public — il passe par SSM SecureString / Secrets Manager.
Pourquoi faut-il invalider CloudFront après un aws s3 sync ?|CloudFront met les fichiers en cache en edge. Sans invalidation (create-invalidation --paths "/*"), les visiteurs reçoivent l'ancienne version jusqu'à expiration du TTL. L'invalidation force la distribution à recharger depuis l'origine S3.
Quelle commande SST détruit toutes les ressources d'un déploiement et pourquoi est-ce important ?|npx sst remove --stage <stage> détruit Lambda, S3, CloudFront, ACM, DNS créés par le déploiement (selon removal: retain/remove). C'est important pour ne rien laisser payer après une démo : le Free Tier ne couvre pas tout indéfiniment.
Quand préférer Amplify Hosting ou ECS Fargate à SST/Lambda ?|Amplify : prototype/petite équipe, git-connecté, zéro config, SSR Next 12-15 — simple mais moins de contrôle et coût plus élevé à fort trafic. ECS Fargate : contrôle total et pas de cold start, mais on paie le conteneur en continu — pertinent seulement pour un trafic constant/soutenu.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-19-deploy-nuxt-next/README.md`. Tu déploies une vraie app Next/Nuxt SSR minimale sur ton compte AWS avec SST v3 (OpenNext), tu branches une variable d'env, tu vérifies le SSR dans le navigateur, puis tu **détruis** tout avec `sst remove` — vrai outil, zéro harnais simulé.

---

> **Note :** ce module est le **dernier module du parcours 12-aws-cloud**. Le `next` pointe vers `fin-parcours-12-aws-cloud` — tu as couvert l'intégralité du curriculum AWS, de la création du compte (module 00) à la mise en ligne du front (ce module). L'infra TribuZen est complète : réseau, IAM, compute, données, messagerie, auth, observabilité, sécurité, CI/CD, et déploiement front.

← [Module 18 — Projet final : architecture cloud](18-projet-final-architecture-cloud.md)
