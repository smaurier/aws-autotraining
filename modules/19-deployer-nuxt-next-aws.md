# Module 19 — Déployer une app Nuxt/Next sur AWS

> **Durée estimée** : 4h00
> **Difficulté** : 4/5
> **Prérequis** : Module 05 (CDK), Module 06 (Lambda), Module 13 (CloudFront)
> **Objectifs** :
> - Déployer une application Nuxt 3 ou Next.js sur AWS
> - Comprendre les différentes stratégies de déploiement (Lambda, ECS, Amplify, S3 static)
> - Configurer SSM Parameter Store pour les variables d'environnement
> - Mettre en place un CI/CD GitHub Actions → AWS

---

## 1. Vue d'ensemble des options

| Stratégie | SSR ? | Coût | Complexité | Cas d'usage |
|-----------|-------|------|------------|-------------|
| **S3 + CloudFront** (static) | Non | $ | Faible | Sites statiques (nuxi generate / next export) |
| **Lambda@Edge + S3** | Oui | $$ | Moyenne | SSR serverless, trafic variable |
| **Amplify Hosting** | Oui | $$ | Faible | Prototypage rapide, DX maximale |
| **ECS Fargate** | Oui | $$$ | Élevée | Contrôle total, trafic constant |
| **SST** | Oui | $$ | Moyenne | DX TypeScript, intégration AWS native |

---

## 2. Option A — Export statique sur S3 + CloudFront

Pour les sites sans SSR (blog, documentation, landing pages).

### Nuxt 3

```bash
# nuxt.config.ts → ssr: false (ou routeRules prerender)
npx nuxi generate  # Génère dans .output/public/
```

### Déploiement

```bash
# Sync vers S3
aws s3 sync .output/public/ s3://mon-bucket/ --delete

# Invalider le cache CloudFront
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/*"
```

---

## 3. Option B — SSR sur Lambda (via SST)

La solution recommandée pour le SSR serverless avec TypeScript.

### SST v3 (Ion) — recommandé

SST v3 utilise des constructs renommés et une API déclarative sans `stacks()` :

```typescript
// sst.config.ts (SST v3 Ion)
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'my-app',
      removal: input?.stage === 'prod' ? 'retain' : 'remove',
      home: 'aws',
    };
  },
  async run() {
    // Next.js
    new sst.aws.Nextjs('NextSite', {
      path: 'packages/web',
      environment: {
        API_URL: process.env.API_URL!,
      },
      domain: {
        name: 'app.example.com',
        dns: sst.aws.dns({ zone: 'example.com' }),
      },
    });

    // Ou Nuxt 3
    new sst.aws.Nuxt('NuxtSite', {
      path: 'packages/web',
      environment: {
        NUXT_PUBLIC_API_URL: process.env.API_URL!,
      },
    });
  },
});
```

> **Correspondance des noms v2 → v3** :
> `NextjsSite` → `sst.aws.Nextjs` | `NuxtSite` → `sst.aws.Nuxt` | `StaticSite` → `sst.aws.StaticSite` | `SvelteKitSite` → `sst.aws.SvelteKit`

<details>
<summary>Ancienne syntaxe SST v2 (dépréciée)</summary>

```typescript
// sst.config.ts (SST v2 — ne plus utiliser)
import { NextjsSite, NuxtSite } from 'sst/constructs';

export default {
  stacks(app) {
    app.stack(function WebStack({ stack }) {
      new NextjsSite(stack, 'next', {
        path: 'packages/web',
        environment: { API_URL: process.env.API_URL! },
        customDomain: {
          domainName: 'app.example.com',
          hostedZone: 'example.com',
        },
      });

      new NuxtSite(stack, 'nuxt', {
        path: 'packages/web',
        environment: { NUXT_PUBLIC_API_URL: process.env.API_URL! },
      });
    });
  },
};
```

</details>

Ce construct crée automatiquement : Lambda pour le SSR, S3 pour les assets statiques, CloudFront pour la distribution, Route 53 pour le domaine.

---

## 4. Option C — Amplify Hosting

Le plus simple pour démarrer. Amplify détecte automatiquement le framework.

```bash
# Installer Amplify CLI
npm install -g @aws-amplify/cli

# Initialiser
amplify init
amplify add hosting
amplify publish
```

Ou via la console Amplify : connecter le repo GitHub → déploiement automatique à chaque push.

**Avantages** : zero config, preview branches, rollback instantané.
**Inconvénients** : moins de contrôle, coût plus élevé à fort trafic.

---

## 5. Option D — ECS Fargate

Pour un contrôle total ou un trafic constant.

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.output .output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

```typescript
// CDK
const service = new ecs.FargateService(this, 'NuxtService', {
  cluster,
  taskDefinition,
  desiredCount: 2,
  assignPublicIp: false,
});

// ALB devant le service
const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', { vpc, internetFacing: true });
lb.addListener('HTTPS', { port: 443, certificates: [cert] })
  .addTargets('Nuxt', { port: 3000, targets: [service] });
```

---

## 6. Variables d'environnement avec SSM Parameter Store

Ne jamais hardcoder les secrets. Utiliser SSM Parameter Store :

```bash
# Stocker un paramètre
aws ssm put-parameter \
  --name "/myapp/prod/DATABASE_URL" \
  --value "postgresql://..." \
  --type SecureString

# Lire dans Lambda
aws ssm get-parameter \
  --name "/myapp/prod/DATABASE_URL" \
  --with-decryption
```

```typescript
// Dans une Lambda
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
const { Parameter } = await ssm.send(new GetParameterCommand({
  Name: '/myapp/prod/DATABASE_URL',
  WithDecryption: true,
}));
const dbUrl = Parameter!.Value!;
```

---

## 7. CI/CD avec GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # OIDC
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-deploy
          aws-region: eu-west-1

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      # Option A : S3 static
      - run: aws s3 sync .output/public/ s3://mon-bucket/ --delete

      # Option B : SST
      - run: npx sst deploy --stage prod
```

**OIDC** (recommandé) : pas de clés AWS stockées dans GitHub. Le rôle IAM trust la fédération GitHub.

---

## 8. Récapitulatif

| Option | Quand l'utiliser |
|--------|-----------------|
| **S3 + CloudFront** | Site statique, blog, docs |
| **SST (Lambda)** | SSR serverless, TypeScript-first |
| **Amplify** | Prototype rapide, petite équipe |
| **ECS Fargate** | Contrôle total, trafic prévisible |

- **SSM Parameter Store** pour les variables d'environnement (pas de .env en prod)
- **GitHub Actions + OIDC** pour le CI/CD (pas de clés AWS dans les secrets)
- **CloudFront** devant tout pour le cache et le TLS
