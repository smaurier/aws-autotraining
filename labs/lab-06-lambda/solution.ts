// =============================================================================
// Lab 05 — Lambda (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 05 — Lambda');

// =============================================================================
// Exercise 1: Cold Start Simulator
// =============================================================================

interface InvocationResult {
  coldStart: boolean;
  initDurationMs: number;
  executionDurationMs: number;
  totalDurationMs: number;
}

function createLambdaSimulator(initDurationMs: number, execDurationMs: number, ttlMs: number) {
  let lastInvokedAt: number | null = null;

  return {
    invoke(currentTimeMs: number): InvocationResult {
      const isCold = lastInvokedAt === null || (currentTimeMs - lastInvokedAt) > ttlMs;
      lastInvokedAt = currentTimeMs;
      return {
        coldStart: isCold,
        initDurationMs: isCold ? initDurationMs : 0,
        executionDurationMs: execDurationMs,
        totalDurationMs: (isCold ? initDurationMs : 0) + execDurationMs,
      };
    },
  };
}

// =============================================================================
// Exercise 2: Concurrency Calculator
// =============================================================================

function calculateConcurrency(invocationsPerSecond: number, avgDurationMs: number): number {
  return Math.ceil(invocationsPerSecond * (avgDurationMs / 1000));
}

function calculateLambdaCost(
  invocationsPerMonth: number,
  avgDurationMs: number,
  memoryMB: number
): { requestCost: number; computeCost: number; totalCost: number } {
  const FREE_REQUESTS = 1_000_000;
  const FREE_GB_SECONDS = 400_000;
  const PRICE_PER_REQUEST = 0.20 / 1_000_000;
  const PRICE_PER_GB_SECOND = 0.0000166667;

  const billableRequests = Math.max(0, invocationsPerMonth - FREE_REQUESTS);
  const requestCost = Math.round(billableRequests * PRICE_PER_REQUEST * 100) / 100;

  const gbSeconds = invocationsPerMonth * (avgDurationMs / 1000) * (memoryMB / 1024);
  const billableGbSeconds = Math.max(0, gbSeconds - FREE_GB_SECONDS);
  const computeCost = Math.round(billableGbSeconds * PRICE_PER_GB_SECOND * 100) / 100;

  return { requestCost, computeCost, totalCost: Math.round((requestCost + computeCost) * 100) / 100 };
}

// =============================================================================
// Exercise 3: Event Source Mapping Configurator
// =============================================================================

type EventSource = 'sqs' | 'kinesis' | 'dynamodb-stream';

interface EventSourceConfig {
  source: EventSource;
  batchSize: number;
  maxBatchingWindowSeconds: number;
  parallelizationFactor: number;
  bisectBatchOnError: boolean;
  maxRetries: number;
}

function recommendEventSourceConfig(source: EventSource): EventSourceConfig {
  const defaults: Record<EventSource, EventSourceConfig> = {
    sqs: { source: 'sqs', batchSize: 10, maxBatchingWindowSeconds: 0, parallelizationFactor: 1, bisectBatchOnError: false, maxRetries: 3 },
    kinesis: { source: 'kinesis', batchSize: 100, maxBatchingWindowSeconds: 5, parallelizationFactor: 10, bisectBatchOnError: true, maxRetries: 3 },
    'dynamodb-stream': { source: 'dynamodb-stream', batchSize: 100, maxBatchingWindowSeconds: 0, parallelizationFactor: 1, bisectBatchOnError: true, maxRetries: 3 },
  };
  return defaults[source];
}

function validateEventSourceConfig(config: EventSourceConfig): string[] {
  const errors: string[] = [];
  const maxBatch = config.source === 'sqs' ? 10 : 10000;
  if (config.batchSize < 1 || config.batchSize > maxBatch) {
    errors.push(`batchSize must be 1-${maxBatch} for ${config.source}`);
  }
  if (config.parallelizationFactor < 1 || config.parallelizationFactor > 10) {
    errors.push('parallelizationFactor must be 1-10');
  }
  if (config.maxBatchingWindowSeconds < 0 || config.maxBatchingWindowSeconds > 300) {
    errors.push('maxBatchingWindowSeconds must be 0-300');
  }
  return errors;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — cold start on first invocation', () => {
  const sim = createLambdaSimulator(500, 100, 5000);
  const result = sim.invoke(0);
  assert(result.coldStart, 'First invocation should be cold');
  assertEqual(result.initDurationMs, 500);
  assertEqual(result.executionDurationMs, 100);
  assertEqual(result.totalDurationMs, 600);
});

test('Ex1 — warm start within TTL', () => {
  const sim = createLambdaSimulator(500, 100, 5000);
  sim.invoke(0);
  const result = sim.invoke(3000);
  assert(!result.coldStart, 'Should be warm within TTL');
  assertEqual(result.totalDurationMs, 100);
});

test('Ex1 — cold start after TTL expires', () => {
  const sim = createLambdaSimulator(500, 100, 5000);
  sim.invoke(0);
  const result = sim.invoke(6000);
  assert(result.coldStart, 'Should be cold after TTL');
  assertEqual(result.totalDurationMs, 600);
});

test('Ex2 — calculateConcurrency basic', () => {
  assertEqual(calculateConcurrency(100, 200), 20);
  assertEqual(calculateConcurrency(50, 3000), 150);
  assertEqual(calculateConcurrency(10, 150), 2);
});

test('Ex2 — calculateLambdaCost with free tier', () => {
  const cost = calculateLambdaCost(500_000, 200, 128);
  assertEqual(cost.requestCost, 0);
  assertEqual(cost.computeCost, 0);
  assertEqual(cost.totalCost, 0);
});

test('Ex2 — calculateLambdaCost beyond free tier', () => {
  const cost = calculateLambdaCost(2_000_000, 200, 128);
  assert(cost.requestCost > 0, 'Should have request cost');
  assert(cost.totalCost > 0, 'Should have total cost');
});

test('Ex3 — recommendEventSourceConfig for SQS', () => {
  const config = recommendEventSourceConfig('sqs');
  assertEqual(config.batchSize, 10);
  assertEqual(config.parallelizationFactor, 1);
  assertEqual(config.bisectBatchOnError, false);
});

test('Ex3 — recommendEventSourceConfig for Kinesis', () => {
  const config = recommendEventSourceConfig('kinesis');
  assertEqual(config.batchSize, 100);
  assertEqual(config.parallelizationFactor, 10);
  assertEqual(config.bisectBatchOnError, true);
});

test('Ex3 — validateEventSourceConfig catches invalid SQS batchSize', () => {
  const errors = validateEventSourceConfig({
    source: 'sqs', batchSize: 20, maxBatchingWindowSeconds: 0,
    parallelizationFactor: 1, bisectBatchOnError: false, maxRetries: 3,
  });
  assert(errors.length > 0, 'Should have validation errors');
});

test('Ex3 — validateEventSourceConfig passes valid config', () => {
  const errors = validateEventSourceConfig(recommendEventSourceConfig('kinesis'));
  assertEqual(errors.length, 0);
});

summary();
