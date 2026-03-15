// =============================================================================
// Lab 01 — IAM (Identity and Access Management)
// =============================================================================
// Objectives:
//   - Build IAM policy documents programmatically
//   - Evaluate allow/deny logic for permissions
//   - Validate role trust policies
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

// TODO: Build a policy document with the given statements.
// Version should always be "2012-10-17".
function buildPolicy(...statements: PolicyStatement[]): PolicyDocument {
  // TODO: Return a PolicyDocument with Version and Statement array
  return {} as PolicyDocument;
}

// TODO: Create a single Allow statement for the given actions and resources.
function allowStatement(actions: string[], resources: string[]): PolicyStatement {
  // TODO: Return a PolicyStatement with Effect "Allow"
  return {} as PolicyStatement;
}

// TODO: Create a single Deny statement for the given actions and resources.
function denyStatement(actions: string[], resources: string[]): PolicyStatement {
  // TODO: Return a PolicyStatement with Effect "Deny"
  return {} as PolicyStatement;
}

// =============================================================================
// Exercise 2: Permission Evaluator
// AWS rule: explicit Deny always wins. Otherwise, must have explicit Allow.
// =============================================================================

// TODO: Given a list of policy statements, an action, and a resource,
// determine if the request is allowed.
// Rules: 1) Any explicit Deny matching action+resource -> "Deny"
//        2) Any explicit Allow matching action+resource -> "Allow"
//        3) Otherwise -> "Deny" (implicit deny)
// Action matching: exact match or wildcard "*"
// Resource matching: exact match or wildcard "*"
function evaluatePermission(
  statements: PolicyStatement[],
  action: string,
  resource: string
): 'Allow' | 'Deny' {
  // TODO: Check deny statements first, then allow statements
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

// TODO: Check if a given AWS service (e.g. "lambda.amazonaws.com")
// is trusted by the trust policy.
function isTrustedService(policy: TrustPolicy, service: string): boolean {
  // TODO: Compare policy.Principal.Service with the given service
  return false;
}

// TODO: Check if a given AWS account ID is trusted by the trust policy.
function isTrustedAccount(policy: TrustPolicy, accountId: string): boolean {
  // TODO: Check if policy.Principal.AWS contains the accountId
  // Principal.AWS format: "arn:aws:iam::ACCOUNT_ID:root"
  return false;
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
