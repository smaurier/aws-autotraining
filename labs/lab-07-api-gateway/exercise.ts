// =============================================================================
// Lab 06 — API Gateway
// =============================================================================
// Objectives:
//   - Match incoming requests to API routes
//   - Calculate throttling limits and burst capacity
//   - Validate request parameters
//   - Build CORS headers
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 06 — API Gateway');

// =============================================================================
// Exercise 1: Route Matcher
// =============================================================================

interface Route {
  method: string;
  path: string; // e.g. "/users/{userId}/orders/{orderId}"
  handler: string;
}

interface MatchResult {
  handler: string;
  pathParams: Record<string, string>;
}

// TODO: Match an incoming request (method + path) against a list of routes.
// Path parameters are denoted by {paramName} and should capture the actual value.
// Return null if no match found. Method must match exactly.
function matchRoute(routes: Route[], method: string, path: string): MatchResult | null {
  // TODO:
  // 1. For each route, check method match
  // 2. Split route.path and path into segments
  // 3. Segments must match exactly or be a {param} capture
  // 4. Return handler + captured path params
  return null;
}

// =============================================================================
// Exercise 2: Throttling Calculator
// =============================================================================

interface ThrottleConfig {
  rateLimit: number;   // requests per second (steady state)
  burstLimit: number;  // max burst capacity
}

// TODO: Simulate a token bucket throttler.
// Tokens refill at rateLimit per second, up to burstLimit.
// Each request consumes 1 token. Return true if allowed, false if throttled.
function createThrottler(config: ThrottleConfig) {
  // TODO: Track tokens and last refill time

  return {
    tryRequest(_currentTimeMs: number): boolean {
      // TODO: Refill tokens based on elapsed time, then consume one if available
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
  pattern?: string; // regex pattern for string validation
}

// TODO: Validate query parameters against a set of rules.
// Return an array of error messages. Empty array = valid.
function validateQueryParams(
  params: Record<string, string>,
  rules: ValidationRule[]
): string[] {
  // TODO:
  // - Check required params are present
  // - Check type (number should be parseable, boolean should be "true"/"false")
  // - Check pattern if provided
  return [];
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

// TODO: Build CORS response headers for a given request origin.
// If the origin is in allowOrigins (or allowOrigins contains "*"), include it.
// Otherwise, omit Access-Control-Allow-Origin.
function buildCorsHeaders(config: CorsConfig, requestOrigin: string): Record<string, string> {
  // TODO: Build the appropriate headers
  return {};
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
