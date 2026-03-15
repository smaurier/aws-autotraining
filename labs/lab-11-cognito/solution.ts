// =============================================================================
// Lab 09 — Cognito & Authentication (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 09 — Cognito & Authentication');

// =============================================================================
// Exercise 1: JWT Decoder
// =============================================================================

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT: must have 3 parts');
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(base64);
  return JSON.parse(json);
}

// =============================================================================
// Exercise 2: Token Validator
// =============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateToken(
  payload: Record<string, unknown>,
  expectedIssuer: string,
  nowEpoch: number,
): ValidationResult {
  const errors: string[] = [];
  if (!payload.exp || (payload.exp as number) <= nowEpoch) {
    errors.push('Token is expired');
  }
  if (payload.iss !== expectedIssuer) {
    errors.push('Invalid issuer');
  }
  if (!payload.sub) {
    errors.push('Missing subject (sub)');
  }
  return { valid: errors.length === 0, errors };
}

// =============================================================================
// Exercise 3: OAuth Flow Simulator
// =============================================================================

interface OAuthStep {
  step: string;
  sends: string;
  receives: string;
  nextStep: string | null;
}

function getOAuthStep(stepName: string): OAuthStep {
  const flow: Record<string, OAuthStep> = {
    authorize: {
      step: 'authorize',
      sends: 'redirect with code_challenge and scope',
      receives: 'authorization_code',
      nextStep: 'exchange',
    },
    exchange: {
      step: 'exchange',
      sends: 'authorization_code + code_verifier',
      receives: 'access_token + id_token + refresh_token',
      nextStep: 'refresh',
    },
    refresh: {
      step: 'refresh',
      sends: 'refresh_token',
      receives: 'new access_token + id_token',
      nextStep: 'logout',
    },
    logout: {
      step: 'logout',
      sends: 'token revocation request',
      receives: 'confirmation',
      nextStep: null,
    },
  };
  if (!flow[stepName]) throw new Error(`Unknown step: ${stepName}`);
  return flow[stepName];
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — decodeJwtPayload extracts payload', () => {
  const payload = { sub: '1234', name: 'Alice', iss: 'https://cognito.aws.com' };
  const encoded = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const token = `eyJhbGciOiJSUzI1NiJ9.${encoded}.fakesig`;
  const result = decodeJwtPayload(token);
  assertEqual(result.sub, '1234');
  assertEqual(result.name, 'Alice');
});

test('Ex1 — decodeJwtPayload throws on invalid token', () => {
  let threw = false;
  try { decodeJwtPayload('not.a-jwt'); } catch { threw = true; }
  assert(threw, 'Should throw on invalid token');
});

test('Ex2 — validateToken accepts valid token', () => {
  const payload = { sub: 'user-1', iss: 'https://cognito.aws.com', exp: 2000000000 };
  const result = validateToken(payload, 'https://cognito.aws.com', 1700000000);
  assertEqual(result.valid, true);
  assertEqual(result.errors.length, 0);
});

test('Ex2 — validateToken catches expired and wrong issuer', () => {
  const payload = { sub: 'user-1', iss: 'https://evil.com', exp: 1000 };
  const result = validateToken(payload, 'https://cognito.aws.com', 1700000000);
  assertEqual(result.valid, false);
  assertEqual(result.errors.length, 2);
});

test('Ex2 — validateToken catches missing sub', () => {
  const payload = { iss: 'https://cognito.aws.com', exp: 2000000000 };
  const result = validateToken(payload, 'https://cognito.aws.com', 1700000000);
  assertEqual(result.valid, false);
  assert(result.errors.length >= 1, 'Should have at least 1 error');
});

test('Ex3 — getOAuthStep authorize step', () => {
  const step = getOAuthStep('authorize');
  assertEqual(step.step, 'authorize');
  assertEqual(step.nextStep, 'exchange');
});

test('Ex3 — getOAuthStep exchange step', () => {
  const step = getOAuthStep('exchange');
  assertEqual(step.step, 'exchange');
  assertEqual(step.nextStep, 'refresh');
});

test('Ex3 — getOAuthStep logout is terminal', () => {
  const step = getOAuthStep('logout');
  assertEqual(step.nextStep, null);
});

summary();
