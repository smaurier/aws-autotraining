// =============================================================================
// Lab 01 — IAM (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assertEqual, assertDeepEqual, assert, summary } =
  createTestRunner('Lab 01 — IAM');

// =============================================================================
// Exercise 1: Policy Document Builder
// =============================================================================

interface PolicyStatement {
  Effect: 'Allow' | 'Deny';
  Action: string[];
  Resource: string[];
}

interface PolicyDocument {
  Version: string;
  Statement: PolicyStatement[];
}

function buildPolicy(...statements: PolicyStatement[]): PolicyDocument {
  return { Version: '2012-10-17', Statement: statements };
}

function allowStatement(actions: string[], resources: string[]): PolicyStatement {
  return { Effect: 'Allow', Action: actions, Resource: resources };
}

function denyStatement(actions: string[], resources: string[]): PolicyStatement {
  return { Effect: 'Deny', Action: actions, Resource: resources };
}

// =============================================================================
// Exercise 2: Permission Evaluator
// =============================================================================

function matchesPattern(value: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p === '*') return true;
    if (p === value) return true;
    if (p.endsWith('*') && value.startsWith(p.slice(0, -1))) return true;
    return false;
  });
}

function evaluatePermission(
  statements: PolicyStatement[],
  action: string,
  resource: string
): 'Allow' | 'Deny' {
  // Check explicit deny first
  for (const stmt of statements) {
    if (stmt.Effect === 'Deny' && matchesPattern(action, stmt.Action) && matchesPattern(resource, stmt.Resource)) {
      return 'Deny';
    }
  }
  // Check for explicit allow
  for (const stmt of statements) {
    if (stmt.Effect === 'Allow' && matchesPattern(action, stmt.Action) && matchesPattern(resource, stmt.Resource)) {
      return 'Allow';
    }
  }
  // Implicit deny
  return 'Deny';
}

// =============================================================================
// Exercise 3: Role Trust Policy Validator
// =============================================================================

interface TrustPolicy {
  Principal: { Service?: string; AWS?: string };
  Effect: 'Allow';
  Action: 'sts:AssumeRole';
}

function isTrustedService(policy: TrustPolicy, service: string): boolean {
  return policy.Principal.Service === service;
}

function isTrustedAccount(policy: TrustPolicy, accountId: string): boolean {
  return policy.Principal.AWS?.includes(accountId) ?? false;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — buildPolicy creates a valid document', () => {
  const stmt = allowStatement(['s3:GetObject'], ['arn:aws:s3:::my-bucket/*']);
  const policy = buildPolicy(stmt);
  assertEqual(policy.Version, '2012-10-17');
  assertEqual(policy.Statement.length, 1);
  assertEqual(policy.Statement[0].Effect, 'Allow');
});

test('Ex1 — allowStatement and denyStatement', () => {
  const allow = allowStatement(['s3:*'], ['*']);
  assertEqual(allow.Effect, 'Allow');
  assertDeepEqual(allow.Action, ['s3:*']);
  const deny = denyStatement(['s3:DeleteBucket'], ['*']);
  assertEqual(deny.Effect, 'Deny');
});

test('Ex1 — buildPolicy with multiple statements', () => {
  const policy = buildPolicy(
    allowStatement(['s3:GetObject'], ['*']),
    denyStatement(['s3:DeleteBucket'], ['*'])
  );
  assertEqual(policy.Statement.length, 2);
});

test('Ex2 — evaluatePermission allows matching action', () => {
  const stmts = [allowStatement(['s3:GetObject'], ['arn:aws:s3:::my-bucket/*'])];
  assertEqual(evaluatePermission(stmts, 's3:GetObject', 'arn:aws:s3:::my-bucket/*'), 'Allow');
});

test('Ex2 — evaluatePermission implicit deny', () => {
  const stmts = [allowStatement(['s3:GetObject'], ['arn:aws:s3:::my-bucket/*'])];
  assertEqual(evaluatePermission(stmts, 's3:PutObject', 'arn:aws:s3:::my-bucket/*'), 'Deny');
});

test('Ex2 — evaluatePermission explicit deny wins over allow', () => {
  const stmts = [
    allowStatement(['s3:*'], ['*']),
    denyStatement(['s3:DeleteBucket'], ['*']),
  ];
  assertEqual(evaluatePermission(stmts, 's3:DeleteBucket', 'arn:aws:s3:::prod'), 'Deny');
  assertEqual(evaluatePermission(stmts, 's3:GetObject', 'arn:aws:s3:::prod'), 'Allow');
});

test('Ex2 — evaluatePermission wildcard action and resource', () => {
  const stmts = [allowStatement(['*'], ['*'])];
  assertEqual(evaluatePermission(stmts, 'ec2:RunInstances', 'arn:aws:ec2:us-east-1:*'), 'Allow');
});

test('Ex3 — isTrustedService checks service principal', () => {
  const policy: TrustPolicy = {
    Principal: { Service: 'lambda.amazonaws.com' },
    Effect: 'Allow',
    Action: 'sts:AssumeRole',
  };
  assert(isTrustedService(policy, 'lambda.amazonaws.com'), 'Lambda should be trusted');
  assert(!isTrustedService(policy, 'ec2.amazonaws.com'), 'EC2 should not be trusted');
});

test('Ex3 — isTrustedAccount checks account principal', () => {
  const policy: TrustPolicy = {
    Principal: { AWS: 'arn:aws:iam::111122223333:root' },
    Effect: 'Allow',
    Action: 'sts:AssumeRole',
  };
  assert(isTrustedAccount(policy, '111122223333'), 'Account should be trusted');
  assert(!isTrustedAccount(policy, '999988887777'), 'Other account should not be trusted');
});

summary();
