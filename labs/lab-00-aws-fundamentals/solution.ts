// =============================================================================
// Lab 00 — AWS Fundamentals (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 00 — AWS Fundamentals');

// =============================================================================
// Exercise 1: Parse ARN
// =============================================================================

interface ArnComponents {
  partition: string;
  service: string;
  region: string;
  accountId: string;
  resource: string;
}

function parseArn(arn: string): ArnComponents {
  if (!arn.startsWith('arn:')) throw new Error('Invalid ARN: must start with arn:');
  const parts = arn.split(':');
  if (parts.length < 6) throw new Error('Invalid ARN: must have at least 6 colon-separated parts');
  return {
    partition: parts[1],
    service: parts[2],
    region: parts[3],
    accountId: parts[4],
    resource: parts.slice(5).join(':'),
  };
}

// =============================================================================
// Exercise 2: Region Latency Estimator
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

function estimateLatency(regionA: string, regionB: string): number {
  const coordA = REGION_COORDS[regionA];
  const coordB = REGION_COORDS[regionB];
  if (!coordA) throw new Error(`Unknown region: ${regionA}`);
  if (!coordB) throw new Error(`Unknown region: ${regionB}`);

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const [lat1, lon1] = coordA.map(toRad);
  const [lat2, lon2] = coordB.map(toRad);
  const dlat = lat2 - lat1;
  const dlon = lon2 - lon1;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distKm = 6371 * c;

  return Math.round(distKm / 100);
}

// =============================================================================
// Exercise 3: Validate CIDR Block
// =============================================================================

function isValidCidr(cidr: string): boolean {
  const match = cidr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!match) return false;
  const octets = [+match[1], +match[2], +match[3], +match[4]];
  const prefix = +match[5];
  if (octets.some((o) => o < 0 || o > 255)) return false;
  if (prefix < 0 || prefix > 32) return false;
  return true;
}

// =============================================================================
// Exercise 4: Count IPs in CIDR
// =============================================================================

function countIpsInCidr(cidr: string): number {
  if (!isValidCidr(cidr)) throw new Error(`Invalid CIDR: ${cidr}`);
  const prefix = parseInt(cidr.split('/')[1], 10);
  return 2 ** (32 - prefix);
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
