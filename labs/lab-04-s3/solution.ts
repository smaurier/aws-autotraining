// =============================================================================
// Lab 04 — S3 (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 04 — S3');

// =============================================================================
// Exercise 1: Storage Class Optimizer
// =============================================================================

type StorageClass = 'STANDARD' | 'STANDARD_IA' | 'ONEZONE_IA' | 'GLACIER' | 'DEEP_ARCHIVE';

interface AccessPattern {
  accessesPerMonth: number;
  avgObjectSizeKB: number;
  durabilityRequired: 'high' | 'normal';
  retrievalUrgency: 'immediate' | 'hours' | 'days';
}

function recommendStorageClass(pattern: AccessPattern): StorageClass {
  if (pattern.retrievalUrgency === 'days') return 'DEEP_ARCHIVE';
  if (pattern.retrievalUrgency === 'hours') return 'GLACIER';
  if (pattern.accessesPerMonth >= 30) return 'STANDARD';
  if (pattern.accessesPerMonth >= 3) {
    return pattern.durabilityRequired === 'normal' ? 'ONEZONE_IA' : 'STANDARD_IA';
  }
  return pattern.durabilityRequired === 'normal' ? 'ONEZONE_IA' : 'STANDARD_IA';
}

// =============================================================================
// Exercise 2: Lifecycle Policy Generator
// =============================================================================

interface LifecycleRule {
  id: string;
  prefix: string;
  transitions: { days: number; storageClass: StorageClass }[];
  expiration?: { days: number };
}

function generateLifecycleRule(
  id: string,
  prefix: string,
  config: { iaAfterDays: number; glacierAfterDays: number; expireAfterDays?: number }
): LifecycleRule {
  const transitions: { days: number; storageClass: StorageClass }[] = [
    { days: config.iaAfterDays, storageClass: 'STANDARD_IA' },
    { days: config.glacierAfterDays, storageClass: 'GLACIER' },
  ];
  const rule: LifecycleRule = { id, prefix, transitions };
  if (config.expireAfterDays !== undefined) {
    rule.expiration = { days: config.expireAfterDays };
  }
  return rule;
}

// =============================================================================
// Exercise 3: Bucket Policy Builder
// =============================================================================

interface BucketPolicyStatement {
  Sid: string;
  Effect: 'Allow' | 'Deny';
  Principal: string | { AWS: string };
  Action: string[];
  Resource: string[];
  Condition?: Record<string, Record<string, string>>;
}

function enforceHttpsPolicy(bucketArn: string): BucketPolicyStatement {
  return {
    Sid: 'EnforceHTTPS',
    Effect: 'Deny',
    Principal: '*',
    Action: ['s3:*'],
    Resource: [`${bucketArn}/*`],
    Condition: { Bool: { 'aws:SecureTransport': 'false' } },
  };
}

function grantReadAccess(bucketArn: string, roleArn: string): BucketPolicyStatement {
  return {
    Sid: 'GrantReadAccess',
    Effect: 'Allow',
    Principal: { AWS: roleArn },
    Action: ['s3:GetObject'],
    Resource: [`${bucketArn}/*`],
  };
}

function restrictUploadsToPrefix(bucketArn: string, prefix: string, roleArn: string): BucketPolicyStatement {
  return {
    Sid: 'RestrictUploads',
    Effect: 'Allow',
    Principal: { AWS: roleArn },
    Action: ['s3:PutObject'],
    Resource: [`${bucketArn}/${prefix}*`],
  };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — recommendStorageClass for frequent access', () => {
  assertEqual(recommendStorageClass({
    accessesPerMonth: 100, avgObjectSizeKB: 512, durabilityRequired: 'high', retrievalUrgency: 'immediate',
  }), 'STANDARD');
});

test('Ex1 — recommendStorageClass for infrequent access', () => {
  assertEqual(recommendStorageClass({
    accessesPerMonth: 5, avgObjectSizeKB: 1024, durabilityRequired: 'high', retrievalUrgency: 'immediate',
  }), 'STANDARD_IA');
});

test('Ex1 — recommendStorageClass for single-zone infrequent', () => {
  assertEqual(recommendStorageClass({
    accessesPerMonth: 5, avgObjectSizeKB: 1024, durabilityRequired: 'normal', retrievalUrgency: 'immediate',
  }), 'ONEZONE_IA');
});

test('Ex1 — recommendStorageClass for archive (hours)', () => {
  assertEqual(recommendStorageClass({
    accessesPerMonth: 0, avgObjectSizeKB: 2048, durabilityRequired: 'high', retrievalUrgency: 'hours',
  }), 'GLACIER');
});

test('Ex1 — recommendStorageClass for deep archive', () => {
  assertEqual(recommendStorageClass({
    accessesPerMonth: 0, avgObjectSizeKB: 4096, durabilityRequired: 'high', retrievalUrgency: 'days',
  }), 'DEEP_ARCHIVE');
});

test('Ex2 — generateLifecycleRule with full transitions', () => {
  const rule = generateLifecycleRule('logs-lifecycle', 'logs/', {
    iaAfterDays: 30, glacierAfterDays: 90, expireAfterDays: 365,
  });
  assertEqual(rule.id, 'logs-lifecycle');
  assertEqual(rule.prefix, 'logs/');
  assertEqual(rule.transitions.length, 2);
  assertEqual(rule.transitions[0].days, 30);
  assertEqual(rule.transitions[0].storageClass, 'STANDARD_IA');
  assertEqual(rule.transitions[1].days, 90);
  assertEqual(rule.transitions[1].storageClass, 'GLACIER');
  assertEqual(rule.expiration?.days, 365);
});

test('Ex2 — generateLifecycleRule without expiration', () => {
  const rule = generateLifecycleRule('archive', 'data/', { iaAfterDays: 60, glacierAfterDays: 180 });
  assertEqual(rule.transitions.length, 2);
  assertEqual(rule.expiration, undefined);
});

test('Ex3 — enforceHttpsPolicy denies non-SSL', () => {
  const stmt = enforceHttpsPolicy('arn:aws:s3:::my-bucket');
  assertEqual(stmt.Effect, 'Deny');
  assertEqual(stmt.Principal, '*');
  assert(stmt.Condition !== undefined, 'Must have condition');
  assertEqual(stmt.Condition!['Bool']['aws:SecureTransport'], 'false');
});

test('Ex3 — grantReadAccess allows GetObject', () => {
  const stmt = grantReadAccess('arn:aws:s3:::my-bucket', 'arn:aws:iam::123:role/reader');
  assertEqual(stmt.Effect, 'Allow');
  assertDeepEqual(stmt.Action, ['s3:GetObject']);
  assertDeepEqual(stmt.Resource, ['arn:aws:s3:::my-bucket/*']);
});

test('Ex3 — restrictUploadsToPrefix scopes to prefix', () => {
  const stmt = restrictUploadsToPrefix('arn:aws:s3:::my-bucket', 'uploads/', 'arn:aws:iam::123:role/uploader');
  assertEqual(stmt.Effect, 'Allow');
  assertDeepEqual(stmt.Action, ['s3:PutObject']);
  assertDeepEqual(stmt.Resource, ['arn:aws:s3:::my-bucket/uploads/*']);
});

summary();
