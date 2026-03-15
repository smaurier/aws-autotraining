// =============================================================================
// Lab 06 — API Gateway (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 06 — API Gateway');

// =============================================================================
// Exercise 1: Route Matcher
// =============================================================================

interface Route {
  method: string;
  path: string;
  handler: string;
}

interface MatchResult {
  handler: string;
  pathParams: Record<string, string>;
}

function matchRoute(routes: Route[], method: string, path: string): MatchResult | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const routeSegments = route.path.split('/');
    const pathSegments = path.split('/');
    if (routeSegments.length !== pathSegments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < routeSegments.length; i++) {
      const rSeg = routeSegments[i];
      if (rSeg.startsWith('{') && rSeg.endsWith('}')) {
        params[rSeg.slice(1, -1)] = pathSegments[i];
      } else if (rSeg !== pathSegments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: route.handler, pathParams: params };
  }
  return null;
}

// =============================================================================
// Exercise 2: Throttling Calculator
// =============================================================================

interface ThrottleConfig {
  rateLimit: number;
  burstLimit: number;
}

function createThrottler(config: ThrottleConfig) {
  let tokens = config.burstLimit;
  let lastRefillMs = 0;

  return {
    tryRequest(currentTimeMs: number): boolean {
      const elapsed = currentTimeMs - lastRefillMs;
      const refill = (elapsed / 1000) * config.rateLimit;
      tokens = Math.min(config.burstLimit, tokens + refill);
      lastRefillMs = currentTimeMs;
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
  };
}

// =============================================================================
// Exercise 3: Request Validator
// =============================================================================

interface ValidationRule {
  name: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  pattern?: string;
}

function validateQueryParams(
  params: Record<string, string>,
  rules: ValidationRule[]
): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    const value = params[rule.name];
    if (value === undefined) {
      if (rule.required) errors.push(`Missing required parameter: ${rule.name}`);
      continue;
    }
    if (rule.type === 'number' && isNaN(Number(value))) {
      errors.push(`Parameter ${rule.name} must be a number`);
    }
    if (rule.type === 'boolean' && value !== 'true' && value !== 'false') {
      errors.push(`Parameter ${rule.name} must be true or false`);
    }
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
      errors.push(`Parameter ${rule.name} does not match pattern ${rule.pattern}`);
    }
  }
  return errors;
}

// =============================================================================
// Exercise 4: CORS Header Builder
// =============================================================================

interface CorsConfig {
  allowOrigins: string[];
  allowMethods: string[];
  allowHeaders: string[];
  maxAge: number;
  allowCredentials: boolean;
}

function buildCorsHeaders(config: CorsConfig, requestOrigin: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const originAllowed = config.allowOrigins.includes('*') || config.allowOrigins.includes(requestOrigin);
  if (!originAllowed) return headers;

  headers['Access-Control-Allow-Origin'] = config.allowOrigins.includes('*') ? '*' : requestOrigin;
  if (config.allowMethods.length > 0) {
    headers['Access-Control-Allow-Methods'] = config.allowMethods.join(', ');
  }
  if (config.allowHeaders.length > 0) {
    headers['Access-Control-Allow-Headers'] = config.allowHeaders.join(', ');
  }
  headers['Access-Control-Max-Age'] = String(config.maxAge);
  if (config.allowCredentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — matchRoute matches static path', () => {
  const routes: Route[] = [{ method: 'GET', path: '/users', handler: 'listUsers' }];
  const result = matchRoute(routes, 'GET', '/users');
  assertEqual(result?.handler, 'listUsers');
  assertDeepEqual(result?.pathParams, {});
});

test('Ex1 — matchRoute captures path params', () => {
  const routes: Route[] = [{ method: 'GET', path: '/users/{userId}', handler: 'getUser' }];
  const result = matchRoute(routes, 'GET', '/users/42');
  assertEqual(result?.handler, 'getUser');
  assertEqual(result?.pathParams.userId, '42');
});

test('Ex1 — matchRoute with multiple params', () => {
  const routes: Route[] = [{ method: 'GET', path: '/users/{userId}/orders/{orderId}', handler: 'getOrder' }];
  const result = matchRoute(routes, 'GET', '/users/5/orders/100');
  assertEqual(result?.handler, 'getOrder');
  assertEqual(result?.pathParams.userId, '5');
  assertEqual(result?.pathParams.orderId, '100');
});

test('Ex1 — matchRoute returns null for no match', () => {
  const routes: Route[] = [{ method: 'POST', path: '/users', handler: 'createUser' }];
  assertEqual(matchRoute(routes, 'GET', '/users'), null);
  assertEqual(matchRoute(routes, 'POST', '/orders'), null);
});

test('Ex2 — throttler allows requests within limit', () => {
  const t = createThrottler({ rateLimit: 10, burstLimit: 10 });
  for (let i = 0; i < 10; i++) {
    assert(t.tryRequest(0), `Request ${i} should be allowed`);
  }
  assert(!t.tryRequest(0), 'Request 11 should be throttled');
});

test('Ex2 — throttler refills tokens over time', () => {
  const t = createThrottler({ rateLimit: 10, burstLimit: 10 });
  for (let i = 0; i < 10; i++) t.tryRequest(0);
  assert(!t.tryRequest(0), 'Should be empty');
  assert(t.tryRequest(1000), 'Should have refilled after 1 second');
});

test('Ex3 — validateQueryParams catches missing required', () => {
  const rules: ValidationRule[] = [{ name: 'page', required: true, type: 'number' }];
  const errors = validateQueryParams({}, rules);
  assert(errors.length > 0, 'Should report missing required param');
});

test('Ex3 — validateQueryParams validates type', () => {
  const rules: ValidationRule[] = [{ name: 'page', required: true, type: 'number' }];
  const errors = validateQueryParams({ page: 'abc' }, rules);
  assert(errors.length > 0, 'Should report type error');
});

test('Ex3 — validateQueryParams passes valid params', () => {
  const rules: ValidationRule[] = [
    { name: 'page', required: true, type: 'number' },
    { name: 'q', required: false, type: 'string' },
  ];
  const errors = validateQueryParams({ page: '5' }, rules);
  assertEqual(errors.length, 0);
});

test('Ex4 — buildCorsHeaders includes matching origin', () => {
  const headers = buildCorsHeaders({
    allowOrigins: ['https://example.com'], allowMethods: ['GET', 'POST'],
    allowHeaders: ['Content-Type'], maxAge: 3600, allowCredentials: true,
  }, 'https://example.com');
  assertEqual(headers['Access-Control-Allow-Origin'], 'https://example.com');
  assertEqual(headers['Access-Control-Allow-Credentials'], 'true');
});

test('Ex4 — buildCorsHeaders omits non-matching origin', () => {
  const headers = buildCorsHeaders({
    allowOrigins: ['https://example.com'], allowMethods: ['GET'],
    allowHeaders: [], maxAge: 3600, allowCredentials: false,
  }, 'https://evil.com');
  assertEqual(headers['Access-Control-Allow-Origin'], undefined);
});

test('Ex4 — buildCorsHeaders handles wildcard origin', () => {
  const headers = buildCorsHeaders({
    allowOrigins: ['*'], allowMethods: ['GET'], allowHeaders: [],
    maxAge: 86400, allowCredentials: false,
  }, 'https://anything.com');
  assertEqual(headers['Access-Control-Allow-Origin'], '*');
});

summary();
