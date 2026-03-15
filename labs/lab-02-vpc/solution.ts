// =============================================================================
// Lab 02 — VPC (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 02 — VPC');

// =============================================================================
// Exercise 1: CIDR Subnet Splitter
// =============================================================================

function ipToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function numToIp(num: number): string {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
}

function splitCidr(cidr: string, count: number): string[] {
  if (count <= 0 || (count & (count - 1)) !== 0) {
    throw new Error('Count must be a power of 2');
  }
  const [baseIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const newPrefix = prefix + Math.log2(count);
  const subnetSize = 2 ** (32 - newPrefix);
  const baseNum = ipToNum(baseIp);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(`${numToIp((baseNum + i * subnetSize) >>> 0)}/${newPrefix}`);
  }
  return result;
}

// =============================================================================
// Exercise 2: Security Group Rule Validator
// =============================================================================

interface SecurityGroupRule {
  direction: 'inbound' | 'outbound';
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  fromPort: number;
  toPort: number;
  source: string;
}

function isValidCidrBasic(cidr: string): boolean {
  const match = cidr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!match) return false;
  const octets = [+match[1], +match[2], +match[3], +match[4]];
  const prefix = +match[5];
  return octets.every((o) => o >= 0 && o <= 255) && prefix >= 0 && prefix <= 32;
}

function isValidSgRule(rule: SecurityGroupRule): boolean {
  if (rule.protocol === 'icmp') {
    if (rule.fromPort !== -1 || rule.toPort !== -1) return false;
  } else {
    if (rule.fromPort < 0 || rule.fromPort > 65535) return false;
    if (rule.toPort < 0 || rule.toPort > 65535) return false;
    if (rule.fromPort > rule.toPort) return false;
  }
  if (!rule.source.startsWith('sg-') && !isValidCidrBasic(rule.source)) return false;
  return true;
}

// =============================================================================
// Exercise 3: Route Table Resolver
// =============================================================================

interface RouteEntry {
  destination: string;
  target: string;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [baseIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToNum(ip) & mask) === (ipToNum(baseIp) & mask);
}

function resolveRoute(routes: RouteEntry[], destinationIp: string): string {
  let bestTarget = 'no-route';
  let bestPrefix = -1;
  for (const route of routes) {
    const prefix = parseInt(route.destination.split('/')[1], 10);
    if (ipInCidr(destinationIp, route.destination) && prefix > bestPrefix) {
      bestPrefix = prefix;
      bestTarget = route.target;
    }
  }
  return bestTarget;
}

// =============================================================================
// Tests
// =============================================================================

test('helpers — ipToNum and numToIp round-trip', () => {
  assertEqual(numToIp(ipToNum('10.0.0.0')), '10.0.0.0');
  assertEqual(numToIp(ipToNum('192.168.1.1')), '192.168.1.1');
  assertEqual(ipToNum('10.0.0.0'), 167772160);
});

test('Ex1 — splitCidr /16 into 4 subnets', () => {
  const subnets = splitCidr('10.0.0.0/16', 4);
  assertEqual(subnets.length, 4);
  assertEqual(subnets[0], '10.0.0.0/18');
  assertEqual(subnets[1], '10.0.64.0/18');
  assertEqual(subnets[2], '10.0.128.0/18');
  assertEqual(subnets[3], '10.0.192.0/18');
});

test('Ex1 — splitCidr /24 into 2 subnets', () => {
  const subnets = splitCidr('192.168.1.0/24', 2);
  assertEqual(subnets.length, 2);
  assertEqual(subnets[0], '192.168.1.0/25');
  assertEqual(subnets[1], '192.168.1.128/25');
});

test('Ex1 — splitCidr throws on non-power-of-2', () => {
  let threw = false;
  try { splitCidr('10.0.0.0/16', 3); } catch { threw = true; }
  assert(threw, 'Should throw for non-power-of-2 count');
});

test('Ex2 — isValidSgRule accepts valid TCP rule', () => {
  assert(isValidSgRule({
    direction: 'inbound', protocol: 'tcp', fromPort: 443, toPort: 443, source: '0.0.0.0/0',
  }), 'HTTPS rule should be valid');
});

test('Ex2 — isValidSgRule accepts sg- source', () => {
  assert(isValidSgRule({
    direction: 'inbound', protocol: 'tcp', fromPort: 80, toPort: 80, source: 'sg-0123abcd',
  }), 'Security group source should be valid');
});

test('Ex2 — isValidSgRule rejects invalid port range', () => {
  assert(!isValidSgRule({
    direction: 'inbound', protocol: 'tcp', fromPort: 8080, toPort: 80, source: '0.0.0.0/0',
  }), 'fromPort > toPort should be invalid');
});

test('Ex2 — isValidSgRule validates ICMP ports', () => {
  assert(isValidSgRule({
    direction: 'inbound', protocol: 'icmp', fromPort: -1, toPort: -1, source: '10.0.0.0/8',
  }), 'ICMP with -1 ports should be valid');
  assert(!isValidSgRule({
    direction: 'inbound', protocol: 'icmp', fromPort: 80, toPort: 80, source: '10.0.0.0/8',
  }), 'ICMP with specific ports should be invalid');
});

test('Ex3 — ipInCidr checks membership', () => {
  assert(ipInCidr('10.0.1.5', '10.0.0.0/16'), '10.0.1.5 in 10.0.0.0/16');
  assert(!ipInCidr('10.1.0.1', '10.0.0.0/16'), '10.1.0.1 not in 10.0.0.0/16');
  assert(ipInCidr('192.168.1.100', '0.0.0.0/0'), 'Any IP in 0.0.0.0/0');
});

test('Ex3 — resolveRoute picks longest prefix match', () => {
  const routes: RouteEntry[] = [
    { destination: '0.0.0.0/0', target: 'igw-123' },
    { destination: '10.0.0.0/16', target: 'local' },
    { destination: '10.0.1.0/24', target: 'nat-456' },
  ];
  assertEqual(resolveRoute(routes, '10.0.1.5'), 'nat-456');
  assertEqual(resolveRoute(routes, '10.0.2.5'), 'local');
  assertEqual(resolveRoute(routes, '8.8.8.8'), 'igw-123');
});

test('Ex3 — resolveRoute returns no-route when unmatched', () => {
  assertEqual(resolveRoute([], '10.0.0.1'), 'no-route');
});

summary();
