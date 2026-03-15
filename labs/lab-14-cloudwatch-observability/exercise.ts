// =============================================================================
// Lab 13 — CloudWatch : Metric aggregation, alarm state machine, log query
// =============================================================================
// Objectifs :
//   - Agreger des metriques (avg, p99, max)
//   - Modeliser une machine a etats d'alarme CloudWatch
//   - Parser des requetes CloudWatch Logs Insights
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 13 — CloudWatch Observability');

// =============================================================================
// Exercice 1 : Metric aggregator
// =============================================================================

interface MetricDatapoint {
  timestamp: number;
  value: number;
}

interface AggregatedMetric {
  avg: number;
  max: number;
  min: number;
  p99: number;
  count: number;
}

// TODO: Implementez cette fonction
// Calculez avg, max, min, p99 et count pour un tableau de datapoints.
// p99 = valeur au 99e percentile (triez les valeurs, prenez l'index Math.ceil(0.99 * n) - 1)
// Arrondissez avg a 2 decimales.
function aggregateMetrics(datapoints: MetricDatapoint[]): AggregatedMetric {
  // TODO
  return { avg: 0, max: 0, min: 0, p99: 0, count: 0 };
}

// =============================================================================
// Exercice 2 : Alarm state machine
// =============================================================================

type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';

interface AlarmConfig {
  threshold: number;
  evaluationPeriods: number;
  comparisonOperator: 'GreaterThanThreshold' | 'LessThanThreshold';
}

// TODO: Implementez cette fonction
// Evaluez l'etat d'une alarme CloudWatch :
// - Si values.length < evaluationPeriods -> 'INSUFFICIENT_DATA'
// - Prenez les N dernieres valeurs (N = evaluationPeriods)
// - Si TOUTES ces valeurs depassent le seuil (selon l'operateur) -> 'ALARM'
// - Sinon -> 'OK'
function evaluateAlarmState(values: number[], config: AlarmConfig): AlarmState {
  // TODO
  return 'INSUFFICIENT_DATA';
}

// =============================================================================
// Exercice 3 : Log query parser (CloudWatch Logs Insights simplifie)
// =============================================================================

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

interface QueryResult {
  matchedLogs: LogEntry[];
  count: number;
}

// TODO: Implementez cette fonction
// Filtrez les logs selon les criteres :
// - level : si specifie, ne garder que les logs de ce niveau
// - contains : si specifie, ne garder que les logs dont le message contient ce texte
// - since : si specifie (timestamp ISO), ne garder que les logs apres cette date
function queryLogs(
  logs: LogEntry[],
  filter: { level?: string; contains?: string; since?: string }
): QueryResult {
  // TODO
  return { matchedLogs: [], count: 0 };
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — aggregateMetrics calcule correctement', () => {
  const points: MetricDatapoint[] = [
    { timestamp: 1, value: 10 },
    { timestamp: 2, value: 20 },
    { timestamp: 3, value: 30 },
    { timestamp: 4, value: 40 },
    { timestamp: 5, value: 50 },
  ];
  const result = aggregateMetrics(points);
  assertEqual(result.avg, 30);
  assertEqual(result.max, 50);
  assertEqual(result.min, 10);
  assertEqual(result.count, 5);
  assertEqual(result.p99, 50);
});

test('Ex1 — aggregateMetrics avec un seul point', () => {
  const result = aggregateMetrics([{ timestamp: 1, value: 42 }]);
  assertEqual(result.avg, 42);
  assertEqual(result.p99, 42);
  assertEqual(result.count, 1);
});

test('Ex2 — alarm passe en ALARM', () => {
  const config: AlarmConfig = {
    threshold: 80, evaluationPeriods: 3,
    comparisonOperator: 'GreaterThanThreshold',
  };
  assertEqual(evaluateAlarmState([90, 85, 95], config), 'ALARM');
});

test('Ex2 — alarm reste OK si pas toutes les periodes', () => {
  const config: AlarmConfig = {
    threshold: 80, evaluationPeriods: 3,
    comparisonOperator: 'GreaterThanThreshold',
  };
  assertEqual(evaluateAlarmState([90, 70, 95], config), 'OK');
});

test('Ex2 — INSUFFICIENT_DATA si pas assez de valeurs', () => {
  const config: AlarmConfig = {
    threshold: 80, evaluationPeriods: 3,
    comparisonOperator: 'GreaterThanThreshold',
  };
  assertEqual(evaluateAlarmState([90], config), 'INSUFFICIENT_DATA');
});

test('Ex2 — LessThanThreshold fonctionne', () => {
  const config: AlarmConfig = {
    threshold: 20, evaluationPeriods: 2,
    comparisonOperator: 'LessThanThreshold',
  };
  assertEqual(evaluateAlarmState([10, 15], config), 'ALARM');
  assertEqual(evaluateAlarmState([10, 25], config), 'OK');
});

test('Ex3 — queryLogs filtre par niveau', () => {
  const logs: LogEntry[] = [
    { timestamp: '2024-01-01T10:00:00Z', level: 'ERROR', message: 'DB down' },
    { timestamp: '2024-01-01T10:01:00Z', level: 'INFO', message: 'Request ok' },
    { timestamp: '2024-01-01T10:02:00Z', level: 'ERROR', message: 'Timeout' },
  ];
  const result = queryLogs(logs, { level: 'ERROR' });
  assertEqual(result.count, 2);
});

test('Ex3 — queryLogs filtre par contenu', () => {
  const logs: LogEntry[] = [
    { timestamp: '2024-01-01T10:00:00Z', level: 'ERROR', message: 'DB connection failed' },
    { timestamp: '2024-01-01T10:01:00Z', level: 'INFO', message: 'DB backup done' },
    { timestamp: '2024-01-01T10:02:00Z', level: 'WARN', message: 'High CPU' },
  ];
  const result = queryLogs(logs, { contains: 'DB' });
  assertEqual(result.count, 2);
});

test('Ex3 — queryLogs filtre par date', () => {
  const logs: LogEntry[] = [
    { timestamp: '2024-01-01T08:00:00Z', level: 'INFO', message: 'Old' },
    { timestamp: '2024-01-01T12:00:00Z', level: 'INFO', message: 'New' },
  ];
  const result = queryLogs(logs, { since: '2024-01-01T10:00:00Z' });
  assertEqual(result.count, 1);
  assertEqual(result.matchedLogs[0].message, 'New');
});

summary();
