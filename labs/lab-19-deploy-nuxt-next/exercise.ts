// =============================================================================
// Lab 19 — Déployer Nuxt/Next sur AWS (simulation en TypeScript)
// =============================================================================
// Executer avec : npx tsx exercise.ts
// =============================================================================

// =============================================================================
// Types
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
// Objectif : Générer un plan de déploiement AWS selon la config.
//
// TODO: Implementez generateDeployPlan(config) qui retourne :
//   - Pour mode 'static' : S3 bucket + CloudFront (+ Route53 + ACM si domain)
//     Coût estimé : $5/mois
//   - Pour mode 'ssr' : Lambda + API Gateway + S3 + CloudFront (+ Route53 + ACM si domain)
//     Coût estimé : $15/mois
//   - deploySteps : liste ordonnée des étapes de déploiement
//
// 💡 Indice : Si config.domain est défini, ajouter Route53 et ACM au plan

function generateDeployPlan(_config: DeployConfig): DeployPlan {
  // TODO: Générer le plan selon static/ssr et domain
  console.log('  TODO: Implementer generateDeployPlan()');
  return { resources: [], estimatedMonthlyCost: 0, deploySteps: [] };
}

// =============================================================================
// PARTIE 2 — SSM Parameter Store (simulation)
// =============================================================================
// Objectif : Simuler le Parameter Store pour gérer les env vars.
//
// TODO: Implementez ParameterStore avec :
//   - putParameter(name, value, type) : stocker le paramètre
//     Si type='SecureString', stocker la valeur chiffrée (base64)
//   - getParameter(name, withDecryption) : lire le paramètre
//     Si withDecryption=true et type=SecureString, déchiffrer
//   - getParametersByPath(path) : retourner tous les paramètres
//     dont le nom commence par path

class ParameterStore {
  private params = new Map<string, SSMParameter>();

  putParameter(_name: string, _value: string, _type: 'String' | 'SecureString'): void {
    // TODO: Stocker (chiffrer si SecureString)
    console.log('  TODO: Implementer putParameter()');
  }

  getParameter(_name: string, _withDecryption = false): string | null {
    // TODO: Lire (déchiffrer si nécessaire)
    console.log('  TODO: Implementer getParameter()');
    return null;
  }

  getParametersByPath(_path: string): SSMParameter[] {
    // TODO: Filtrer par préfixe
    console.log('  TODO: Implementer getParametersByPath()');
    return [];
  }
}

// =============================================================================
// PARTIE 3 — GitHub Actions OIDC validator
// =============================================================================
// Objectif : Valider qu'un token OIDC GitHub correspond au rôle IAM autorisé.
//
// TODO: Implementez validateOIDCToken(token, allowedRepos) qui :
//   1. Parse le token (JSON avec fields: repo, ref, actor)
//   2. Vérifie que repo est dans allowedRepos
//   3. Vérifie que ref est 'refs/heads/main' (seul main peut déployer)
//   4. Retourne { valid: true, repo, actor } ou { valid: false, reason }

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

function validateOIDCToken(_tokenJson: string, _allowedRepos: string[]): OIDCResult {
  // TODO: Parser et valider le token
  console.log('  TODO: Implementer validateOIDCToken()');
  return { valid: false, reason: 'Not implemented' };
}

// =============================================================================
// PARTIE 4 — CloudFront invalidation planner
// =============================================================================
// Objectif : Optimiser les invalidations CloudFront (les 1000 premières
// par mois sont gratuites, ensuite $0.005 par path).
//
// TODO: Implementez planInvalidation(changedFiles) qui :
//   - Si <= 10 fichiers changés : invalider chaque fichier individuellement
//   - Si > 10 fichiers dans le même répertoire : invalider le répertoire /*
//   - Retourner le nombre de paths d'invalidation et le coût estimé

interface InvalidationPlan {
  paths: string[];
  pathCount: number;
  estimatedCost: number; // $0.005 par path au-delà de 1000/mois
}

function planInvalidation(_changedFiles: string[], _monthlyInvalidationsUsed: number): InvalidationPlan {
  // TODO: Optimiser les invalidations
  console.log('  TODO: Implementer planInvalidation()');
  return { paths: [], pathCount: 0, estimatedCost: 0 };
}

// =============================================================================
// Tests automatisés
// =============================================================================

