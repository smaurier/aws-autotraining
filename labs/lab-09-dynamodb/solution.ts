// =============================================================================
// Lab 07 — DynamoDB (SOLUTION)
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

function designKeySchema(pattern: AccessPattern): KeySchema {
  switch (pattern) {
    case 'user-by-id':
      return { partitionKey: { name: 'userId', type: 'S' } };
    case 'orders-by-user':
      return {
        partitionKey: { name: 'userId', type: 'S' },
        sortKey: { name: 'orderId', type: 'S' },
      };
    case 'orders-by-date':
      return {
        partitionKey: { name: 'userId', type: 'S' },
        sortKey: { name: 'orderDate', type: 'S' },
        gsi: [{ name: 'date-index', partitionKey: 'orderDate', sortKey: 'userId' }],
      };
    case 'products-by-category':
      return {
        partitionKey: { name: 'category', type: 'S' },
        sortKey: { name: 'productId', type: 'S' },
      };
  }
}

// =============================================================================
// Exercise 2: Capacity Unit Calculator
// =============================================================================

function calculateRCU(
  itemSizeKB: number,
  readsPerSecond: number,
  consistentRead: boolean
): number {
  const readUnits = Math.ceil(itemSizeKB / 4) * readsPerSecond;
  return consistentRead ? readUnits : Math.ceil(readUnits * 0.5);
}

function calculateWCU(itemSizeKB: number, writesPerSecond: number): number {
  return Math.ceil(itemSizeKB) * writesPerSecond;
}

function estimateMonthlyCost(rcu: number, wcu: number): { rcuCost: number; wcuCost: number; total: number } {
  const rcuCost = Math.round(rcu * 0.00065 * 730 * 100) / 100;
  const wcuCost = Math.round(wcu * 0.00065 * 730 * 100) / 100;
  return { rcuCost, wcuCost, total: Math.round((rcuCost + wcuCost) * 100) / 100 };
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

function optimizeAccess(table: TableInfo, filterKeys: string[]): QueryPlan {
  // Check if partition key is in filter
  if (filterKeys.includes(table.partitionKey)) {
    const estimatedItems = Math.ceil(table.itemCount / 100); // rough estimate
    return {
      operation: 'query',
      reason: `Filter includes partition key "${table.partitionKey}"`,
      estimatedRCU: Math.ceil((estimatedItems * table.avgItemSizeKB) / 4),
    };
  }
  // Check GSIs
  for (const gsiName of table.gsiNames) {
    const gsi = table.gsiKeys[gsiName];
    if (gsi && filterKeys.includes(gsi.partitionKey)) {
      const estimatedItems = Math.ceil(table.itemCount / 100);
      return {
        operation: 'query',
        reason: `Filter matches GSI "${gsiName}" partition key "${gsi.partitionKey}"`,
        estimatedRCU: Math.ceil((estimatedItems * table.avgItemSizeKB) / 4),
        useIndex: gsiName,
      };
    }
  }
  // Fallback to scan
  return {
    operation: 'scan',
    reason: 'No partition key or GSI matches the filter — full table scan required',
    estimatedRCU: Math.ceil((table.itemCount * table.avgItemSizeKB) / 4),
  };
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
