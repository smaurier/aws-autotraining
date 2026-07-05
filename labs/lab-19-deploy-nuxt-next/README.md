# Lab 19 — Déployer une app Nuxt/Next SSR sur AWS

> **Outcome :** à la fin, tu as mis une vraie app Nuxt (ou Next) **SSR** en ligne sur AWS avec **SST v3 (OpenNext)**, branché une variable d'environnement, vérifié le rendu serveur dans le navigateur, puis **tout détruit**.
> **Vrai outil :** SST v3 + AWS CLI, sur **ton** compte AWS (pas un harnais simulé). Le déploiement crée de vraies ressources Lambda + S3 + CloudFront.
> **Feedback :** le coach valide en session — l'URL déployée s'ouvre, le SSR est visible dans `view-source`, et le `sst remove` ne laisse rien derrière.

> ⚠️ **Coût & Free Tier.** Ce lab crée des ressources réelles (Lambda, S3, CloudFront). Elles restent dans le Free Tier pour un usage de test ponctuel, **mais seulement si tu détruis à la fin** (étape Teardown, obligatoire). Ne saute pas le `sst remove`.

> **Prérequis machine :** un compte AWS avec l'AWS CLI configurée (module 00), Node 20+, et les droits IAM pour créer Lambda/S3/CloudFront/IAM. **Pas besoin de domaine ni de Route 53** pour ce lab : on déploie sur l'URL CloudFront générée par SST (le domaine custom + ACM est en variante).

---

## Énoncé

Tu déploies le front-office TribuZen (version minimale) en SSR sur AWS.

**Cahier des charges exact :**

