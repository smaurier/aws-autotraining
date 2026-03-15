// =============================================================================
// Lab 14 — RDS : Connection pool, read replica routing, cache-aside (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 14 — RDS & ElastiCache');

// =============================================================================
// Exercice 1 : Connection pool sizer
// =============================================================================

interface PoolConfig {
  maxConnections: number;
  avgQueryTimeMs: number;
  targetRequestsPerSec: number;
}

function calculatePoolSize(config: PoolConfig): number {
  const optimal = Math.ceil(config.targetRequestsPerSec * (config.avgQueryTimeMs / 1000));
  return Math.max(1, Math.min(optimal, config.maxConnections));
}

// =============================================================================
// Exercice 2 : Read replica routing (round-robin)
// =============================================================================

interface ReplicaRouter {
  next(): string;
  addReplica(endpoint: string): void;
  removeReplica(endpoint: string): void;
  getReplicaCount(): number;
}

function createReplicaRouter(primaryEndpoint: string, replicas: string[]): ReplicaRouter {
  const pool = [...replicas];
  let index = 0;
  return {
    next() {
      if (pool.length === 0) return primaryEndpoint;
      const endpoint = pool[index % pool.length];
      index = (index + 1) % pool.length;
      return endpoint;
    },
    addReplica(endpoint: string) {
      pool.push(endpoint);
    },
    removeReplica(endpoint: string) {
      const i = pool.indexOf(endpoint);
      if (i !== -1) {
        pool.splice(i, 1);
        if (index >= pool.length) index = 0;
      }
    },
    getReplicaCount() {
      return pool.length;
    },
  };
}

// =============================================================================
// Exercice 3 : Cache-aside pattern
// =============================================================================

type FetchFn = (key: string) => string | null;

interface CacheAside {
  get(key: string): string | null;
  invalidate(key: string): void;
  stats(): { hits: number; misses: number; hitRate: number };
}

function createCacheAside(fetchFromDb: FetchFn): CacheAside {
  const cache = new Map<string, string>();
  let hits = 0;
  let misses = 0;
  return {
    get(key: string) {
      if (cache.has(key)) {
        hits++;
        return cache.get(key)!;
      }
      misses++;
      const value = fetchFromDb(key);
      if (value !== null) {
        cache.set(key, value);
      }
      return value;
    },
    invalidate(key: string) {
      cache.delete(key);
    },
    stats() {
      const total = hits + misses;
      return {
        hits,
        misses,
        hitRate: total === 0 ? 0 : Math.round((hits / total) * 100) / 100,
      };
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — calculatePoolSize dimensionne correctement', () => {
  assertEqual(calculatePoolSize({
    maxConnections: 100, avgQueryTimeMs: 50, targetRequestsPerSec: 200,
  }), 10);
});

test('Ex1 — calculatePoolSize plafonne a maxConnections', () => {
  assertEqual(calculatePoolSize({
    maxConnections: 5, avgQueryTimeMs: 100, targetRequestsPerSec: 1000,
  }), 5);
});

test('Ex1 — calculatePoolSize minimum 1', () => {
  assertEqual(calculatePoolSize({
    maxConnections: 100, avgQueryTimeMs: 1, targetRequestsPerSec: 1,
  }), 1);
});

test('Ex2 — round-robin distribue entre les replicas', () => {
  const router = createReplicaRouter('primary.db', ['replica-1.db', 'replica-2.db']);
  assertEqual(router.next(), 'replica-1.db');
  assertEqual(router.next(), 'replica-2.db');
  assertEqual(router.next(), 'replica-1.db');
});

test('Ex2 — fallback sur primary si pas de replicas', () => {
  const router = createReplicaRouter('primary.db', []);
  assertEqual(router.next(), 'primary.db');
});

test('Ex2 — addReplica et removeReplica', () => {
  const router = createReplicaRouter('primary.db', ['r1.db']);
  assertEqual(router.getReplicaCount(), 1);
  router.addReplica('r2.db');
  assertEqual(router.getReplicaCount(), 2);
  router.removeReplica('r1.db');
  assertEqual(router.getReplicaCount(), 1);
  assertEqual(router.next(), 'r2.db');
});

test('Ex3 — cache-aside hit et miss', () => {
  const db: Record<string, string> = { user1: 'Alice', user2: 'Bob' };
  const cache = createCacheAside((key) => db[key] ?? null);
  assertEqual(cache.get('user1'), 'Alice');
  assertEqual(cache.get('user1'), 'Alice');
  const stats = cache.stats();
  assertEqual(stats.misses, 1);
  assertEqual(stats.hits, 1);
  assertEqual(stats.hitRate, 0.5);
});

test('Ex3 — cache-aside ne cache pas les nulls', () => {
  const cache = createCacheAside(() => null);
  assertEqual(cache.get('missing'), null);
  assertEqual(cache.get('missing'), null);
  assertEqual(cache.stats().misses, 2);
  assertEqual(cache.stats().hits, 0);
});

test('Ex3 — cache invalidation', () => {
  const db: Record<string, string> = { key1: 'v1' };
  const cache = createCacheAside((key) => db[key] ?? null);
  cache.get('key1');
  cache.get('key1');
  cache.invalidate('key1');
  db['key1'] = 'v2';
  assertEqual(cache.get('key1'), 'v2');
  assertEqual(cache.stats().misses, 2);
});

summary();
