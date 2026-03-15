// =============================================================================
// Lab 18 — Projet Final : Architecture validator, cost estimator, readiness check
// =============================================================================
// Objectifs :
//   - Valider qu'une architecture contient tous les composants requis
//   - Estimer le cout mensuel d'une architecture
//   - Verifier la "production readiness" d'une architecture
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 18 — Projet Final');

// =============================================================================
// Exercice 1 : Architecture validator
// =============================================================================

interface ArchComponent {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

interface Architecture {
  name: string;
  components: ArchComponent[];
}

const REQUIRED_TYPES = ['compute', 'database', 'storage', 'cdn', 'monitoring'];

interface ValidationResult {
  valid: boolean;
  missingTypes: string[];
  presentTypes: string[];
}

// TODO: Implementez cette fonction
// Verifiez que l'architecture contient au moins un composant de chaque type requis.
// Retournez les types manquants et presents.
function validateArchitecture(arch: Architecture): ValidationResult {
  // TODO
  return { valid: false, missingTypes: [], presentTypes: [] };
}

// =============================================================================
// Exercice 2 : Cost estimator
// =============================================================================

const SERVICE_COSTS: Record<string, number> = {
  'lambda': 0.20,          // par million d'invocations
  'ec2-t3.micro': 7.59,    // par mois
  'ec2-t3.small': 15.18,
  'ec2-t3.medium': 30.37,
  'rds-t3.micro': 12.41,
  'rds-t3.small': 24.82,
  's3': 0.023,             // par Go/mois
  'cloudfront': 0.085,     // par Go transfere
  'elasticache-t3.micro': 11.52,
  'cloudwatch': 0.30,      // par metrique/mois
};

interface ServiceUsage {
  service: string;
  quantity: number;  // nombre d'instances ou unites
}

interface CostEstimate {
  lineItems: { service: string; monthlyCost: number }[];
  totalMonthlyCost: number;
  totalAnnualCost: number;
}

// TODO: Implementez cette fonction
// Calculez le cout mensuel et annuel.
// Pour chaque service : cout = SERVICE_COSTS[service] * quantity
// Si le service n'existe pas dans SERVICE_COSTS, lancez une erreur.
// Arrondissez les couts a 2 decimales.
function estimateCost(services: ServiceUsage[]): CostEstimate {
  // TODO
  return { lineItems: [], totalMonthlyCost: 0, totalAnnualCost: 0 };
}

// =============================================================================
// Exercice 3 : Production readiness checker
// =============================================================================

interface ReadinessCheck {
  name: string;
  pass: boolean;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

// TODO: Implementez cette fonction
// Verifiez les criteres de production readiness :
// 1. CRITICAL: Au moins 2 AZ (availabilityZones >= 2)
// 2. CRITICAL: Backup active (backupEnabled === true)
// 3. CRITICAL: Monitoring present (type 'monitoring' dans components)
// 4. WARNING:  Auto-scaling configure (autoScaling === true dans au moins un compute)
// 5. WARNING:  CDN present (type 'cdn' dans components)
// 6. INFO:     Multi-region (regions >= 2)
function checkProductionReadiness(arch: Architecture & {
  availabilityZones: number;
  regions: number;
  backupEnabled: boolean;
}): { ready: boolean; checks: ReadinessCheck[] } {
  // TODO: ready = true seulement si tous les checks 'critical' passent
  return { ready: false, checks: [] };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — architecture valide', () => {
  const arch: Architecture = {
    name: 'web-app',
    components: [
      { name: 'API', type: 'compute', config: {} },
      { name: 'PostgreSQL', type: 'database', config: {} },
      { name: 'S3', type: 'storage', config: {} },
      { name: 'CloudFront', type: 'cdn', config: {} },
      { name: 'CloudWatch', type: 'monitoring', config: {} },
    ],
  };
  const result = validateArchitecture(arch);
  assert(result.valid, 'Architecture doit etre valide');
  assertEqual(result.missingTypes.length, 0);
});

test('Ex1 — architecture incomplete', () => {
  const arch: Architecture = {
    name: 'minimal',
    components: [
      { name: 'Lambda', type: 'compute', config: {} },
      { name: 'DynamoDB', type: 'database', config: {} },
    ],
  };
  const result = validateArchitecture(arch);
  assert(!result.valid, 'Architecture doit etre invalide');
  assert(result.missingTypes.includes('storage'), 'storage manquant');
  assert(result.missingTypes.includes('cdn'), 'cdn manquant');
  assert(result.missingTypes.includes('monitoring'), 'monitoring manquant');
});

test('Ex2 — estimation de cout', () => {
  const estimate = estimateCost([
    { service: 'ec2-t3.micro', quantity: 2 },
    { service: 's3', quantity: 100 },
    { service: 'cloudwatch', quantity: 50 },
  ]);
  assertEqual(estimate.lineItems.length, 3);
  assertEqual(estimate.lineItems[0].monthlyCost, 15.18);  // 7.59 * 2
  assertEqual(estimate.lineItems[1].monthlyCost, 2.3);     // 0.023 * 100
  assertEqual(estimate.totalMonthlyCost, 32.48);            // 15.18 + 2.3 + 15
  assertEqual(estimate.totalAnnualCost, 389.76);            // 32.48 * 12
});

test('Ex2 — service inconnu lance une erreur', () => {
  let threw = false;
  try { estimateCost([{ service: 'unknown-service', quantity: 1 }]); } catch { threw = true; }
  assert(threw, 'Doit lancer une erreur pour service inconnu');
});

test('Ex3 — architecture production-ready', () => {
  const arch = {
    name: 'prod-app',
    components: [
      { name: 'ECS', type: 'compute', config: { autoScaling: true } },
      { name: 'RDS', type: 'database', config: {} },
      { name: 'S3', type: 'storage', config: {} },
      { name: 'CF', type: 'cdn', config: {} },
      { name: 'CW', type: 'monitoring', config: {} },
    ],
    availabilityZones: 3,
    regions: 1,
    backupEnabled: true,
  };
  const result = checkProductionReadiness(arch);
  assert(result.ready, 'Doit etre production-ready');
  const criticals = result.checks.filter((c) => c.severity === 'critical');
  assert(criticals.every((c) => c.pass), 'Tous les criticals doivent passer');
});

test('Ex3 — architecture non-ready (pas de backup)', () => {
  const arch = {
    name: 'dev-app',
    components: [
      { name: 'Lambda', type: 'compute', config: {} },
    ],
    availabilityZones: 1,
    regions: 1,
    backupEnabled: false,
  };
  const result = checkProductionReadiness(arch);
  assert(!result.ready, 'Ne doit pas etre production-ready');
  const failedCriticals = result.checks.filter((c) => c.severity === 'critical' && !c.pass);
  assert(failedCriticals.length >= 2, 'Au moins 2 checks critiques echoues');
});

summary();
