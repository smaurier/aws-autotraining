// =============================================================================
// Lab 17 — CI/CD (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 17 — CI/CD');

// =============================================================================
// Exercise 1: Pipeline Stage Executor
// =============================================================================

interface StageResult {
  name: string;
  status: 'success' | 'failure';
  durationMs: number;
}

function executePipeline(
  stages: { name: string; execute: () => boolean; durationMs: number }[],
): { results: StageResult[]; success: boolean } {
  const results: StageResult[] = [];

  for (const stage of stages) {
    const ok = stage.execute();
    results.push({
      name: stage.name,
      status: ok ? 'success' : 'failure',
      durationMs: stage.durationMs,
    });
    if (!ok) return { results, success: false };
  }

  return { results, success: true };
}

// =============================================================================
// Exercise 2: Deployment Strategy Simulator
// =============================================================================

interface TrafficStep {
  bluePercent: number;
  greenPercent: number;
  description: string;
}

function simulateDeployment(
  strategy: 'blue-green' | 'canary' | 'rolling',
): TrafficStep[] {
  switch (strategy) {
    case 'blue-green':
      return [
        { bluePercent: 100, greenPercent: 0, description: 'All traffic on blue' },
        { bluePercent: 0, greenPercent: 100, description: 'Instant switch to green' },
      ];
    case 'canary':
      return [
        { bluePercent: 100, greenPercent: 0, description: 'All traffic on blue' },
        { bluePercent: 90, greenPercent: 10, description: 'Canary: 10% to green' },
        { bluePercent: 50, greenPercent: 50, description: 'Canary: 50% to green' },
        { bluePercent: 0, greenPercent: 100, description: 'Full rollout to green' },
      ];
    case 'rolling':
      return [
        { bluePercent: 100, greenPercent: 0, description: 'All traffic on blue' },
        { bluePercent: 75, greenPercent: 25, description: 'Rolling: 25% to green' },
        { bluePercent: 50, greenPercent: 50, description: 'Rolling: 50% to green' },
        { bluePercent: 25, greenPercent: 75, description: 'Rolling: 75% to green' },
        { bluePercent: 0, greenPercent: 100, description: 'Full rollout to green' },
      ];
  }
}

// =============================================================================
// Exercise 3: Buildspec Parser
// =============================================================================

interface Buildspec {
  version: string;
  phases: Record<string, { commands: string[] }>;
  artifacts?: { files: string[] };
}

interface BuildspecValidation {
  valid: boolean;
  errors: string[];
  totalCommands: number;
}

function validateBuildspec(spec: Buildspec): BuildspecValidation {
  const errors: string[] = [];
  let totalCommands = 0;

  if (spec.version !== '0.2') {
    errors.push('Version must be "0.2"');
  }
  if (!spec.phases.build) {
    errors.push('Missing required "build" phase');
  }
  for (const [name, phase] of Object.entries(spec.phases)) {
    if (!phase.commands || phase.commands.length === 0) {
      errors.push(`Phase "${name}" must have at least 1 command`);
    } else {
      totalCommands += phase.commands.length;
    }
  }

  return { valid: errors.length === 0, errors, totalCommands };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — executePipeline all stages pass', () => {
  const stages = [
    { name: 'source', execute: () => true, durationMs: 100 },
    { name: 'build', execute: () => true, durationMs: 200 },
    { name: 'deploy', execute: () => true, durationMs: 300 },
  ];
  const result = executePipeline(stages);
  assertEqual(result.success, true);
  assertEqual(result.results.length, 3);
  assertEqual(result.results[2].name, 'deploy');
});

test('Ex1 — executePipeline stops at failure', () => {
  const stages = [
    { name: 'source', execute: () => true, durationMs: 100 },
    { name: 'build', execute: () => false, durationMs: 200 },
    { name: 'deploy', execute: () => true, durationMs: 300 },
  ];
  const result = executePipeline(stages);
  assertEqual(result.success, false);
  assertEqual(result.results.length, 2);
  assertEqual(result.results[1].status, 'failure');
});

test('Ex2 — blue-green deployment has 2 steps', () => {
  const steps = simulateDeployment('blue-green');
  assertEqual(steps.length, 2);
  assertEqual(steps[0].bluePercent, 100);
  assertEqual(steps[1].greenPercent, 100);
});

test('Ex2 — canary deployment has 4 steps', () => {
  const steps = simulateDeployment('canary');
  assertEqual(steps.length, 4);
  assertEqual(steps[1].greenPercent, 10);
});

test('Ex2 — rolling deployment has 5 steps', () => {
  const steps = simulateDeployment('rolling');
  assertEqual(steps.length, 5);
  assertEqual(steps[2].greenPercent, 50);
});

test('Ex3 — validateBuildspec accepts valid spec', () => {
  const spec: Buildspec = {
    version: '0.2',
    phases: {
      install: { commands: ['npm ci'] },
      build: { commands: ['npm run build', 'npm test'] },
    },
  };
  const result = validateBuildspec(spec);
  assertEqual(result.valid, true);
  assertEqual(result.totalCommands, 3);
});

test('Ex3 — validateBuildspec rejects missing build phase', () => {
  const spec: Buildspec = {
    version: '0.2',
    phases: { install: { commands: ['npm ci'] } },
  };
  const result = validateBuildspec(spec);
  assertEqual(result.valid, false);
  assert(result.errors.length >= 1, 'Should have errors');
});

test('Ex3 — validateBuildspec rejects wrong version', () => {
  const spec: Buildspec = {
    version: '0.1',
    phases: { build: { commands: ['make'] } },
  };
  const result = validateBuildspec(spec);
  assertEqual(result.valid, false);
});

summary();
