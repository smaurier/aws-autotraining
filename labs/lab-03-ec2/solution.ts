// =============================================================================
// Lab 03 — EC2 (SOLUTION)
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

function selectInstance(requirements: WorkloadRequirements): string | null {
  const candidates = INSTANCE_CATALOG.filter((i) => {
    if (i.vCPUs < requirements.minVCPUs) return false;
    if (i.memoryGiB < requirements.minMemoryGiB) return false;
    if (requirements.preferredCategory && i.category !== requirements.preferredCategory) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.pricePerHour - b.pricePerHour);
  return candidates[0].name;
}

// =============================================================================
// Exercise 2: Cost Calculator
// =============================================================================

interface CostEstimate {
  onDemand: number;
  spot: number;
  reserved1yr: number;
}

function calculateMonthlyCost(instanceName: string): CostEstimate {
  const instance = INSTANCE_CATALOG.find((i) => i.name === instanceName);
  if (!instance) throw new Error(`Unknown instance: ${instanceName}`);
  const monthly = instance.pricePerHour * 730;
  return {
    onDemand: Math.round(monthly * 100) / 100,
    spot: Math.round(monthly * 0.4 * 100) / 100,
    reserved1yr: Math.round(monthly * 0.6 * 100) / 100,
  };
}

function calculateFleetCost(fleet: Record<string, number>): number {
  let total = 0;
  for (const [name, count] of Object.entries(fleet)) {
    const instance = INSTANCE_CATALOG.find((i) => i.name === name);
    if (!instance) throw new Error(`Unknown instance: ${name}`);
    total += instance.pricePerHour * count * 730;
  }
  return Math.round(total * 100) / 100;
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

function recommendVolume(requiredIops: number, requiredThroughputMBs: number, sizeGiB: number): VolumeSpec {
  const priorities: VolumeType[] = ['gp3', 'io2', 'st1'];
  for (const type of priorities) {
    const limits = VOLUME_LIMITS[type];
    if (requiredIops <= limits.maxIops && requiredThroughputMBs <= limits.maxThroughputMBs
      && sizeGiB >= limits.minSizeGiB && sizeGiB <= limits.maxSizeGiB) {
      return { type, sizeGiB, iops: requiredIops, throughputMBs: requiredThroughputMBs };
    }
  }
  throw new Error('No suitable volume type found');
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
