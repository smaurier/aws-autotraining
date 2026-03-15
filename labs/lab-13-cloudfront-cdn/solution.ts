// =============================================================================
// Lab 12 — CloudFront : Cache key, TTL resolver, origin failover (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 12 — CloudFront CDN');

// =============================================================================
// Exercice 1 : Cache key generator
// =============================================================================

function generateCacheKey(
  path: string,
  queryParams: Record<string, string>,
  excludeParams: string[] = []
): string {
  const filtered = Object.entries(queryParams)
    .filter(([key]) => !excludeParams.includes(key))
    .sort(([a], [b]) => a.localeCompare(b));
  if (filtered.length === 0) return path;
  const qs = filtered.map(([k, v]) => `${k}=${v}`).join('&');
  return `${path}?${qs}`;
}

// =============================================================================
// Exercice 2 : TTL resolver par type de fichier
// =============================================================================

const TTL_RULES: Record<string, number> = {
  '.html': 300,
  '.css': 86400,
  '.js': 86400,
  '.png': 604800,
  '.jpg': 604800,
  '.svg': 604800,
  '.woff2': 2592000,
  '.json': 60,
};
const DEFAULT_TTL = 3600;

function resolveTTL(filePath: string): number {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return DEFAULT_TTL;
  const ext = filePath.slice(dotIndex);
  return TTL_RULES[ext] ?? DEFAULT_TTL;
}

// =============================================================================
// Exercice 3 : Origin failover logic
// =============================================================================

interface Origin {
  id: string;
  domain: string;
  healthy: boolean;
}

interface OriginGroup {
  primary: Origin;
  fallback: Origin;
}

function selectOrigin(group: OriginGroup): Origin | null {
  if (group.primary.healthy) return group.primary;
  if (group.fallback.healthy) return group.fallback;
  return null;
}

function originHealthReport(groups: OriginGroup[]): {
  healthy: number;
  unhealthy: number;
  activeOrigins: string[];
} {
  let healthy = 0;
  let unhealthy = 0;
  const activeOrigins: string[] = [];
  for (const g of groups) {
    const allOrigins = [g.primary, g.fallback];
    for (const o of allOrigins) {
      if (o.healthy) healthy++;
      else unhealthy++;
    }
    const selected = selectOrigin(g);
    if (selected) activeOrigins.push(selected.domain);
  }
  return { healthy, unhealthy, activeOrigins };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — generateCacheKey trie les params', () => {
  const key = generateCacheKey('/api/users', { sort: 'name', page: '1', limit: '10' });
  assertEqual(key, '/api/users?limit=10&page=1&sort=name');
});

test('Ex1 — generateCacheKey exclut les params', () => {
  const key = generateCacheKey('/api/data', { token: 'abc', page: '2' }, ['token']);
  assertEqual(key, '/api/data?page=2');
});

test('Ex1 — generateCacheKey sans params', () => {
  const key = generateCacheKey('/index.html', {});
  assertEqual(key, '/index.html');
});

test('Ex2 — resolveTTL pour fichiers statiques', () => {
  assertEqual(resolveTTL('/assets/style.css'), 86400);
  assertEqual(resolveTTL('/images/logo.png'), 604800);
  assertEqual(resolveTTL('/fonts/inter.woff2'), 2592000);
});

test('Ex2 — resolveTTL pour HTML', () => {
  assertEqual(resolveTTL('/index.html'), 300);
});

test('Ex2 — resolveTTL pour extension inconnue', () => {
  assertEqual(resolveTTL('/data/export.csv'), DEFAULT_TTL);
});

test('Ex3 — selectOrigin retourne le primary si sain', () => {
  const group: OriginGroup = {
    primary: { id: 'p1', domain: 'main.example.com', healthy: true },
    fallback: { id: 'f1', domain: 'backup.example.com', healthy: true },
  };
  const origin = selectOrigin(group);
  assertEqual(origin!.id, 'p1');
});

test('Ex3 — selectOrigin bascule sur le fallback', () => {
  const group: OriginGroup = {
    primary: { id: 'p1', domain: 'main.example.com', healthy: false },
    fallback: { id: 'f1', domain: 'backup.example.com', healthy: true },
  };
  const origin = selectOrigin(group);
  assertEqual(origin!.id, 'f1');
});

test('Ex3 — selectOrigin retourne null si tout est down', () => {
  const group: OriginGroup = {
    primary: { id: 'p1', domain: 'main.example.com', healthy: false },
    fallback: { id: 'f1', domain: 'backup.example.com', healthy: false },
  };
  assertEqual(selectOrigin(group), null);
});

test('Ex3 — originHealthReport resume la sante', () => {
  const groups: OriginGroup[] = [
    {
      primary: { id: 'p1', domain: 'a.com', healthy: true },
      fallback: { id: 'f1', domain: 'a-backup.com', healthy: true },
    },
    {
      primary: { id: 'p2', domain: 'b.com', healthy: false },
      fallback: { id: 'f2', domain: 'b-backup.com', healthy: true },
    },
  ];
  const report = originHealthReport(groups);
  assertEqual(report.healthy, 3);
  assertEqual(report.unhealthy, 1);
  assertDeepEqual(report.activeOrigins, ['a.com', 'b-backup.com']);
});

summary();
