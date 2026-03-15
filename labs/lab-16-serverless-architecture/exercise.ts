// =============================================================================
// Lab 16 — Serverless : Step Function executor, saga pattern, CQRS projector
// =============================================================================
// Objectifs :
//   - Executer une machine a etats Step Functions simplifiee
//   - Implementer le pattern saga avec transactions compensatoires
//   - Projeter des evenements CQRS dans un modele de lecture
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 16 — Serverless Architecture');

// =============================================================================
// Exercice 1 : Step Function state machine executor
// =============================================================================

type StepState =
  | { type: 'Task'; name: string; next: string; handler: (input: unknown) => unknown }
  | { type: 'Choice'; name: string; choices: { condition: (input: unknown) => boolean; next: string }[]; default: string }
  | { type: 'Succeed'; name: string };

interface StateMachine {
  startAt: string;
  states: Record<string, StepState>;
}

// TODO: Implementez cette fonction
// Executez la machine a etats a partir de startAt avec l'input donne.
// - Task : appelez handler(input), utilisez le resultat comme input pour l'etat next
// - Choice : evaluez chaque condition dans l'ordre, allez vers le next de la premiere
//            condition vraie, ou vers default si aucune ne matche
// - Succeed : retournez l'input courant
// Securite : max 50 iterations pour eviter les boucles infinies.
function executeStateMachine(machine: StateMachine, input: unknown): unknown {
  // TODO
  return null;
}

// =============================================================================
// Exercice 2 : Saga pattern (compensating transactions)
// =============================================================================

interface SagaStep {
  name: string;
  execute: () => boolean;    // retourne true si succes
  compensate: () => void;    // annule l'action
}

interface SagaResult {
  success: boolean;
  executedSteps: string[];
  compensatedSteps: string[];
}

// TODO: Implementez cette fonction
// Executez les etapes dans l'ordre. Si une etape echoue :
// 1. N'ajoutez PAS l'etape echouee a executedSteps
// 2. Compensez toutes les etapes deja executees (dans l'ordre inverse)
// 3. Retournez success: false
function executeSaga(steps: SagaStep[]): SagaResult {
  // TODO
  return { success: false, executedSteps: [], compensatedSteps: [] };
}

// =============================================================================
// Exercice 3 : CQRS event projector
// =============================================================================

interface DomainEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface OrderView {
  orderId: string;
  status: string;
  items: string[];
  total: number;
}

// TODO: Implementez cette fonction
// Projetez les evenements dans un modele de lecture (OrderView).
// Types d'evenements :
// - 'OrderCreated'  : payload { orderId } -> cree la vue avec status 'created', items [], total 0
// - 'ItemAdded'     : payload { orderId, item, price } -> ajoute l'item et incremente total
// - 'OrderConfirmed': payload { orderId } -> status = 'confirmed'
// - 'OrderCancelled': payload { orderId } -> status = 'cancelled'
// Retournez la map de toutes les vues par orderId.
function projectEvents(events: DomainEvent[]): Map<string, OrderView> {
  // TODO
  return new Map();
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — execute une machine a etats simple', () => {
  const machine: StateMachine = {
    startAt: 'Double',
    states: {
      'Double': { type: 'Task', name: 'Double', next: 'Done', handler: (n) => (n as number) * 2 },
      'Done': { type: 'Succeed', name: 'Done' },
    },
  };
  assertEqual(executeStateMachine(machine, 5), 10);
});

test('Ex1 — execute avec un Choice', () => {
  const machine: StateMachine = {
    startAt: 'Check',
    states: {
      'Check': {
        type: 'Choice', name: 'Check',
        choices: [{ condition: (n) => (n as number) > 10, next: 'Big' }],
        default: 'Small',
      },
      'Big': { type: 'Task', name: 'Big', next: 'End', handler: () => 'big' },
      'Small': { type: 'Task', name: 'Small', next: 'End', handler: () => 'small' },
      'End': { type: 'Succeed', name: 'End' },
    },
  };
  assertEqual(executeStateMachine(machine, 20), 'big');
  assertEqual(executeStateMachine(machine, 5), 'small');
});

test('Ex2 — saga reussie', () => {
  const steps: SagaStep[] = [
    { name: 'reserveStock', execute: () => true, compensate: () => {} },
    { name: 'chargePayment', execute: () => true, compensate: () => {} },
    { name: 'sendEmail', execute: () => true, compensate: () => {} },
  ];
  const result = executeSaga(steps);
  assert(result.success, 'Saga doit reussir');
  assertEqual(result.executedSteps.length, 3);
  assertEqual(result.compensatedSteps.length, 0);
});

test('Ex2 — saga avec echec compense dans l\'ordre inverse', () => {
  const compensated: string[] = [];
  const steps: SagaStep[] = [
    { name: 'reserveStock', execute: () => true, compensate: () => { compensated.push('reserveStock'); } },
    { name: 'chargePayment', execute: () => true, compensate: () => { compensated.push('chargePayment'); } },
    { name: 'sendEmail', execute: () => false, compensate: () => { compensated.push('sendEmail'); } },
  ];
  const result = executeSaga(steps);
  assert(!result.success, 'Saga doit echouer');
  assertEqual(result.executedSteps.length, 2);
  assertDeepEqual(result.compensatedSteps, ['chargePayment', 'reserveStock']);
});

test('Ex3 — projection d\'evenements', () => {
  const events: DomainEvent[] = [
    { type: 'OrderCreated', payload: { orderId: 'o1' }, timestamp: '2024-01-01T10:00:00Z' },
    { type: 'ItemAdded', payload: { orderId: 'o1', item: 'Widget', price: 25 }, timestamp: '2024-01-01T10:01:00Z' },
    { type: 'ItemAdded', payload: { orderId: 'o1', item: 'Gadget', price: 15 }, timestamp: '2024-01-01T10:02:00Z' },
    { type: 'OrderConfirmed', payload: { orderId: 'o1' }, timestamp: '2024-01-01T10:03:00Z' },
  ];
  const views = projectEvents(events);
  const order = views.get('o1')!;
  assertEqual(order.status, 'confirmed');
  assertDeepEqual(order.items, ['Widget', 'Gadget']);
  assertEqual(order.total, 40);
});

test('Ex3 — projection commande annulee', () => {
  const events: DomainEvent[] = [
    { type: 'OrderCreated', payload: { orderId: 'o2' }, timestamp: '2024-01-01T10:00:00Z' },
    { type: 'OrderCancelled', payload: { orderId: 'o2' }, timestamp: '2024-01-01T10:05:00Z' },
  ];
  const views = projectEvents(events);
  assertEqual(views.get('o2')!.status, 'cancelled');
});

summary();
