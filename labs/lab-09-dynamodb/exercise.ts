// =============================================================================
// Lab 07 — DynamoDB
// =============================================================================
// Objectives:
//   - Design key schemas for common access patterns
//   - Calculate Read/Write Capacity Units
//   - Determine when to use Query vs Scan
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 07 — DynamoDB');

// =============================================================================
// Exercise 1: Key Schema Designer
// =============================================================================

interface KeySchema {
  partitionKey: { name: string; type: 'S' | 'N' };
  sortKey?: { name: string; type: 'S' | 'N' };
  gsi?: { name: string; partitionKey: string; sortKey?: string }[];
}

type AccessPattern =
  | 'user-by-id'
  | 'orders-by-user'
  | 'orders-by-date'
  | 'products-by-category';

// TODO: Design a key schema for the given access pattern.
// - user-by-id: PK=userId (S), no SK
// - orders-by-user: PK=userId (S), SK=orderId (S)
// - orders-by-date: PK=userId (S), SK=orderDate (S), GSI on orderDate
// - products-by-category: PK=category (S), SK=productId (S)
function designKeySchema(pattern: AccessPattern): KeySchema {
  // TODO: Return the appropriate key schema
  return { partitionKey: { name: '', type: 'S' } };
}

// =============================================================================
// Exercise 2: Capacity Unit Calculator
// =============================================================================

// TODO: Calculate Read Capacity Units needed.
// One RCU = one strongly consistent read/s for items up to 4 KB.
// Eventually consistent reads use half the RCUs.
// Formula: RCU = ceil(itemSizeKB / 4) * readsPerSecond (* 0.5 for eventual)
function calculateRCU(
  itemSizeKB: number,
  readsPerSecond: number,
  consistentRead: boolean
): number {
  // TODO: Implement RCU calculation
  return 0;
}

// TODO: Calculate Write Capacity Units needed.
// One WCU = one write/s for items up to 1 KB.
// Formula: WCU = ceil(itemSizeKB / 1) * writesPerSecond
function calculateWCU(itemSizeKB: number, writesPerSecond: number): number {
  // TODO: Implement WCU calculation
  return 0;
}

// TODO: Estimate monthly cost for provisioned capacity.
// RCU price: $0.00065 per RCU per hour
// WCU price: $0.00065 per WCU per hour
// Hours per month: 730
function estimateMonthlyCost(rcu: number, wcu: number): { rcuCost: number; wcuCost: number; total: number } {
  // TODO: Calculate monthly costs
  return { rcuCost: 0, wcuCost: 0, total: 0 };
}

// =============================================================================
// Exercise 3: Query vs Scan Optimizer
// =============================================================================

interface QueryPlan {
  operation: 'query' | 'scan';
  reason: string;
  estimatedRCU: number;
  useIndex?: string;
}

interface TableInfo {
  partitionKey: string;
  sortKey?: string;
  gsiNames: string[];
  gsiKeys: Record<string, { partitionKey: string; sortKey?: string }>;
  itemCount: number;
  avgItemSizeKB: number;
}

// TODO: Determine whether to use Query or Scan for a given filter.
// Use Query if the filter includes the partition key (or a GSI partition key).
// Otherwise, fall back to Scan.
// Estimate RCU: Query reads ~matching items, Scan reads ~all items.
function optimizeAccess(
  table: TableInfo,
  filterKeys: string[]
): QueryPlan {
  // TODO:
  // 1. Check if filterKeys include the table's partition key -> Query
  // 2. Check if filterKeys match any GSI partition key -> Query with index
  // 3. Otherwise -> Scan
  return { operation: 'scan', reason: '', estimatedRCU: 0 };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — designKeySchema for user-by-id', () => {
  const schema = designKeySchema('user-by-id');
  assertEqual(schema.partitionKey.name, 'userId');
  assertEqual(schema.sortKey, undefined);
});

test('Ex1 — designKeySchema for orders-by-user', () => {
  const schema = designKeySchema('orders-by-user');
  assertEqual(schema.partitionKey.name, 'userId');
  assertEqual(schema.sortKey?.name, 'orderId');
});

test('Ex1 — designKeySchema for orders-by-date (with GSI)', () => {
  const schema = designKeySchema('orders-by-date');
  assertEqual(schema.partitionKey.name, 'userId');
  assertEqual(schema.sortKey?.name, 'orderDate');
  assert(schema.gsi !== undefined && schema.gsi.length > 0, 'Should have a GSI');
});

test('Ex1 — designKeySchema for products-by-category', () => {
  const schema = designKeySchema('products-by-category');
  assertEqual(schema.partitionKey.name, 'category');
  assertEqual(schema.sortKey?.name, 'productId');
});

test('Ex2 — calculateRCU strongly consistent', () => {
  assertEqual(calculateRCU(4, 10, true), 10);
  assertEqual(calculateRCU(8, 10, true), 20);
  assertEqual(calculateRCU(1, 5, true), 5);
});

test('Ex2 — calculateRCU eventually consistent', () => {
  assertEqual(calculateRCU(4, 10, false), 5);
  assertEqual(calculateRCU(8, 10, false), 10);
});

test('Ex2 — calculateWCU', () => {
  assertEqual(calculateWCU(1, 10), 10);
  assertEqual(calculateWCU(2.5, 10), 30);
  assertEqual(calculateWCU(0.5, 100), 100);
});

test('Ex2 — estimateMonthlyCost', () => {
  const cost = estimateMonthlyCost(10, 5);
  assertEqual(cost.rcuCost, Math.round(10 * 0.00065 * 730 * 100) / 100);
  assertEqual(cost.wcuCost, Math.round(5 * 0.00065 * 730 * 100) / 100);
});

test('Ex3 — optimizeAccess uses Query for partition key filter', () => {
  const table: TableInfo = {
    partitionKey: 'userId', sortKey: 'orderId', gsiNames: [],
    gsiKeys: {}, itemCount: 10000, avgItemSizeKB: 2,
  };
  const plan = optimizeAccess(table, ['userId']);
  assertEqual(plan.operation, 'query');
});

test('Ex3 — optimizeAccess uses Query with GSI', () => {
  const table: TableInfo = {
    partitionKey: 'userId', sortKey: 'orderId', gsiNames: ['date-index'],
    gsiKeys: { 'date-index': { partitionKey: 'orderDate' } },
    itemCount: 10000, avgItemSizeKB: 2,
  };
  const plan = optimizeAccess(table, ['orderDate']);
  assertEqual(plan.operation, 'query');
  assertEqual(plan.useIndex, 'date-index');
});

test('Ex3 — optimizeAccess falls back to Scan', () => {
  const table: TableInfo = {
    partitionKey: 'userId', sortKey: 'orderId', gsiNames: [],
    gsiKeys: {}, itemCount: 10000, avgItemSizeKB: 2,
  };
  const plan = optimizeAccess(table, ['status']);
  assertEqual(plan.operation, 'scan');
});

summary();
