# Screencast 00 — Prérequis et vue d'ensemble AWS

## Informations
- **Durée estimée** : 14-15 min
- **Module** : `modules/00-prerequis-et-vue-ensemble.md`
- **Lab associé** : `labs/lab-00-aws-fundamentals/`

## Setup
- [ ] Compte AWS avec accès console
- [ ] AWS CLI installé et configuré
- [ ] Node.js 20+ et TypeScript

## Script

### [00:00-02:00] Introduction — Pourquoi AWS ?

> Bienvenue dans ce cours AWS Cloud orienté développeur fullstack JavaScript. L'objectif n'est pas de devenir architecte cloud — c'est de comprendre suffisamment AWS pour déployer, opérer et debugger vos applications en production.

**Action** : Afficher la console AWS.

> AWS c'est 200+ services. On va en couvrir une vingtaine — ceux qu'un dev fullstack JS utilise au quotidien. IAM, S3, Lambda, CDK, CloudFront, DynamoDB, RDS, et plus.

### [02:00-05:00] Tour de la console AWS

> Voyons les bases de la console.

**Action** : Naviguer dans la console — montrer les régions, les services récents, CloudShell.

> Chaque service AWS est régional. eu-west-1 c'est l'Irlande, us-east-1 la Virginie. Vos ressources vivent dans une région. Exception : IAM et CloudFront sont globaux.

### [05:00-09:00] AWS CLI et SDK

> En tant que dev, vous allez surtout utiliser le CLI et le SDK TypeScript.

**Action** : Terminal — montrer `aws configure`, `aws sts get-caller-identity`.

> Le SDK v3 est modulaire — on importe uniquement les clients nécessaires. `@aws-sdk/client-s3`, `@aws-sdk/client-lambda`, etc. Fini le SDK v2 monolithique.

### [09:00-12:00] Lab — Premier contact

**Action** : Ouvrir le lab et exécuter les premiers exercices.

### [12:00-14:00] Récap et plan du cours

> On va suivre un parcours logique : IAM d'abord (sécurité), puis VPC/EC2 (réseau/compute), S3, CDK, Lambda, API Gateway, bases de données, et enfin déploiement d'une vraie app Nuxt/Next.

### Notes d'enregistrement
- Parler lentement sur les concepts clés (régions, services globaux vs régionaux)
- Montrer la barre de recherche de la console (très utile)
