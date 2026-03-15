// =============================================================================
// Lab 17 — CI/CD
// =============================================================================
// Objectives:
//   - Execute pipeline stages in sequence
//   - Simulate blue/green and canary deployment strategies
//   - Parse and validate a buildspec configuration
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 17 — CI/CD');

// =============================================================================
// Exercise 1: Pipeline Stage Executor
// Run stages in order. Each stage can pass or fail.
// Return results and stop at first failure.
// =============================================================================

interface StageResult {
  name: string;
  status: 'success' | 'failure';
  durationMs: number;
}

function executePipeline(
  stages: { name: string; execute: () => boolean; durationMs: number }[],
): { results: StageResult[]; success: boolean } {
  // TODO: Run stages sequentially. Record each result.
  // Stop at the first failure.
  return { results: [], success: false };
}

// =============================================================================
// Exercise 2: Deployment Strategy Simulator
// Given a strategy, return the traffic-shifting steps.
// =============================================================================

interface TrafficStep {
  bluePercent: number;
  greenPercent: number;
  description: string;
}

function simulateDeployment(
  strategy: 'blue-green' | 'canary' | 'rolling',
): TrafficStep[] {
  // TODO:
  // blue-green: 100/0 → 0/100 (instant switch)
  // canary: 100/0 → 90/10 → 50/50 → 0/100
  // rolling: 100/0 → 75/25 → 50/50 → 25/75 → 0/100
  return [];
}

// =============================================================================
// Exercise 3: Buildspec Parser
// Parse a simplified buildspec object and validate required phases.
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
  // TODO: Validate: version must be "0.2", must have "build" phase,
  // each phase must have at least 1 command. Count total commands.
  return { valid: false, errors: [], totalCommands: 0 };
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
