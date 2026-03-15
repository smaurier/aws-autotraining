// =============================================================================
// Lab 19 — Déployer Nuxt/Next sur AWS (Solution)
// =============================================================================
// Executer avec : npx tsx solution.ts
// =============================================================================

interface DeployConfig {
  framework: 'nuxt' | 'nextjs';
  mode: 'static' | 'ssr';
  domain?: string;
  region: string;
  stage: 'dev' | 'staging' | 'prod';
}

interface AWSResource {
  type: 's3-bucket' | 'cloudfront' | 'lambda' | 'api-gateway' | 'route53-record' | 'acm-cert' | 'ecs-service';
  name: string;
  config: Record<string, unknown>;
}

interface DeployPlan {
  resources: AWSResource[];
  estimatedMonthlyCost: number;
  deploySteps: string[];
}

interface SSMParameter {
  name: string;
  value: string;
  type: 'String' | 'SecureString';
}

// =============================================================================
// PARTIE 1 — Planificateur de déploiement
// =============================================================================

function generateDeployPlan(config: DeployConfig): DeployPlan {
  const resources: AWSResource[] = [];
  const steps: string[] = [];

  // POURQUOI : S3 est toujours nécessaire — en static pour héberger le site,
  // en SSR pour les assets statiques (JS/CSS/images).
  resources.push({
    type: 's3-bucket',
    name: `${config.stage}-assets`,
    config: { region: config.region, publicAccess: config.mode === 'static' },
  });
  steps.push('Créer le bucket S3 pour les assets');

  if (config.mode === 'ssr') {
    // POURQUOI : En SSR, on a besoin d'un serveur pour le rendu côté serveur.
    // Lambda est le choix serverless — scale to zero, pas de serveur à gérer.
    resources.push({
      type: 'lambda',
      name: `${config.stage}-ssr`,
      config: { runtime: 'nodejs20.x', memory: 1024, timeout: 30 },
    });
    resources.push({
      type: 'api-gateway',
      name: `${config.stage}-api`,
      config: { type: 'HTTP_API' },
    });
    steps.push('Déployer la Lambda SSR');
    steps.push('Configurer API Gateway');
  }

  // POURQUOI : CloudFront devant tout — cache les assets statiques,
  // termine le TLS, et distribue globalement via les edge locations.
  resources.push({
    type: 'cloudfront',
    name: `${config.stage}-cdn`,
    config: { origins: config.mode === 'ssr' ? ['s3', 'api-gateway'] : ['s3'] },
  });
  steps.push('Créer la distribution CloudFront');

  if (config.domain) {
    // POURQUOI : Le certificat ACM DOIT être dans us-east-1 pour CloudFront,
    // même si le reste de l'infra est en eu-west-1. C'est une contrainte AWS.
    resources.push({
      type: 'acm-cert',
      name: config.domain,
      config: { region: 'us-east-1', validation: 'DNS' },
    });
    resources.push({
      type: 'route53-record',
      name: config.domain,
      config: { type: 'ALIAS', target: 'cloudfront' },
    });
    steps.push('Créer le certificat ACM (us-east-1)');
    steps.push('Configurer le record Route 53');
  }

  steps.push('Synchroniser les assets vers S3');
  if (config.mode === 'static') {
    steps.push('Invalider le cache CloudFront');
  }

  return {
    resources,
    estimatedMonthlyCost: config.mode === 'static' ? 5 : 15,
    deploySteps: steps,
  };
}

// =============================================================================
// PARTIE 2 — SSM Parameter Store
// =============================================================================

class ParameterStore {
  private params = new Map<string, SSMParameter>();

  putParameter(name: string, value: string, type: 'String' | 'SecureString'): void {
    // POURQUOI : SecureString chiffre la valeur avec KMS.
    // On simule avec base64 — en vrai c'est AES-256 via AWS KMS.
    const storedValue = type === 'SecureString'
      ? Buffer.from(value).toString('base64')
      : value;
    this.params.set(name, { name, value: storedValue, type });
  }

  getParameter(name: string, withDecryption = false): string | null {
    const param = this.params.get(name);
    if (!param) return null;
    // POURQUOI : Sans withDecryption, on retourne la valeur chiffrée.
    // C'est une sécurité : le code doit explicitement demander le déchiffrement.
    if (param.type === 'SecureString' && withDecryption) {
      return Buffer.from(param.value, 'base64').toString('utf-8');
    }
    return param.value;
  }

  getParametersByPath(path: string): SSMParameter[] {
    // POURQUOI : Organiser les paramètres par path (/app/prod/, /app/dev/)
    // permet de charger toutes les env vars d'un environnement en une requête.
    const results: SSMParameter[] = [];
    for (const [name, param] of this.params) {
      if (name.startsWith(path)) {
        results.push(param);
      }
    }
    return results;
  }
}

// =============================================================================
// PARTIE 3 — OIDC validation
// =============================================================================

interface OIDCToken {
  repo: string;
  ref: string;
  actor: string;
  aud: string;
}

interface OIDCResult {
  valid: boolean;
  repo?: string;
  actor?: string;
  reason?: string;
}

function validateOIDCToken(tokenJson: string, allowedRepos: string[]): OIDCResult {
  // POURQUOI : OIDC évite de stocker des clés AWS dans GitHub.
  // Le rôle IAM fait confiance à la fédération GitHub et vérifie
  // le repo et la branche. On ne déploie que depuis main.
  let token: OIDCToken;
  try {
    token = JSON.parse(tokenJson);
  } catch {
    return { valid: false, reason: 'Invalid token JSON' };
  }

  if (!allowedRepos.includes(token.repo)) {
    return { valid: false, reason: `Repository ${token.repo} not allowed` };
  }

  if (token.ref !== 'refs/heads/main') {
    return { valid: false, reason: `Branch ${token.ref} not allowed (only main)` };
  }

  return { valid: true, repo: token.repo, actor: token.actor };
}

