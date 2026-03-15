// =============================================================================
// Lab 11 — ECS : Task definition, port mapping, scaling policy (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 11 — ECS Containers');

// =============================================================================
// Exercice 1 : Task definition builder
// =============================================================================

interface ContainerDef {
  name: string;
  image: string;
  cpu: number;
  memory: number;
  essential: boolean;
  portMappings?: { containerPort: number; hostPort: number; protocol: string }[];
}

interface TaskDefinition {
  family: string;
  totalCpu: number;
  totalMemory: number;
  containers: ContainerDef[];
}

function buildTaskDefinition(family: string, containers: ContainerDef[]): TaskDefinition {
  return {
    family,
    totalCpu: containers.reduce((sum, c) => sum + c.cpu, 0),
    totalMemory: containers.reduce((sum, c) => sum + c.memory, 0),
    containers,
  };
}

// =============================================================================
// Exercice 2 : Container port mapper
// =============================================================================

interface PortMapping {
  service: string;
  containerPort: number;
  hostPort: number;
}

function extractPortMappings(tasks: TaskDefinition[]): PortMapping[] {
  const result: PortMapping[] = [];
  for (const task of tasks) {
    for (const container of task.containers) {
      for (const pm of container.portMappings || []) {
        result.push({
          service: task.family,
          containerPort: pm.containerPort,
          hostPort: pm.hostPort,
        });
      }
    }
  }
  return result;
}

// =============================================================================
// Exercice 3 : Service scaling policy calculator
// =============================================================================

interface ScalingPolicy {
  desiredCount: number;
  minCount: number;
  maxCount: number;
  scaleOutThreshold: number;
  scaleInThreshold: number;
}

function calculateDesiredCount(
  currentCount: number,
  cpuPercent: number,
  policy: ScalingPolicy
): number {
  if (cpuPercent > policy.scaleOutThreshold) {
    return Math.min(currentCount + 1, policy.maxCount);
  }
  if (cpuPercent < policy.scaleInThreshold) {
    return Math.max(currentCount - 1, policy.minCount);
  }
  return currentCount;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — buildTaskDefinition calcule les totaux', () => {
  const td = buildTaskDefinition('web-app', [
    { name: 'app', image: 'nginx:latest', cpu: 256, memory: 512, essential: true },
    { name: 'sidecar', image: 'envoy:v1', cpu: 128, memory: 256, essential: false },
  ]);
  assertEqual(td.family, 'web-app');
  assertEqual(td.totalCpu, 384);
  assertEqual(td.totalMemory, 768);
  assertEqual(td.containers.length, 2);
});

test('Ex1 — buildTaskDefinition avec un seul conteneur', () => {
  const td = buildTaskDefinition('worker', [
    { name: 'worker', image: 'worker:1.0', cpu: 512, memory: 1024, essential: true },
  ]);
  assertEqual(td.totalCpu, 512);
  assertEqual(td.totalMemory, 1024);
});

test('Ex2 — extractPortMappings extrait les ports', () => {
  const tasks: TaskDefinition[] = [
    buildTaskDefinition('api', [
      {
        name: 'api', image: 'api:1', cpu: 256, memory: 512, essential: true,
        portMappings: [{ containerPort: 3000, hostPort: 80, protocol: 'tcp' }],
      },
    ]),
    buildTaskDefinition('web', [
      {
        name: 'web', image: 'web:1', cpu: 256, memory: 512, essential: true,
        portMappings: [
          { containerPort: 8080, hostPort: 443, protocol: 'tcp' },
          { containerPort: 8081, hostPort: 8081, protocol: 'tcp' },
        ],
      },
    ]),
  ];
  const mappings = extractPortMappings(tasks);
  assertEqual(mappings.length, 3);
  assertEqual(mappings[0].service, 'api');
  assertEqual(mappings[0].containerPort, 3000);
});

test('Ex3 — scaling out quand CPU eleve', () => {
  const policy: ScalingPolicy = {
    desiredCount: 2, minCount: 1, maxCount: 10,
    scaleOutThreshold: 70, scaleInThreshold: 30,
  };
  assertEqual(calculateDesiredCount(2, 85, policy), 3);
});

test('Ex3 — scaling in quand CPU bas', () => {
  const policy: ScalingPolicy = {
    desiredCount: 5, minCount: 1, maxCount: 10,
    scaleOutThreshold: 70, scaleInThreshold: 30,
  };
  assertEqual(calculateDesiredCount(5, 15, policy), 4);
});

test('Ex3 — pas de scaling quand CPU normal', () => {
  const policy: ScalingPolicy = {
    desiredCount: 3, minCount: 1, maxCount: 10,
    scaleOutThreshold: 70, scaleInThreshold: 30,
  };
  assertEqual(calculateDesiredCount(3, 50, policy), 3);
});

test('Ex3 — ne descend pas sous minCount', () => {
  const policy: ScalingPolicy = {
    desiredCount: 1, minCount: 1, maxCount: 10,
    scaleOutThreshold: 70, scaleInThreshold: 30,
  };
  assertEqual(calculateDesiredCount(1, 10, policy), 1);
});

test('Ex3 — ne depasse pas maxCount', () => {
  const policy: ScalingPolicy = {
    desiredCount: 10, minCount: 1, maxCount: 10,
    scaleOutThreshold: 70, scaleInThreshold: 30,
  };
  assertEqual(calculateDesiredCount(10, 95, policy), 10);
});

summary();
