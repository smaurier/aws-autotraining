// =============================================================================
// Lab 09 — Cognito & Authentication
// =============================================================================
// Objectives:
//   - Decode JWT payload (base64)
//   - Validate token expiry
//   - Simulate OAuth authorization code flow
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 09 — Cognito & Authentication');

// =============================================================================
// Exercise 1: JWT Decoder
// A JWT has 3 base64url-encoded parts: header.payload.signature
// Decode and return the payload as an object.
// =============================================================================

function decodeJwtPayload(token: string): Record<string, unknown> {
  // TODO: Split on ".", take the second part, base64url-decode it,
  // parse as JSON. Throw if token doesn't have 3 parts.
  return {};
}

// =============================================================================
// Exercise 2: Token Validator
// Check if a decoded token is valid: not expired, correct issuer, has sub.
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
  // TODO: Check "exp" > nowEpoch, "iss" === expectedIssuer, "sub" exists.
  // Return { valid, errors } where errors lists each failing check.
  return { valid: false, errors: [] };
}

// =============================================================================
// Exercise 3: OAuth Flow Simulator
// Simulate the Authorization Code flow steps. Given a step name, return
// the next step and what data is exchanged.
// =============================================================================

interface OAuthStep {
  step: string;
  sends: string;
  receives: string;
  nextStep: string | null;
}

function getOAuthStep(stepName: string): OAuthStep {
  // TODO: Implement the 4-step flow:
  // 1. "authorize" → sends redirect with code_challenge, receives auth_code
  // 2. "exchange"  → sends auth_code + code_verifier, receives tokens
  // 3. "refresh"   → sends refresh_token, receives new tokens
  // 4. "logout"    → sends revocation request, receives confirmation
  return { step: '', sends: '', receives: '', nextStep: null };
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
