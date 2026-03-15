# Screencast 19 — Déployer Nuxt/Next sur AWS

## Informations
- **Durée estimée** : 14-15 min
- **Module** : `modules/19-deployer-nuxt-next-aws.md`
- **Lab associé** : `labs/lab-19-deploy-nuxt-next/`

## Setup
- [ ] Projet Nuxt 3 ou Next.js prêt
- [ ] AWS CLI configuré
- [ ] SST CLI installé (`npm i -g sst`)

## Script

### [00:00-02:00] Introduction — Pourquoi ce module ?

> On arrive au bout du parcours AWS. On a vu IAM, S3, Lambda, CDK, CloudFront, RDS... Maintenant on met tout ensemble pour déployer une vraie application Nuxt ou Next.js.

**Action** : Afficher le tableau des 4 options de déploiement.

> Il y a 4 grandes stratégies : S3 static, SST/Lambda, Amplify, et ECS Fargate. On va les comparer et se concentrer sur les deux plus courantes pour un dev JS.

### [02:00-05:00] Option A — Export statique sur S3

> Si votre site n'a pas besoin de SSR, c'est la solution la plus simple et la moins chère.

**Action** : Montrer `nuxi generate`, le sync S3, l'invalidation CloudFront.

> Le coût ? Environ 5$/mois. CloudFront devant S3, c'est la combinaison classique.

### [05:00-09:00] Option B — SSR avec SST

> Pour le SSR, SST est le meilleur DX en TypeScript. Un `sst.config.ts`, et SST crée Lambda, S3, CloudFront, Route 53 pour vous.

**Action** : Montrer le `sst.config.ts` avec NuxtSite, lancer `sst dev`, faire un changement live.

> Le Live Lambda Development, c'est la killer feature. Vous codez localement, le code s'exécute sur AWS. Hot reload en 1 seconde.

### [09:00-11:30] Variables d'environnement avec SSM

> Jamais de .env en production. On utilise SSM Parameter Store.

**Action** : Créer un paramètre SecureString, le lire depuis une Lambda.

### [11:30-13:00] CI/CD GitHub Actions

> Le déploiement automatique : push sur main → GitHub Actions → AWS.

**Action** : Montrer le workflow YAML avec OIDC (pas de clés AWS dans GitHub).

### [13:00-14:30] Récap

> 4 options, un choix selon vos besoins. S3 static pour les sites simples, SST pour le SSR serverless. SSM pour les secrets, GitHub Actions + OIDC pour le CI/CD.

### Notes d'enregistrement
- Montrer les coûts réels d'un déploiement
- Insister sur OIDC (pas de clés AWS stockées)
- Faire le lien avec les modules CDK (05), Lambda (06), CloudFront (13)
