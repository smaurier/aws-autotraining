// =============================================================================
// Lab 03 — EC2 (Elastic Compute Cloud)
// =============================================================================
// Objectives:
//   - Select optimal instance types based on workload requirements
//   - Calculate costs across pricing models (on-demand, spot, reserved)
//   - Size EBS volumes for given IOPS and throughput needs
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assert, summary } =
  createTestRunner('Lab 03 — EC2');

// =============================================================================
// Exercise 1: Instance Type Selector
// =============================================================================

interface InstanceType {
  name: string;
  vCPUs: number;
  memoryGiB: number;
  category: 'general' | 'compute' | 'memory' | 'storage';
  pricePerHour: number;
}

const INSTANCE_CATALOG: InstanceType[] = [
  { name: 't3.micro', vCPUs: 2, memoryGiB: 1, category: 'general', pricePerHour: 0.0104 },
  { name: 't3.medium', vCPUs: 2, memoryGiB: 4, category: 'general', pricePerHour: 0.0416 },
  { name: 'c6i.large', vCPUs: 2, memoryGiB: 4, category: 'compute', pricePerHour: 0.085 },
  { name: 'c6i.xlarge', vCPUs: 4, memoryGiB: 8, category: 'compute', pricePerHour: 0.17 },
  { name: 'r6i.large', vCPUs: 2, memoryGiB: 16, category: 'memory', pricePerHour: 0.126 },
  { name: 'r6i.xlarge', vCPUs: 4, memoryGiB: 32, category: 'memory', pricePerHour: 0.252 },
  { name: 'i3.large', vCPUs: 2, memoryGiB: 15.25, category: 'storage', pricePerHour: 0.156 },
  { name: 'm6i.large', vCPUs: 2, memoryGiB: 8, category: 'general', pricePerHour: 0.096 },
];

interface WorkloadRequirements {
  minVCPUs: number;
  minMemoryGiB: number;
  preferredCategory?: 'general' | 'compute' | 'memory' | 'storage';
}

// TODO: Find the cheapest instance that meets the workload requirements.
// Filter by minVCPUs, minMemoryGiB, and optionally preferredCategory.
// Return the instance name or null if none match.
function selectInstance(requirements: WorkloadRequirements): string | null {
  // TODO: Filter INSTANCE_CATALOG and pick cheapest match
  return null;
}

// =============================================================================
// Exercise 2: Cost Calculator
// =============================================================================

interface CostEstimate {
  onDemand: number;
  spot: number;
  reserved1yr: number;
}

// TODO: Calculate monthly cost (730 hours) for a given instance type.
// Spot discount: 60% off on-demand. Reserved 1yr: 40% off on-demand.
// Return all three prices rounded to 2 decimal places.
function calculateMonthlyCost(instanceName: string): CostEstimate {
  // TODO: Find instance in catalog, compute costs
  return { onDemand: 0, spot: 0, reserved1yr: 0 };
}

// TODO: Given a fleet of instances (name -> count), calculate total monthly on-demand cost.
function calculateFleetCost(fleet: Record<string, number>): number {
  // TODO: Sum up on-demand costs for all instances in the fleet
  return 0;
}

// =============================================================================
// Exercise 3: EBS Volume Sizer
// =============================================================================

type VolumeType = 'gp3' | 'io2' | 'st1';

interface VolumeSpec {
  type: VolumeType;
  sizeGiB: number;
  iops: number;
  throughputMBs: number;
}

const VOLUME_LIMITS: Record<VolumeType, { maxIops: number; maxThroughputMBs: number; minSizeGiB: number; maxSizeGiB: number }> = {
  gp3: { maxIops: 16000, maxThroughputMBs: 1000, minSizeGiB: 1, maxSizeGiB: 16384 },
  io2: { maxIops: 64000, maxThroughputMBs: 1000, minSizeGiB: 4, maxSizeGiB: 16384 },
  st1: { maxIops: 500, maxThroughputMBs: 500, minSizeGiB: 125, maxSizeGiB: 16384 },
};

// TODO: Recommend a volume spec for given IOPS and throughput needs.
// Pick the cheapest volume type that supports the requirements.
// Priority: gp3 first (cheapest), then io2 if gp3 can't handle IOPS, then st1 for throughput-only.
function recommendVolume(requiredIops: number, requiredThroughputMBs: number, sizeGiB: number): VolumeSpec {
  // TODO: Check each volume type's limits and return the best fit
  return {} as VolumeSpec;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — selectInstance picks cheapest general purpose', () => {
  const result = selectInstance({ minVCPUs: 2, minMemoryGiB: 4, preferredCategory: 'general' });
  assertEqual(result, 't3.medium');
});

test('Ex1 — selectInstance picks compute-optimized', () => {
  const result = selectInstance({ minVCPUs: 4, minMemoryGiB: 8, preferredCategory: 'compute' });
  assertEqual(result, 'c6i.xlarge');
});

test('Ex1 — selectInstance picks cheapest across all categories', () => {
  const result = selectInstance({ minVCPUs: 2, minMemoryGiB: 1 });
  assertEqual(result, 't3.micro');
});

test('Ex1 — selectInstance returns null for impossible requirements', () => {
  const result = selectInstance({ minVCPUs: 64, minMemoryGiB: 512 });
  assertEqual(result, null);
});

test('Ex2 — calculateMonthlyCost for t3.micro', () => {
  const cost = calculateMonthlyCost('t3.micro');
  assertEqual(cost.onDemand, 7.59);
  assertEqual(cost.spot, 3.04);
  assertEqual(cost.reserved1yr, 4.56);
});

test('Ex2 — calculateFleetCost sums correctly', () => {
  const total = calculateFleetCost({ 't3.micro': 3, 'c6i.large': 2 });
  const expected = (0.0104 * 3 + 0.085 * 2) * 730;
  assertEqual(Math.round(total * 100) / 100, Math.round(expected * 100) / 100);
});

test('Ex3 — recommendVolume picks gp3 for moderate IOPS', () => {
  const vol = recommendVolume(3000, 125, 100);
  assertEqual(vol.type, 'gp3');
  assertEqual(vol.iops, 3000);
});

test('Ex3 — recommendVolume picks io2 for high IOPS', () => {
  const vol = recommendVolume(32000, 500, 100);
  assertEqual(vol.type, 'io2');
  assertEqual(vol.iops, 32000);
});

test('Ex3 — recommendVolume respects size limits', () => {
  const vol = recommendVolume(500, 100, 200);
  assertEqual(vol.type, 'gp3');
  assertEqual(vol.sizeGiB, 200);
});

summary();
