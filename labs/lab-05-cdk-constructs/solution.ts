// =============================================================================
// Lab 10 — CDK : Construct tree, CloudFormation template, stack dependencies (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 10 — CDK Constructs');

// =============================================================================
// Exercice 1 : Construct tree builder
// =============================================================================

interface Construct {
  id: string;
  type: string;
  children: Construct[];
}

function buildConstructTree(stackId: string, resources: { id: string; type: string }[]): Construct {
  return {
    id: stackId,
    type: 'Stack',
    children: resources.map((r) => ({ id: r.id, type: r.type, children: [] })),
  };
}

function flattenConstructIds(node: Construct): string[] {
  const result: string[] = [node.id];
  for (const child of node.children) {
    result.push(...flattenConstructIds(child));
  }
  return result;
}

// =============================================================================
// Exercice 2 : CloudFormation template generator
// =============================================================================

interface CfnResource {
  logicalId: string;
  type: string;
  properties: Record<string, unknown>;
}

interface CfnTemplate {
  AWSTemplateFormatVersion: string;
  Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
}

function generateTemplate(resources: CfnResource[]): CfnTemplate {
  const tpl: CfnTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Resources: {},
  };
  for (const r of resources) {
    tpl.Resources[r.logicalId] = { Type: r.type, Properties: r.properties };
  }
  return tpl;
}

// =============================================================================
// Exercice 3 : Stack dependency resolver (tri topologique de Kahn)
// =============================================================================

interface StackDef {
  name: string;
  dependsOn: string[];
}

function resolveDeployOrder(stacks: StackDef[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of stacks) {
    inDegree.set(s.name, s.dependsOn.length);
    adj.set(s.name, []);
  }
  for (const s of stacks) {
    for (const dep of s.dependsOn) {
      adj.get(dep)!.push(s.name);
    }
  }
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of adj.get(current) || []) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }
  if (order.length !== stacks.length) {
    throw new Error('Circular dependency detected');
  }
  return order;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — buildConstructTree cree un arbre', () => {
  const tree = buildConstructTree('MyStack', [
    { id: 'Bucket', type: 'AWS::S3::Bucket' },
    { id: 'Lambda', type: 'AWS::Lambda::Function' },
  ]);
  assertEqual(tree.id, 'MyStack');
  assertEqual(tree.type, 'Stack');
  assertEqual(tree.children.length, 2);
  assertEqual(tree.children[0].id, 'Bucket');
});

test('Ex1 — flattenConstructIds parcourt en profondeur', () => {
  const tree = buildConstructTree('Root', [
    { id: 'A', type: 'TypeA' },
    { id: 'B', type: 'TypeB' },
  ]);
  const ids = flattenConstructIds(tree);
  assertDeepEqual(ids, ['Root', 'A', 'B']);
});

test('Ex2 — generateTemplate produit un template valide', () => {
  const tpl = generateTemplate([
    { logicalId: 'MyBucket', type: 'AWS::S3::Bucket', properties: { BucketName: 'my-bucket' } },
    { logicalId: 'MyFunc', type: 'AWS::Lambda::Function', properties: { Runtime: 'nodejs18.x' } },
  ]);
  assertEqual(tpl.AWSTemplateFormatVersion, '2010-09-09');
  assertEqual(tpl.Resources['MyBucket'].Type, 'AWS::S3::Bucket');
  assertEqual(tpl.Resources['MyFunc'].Properties.Runtime, 'nodejs18.x');
});

test('Ex2 — generateTemplate avec zero ressources', () => {
  const tpl = generateTemplate([]);
  assertEqual(Object.keys(tpl.Resources).length, 0);
});

test('Ex3 — resolveDeployOrder tri topologique simple', () => {
  const stacks: StackDef[] = [
    { name: 'App', dependsOn: ['Database'] },
    { name: 'Database', dependsOn: ['Network'] },
    { name: 'Network', dependsOn: [] },
  ];
  const order = resolveDeployOrder(stacks);
  assertDeepEqual(order, ['Network', 'Database', 'App']);
});

test('Ex3 — resolveDeployOrder sans dependances', () => {
  const stacks: StackDef[] = [
    { name: 'A', dependsOn: [] },
    { name: 'B', dependsOn: [] },
  ];
  const order = resolveDeployOrder(stacks);
  assertEqual(order.length, 2);
  assert(order.includes('A'), 'A doit etre present');
  assert(order.includes('B'), 'B doit etre present');
});

test('Ex3 — resolveDeployOrder detecte les cycles', () => {
  const stacks: StackDef[] = [
    { name: 'A', dependsOn: ['B'] },
    { name: 'B', dependsOn: ['A'] },
  ];
  let threw = false;
  try { resolveDeployOrder(stacks); } catch { threw = true; }
  assert(threw, 'Doit lancer une erreur pour dependance circulaire');
});

summary();
