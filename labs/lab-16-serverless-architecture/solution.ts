// =============================================================================
// Lab 16 — Serverless : Step Function executor, saga pattern, CQRS projector (SOLUTION)
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

function executeStateMachine(machine: StateMachine, input: unknown): unknown {
  let current = machine.startAt;
  let data = input;
  let iterations = 0;
  while (iterations++ < 50) {
    const state = machine.states[current];
    if (state.type === 'Succeed') return data;
    if (state.type === 'Task') {
      data = state.handler(data);
      current = state.next;
    } else if (state.type === 'Choice') {
      let nextState = state.default;
      for (const choice of state.choices) {
        if (choice.condition(data)) {
          nextState = choice.next;
          break;
        }
      }
      current = nextState;
    }
  }
  throw new Error('Max iterations exceeded');
}

// =============================================================================
// Exercice 2 : Saga pattern
// =============================================================================

interface SagaStep {
  name: string;
  execute: () => boolean;
  compensate: () => void;
}

interface SagaResult {
  success: boolean;
  executedSteps: string[];
  compensatedSteps: string[];
}

function executeSaga(steps: SagaStep[]): SagaResult {
  const executedSteps: string[] = [];
  const compensatedSteps: string[] = [];
  for (const step of steps) {
    if (step.execute()) {
      executedSteps.push(step.name);
    } else {
      // Compensate in reverse order
      for (let i = executedSteps.length - 1; i >= 0; i--) {
        const executed = steps.find((s) => s.name === executedSteps[i])!;
        executed.compensate();
        compensatedSteps.push(executed.name);
      }
      return { success: false, executedSteps, compensatedSteps };
    }
  }
  return { success: true, executedSteps, compensatedSteps };
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

function projectEvents(events: DomainEvent[]): Map<string, OrderView> {
  const views = new Map<string, OrderView>();
  for (const event of events) {
    const orderId = event.payload.orderId as string;
    switch (event.type) {
      case 'OrderCreated':
        views.set(orderId, { orderId, status: 'created', items: [], total: 0 });
        break;
      case 'ItemAdded': {
        const view = views.get(orderId)!;
        view.items.push(event.payload.item as string);
        view.total += event.payload.price as number;
        break;
      }
      case 'OrderConfirmed':
        views.get(orderId)!.status = 'confirmed';
        break;
      case 'OrderCancelled':
        views.get(orderId)!.status = 'cancelled';
        break;
    }
  }
  return views;
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
