// =============================================================================
// Lab 08 — Messaging (SQS, SNS, EventBridge)
// =============================================================================
// Objectives:
//   - Calculate SQS visibility timeout for reliable processing
//   - Simulate SNS fan-out to multiple subscribers
//   - Match events against EventBridge rules
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 08 — Messaging');

// =============================================================================
// Exercise 1: SQS Visibility Timeout Calculator
// =============================================================================

// TODO: Calculate the recommended visibility timeout for an SQS queue.
// Rule of thumb: 6x the average processing time, capped at 12 hours (43200s).
// Minimum: 30 seconds.
function recommendVisibilityTimeout(avgProcessingTimeSeconds: number): number {
  // TODO: Return 6x processing time, clamped between 30 and 43200
  return 0;
}

// TODO: Simulate message processing with visibility timeout.
// Track messages in-flight. A message becomes visible again after timeout.
function createSqsSimulator(visibilityTimeoutMs: number) {
  // TODO: Track queue of messages and their visibility state

  return {
    send(_body: string): void {
      // TODO: Add message to queue
    },
    receive(_currentTimeMs: number): string | null {
      // TODO: Return first visible message and mark it in-flight
      return null;
    },
    acknowledge(_messageId: string): void {
      // TODO: Remove message from queue permanently
    },
    queueSize(): number {
      // TODO: Return total messages (visible + in-flight)
      return 0;
    },
  };
}

// =============================================================================
// Exercise 2: SNS Fan-Out Simulator
// =============================================================================

interface SnsSubscription {
  protocol: 'sqs' | 'lambda' | 'email';
  endpoint: string;
  filterPolicy?: Record<string, string[]>;
}

interface SnsMessage {
  subject: string;
  body: string;
  attributes: Record<string, string>;
}

// TODO: Determine which subscribers should receive a message based on filter policies.
// If a subscription has no filterPolicy, it receives all messages.
// If it has a filterPolicy, each key in the policy must match: the message attribute
// with that key must have a value that is in the policy's array for that key.
function fanOut(subscriptions: SnsSubscription[], message: SnsMessage): string[] {
  // TODO: Return list of endpoints that should receive the message
  return [];
}

// =============================================================================
// Exercise 3: EventBridge Rule Matcher
// =============================================================================

interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: Record<string, unknown>;
}

interface EventBridgeRule {
  name: string;
  eventPattern: {
    source?: string[];
    'detail-type'?: string[];
    detail?: Record<string, unknown[]>;
  };
  targets: string[];
}

// TODO: Match an event against EventBridge rules.
// A rule matches if:
// - source is in eventPattern.source (or source not specified in pattern)
// - detail-type is in eventPattern['detail-type'] (or not specified)
// - For each key in eventPattern.detail, the event detail value is in the array
// Return the list of target ARNs from all matching rules.
function matchEventRules(rules: EventBridgeRule[], event: EventBridgeEvent): string[] {
  // TODO: Filter rules that match, collect all targets
  return [];
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — recommendVisibilityTimeout basic', () => {
  assertEqual(recommendVisibilityTimeout(10), 60);
  assertEqual(recommendVisibilityTimeout(100), 600);
});

test('Ex1 — recommendVisibilityTimeout minimum 30s', () => {
  assertEqual(recommendVisibilityTimeout(2), 30);
  assertEqual(recommendVisibilityTimeout(0), 30);
});

test('Ex1 — recommendVisibilityTimeout caps at 43200', () => {
  assertEqual(recommendVisibilityTimeout(10000), 43200);
});

test('Ex1 — SQS simulator send and receive', () => {
  const sqs = createSqsSimulator(5000);
  sqs.send('msg-1');
  sqs.send('msg-2');
  assertEqual(sqs.queueSize(), 2);
  const msg = sqs.receive(0);
  assertEqual(msg, 'msg-1');
});

test('Ex1 — SQS simulator visibility timeout', () => {
  const sqs = createSqsSimulator(5000);
  sqs.send('msg-1');
  sqs.receive(0); // in-flight
  assertEqual(sqs.receive(3000), null); // still hidden
  assertEqual(sqs.receive(6000), 'msg-1'); // visible again
});

test('Ex1 — SQS simulator acknowledge', () => {
  const sqs = createSqsSimulator(5000);
  sqs.send('msg-1');
  sqs.receive(0);
  sqs.acknowledge('msg-1');
  assertEqual(sqs.queueSize(), 0);
  assertEqual(sqs.receive(6000), null);
});

test('Ex2 — fanOut without filter delivers to all', () => {
  const subs: SnsSubscription[] = [
    { protocol: 'sqs', endpoint: 'queue-A' },
    { protocol: 'lambda', endpoint: 'fn-B' },
  ];
  const msg: SnsMessage = { subject: 'test', body: 'hello', attributes: {} };
  const targets = fanOut(subs, msg);
  assertDeepEqual(targets.sort(), ['fn-B', 'queue-A']);
});

test('Ex2 — fanOut with filter policy', () => {
  const subs: SnsSubscription[] = [
    { protocol: 'sqs', endpoint: 'orders-queue', filterPolicy: { eventType: ['order-placed'] } },
    { protocol: 'sqs', endpoint: 'all-events-queue' },
    { protocol: 'lambda', endpoint: 'payment-fn', filterPolicy: { eventType: ['payment-received'] } },
  ];
  const msg: SnsMessage = { subject: 'order', body: '{}', attributes: { eventType: 'order-placed' } };
  const targets = fanOut(subs, msg);
  assertDeepEqual(targets.sort(), ['all-events-queue', 'orders-queue']);
});

test('Ex3 — matchEventRules matches by source', () => {
  const rules: EventBridgeRule[] = [
    { name: 'order-rule', eventPattern: { source: ['com.myapp.orders'] }, targets: ['arn:lambda:process'] },
    { name: 'user-rule', eventPattern: { source: ['com.myapp.users'] }, targets: ['arn:lambda:user'] },
  ];
  const event: EventBridgeEvent = { source: 'com.myapp.orders', 'detail-type': 'OrderPlaced', detail: {} };
  assertDeepEqual(matchEventRules(rules, event), ['arn:lambda:process']);
});

test('Ex3 — matchEventRules matches by detail', () => {
  const rules: EventBridgeRule[] = [{
    name: 'high-value',
    eventPattern: { source: ['com.myapp.orders'], detail: { status: ['confirmed'] } },
    targets: ['arn:sqs:confirmed'],
  }];
  const event: EventBridgeEvent = { source: 'com.myapp.orders', 'detail-type': 'OrderUpdate', detail: { status: 'confirmed' } };
  assertDeepEqual(matchEventRules(rules, event), ['arn:sqs:confirmed']);
});

test('Ex3 — matchEventRules no match returns empty', () => {
  const rules: EventBridgeRule[] = [{
    name: 'rule-1', eventPattern: { source: ['com.other'] }, targets: ['arn:target'],
  }];
  const event: EventBridgeEvent = { source: 'com.myapp', 'detail-type': 'Test', detail: {} };
  assertDeepEqual(matchEventRules(rules, event), []);
});

summary();