// =============================================================================
// PARTIE 4 — CloudFront invalidation
// =============================================================================

interface InvalidationPlan {
  paths: string[];
  pathCount: number;
  estimatedCost: number;
}

function planInvalidation(changedFiles: string[], monthlyInvalidationsUsed: number): InvalidationPlan {
  // POURQUOI : CloudFront offre 1000 invalidations gratuites par mois.
  // Au-delà, c'est $0.005 par path. Invalider un wildcard (/assets/*)
  // compte comme 1 path, donc c'est plus économique quand beaucoup
  // de fichiers changent dans le même répertoire.
  let paths: string[];

  if (changedFiles.length <= 10) {
    paths = [...changedFiles];
  } else {
    // Regrouper par répertoire parent
    const dirs = new Set<string>();
    for (const file of changedFiles) {
      const dir = file.substring(0, file.lastIndexOf('/'));
      dirs.add(dir || '/');
    }
    paths = [...dirs].map((d) => d === '/' ? '/*' : `${d}/*`);
  }

  const newTotal = monthlyInvalidationsUsed + paths.length;
  const billablePaths = Math.max(0, newTotal - 1000);
  const estimatedCost = Math.round(billablePaths * 0.005 * 1000) / 1000;

  return { paths, pathCount: paths.length, estimatedCost };
}

// =============================================================================
// Tests
// =============================================================================

async function runTests() {
  console.log('\n=== Lab 19 — Déployer Nuxt/Next sur AWS (Solution) ===\n');

  let passed = 0;
  let failed = 0;

  // Test 1
  const staticPlan = generateDeployPlan({ framework: 'nuxt', mode: 'static', region: 'eu-west-1', stage: 'prod' });
  const hasS3 = staticPlan.resources.some((r) => r.type === 's3-bucket');
  const hasCF = staticPlan.resources.some((r) => r.type === 'cloudfront');
  const noLambda = !staticPlan.resources.some((r) => r.type === 'lambda');
  if (hasS3 && hasCF && noLambda && staticPlan.estimatedMonthlyCost === 5) {
    console.log('  ✅ Test 1: Plan static correct'); passed++;
  } else { console.log('  ❌ Test 1: Plan static echoue'); failed++; }

  // Test 2
  const ssrPlan = generateDeployPlan({ framework: 'nextjs', mode: 'ssr', domain: 'app.example.com', region: 'eu-west-1', stage: 'prod' });
  const hasLambda = ssrPlan.resources.some((r) => r.type === 'lambda');
  const hasR53 = ssrPlan.resources.some((r) => r.type === 'route53-record');
  const hasACM = ssrPlan.resources.some((r) => r.type === 'acm-cert');
  if (hasLambda && hasR53 && hasACM && ssrPlan.estimatedMonthlyCost === 15) {
    console.log('  ✅ Test 2: Plan SSR+domain correct'); passed++;
  } else { console.log('  ❌ Test 2: Plan SSR echoue'); failed++; }

  // Test 3
  const ssm = new ParameterStore();
  ssm.putParameter('/app/prod/API_KEY', 'secret123', 'SecureString');
  ssm.putParameter('/app/prod/APP_NAME', 'MyApp', 'String');
  ssm.putParameter('/app/dev/API_KEY', 'dev-key', 'String');
  const encrypted = ssm.getParameter('/app/prod/API_KEY', false);
  const decrypted = ssm.getParameter('/app/prod/API_KEY', true);
  const prodParams = ssm.getParametersByPath('/app/prod/');
  if (encrypted !== 'secret123' && decrypted === 'secret123' && prodParams.length === 2) {
    console.log('  ✅ Test 3: SSM Parameter Store fonctionne'); passed++;
  } else { console.log(`  ❌ Test 3: SSM echoue (enc=${encrypted}, dec=${decrypted}, params=${prodParams.length})`); failed++; }

  // Test 4
  const valid = JSON.stringify({ repo: 'smaurier/my-app', ref: 'refs/heads/main', actor: 'smaurier', aud: 'sts.amazonaws.com' });
  const badBranch = JSON.stringify({ repo: 'smaurier/my-app', ref: 'refs/heads/feature', actor: 'smaurier', aud: 'sts.amazonaws.com' });
  const badRepo = JSON.stringify({ repo: 'hacker/my-app', ref: 'refs/heads/main', actor: 'hacker', aud: 'sts.amazonaws.com' });
  const r1 = validateOIDCToken(valid, ['smaurier/my-app']);
  const r2 = validateOIDCToken(badBranch, ['smaurier/my-app']);
  const r3 = validateOIDCToken(badRepo, ['smaurier/my-app']);
  if (r1.valid && !r2.valid && !r3.valid) {
    console.log('  ✅ Test 4: OIDC validation correcte'); passed++;
  } else { console.log('  ❌ Test 4: OIDC echoue'); failed++; }

  // Test 5
  const plan1 = planInvalidation(['/index.html', '/about.html', '/contact.html'], 0);
  const manyFiles = Array.from({ length: 15 }, (_, i) => `/assets/img-${i}.png`);
  const plan2 = planInvalidation(manyFiles, 995);
  if (plan1.pathCount === 3 && plan1.estimatedCost === 0 && plan2.pathCount === 1 && plan2.estimatedCost === 0) {
    console.log('  ✅ Test 5: Invalidation planifiée correctement'); passed++;
  } else { console.log(`  ❌ Test 5: Invalidation echoue (${plan1.pathCount}/${plan2.pathCount})`); failed++; }

  console.log(`\n  Resultats: ${passed}/${passed + failed} tests passes\n`);
}

setTimeout(runTests, 0);
