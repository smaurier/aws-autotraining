# Lab 01 — De zéro : déployer TribuZen de bout en bout

> **Outcome :** une API TribuZen (familles) tourne réellement sur AWS — Lambda + API Gateway
> HTTP, connectée à un vrai Postgres RDS — avec une page statique servie par CloudFront
> depuis S3. **Un seul geste transverse sur les cours 12 (AWS), 15 (CI/CD) et 16
> (observabilité)** — pas 55 labs séparés.
> **Vrai outil :** Terraform (IaC), AWS CLI, un vrai compte AWS.
> **État :** infrastructure écrite et validée localement (`terraform validate` GREEN, `terraform
> plan` s'arrête exactement au point attendu — l'absence de credentials AWS, rien d'autre).
> **PAS ENCORE DÉPLOYÉ** — en attente d'un compte AWS + des identifiants IAM de Sylvain.

## Prérequis technique

- Un compte AWS (créé après le 15/07/2025 → nouveau modèle par crédits, voir module 00 §2.6).
- Un utilisateur IAM dédié (jamais le root — module 00 piège #1), profil CLI `tribuzen-dev`.
- **Avant toute autre chose** : Billing preferences → activer les alertes de facturation,
  puis AWS Budgets → un budget de coût à 5 $/mois avec alerte à 80 %/100 % (module 00 §2.6).
- Terraform ≥ 1.9, AWS CLI (installés localement pour ce lab : `terraform` dans
  `~/.local/bin`, `aws` v1 via `pip install --user awscli`).

## Lire avant (une lecture bornée)

- Module [`00-prerequis-et-vue-ensemble.md`](../../modules/00-prerequis-et-vue-ensemble.md) —
  compte, régions, IAM root vs utilisateur, Free Tier post-2025, maîtrise des coûts.
- Module [`06-lambda-serverless.md`](../../modules/06-lambda-serverless.md),
  [`07-api-gateway.md`](../../modules/07-api-gateway.md),
  [`08-rds-elasticache.md`](../../modules/08-rds-elasticache.md),
  [`04-s3-stockage-objets.md`](../../modules/04-s3-stockage-objets.md),
  [`13-cloudfront-cdn.md`](../../modules/13-cloudfront-cdn.md) — chaque brique déployée ici.
- Module [`18-projet-final-architecture-cloud.md`](../../modules/18-projet-final-architecture-cloud.md) —
  l'architecture de référence du cours (le choix RDS vs DynamoDB de ce lab en diverge
  délibérément, voir §Architecture ci-dessous).

## Architecture

```
Internet ──▶ CloudFront (S3 statique)
Internet ──▶ API Gateway HTTP ──▶ Lambda (Node, pg) ──▶ RDS Postgres
```

**RDS Postgres, pas DynamoDB** (le module 18 illustre DynamoDB) : décision assumée — le
différenciateur marché visé par ce parcours est NestJS + PostgreSQL, pas le NoSQL. Ce lab
prouve "je fais tourner mon stack Postgres en prod sur du vrai cloud", pas une architecture
serverless générique.

**Pas de NestJS sur Lambda** : la logique métier "familles" existe déjà, testée, dans
`09-nestjs/labs/lab-01-api-de-zero`. Réutiliser NestJS sur Lambda (adaptateur
`serverless-express`, cold start) est un vrai chantier à part, hors scope de CE geste — le
sujet ici est l'infra AWS, pas un nouveau pattern applicatif. `app/src/handler.mjs` est du
Node brut avec `pg`.

## Arbitrage sécurité — RDS public, Lambda hors VPC

Le choix "propre" (module 02, VPC) serait Lambda + RDS dans un VPC privé, sans exposition
publique. Concrètement ça exige un **NAT Gateway (~30 €/mois, en continu)** ou des VPC
endpoints payants par service — hors budget d'un lab détruit après usage. Pour ce geste, à
petite échelle : RDS publiquement accessible, sécurisé par un security group (port 5432
uniquement), un mot de passe fort généré aléatoirement (jamais tapé à la main, jamais
committé — `random_password` Terraform), TLS imposé côté client. **C'est un compromis
documenté pour ce lab, pas la bonne pratique en production** — le module 02 enseigne la
version VPC correcte.

## Étapes

1. Créer le compte AWS, activer les alertes de facturation + un budget (voir Prérequis).
2. Créer l'utilisateur IAM `sylvain-dev`, générer ses clés d'accès.
3. `aws configure --profile tribuzen-dev` (région `eu-west-3`, format `json`).
4. `aws sts get-caller-identity --profile tribuzen-dev` — vérifier que l'ARN ne finit PAS
   par `:root`.
5. `cd 12-aws-cloud/labs/lab-01-deployer-tribuzen/app && npm install --omit=dev` (les
   dépendances doivent être présentes AVANT le zip Lambda).
6. `cd ../infra && terraform init && AWS_PROFILE=tribuzen-dev terraform plan` — relire le
   plan avant d'appliquer quoi que ce soit (module 00 : ne jamais appliquer à l'aveugle).
7. `AWS_PROFILE=tribuzen-dev terraform apply`.
8. Une fois appliqué : `psql "postgresql://<db_username>:<mot de passe>@$(terraform output
   -raw rds_endpoint):5432/tribuzen?sslmode=require" -f ../app/schema.sql` (le mot de passe :
   `terraform output db_master_password`, sensible, jamais loggé en clair ailleurs).
9. Vérifier : `curl $(terraform output -raw api_endpoint)/health` → `{"status":"ok","db":"connected"}`.
10. `curl $(terraform output -raw cloudfront_domain)` → la page statique.
11. **Détruire en fin de session de travail** : `AWS_PROFILE=tribuzen-dev terraform destroy`
    — rien ne doit rester en vie entre deux sessions tant que ce n'est pas une démo qu'on
    veut garder en ligne.

## Vérifier (ce qui est déjà prouvé, sans AWS)

```bash
cd 12-aws-cloud/labs/lab-01-deployer-tribuzen/infra
terraform init
terraform validate   # GREEN
terraform fmt -check # GREEN, aucun diff
terraform plan       # calcule tout ce qui ne dépend pas d'AWS (random_id, random_password),
                      # puis s'arrête PRÉCISÉMENT sur l'absence du profil AWS — rien d'autre
```

## Coût estimé (avant apply, méthode module 00 §2.5 — jamais au pif)

- RDS `db.t4g.micro`, 20 Go gp3 : éligible aux crédits/free tier ; en continu au tarif
  standard eu-west-3, de l'ordre de 15-20 $/mois si jamais détruit — d'où l'étape 11.
- Lambda + API Gateway HTTP : gratuit à ce niveau d'usage (largement sous les quotas
  "always free").
- S3 + CloudFront : quelques centimes pour un lab (stockage minime, `PriceClass_100`).
- **Budget AWS à 5 $/mois posé AVANT tout `apply`** — le vrai garde-fou.

## Application TribuZen

C'est littéralement le geste : ce lab EST le premier déploiement réel de TribuZen sur AWS,
pas un exercice à côté. Commit après le premier `apply` réussi :
`feat(infra): TribuZen déployé de bout en bout sur AWS (Lambda + RDS + S3/CloudFront)`.
