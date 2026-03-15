// =============================================================================
// Lab 12 — CloudFront : Cache key, TTL resolver, origin failover
// =============================================================================
// Objectifs :
//   - Generer des cles de cache pour CloudFront
//   - Determiner le TTL selon le type de fichier
//   - Implementer la logique de failover d'origines
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 12 — CloudFront CDN');

// =============================================================================
// Exercice 1 : Cache key generator
// =============================================================================

// TODO: Implementez cette fonction
// La cle de cache est composee de : path + query params tries alphabetiquement
// Ex: '/api/users?page=1&sort=name' -> '/api/users?page=1&sort=name'
// Ex: '/api/users?sort=name&page=1' -> '/api/users?page=1&sort=name'
// Ignorez les query params listes dans excludeParams
function generateCacheKey(
  path: string,
  queryParams: Record<string, string>,
  excludeParams: string[] = []
): string {
  // TODO: Triez les params, excluez ceux dans excludeParams, construisez la cle
  return '';
}

// =============================================================================
// Exercice 2 : TTL resolver par type de fichier
// =============================================================================

const TTL_RULES: Record<string, number> = {
  '.html': 300,        // 5 minutes
  '.css': 86400,       // 1 jour
  '.js': 86400,        // 1 jour
  '.png': 604800,      // 7 jours
  '.jpg': 604800,      // 7 jours
  '.svg': 604800,      // 7 jours
  '.woff2': 2592000,   // 30 jours
  '.json': 60,         // 1 minute
};
const DEFAULT_TTL = 3600; // 1 heure

// TODO: Implementez cette fonction
// Retournez le TTL en secondes en fonction de l'extension du fichier
// Utilisez TTL_RULES, ou DEFAULT_TTL si l'extension n'est pas listee
function resolveTTL(filePath: string): number {
  // TODO: Extrayez l'extension et cherchez dans TTL_RULES
  return 0;
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

// TODO: Implementez cette fonction
// Si le primary est healthy, retournez le primary.
// Sinon, si le fallback est healthy, retournez le fallback.
// Sinon, retournez null (aucune origine disponible).
function selectOrigin(group: OriginGroup): Origin | null {
  // TODO
  return null;
}

// TODO: Implementez cette fonction
// Pour un tableau de groupes d'origines, retournez un rapport :
// { healthy: nombre total d'origines saines, unhealthy: nombre total non saines,
//   activeOrigins: liste des domaines selectionnes (un par groupe) }
function originHealthReport(groups: OriginGroup[]): {
  healthy: number;
  unhealthy: number;
  activeOrigins: string[];
} {
  // TODO
  return { healthy: 0, unhealthy: 0, activeOrigins: [] };
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
