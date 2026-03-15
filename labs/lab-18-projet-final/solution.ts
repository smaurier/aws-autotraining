// =============================================================================
// Lab 18 — Projet Final : Architecture validator, cost estimator, readiness check (SOLUTION)
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

function validateArchitecture(arch: Architecture): ValidationResult {
  const presentTypes = [...new Set(arch.components.map((c) => c.type))];
  const missingTypes = REQUIRED_TYPES.filter((t) => !presentTypes.includes(t));
  return {
    valid: missingTypes.length === 0,
    missingTypes,
    presentTypes: REQUIRED_TYPES.filter((t) => presentTypes.includes(t)),
  };
}

// =============================================================================
// Exercice 2 : Cost estimator
// =============================================================================

const SERVICE_COSTS: Record<string, number> = {
  'lambda': 0.20,
  'ec2-t3.micro': 7.59,
  'ec2-t3.small': 15.18,
  'ec2-t3.medium': 30.37,
  'rds-t3.micro': 12.41,
  'rds-t3.small': 24.82,
  's3': 0.023,
  'cloudfront': 0.085,
  'elasticache-t3.micro': 11.52,
  'cloudwatch': 0.30,
};

interface ServiceUsage {
  service: string;
  quantity: number;
}

interface CostEstimate {
  lineItems: { service: string; monthlyCost: number }[];
  totalMonthlyCost: number;
  totalAnnualCost: number;
}

function estimateCost(services: ServiceUsage[]): CostEstimate {
  const lineItems = services.map((s) => {
    const unitCost = SERVICE_COSTS[s.service];
    if (unitCost === undefined) throw new Error(`Unknown service: ${s.service}`);
    return {
      service: s.service,
      monthlyCost: Math.round(unitCost * s.quantity * 100) / 100,
    };
  });
  const totalMonthlyCost = Math.round(lineItems.reduce((sum, li) => sum + li.monthlyCost, 0) * 100) / 100;
  return {
    lineItems,
    totalMonthlyCost,
    totalAnnualCost: Math.round(totalMonthlyCost * 12 * 100) / 100,
  };
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

function checkProductionReadiness(arch: Architecture & {
  availabilityZones: number;
  regions: number;
  backupEnabled: boolean;
}): { ready: boolean; checks: ReadinessCheck[] } {
  const types = new Set(arch.components.map((c) => c.type));
  const hasAutoScaling = arch.components.some(
    (c) => c.type === 'compute' && c.config.autoScaling === true
  );

  const checks: ReadinessCheck[] = [
    {
      name: 'Multi-AZ',
      pass: arch.availabilityZones >= 2,
      severity: 'critical',
      message: arch.availabilityZones >= 2
        ? `${arch.availabilityZones} AZs configured`
        : 'At least 2 availability zones required',
    },
    {
      name: 'Backup',
      pass: arch.backupEnabled,
      severity: 'critical',
      message: arch.backupEnabled ? 'Backups enabled' : 'Backups must be enabled',
    },
    {
      name: 'Monitoring',
      pass: types.has('monitoring'),
      severity: 'critical',
      message: types.has('monitoring') ? 'Monitoring configured' : 'Monitoring component required',
    },
    {
      name: 'Auto-scaling',
      pass: hasAutoScaling,
      severity: 'warning',
      message: hasAutoScaling ? 'Auto-scaling configured' : 'Auto-scaling recommended',
    },
    {
      name: 'CDN',
      pass: types.has('cdn'),
      severity: 'warning',
      message: types.has('cdn') ? 'CDN configured' : 'CDN recommended for production',
    },
    {
      name: 'Multi-region',
      pass: arch.regions >= 2,
      severity: 'info',
      message: arch.regions >= 2 ? `${arch.regions} regions configured` : 'Consider multi-region',
    },
  ];

  const ready = checks.filter((c) => c.severity === 'critical').every((c) => c.pass);
  return { ready, checks };
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
  assertEqual(estimate.lineItems[0].monthlyCost, 15.18);
  assertEqual(estimate.lineItems[1].monthlyCost, 2.3);
  assertEqual(estimate.totalMonthlyCost, 32.48);
  assertEqual(estimate.totalAnnualCost, 389.76);
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
