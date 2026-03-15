// =============================================================================
// Lab 02 — VPC (Virtual Private Cloud)
// =============================================================================
// Objectives:
//   - Split a CIDR block into subnets
//   - Validate security group rules
//   - Resolve route table entries
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 02 — VPC');

// =============================================================================
// Exercise 1: CIDR Subnet Splitter
// =============================================================================

// TODO: Split a CIDR block into N equal subnets.
// E.g. splitCidr("10.0.0.0/16", 4) -> ["10.0.0.0/18","10.0.64.0/18","10.0.128.0/18","10.0.192.0/18"]
// N must be a power of 2. Throw if not.
function splitCidr(cidr: string, count: number): string[] {
  // TODO:
  // 1. Parse the base IP and prefix
  // 2. Calculate new prefix = oldPrefix + log2(count)
  // 3. Calculate the size of each subnet
  // 4. Generate the subnet CIDRs
  return [];
}

// Helper: convert IP string to 32-bit number
function ipToNum(ip: string): number {
  // TODO: Split on "." and combine octets into a single number
  return 0;
}

// Helper: convert 32-bit number to IP string
function numToIp(num: number): string {
  // TODO: Extract each octet from the number
  return '';
}

// =============================================================================
// Exercise 2: Security Group Rule Validator
// =============================================================================

interface SecurityGroupRule {
  direction: 'inbound' | 'outbound';
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  fromPort: number;
  toPort: number;
  source: string; // CIDR or security group ID
}

// TODO: Validate that a security group rule is well-formed.
// Rules:
// - fromPort and toPort must be 0-65535
// - fromPort <= toPort
// - If protocol is "icmp", ports must be -1 (any)
// - If protocol is "all", ports must be 0-65535
// - source must be a valid CIDR or start with "sg-"
function isValidSgRule(rule: SecurityGroupRule): boolean {
  // TODO: Implement validation logic
  return false;
}

// =============================================================================
// Exercise 3: Route Table Resolver
// =============================================================================

interface RouteEntry {
  destination: string; // CIDR
  target: string;      // e.g. "igw-123", "nat-456", "local"
}

// TODO: Given a route table and a destination IP, find the most specific
// matching route (longest prefix match).
// Return the target string, or "no-route" if no match found.
function resolveRoute(routes: RouteEntry[], destinationIp: string): string {
  // TODO:
  // 1. For each route, check if the IP falls within the CIDR
  // 2. Among matches, pick the one with the longest prefix
  return 'no-route';
}

// TODO: Check if an IP address falls within a CIDR block.
function ipInCidr(ip: string, cidr: string): boolean {
  // TODO: Convert IP and CIDR base to numbers, apply mask
  return false;
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
