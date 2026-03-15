// =============================================================================
// Lab 08 — Messaging (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 08 — Messaging');

// =============================================================================
// Exercise 1: SQS Visibility Timeout Calculator
// =============================================================================

function recommendVisibilityTimeout(avgProcessingTimeSeconds: number): number {
  return Math.min(43200, Math.max(30, avgProcessingTimeSeconds * 6));
}

interface QueueMessage {
  body: string;
  invisibleUntil: number;
  inFlight: boolean;
}

function createSqsSimulator(visibilityTimeoutMs: number) {
  const messages: QueueMessage[] = [];

  return {
    send(body: string): void {
      messages.push({ body, invisibleUntil: 0, inFlight: false });
    },
    receive(currentTimeMs: number): string | null {
      const msg = messages.find((m) => !m.inFlight || currentTimeMs >= m.invisibleUntil);
      if (!msg) return null;
      msg.inFlight = true;
      msg.invisibleUntil = currentTimeMs + visibilityTimeoutMs;
      return msg.body;
    },
    acknowledge(messageId: string): void {
      const idx = messages.findIndex((m) => m.body === messageId);
      if (idx !== -1) messages.splice(idx, 1);
    },
    queueSize(): number {
      return messages.length;
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

function fanOut(subscriptions: SnsSubscription[], message: SnsMessage): string[] {
  return subscriptions
    .filter((sub) => {
      if (!sub.filterPolicy) return true;
      return Object.entries(sub.filterPolicy).every(([key, allowed]) => {
        const value = message.attributes[key];
        return value !== undefined && allowed.includes(value);
      });
    })
    .map((sub) => sub.endpoint);
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

function matchEventRules(rules: EventBridgeRule[], event: EventBridgeEvent): string[] {
  const targets: string[] = [];
  for (const rule of rules) {
    const pattern = rule.eventPattern;
    if (pattern.source && !pattern.source.includes(event.source)) continue;
    if (pattern['detail-type'] && !pattern['detail-type'].includes(event['detail-type'])) continue;
    if (pattern.detail) {
      let detailMatch = true;
      for (const [key, allowed] of Object.entries(pattern.detail)) {
        if (!allowed.includes(event.detail[key])) {
          detailMatch = false;
          break;
        }
      }
      if (!detailMatch) continue;
    }
    targets.push(...rule.targets);
  }
  return targets;
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
  sqs.receive(0);
  assertEqual(sqs.receive(3000), null);
  assertEqual(sqs.receive(6000), 'msg-1');
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