1. Créer une app **Nuxt 3** (ou Next.js) minimale avec **au moins une page rendue côté serveur** qui affiche une donnée non figée au build (ex. l'heure serveur, ou une valeur lue dans `process.env` au runtime).
2. Ajouter **SST v3** au projet et le configurer pour déployer cette app.
3. Injecter une **variable d'environnement** exposée au navigateur (ex. `VUE_APP_API_URL` en Nuxt / `NEXT_PUBLIC_API_URL` en Next) et l'afficher dans la page.
4. Déployer sur un **stage `dev`** (`removal: 'remove'`), récupérer l'**URL CloudFront**.
5. **Prouver que le SSR fonctionne** : ouvrir `view-source` sur l'URL et vérifier que le HTML contient la donnée dynamique (pas une coquille vide hydratée côté client).
6. **Teardown** : détruire toutes les ressources avec `sst remove`.

**Pas de gap-fill** — tu écris `sst.config.ts` toi-même à partir du starter ci-dessous.

### Starter minimal

```bash
# 1. App Nuxt minimale
npx nuxi@latest init tribuzen-web
cd tribuzen-web
npm install

# 2. Ajouter SST au projet (détecte Nuxt, génère un sst.config.ts de base)
npx sst@latest init
```

Page SSR de démonstration — `pages/index.vue` (Nuxt) :

```vue
<script setup lang="ts">
// useState + rendu serveur : la valeur est calculée sur le serveur à chaque requête
const serverTime = useState('t', () => new Date().toISOString())
// variable d'env exposée au navigateur (voir sst.config.ts)
const apiUrl = 'API: ' + (import.meta.env.VUE_APP_API_URL ?? 'non définie')
</script>

<template>
  <main>
    <h1>TribuZen — déployé sur AWS</h1>
    <!-- Rendu côté serveur : doit apparaître dans view-source -->
    <p>Heure serveur au rendu : {{ serverTime }}</p>
    <p>{{ apiUrl }}</p>
  </main>
</template>
```

À toi d'écrire `sst.config.ts` (bloc `app()` + `run()` avec le composant `sst.aws.Nuxt`).

---

## Étapes (en friction)

1. **Vérifie ton identité AWS** — `aws sts get-caller-identity` doit renvoyer ton compte/rôle. Sinon, configure la CLI (module 00).
2. **Écris `app()`** dans `sst.config.ts` : `name`, `home: 'aws'`, et surtout `removal: input?.stage === 'prod' ? 'retain' : 'remove'` (pour que le stage `dev` soit détruisible).
3. **Écris `run()`** : instancie `new sst.aws.Nuxt('Web', { path: '.', environment: { VUE_APP_API_URL: 'https://api.tribuzen.fr' } })` et retourne `site.url`.
4. **Déploie** — `npx sst deploy --stage dev`. Observe SST construire l'app, packager la Lambda SSR, créer S3 + CloudFront. Note l'URL affichée à la fin.
5. **Ouvre l'URL** dans le navigateur. La page s'affiche.
6. **Prouve le SSR** — `view-source:` sur l'URL (ou `curl <url>`). L'heure serveur et la ligne API **doivent être dans le HTML brut**, pas injectées après coup par le JS.
7. **Modifie la variable d'env** dans `sst.config.ts`, redéploie, et constate le changement (rappel : var build-time → un redeploy est nécessaire).
8. **Teardown obligatoire** — `npx sst remove --stage dev`. Attends la fin. Vérifie qu'il ne reste rien.

---

## Corrigé complet commenté

`sst.config.ts` :

```ts
// sst.config.ts — déploiement SSR de l'app Nuxt TribuZen sur AWS
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  // --- app() : métadonnées globales du déploiement ---
  app(input) {
    return {
      name: 'tribuzen-web',
      home: 'aws',              // provider cible : AWS
      // prod : on CONSERVE les ressources (removal retain) pour ne pas détruire par accident.
      // tout autre stage (dev, perso) : 'remove' → sst remove détruit réellement tout.
      removal: input?.stage === 'prod' ? 'retain' : 'remove',
    }
  },

  // --- run() : les ressources à provisionner ---
  async run() {
    const site = new sst.aws.Nuxt('Web', {
      path: '.',                // l'app Nuxt est à la racine du projet
      environment: {
        // Exposée au navigateur via le composant Nuxt de SST.
        // NON secrète : une URL d'API publique. Un secret irait dans sst.Secret / SSM.
        VUE_APP_API_URL: 'https://api.tribuzen.fr',
      },
      // Pas de `domain` ici : on déploie sur l'URL CloudFront générée (pas de Route 53 requis).
      // Le domaine custom + ACM us-east-1 est en variante J+30.
    })

    // Affiche l'URL déployée à la fin de `sst deploy`
    return { url: site.url }
  },
})
```

Séquence de commandes :

```bash
# Déploiement sur le stage dev (destructible)
npx sst deploy --stage dev
# → SST : build Nuxt (Nitro) → adaptateur OpenNext → Lambda SSR + bucket S3 d'assets
#         + distribution CloudFront. Sortie : url = https://xxxx.cloudfront.net

# Preuve du SSR : le HTML brut contient l'heure serveur (pas une coquille vide)
curl -s https://xxxx.cloudfront.net | grep "Heure serveur"
# → <p>Heure serveur au rendu : 2026-07-05T...</p>  ✅ rendu côté serveur

# TEARDOWN — obligatoire, ne rien laisser tourner
npx sst remove --stage dev
# → détruit Lambda, S3, CloudFront. Le stage dev est en removal: 'remove'.
```

**Pourquoi ce corrigé est correct :**
- `removal: 'remove'` sur le stage `dev` garantit que `sst remove` supprime **réellement** les ressources (un stage `prod` en `retain` les conserverait — protection prod).
- `sst.aws.Nuxt` provisionne **la Lambda de SSR** (le compute manquant que S3 seul ne fournit pas), plus S3 pour les assets et CloudFront devant. C'est exactement ce qu'exige une app SSR.
- La preuve par `curl | grep` distingue un **vrai SSR** (donnée dans le HTML de la réponse) d'un rendu client (donnée absente du HTML, injectée après par le JS). C'est le test qui attrape le piège « SSR déployé comme du statique ».
- La variable d'env est **publique et non secrète** — une URL d'API. Un secret (clé, mot de passe) n'irait jamais là : il passerait par `sst.Secret` / SSM SecureString.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé :**

1. Déploie **avec un domaine custom** : ajoute `domain: 'app-<tes-initiales>.<ta-zone>.fr'` au composant (suppose une zone Route 53 t'appartenant). Vérifie que SST crée le **certificat ACM en `us-east-1`** automatiquement et que l'URL HTTPS custom répond.
2. Remplace l'URL d'API en clair par un **secret** : crée `const apiKey = new sst.Secret('ApiKey')`, référence-le côté serveur uniquement, et confirme qu'il **n'apparaît pas** dans le bundle JS téléchargé (cherche-le dans les sources du navigateur — il ne doit pas y être).
3. Fais-le **en 30 minutes**, teardown inclus.

**Critère de réussite :** l'URL HTTPS custom sert le SSR, le secret est absent du client, et `sst remove` ne laisse aucune ressource (vérifie la console CloudFront/Lambda/ACM).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, le déploiement du front-office vit ici :

```
tribuzen/
  apps/
    web/
      sst.config.ts          ← ce lab : sst.aws.Nuxt, déploiement SSR
      nuxt.config.ts
  .github/workflows/
    deploy.yml               ← module 17 : sst deploy --stage prod via OIDC (pas depuis le poste)
```

**Différences par rapport au lab :**
- En prod, le stage est `prod` (`removal: 'retain'`) et le domaine est le vrai `app.tribuzen.fr` avec ACM géré par SST.
- Le déploiement n'est **pas** lancé à la main : GitHub Actions le déclenche sur `push` vers `main`, authentifié par **OIDC** (aucune clé AWS dans les secrets GitHub — module 17).
- Les vraies variables sensibles (clés de service) passent par `sst.Secret` / SSM Parameter Store, jamais par une var `public`.

**Commit cible :**
```
chore(web): déploiement SSR du front-office sur AWS via SST (OpenNext) + teardown documenté
```

---

> **Teardown — rappel final.** Ce lab a créé de vraies ressources facturables. Avant de fermer la session : `npx sst remove --stage dev` (et pour la variante, supprime aussi le secret et vérifie ACM/CloudFront dans la console). Ne rien laisser tourner.
