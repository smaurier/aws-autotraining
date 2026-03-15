// =============================================================================
// Lab 15 — Security : Envelope encryption, WAF rules, security group audit (SOLUTION)
// =============================================================================

import { createTestRunner } from '../test-utils.ts';
const { test, assert, assertEqual, assertDeepEqual, summary } =
  createTestRunner('Lab 15 — AWS Security');

// =============================================================================
// Exercice 1 : Envelope encryption simulator
// =============================================================================

interface EncryptedPayload {
  encryptedData: string;
  encryptedDataKey: string;
  algorithm: string;
}

function envelopeEncrypt(data: string, masterKey: string): EncryptedPayload {
  const dataKey = `dk-${Date.now()}`;
  return {
    encryptedData: btoa(data),
    encryptedDataKey: btoa(dataKey + ':' + masterKey),
    algorithm: 'AES-256-SIM',
  };
}

function envelopeDecrypt(payload: EncryptedPayload, masterKey: string): string {
  const decoded = atob(payload.encryptedDataKey);
  const parts = decoded.split(':');
  const storedMasterKey = parts.slice(1).join(':');
  if (storedMasterKey !== masterKey) {
    throw new Error('Invalid master key');
  }
  return atob(payload.encryptedData);
}

// =============================================================================
// Exercice 2 : WAF rule matcher
// =============================================================================

interface WafRule {
  id: string;
  action: 'ALLOW' | 'BLOCK' | 'COUNT';
  condition: {
    field: 'uri' | 'ip' | 'header';
    match: 'contains' | 'equals' | 'startsWith';
    value: string;
    headerName?: string;
  };
}

interface HttpRequest {
  uri: string;
  ip: string;
  headers: Record<string, string>;
}

function evaluateWafRules(request: HttpRequest, rules: WafRule[]): 'ALLOW' | 'BLOCK' | 'COUNT' {
  for (const rule of rules) {
    const { field, match, value, headerName } = rule.condition;
    let target: string;
    if (field === 'uri') target = request.uri;
    else if (field === 'ip') target = request.ip;
    else target = request.headers[headerName!] ?? '';

    let matched = false;
    if (match === 'contains') matched = target.includes(value);
    else if (match === 'equals') matched = target === value;
    else if (match === 'startsWith') matched = target.startsWith(value);

    if (matched) return rule.action;
  }
  return 'ALLOW';
}

// =============================================================================
// Exercice 3 : Security group audit
// =============================================================================

interface SecurityGroupRule {
  protocol: string;
  fromPort: number;
  toPort: number;
  cidr: string;
}

interface SecurityGroup {
  id: string;
  name: string;
  inboundRules: SecurityGroupRule[];
}

interface AuditFinding {
  groupId: string;
  groupName: string;
  issue: string;
  rule: SecurityGroupRule;
}

function auditSecurityGroups(groups: SecurityGroup[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const group of groups) {
    for (const rule of group.inboundRules) {
      if (rule.cidr !== '0.0.0.0/0') continue;
      const base = { groupId: group.id, groupName: group.name, rule };
      if (rule.protocol === '-1') {
        findings.push({ ...base, issue: 'All traffic open to the world' });
      } else if (rule.fromPort <= 22 && rule.toPort >= 22) {
        findings.push({ ...base, issue: 'SSH (port 22) open to the world' });
      } else if (rule.fromPort <= 3389 && rule.toPort >= 3389) {
        findings.push({ ...base, issue: 'RDP (port 3389) open to the world' });
      } else if (rule.toPort - rule.fromPort > 100) {
        findings.push({ ...base, issue: 'Wide port range open to the world' });
      }
    }
  }
  return findings;
}

// =============================================================================
// Tests
// =============================================================================

test('Ex1 — envelope encrypt puis decrypt', () => {
  const payload = envelopeEncrypt('secret data', 'master-key-123');
  assertEqual(payload.algorithm, 'AES-256-SIM');
  assert(payload.encryptedData.length > 0, 'encryptedData ne doit pas etre vide');
  const decrypted = envelopeDecrypt(payload, 'master-key-123');
  assertEqual(decrypted, 'secret data');
});

test('Ex1 — decrypt avec mauvaise master key echoue', () => {
  const payload = envelopeEncrypt('secret', 'correct-key');
  let threw = false;
  try { envelopeDecrypt(payload, 'wrong-key'); } catch { threw = true; }
  assert(threw, 'Doit lancer une erreur avec la mauvaise cle');
});

test('Ex2 — WAF bloque une URI suspecte', () => {
  const rules: WafRule[] = [
    { id: 'r1', action: 'BLOCK', condition: { field: 'uri', match: 'contains', value: '/admin' } },
  ];
  assertEqual(evaluateWafRules({ uri: '/admin/users', ip: '1.2.3.4', headers: {} }, rules), 'BLOCK');
  assertEqual(evaluateWafRules({ uri: '/api/users', ip: '1.2.3.4', headers: {} }, rules), 'ALLOW');
});

test('Ex2 — WAF matche par IP', () => {
  const rules: WafRule[] = [
    { id: 'r1', action: 'BLOCK', condition: { field: 'ip', match: 'equals', value: '10.0.0.1' } },
  ];
  assertEqual(evaluateWafRules({ uri: '/', ip: '10.0.0.1', headers: {} }, rules), 'BLOCK');
  assertEqual(evaluateWafRules({ uri: '/', ip: '10.0.0.2', headers: {} }, rules), 'ALLOW');
});

test('Ex2 — WAF matche par header', () => {
  const rules: WafRule[] = [
    {
      id: 'r1', action: 'BLOCK',
      condition: { field: 'header', match: 'contains', value: 'BadBot', headerName: 'User-Agent' },
    },
  ];
  assertEqual(evaluateWafRules(
    { uri: '/', ip: '1.1.1.1', headers: { 'User-Agent': 'BadBot/1.0' } }, rules
  ), 'BLOCK');
});

test('Ex3 — audit detecte SSH ouvert', () => {
  const groups: SecurityGroup[] = [{
    id: 'sg-1', name: 'web-sg',
    inboundRules: [
      { protocol: 'tcp', fromPort: 22, toPort: 22, cidr: '0.0.0.0/0' },
      { protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '0.0.0.0/0' },
    ],
  }];
  const findings = auditSecurityGroups(groups);
  assertEqual(findings.length, 1);
  assert(findings[0].issue.includes('SSH'), 'Doit mentionner SSH');
});

test('Ex3 — audit detecte tout le trafic ouvert', () => {
  const groups: SecurityGroup[] = [{
    id: 'sg-2', name: 'open-sg',
    inboundRules: [
      { protocol: '-1', fromPort: 0, toPort: 65535, cidr: '0.0.0.0/0' },
    ],
  }];
  const findings = auditSecurityGroups(groups);
  assert(findings.length >= 1, 'Doit trouver au moins un probleme');
});

test('Ex3 — audit ne remonte rien pour un SG propre', () => {
  const groups: SecurityGroup[] = [{
    id: 'sg-3', name: 'clean-sg',
    inboundRules: [
      { protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '10.0.0.0/8' },
    ],
  }];
  const findings = auditSecurityGroups(groups);
  assertEqual(findings.length, 0);
});

summary();
