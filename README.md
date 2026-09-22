# AWS Cloud — Formation Complète

![VitePress](https://img.shields.io/badge/-VitePress-646CFF?style=flat-square&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
[![fullstack-autotraining](https://img.shields.io/badge/curriculum-fullstack--autotraining-4C1?style=flat-square)](https://github.com/smaurier/fullstack-autotraining)

De zéro à l'architecture cloud professionnelle avec TypeScript.

<!-- labs-gestes:start -->
## Labs — refonte du 22/09/2026 : un lab = un geste métier complet

> Règle qualité 5 du parcours : chaque lab est **un geste métier complet**, sous deux formes — **Zéro** (construire de zéro un artefact réel et entier) ou **Intervention** (modifier de l'existant avec consommateurs, findings avant code, non-régression). Un lab n'entre en file qu'avec un **oracle exécutable** (`src/` starter · `test/` · `solution/` séparée). Les labs historiques de ce cours (un concept par lab, sans oracle) restent dans `labs/` jusqu'à remplacement et **ne sont plus la file**. Cible détaillée : [`docs/gestes-complets.md`](../docs/gestes-complets.md). État : **0/3 avec oracle**.

| # | Lab | Forme | Geste | Oracle |
|---|-----|-------|-------|--------|
| 01 | `lab-01-deployer-tribuzen` | Zéro | IAM, S3, Lambda/ECS, RDS, CloudFront — geste transverse avec 15 et 16 | · à écrire |
| 02 | `lab-02-deploiement-casse` | Intervention | diagnostiquer | · à écrire |
| 03 | `lab-03-facture-a-reduire` | Intervention | FinOps réel | · à écrire |

<!-- labs-gestes:end -->

## Lancer le cours

```bash
pnpm install          # une seule fois
pnpm run docs:dev     # ouvre http://localhost:5173
```

## Structure

```
aws-autotraining/
├── modules/          ← Cours théoriques
├── labs/             ← Exercices pratiques
├── quizzes/          ← Quiz interactifs
├── screencasts/      ← Démos enregistrées
└── index.md          ← Page d'accueil VitePress
```

## Parcours

19 modules couvrant les services AWS essentiels, de IAM à une architecture serverless complète.

1. **Fondations Cloud** : IAM, VPC, EC2, S3
2. **Serverless & APIs** : Lambda, API Gateway, DynamoDB, SQS/SNS/EventBridge, Cognito

## Prérequis

- Node.js >= 20
