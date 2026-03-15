// =============================================================================
// Lab 10 — CDK : Construct tree, CloudFormation template, stack dependencies
// =============================================================================
// Objectifs :
//   - Construire un arbre de constructs CDK (simplifie)
//   - Generer un template CloudFormation basique
//   - Resoudre les dependances entre stacks
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 10 — CDK Constructs');

// =============================================================================
// Exercice 1 : Construct tree builder
// Modelisez un arbre de constructs CDK. Chaque noeud a un id et des enfants.
// =============================================================================

interface Construct {
  id: string;
  type: string;
  children: Construct[];
}

// TODO: Implementez cette fonction
// Creez un construct racine (type 'Stack') et ajoutez-y les ressources fournies
// Chaque ressource est { id, type } et devient un enfant du stack
function buildConstructTree(stackId: string, resources: { id: string; type: string }[]): Construct {
  // TODO: Creez le noeud racine et ajoutez les enfants
  return { id: '', type: '', children: [] };
}

// TODO: Implementez cette fonction
// Retournez tous les ids de l'arbre en parcours en profondeur (DFS pre-order)
function flattenConstructIds(node: Construct): string[] {
  // TODO: Parcours recursif
  return [];
}

// =============================================================================
// Exercice 2 : CloudFormation template generator
// Generez un template CloudFormation simplifie a partir de ressources.
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

// TODO: Implementez cette fonction
// Generez un template avec AWSTemplateFormatVersion '2010-09-09'
// Chaque ressource est indexee par son logicalId dans Resources
function generateTemplate(resources: CfnResource[]): CfnTemplate {
  // TODO: Construisez le template
  return { AWSTemplateFormatVersion: '', Resources: {} };
}

// =============================================================================
// Exercice 3 : Stack dependency resolver
// Resolvez l'ordre de deploiement des stacks selon leurs dependances.
// =============================================================================

interface StackDef {
  name: string;
  dependsOn: string[];
}

// TODO: Implementez cette fonction (tri topologique)
// Retournez les noms des stacks dans l'ordre de deploiement
// Lancez une erreur si une dependance circulaire est detectee
function resolveDeployOrder(stacks: StackDef[]): string[] {
  // TODO: Tri topologique (algorithme de Kahn ou DFS)
  return [];
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
