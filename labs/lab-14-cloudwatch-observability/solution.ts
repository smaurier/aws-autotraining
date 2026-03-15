// =============================================================================
// Lab 13 — CloudWatch : Metric aggregation, alarm state machine, log query (SOLUTION)
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

function aggregateMetrics(datapoints: MetricDatapoint[]): AggregatedMetric {
  const values = datapoints.map((d) => d.value);
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = values.reduce((s, v) => s + v, 0);
  const p99Index = Math.ceil(0.99 * n) - 1;
  return {
    avg: Math.round((sum / n) * 100) / 100,
    max: Math.max(...values),
    min: Math.min(...values),
    p99: sorted[Math.max(0, p99Index)],
    count: n,
  };
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

function evaluateAlarmState(values: number[], config: AlarmConfig): AlarmState {
  if (values.length < config.evaluationPeriods) return 'INSUFFICIENT_DATA';
  const recent = values.slice(-config.evaluationPeriods);
  const breaching = recent.every((v) => {
    if (config.comparisonOperator === 'GreaterThanThreshold') return v > config.threshold;
    return v < config.threshold;
  });
  return breaching ? 'ALARM' : 'OK';
}

// =============================================================================
// Exercice 3 : Log query parser
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

function queryLogs(
  logs: LogEntry[],
  filter: { level?: string; contains?: string; since?: string }
): QueryResult {
  let result = [...logs];
  if (filter.level) {
    result = result.filter((l) => l.level === filter.level);
  }
  if (filter.contains) {
    result = result.filter((l) => l.message.includes(filter.contains!));
  }
  if (filter.since) {
    const sinceDate = new Date(filter.since).getTime();
    result = result.filter((l) => new Date(l.timestamp).getTime() > sinceDate);
  }
  return { matchedLogs: result, count: result.length };
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