async function runTests() {
  console.log('\n=== Lab 19 — Déployer Nuxt/Next sur AWS ===\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Deploy plan static
  const staticPlan = generateDeployPlan({
    framework: 'nuxt', mode: 'static', region: 'eu-west-1', stage: 'prod',
  });
  const hasS3 = staticPlan.resources.some((r) => r.type === 's3-bucket');
  const hasCF = staticPlan.resources.some((r) => r.type === 'cloudfront');
  const noLambda = !staticPlan.resources.some((r) => r.type === 'lambda');

  if (hasS3 && hasCF && noLambda && staticPlan.estimatedMonthlyCost === 5) {
    console.log('  ✅ Test 1: Plan static correct (S3 + CloudFront, pas de Lambda, $5/mois)');
    passed++;
  } else {
    console.log(`  ❌ Test 1: Plan static echoue (S3=${hasS3}, CF=${hasCF}, noLambda=${noLambda}, cost=${staticPlan.estimatedMonthlyCost})`);
    failed++;
  }

  // Test 2: Deploy plan SSR with domain
  const ssrPlan = generateDeployPlan({
    framework: 'nextjs', mode: 'ssr', domain: 'app.example.com', region: 'eu-west-1', stage: 'prod',
  });
  const hasLambda = ssrPlan.resources.some((r) => r.type === 'lambda');
  const hasRoute53 = ssrPlan.resources.some((r) => r.type === 'route53-record');
  const hasACM = ssrPlan.resources.some((r) => r.type === 'acm-cert');

  if (hasLambda && hasRoute53 && hasACM && ssrPlan.estimatedMonthlyCost === 15) {
    console.log('  ✅ Test 2: Plan SSR+domain correct (Lambda + Route53 + ACM, $15/mois)');
    passed++;
  } else {
    console.log(`  ❌ Test 2: Plan SSR echoue (Lambda=${hasLambda}, R53=${hasRoute53}, ACM=${hasACM}, cost=${ssrPlan.estimatedMonthlyCost})`);
    failed++;
  }

  // Test 3: SSM Parameter Store
  const ssm = new ParameterStore();
  ssm.putParameter('/app/prod/API_KEY', 'secret123', 'SecureString');
  ssm.putParameter('/app/prod/APP_NAME', 'MyApp', 'String');
  ssm.putParameter('/app/dev/API_KEY', 'dev-key', 'String');

  const encrypted = ssm.getParameter('/app/prod/API_KEY', false);
  const decrypted = ssm.getParameter('/app/prod/API_KEY', true);
  const prodParams = ssm.getParametersByPath('/app/prod/');

  if (encrypted !== 'secret123' && decrypted === 'secret123' && prodParams.length === 2) {
    console.log('  ✅ Test 3: SSM Parameter Store fonctionne (chiffrement + path filter)');
    passed++;
  } else {
    console.log(`  ❌ Test 3: SSM echoue (encrypted=${encrypted}, decrypted=${decrypted}, prodParams=${prodParams.length})`);
    failed++;
  }

  // Test 4: OIDC validation
  const validToken = JSON.stringify({ repo: 'smaurier/my-app', ref: 'refs/heads/main', actor: 'smaurier', aud: 'sts.amazonaws.com' });
  const invalidBranch = JSON.stringify({ repo: 'smaurier/my-app', ref: 'refs/heads/feature', actor: 'smaurier', aud: 'sts.amazonaws.com' });
  const invalidRepo = JSON.stringify({ repo: 'hacker/my-app', ref: 'refs/heads/main', actor: 'hacker', aud: 'sts.amazonaws.com' });

  const r1 = validateOIDCToken(validToken, ['smaurier/my-app']);
  const r2 = validateOIDCToken(invalidBranch, ['smaurier/my-app']);
  const r3 = validateOIDCToken(invalidRepo, ['smaurier/my-app']);

  if (r1.valid && !r2.valid && !r3.valid) {
    console.log('  ✅ Test 4: OIDC validation correcte (main OK, feature KO, wrong repo KO)');
    passed++;
  } else {
    console.log(`  ❌ Test 4: OIDC echoue (valid=${r1.valid}, invalidBranch=${r2.valid}, invalidRepo=${r3.valid})`);
    failed++;
  }

  // Test 5: CloudFront invalidation
  const fewFiles = ['/index.html', '/about.html', '/contact.html'];
  const plan1 = planInvalidation(fewFiles, 0);

  const manyFiles = Array.from({ length: 15 }, (_, i) => `/assets/img-${i}.png`);
  const plan2 = planInvalidation(manyFiles, 995);

  if (plan1.pathCount === 3 && plan1.estimatedCost === 0
    && plan2.pathCount === 1 && plan2.estimatedCost === 0) {
    console.log('  ✅ Test 5: Invalidation planifiée (3 fichiers=3 paths, 15 fichiers=1 wildcard)');
    passed++;
  } else {
    console.log(`  ❌ Test 5: Invalidation echoue (plan1: ${plan1.pathCount} paths/$${plan1.estimatedCost}, plan2: ${plan2.pathCount} paths/$${plan2.estimatedCost})`);
    failed++;
  }

  console.log(`\n  Resultats: ${passed}/${passed + failed} tests passes\n`);
}

setTimeout(runTests, 0);
