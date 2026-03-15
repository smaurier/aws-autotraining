// =============================================================================
// Lab 14 — RDS : Connection pool, read replica routing, cache-aside
// =============================================================================
// Objectifs :
//   - Dimensionner un pool de connexions
//   - Router les requetes vers des replicas en lecture (round-robin)
//   - Implementer le pattern cache-aside
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

// TODO: Implementez cette fonction
// Calculez le nombre optimal de connexions dans le pool :
// Formula : ceil(targetRequestsPerSec * (avgQueryTimeMs / 1000))
// Le resultat ne doit pas depasser maxConnections.
// Minimum : 1 connexion.
function calculatePoolSize(config: PoolConfig): number {
  // TODO
  return 0;
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

// TODO: Implementez cette fonction
// Creez un routeur round-robin qui distribue les requetes entre les replicas.
// next() retourne l'endpoint suivant dans la rotation.
// Si aucun replica n'est disponible, retournez le primaryEndpoint.
function createReplicaRouter(primaryEndpoint: string, replicas: string[]): ReplicaRouter {
  // TODO
  return {
    next() { return ''; },
    addReplica(_endpoint: string) {},
    removeReplica(_endpoint: string) {},
    getReplicaCount() { return 0; },
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

// TODO: Implementez cette fonction
// Creez un cache-aside :
// - get(key) : si la valeur est en cache, retournez-la (hit).
//              Sinon, appelez fetchFromDb(key) (miss).
//              Si la DB retourne une valeur, stockez-la en cache et retournez-la.
//              Si la DB retourne null, retournez null (ne cachez pas les nulls).
// - invalidate(key) : supprimez la cle du cache.
// - stats() : retournez hits, misses, et hitRate (hits / (hits + misses), arrondi a 2 dec.)
function createCacheAside(fetchFromDb: FetchFn): CacheAside {
  // TODO
  return {
    get(_key: string) { return null; },
    invalidate(_key: string) {},
    stats() { return { hits: 0, misses: 0, hitRate: 0 }; },
  };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — calculatePoolSize dimensionne correctement', () => {
  assertEqual(calculatePoolSize({
    maxConnections: 100, avgQueryTimeMs: 50, targetRequestsPerSec: 200,
  }), 10); // ceil(200 * 0.05) = 10
});

test('Ex1 — calculatePoolSize plafonne a maxConnections', () => {
  assertEqual(calculatePoolSize({
    maxConnections: 5, avgQueryTimeMs: 100, targetRequestsPerSec: 1000,
  }), 5); // ceil(1000 * 0.1) = 100, mais max = 5
});

test('Ex1 — calculatePoolSize minimum 1', () => {
  assertEqual(calculatePoolSize({
    maxConnections: 100, avgQueryTimeMs: 1, targetRequestsPerSec: 1,
  }), 1); // ceil(1 * 0.001) = 1
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
  assertEqual(cache.get('user1'), 'Alice');  // miss
  assertEqual(cache.get('user1'), 'Alice');  // hit
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
  cache.get('key1'); // miss -> cache
  cache.get('key1'); // hit
  cache.invalidate('key1');
  db['key1'] = 'v2';
  assertEqual(cache.get('key1'), 'v2'); // miss -> re-fetch
  assertEqual(cache.stats().misses, 2);
});

summary();
