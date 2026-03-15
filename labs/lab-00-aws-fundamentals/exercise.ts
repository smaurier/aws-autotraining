// =============================================================================
// Lab 00 — AWS Fundamentals
// =============================================================================
// Objectives:
//   - Parse and validate AWS ARNs (Amazon Resource Names)
//   - Estimate latency between AWS regions
//   - Validate CIDR block notation
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 00 — AWS Fundamentals');

// =============================================================================
// Exercise 1: Parse ARN
// An ARN has the format: arn:partition:service:region:account-id:resource
// =============================================================================

interface ArnComponents {
  partition: string;
  service: string;
  region: string;
  accountId: string;
  resource: string;
}

// TODO: Parse an ARN string into its components.
// Throw an error if the string doesn't start with "arn:" or has fewer than 6 parts.
function parseArn(arn: string): ArnComponents {
  // TODO: Split on ":" and extract each component
  return {} as ArnComponents;
}

// =============================================================================
// Exercise 2: Region Latency Estimator
// Given two regions, estimate round-trip latency in ms based on geography.
// =============================================================================

const REGION_COORDS: Record<string, [number, number]> = {
  'us-east-1': [39.0, -77.5],
  'us-west-2': [46.2, -122.3],
  'eu-west-1': [53.3, -6.3],
  'eu-central-1': [50.1, 8.7],
  'ap-northeast-1': [35.7, 139.7],
  'ap-southeast-1': [1.3, 103.8],
  'sa-east-1': [-23.5, -46.6],
};

// TODO: Calculate the great-circle distance between two regions in km,
// then estimate latency as distance / 100 (rough ms estimate), rounded.
// Throw if either region is unknown.
function estimateLatency(regionA: string, regionB: string): number {
  // TODO: Use the Haversine formula to compute distance
  // latency ~= distance_km / 100, rounded to nearest integer
  return 0;
}

// =============================================================================
// Exercise 3: Validate CIDR Block
// Check if a string is a valid IPv4 CIDR (e.g. "10.0.0.0/16")
// =============================================================================

// TODO: Return true if the input is a valid CIDR block.
// Rules: 4 octets 0-255, slash, prefix 0-32.
function isValidCidr(cidr: string): boolean {
  // TODO: Parse and validate each part
  return false;
}

// =============================================================================
// Exercise 4: Count IPs in CIDR
// =============================================================================

// TODO: Return the number of IP addresses in a CIDR block.
// Formula: 2^(32 - prefix). Throw if CIDR is invalid.
function countIpsInCidr(cidr: string): number {
  // TODO: Extract prefix length, compute 2^(32 - prefix)
  return 0;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — parseArn extracts components', () => {
  const result = parseArn('arn:aws:s3:us-east-1:123456789012:my-bucket');
  assertEqual(result.partition, 'aws');
  assertEqual(result.service, 's3');
  assertEqual(result.region, 'us-east-1');
  assertEqual(result.accountId, '123456789012');
  assertEqual(result.resource, 'my-bucket');
});

test('Ex1 — parseArn handles IAM ARN (empty region)', () => {
  const result = parseArn('arn:aws:iam::123456789012:user/admin');
  assertEqual(result.service, 'iam');
  assertEqual(result.region, '');
  assertEqual(result.resource, 'user/admin');
});

test('Ex1 — parseArn throws on invalid ARN', () => {
  let threw = false;
  try { parseArn('not-an-arn'); } catch { threw = true; }
  assert(threw, 'Should throw on invalid ARN');
});

test('Ex2 — estimateLatency same region is 0', () => {
  assertEqual(estimateLatency('us-east-1', 'us-east-1'), 0);
});

test('Ex2 — estimateLatency us-east-1 to eu-west-1', () => {
  const latency = estimateLatency('us-east-1', 'eu-west-1');
  assert(latency > 40 && latency < 70, `Expected 40-70ms, got ${latency}`);
});

test('Ex2 — estimateLatency throws for unknown region', () => {
  let threw = false;
  try { estimateLatency('us-east-1', 'mars-west-1'); } catch { threw = true; }
  assert(threw, 'Should throw for unknown region');
});

test('Ex3 — isValidCidr accepts valid CIDRs', () => {
  assert(isValidCidr('10.0.0.0/16'), '10.0.0.0/16 should be valid');
  assert(isValidCidr('192.168.1.0/24'), '192.168.1.0/24 should be valid');
  assert(isValidCidr('0.0.0.0/0'), '0.0.0.0/0 should be valid');
});

test('Ex3 — isValidCidr rejects invalid CIDRs', () => {
  assert(!isValidCidr('256.0.0.0/16'), 'Octet > 255');
  assert(!isValidCidr('10.0.0.0/33'), 'Prefix > 32');
  assert(!isValidCidr('10.0.0/16'), 'Only 3 octets');
  assert(!isValidCidr('not-a-cidr'), 'Not a CIDR');
});

test('Ex4 — countIpsInCidr returns correct counts', () => {
  assertEqual(countIpsInCidr('10.0.0.0/24'), 256);
  assertEqual(countIpsInCidr('10.0.0.0/16'), 65536);
  assertEqual(countIpsInCidr('10.0.0.0/32'), 1);
  assertEqual(countIpsInCidr('0.0.0.0/0'), 4294967296);
});

summary();
