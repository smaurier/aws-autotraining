// =============================================================================
// Lab 15 — Security : Envelope encryption, WAF rules, security group audit
// =============================================================================
// Objectifs :
//   - Simuler le chiffrement par enveloppe (envelope encryption)
//   - Matcher des requetes contre des regles WAF
//   - Auditer les security groups pour trouver les regles trop permissives
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

// TODO: Implementez cette fonction
// Simulez le chiffrement par enveloppe :
// 1. Generez une "data key" = `dk-${Date.now()}` (cle de donnees)
// 2. "Chiffrez" les donnees : encryptedData = btoa(data) (base64 comme simulation)
// 3. "Chiffrez" la data key avec la master key : encryptedDataKey = btoa(dataKey + ':' + masterKey)
// 4. Retournez { encryptedData, encryptedDataKey, algorithm: 'AES-256-SIM' }
function envelopeEncrypt(data: string, masterKey: string): EncryptedPayload {
  // TODO
  return { encryptedData: '', encryptedDataKey: '', algorithm: '' };
}

// TODO: Implementez cette fonction
// Dechiffrez : inversez le processus
// 1. Dechiffrez la data key : atob(encryptedDataKey) -> split(':')[0]
// 2. Verifiez que la master key correspond (split(':')[1] === masterKey)
// 3. Dechiffrez les donnees : atob(encryptedData)
// Lancez une erreur si la master key ne correspond pas.
function envelopeDecrypt(payload: EncryptedPayload, masterKey: string): string {
  // TODO
  return '';
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

// TODO: Implementez cette fonction
// Evaluez les regles WAF dans l'ordre. Retournez l'action de la premiere regle qui matche.
// Si aucune regle ne matche, retournez 'ALLOW' (comportement par defaut).
// Pour 'header', comparez headers[rule.condition.headerName] avec la valeur.
function evaluateWafRules(request: HttpRequest, rules: WafRule[]): 'ALLOW' | 'BLOCK' | 'COUNT' {
  // TODO
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

// TODO: Implementez cette fonction
// Trouvez les regles trop permissives :
// 1. cidr '0.0.0.0/0' avec port 22 (SSH ouvert au monde)
// 2. cidr '0.0.0.0/0' avec port 3389 (RDP ouvert au monde)
// 3. cidr '0.0.0.0/0' avec protocol '-1' (tout le trafic ouvert)
// 4. toPort - fromPort > 100 avec cidr '0.0.0.0/0' (plage de ports trop large)
function auditSecurityGroups(groups: SecurityGroup[]): AuditFinding[] {
  // TODO
  return [];
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
