// =============================================================================
// Lab 05 — Lambda
// =============================================================================
// Objectives:
//   - Simulate cold start behavior and measure impact
//   - Calculate concurrency requirements
//   - Configure event source mappings
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

// TODO: Simulate a Lambda invocation. Track warm/cold state.
// A cold start adds initDurationMs to the total. After first invocation,
// subsequent calls within ttlMs are warm. After ttlMs, the next call is cold again.
// Return an object with coldStart flag and durations.
function createLambdaSimulator(initDurationMs: number, execDurationMs: number, ttlMs: number) {
  // TODO: Track lastInvokedAt timestamp
  // Return an object with invoke(currentTimeMs: number) -> InvocationResult

  return {
    invoke(_currentTimeMs: number): InvocationResult {
      // TODO: Check if cold or warm, compute durations
      return { coldStart: false, initDurationMs: 0, executionDurationMs: 0, totalDurationMs: 0 };
    },
  };
}

// =============================================================================
// Exercise 2: Concurrency Calculator
// =============================================================================

// TODO: Calculate the required concurrent executions for a Lambda function.
// Formula: concurrency = invocationsPerSecond * avgDurationSeconds
// Round up to the nearest integer.
function calculateConcurrency(invocationsPerSecond: number, avgDurationMs: number): number {
  // TODO: Apply formula and ceil
  return 0;
}

// TODO: Calculate the cost of Lambda invocations per month.
// Pricing: $0.20 per 1M requests + $0.0000166667 per GB-second.
// Free tier: 1M requests + 400,000 GB-seconds per month.
function calculateLambdaCost(
  invocationsPerMonth: number,
  avgDurationMs: number,
  memoryMB: number
): { requestCost: number; computeCost: number; totalCost: number } {
  // TODO: Calculate request cost and compute (GB-second) cost after free tier
  return { requestCost: 0, computeCost: 0, totalCost: 0 };
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

// TODO: Generate a recommended event source mapping config.
// SQS: batchSize 10, window 0, parallelization 1, no bisect, 3 retries
// Kinesis: batchSize 100, window 5, parallelization 10, bisect true, 3 retries
// DynamoDB Stream: batchSize 100, window 0, parallelization 1, bisect true, 3 retries
function recommendEventSourceConfig(source: EventSource): EventSourceConfig {
  // TODO: Return defaults per source type
  return {} as EventSourceConfig;
}

// TODO: Validate that a custom config respects AWS limits.
// SQS batchSize: 1-10, Kinesis/DynamoDB batchSize: 1-10000
// parallelizationFactor: 1-10, maxBatchingWindowSeconds: 0-300
function validateEventSourceConfig(config: EventSourceConfig): string[] {
  // TODO: Return array of error messages (empty if valid)
  return [];
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
