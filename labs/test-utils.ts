export function createTestRunner(suiteName: string) {
  let passed = 0;
  let failed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      failed++;
      console.log(`  ❌ ${name}: ${e.message}`);
    }
  }

  function assert(condition: boolean, msg = 'Assertion failed') {
    if (!condition) throw new Error(msg);
  }

  function assertEqual<T>(actual: T, expected: T) {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  function assertDeepEqual<T>(actual: T, expected: T) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  function assertThrows(fn: () => void) {
    try {
      fn();
      throw new Error('Expected function to throw');
    } catch (e: any) {
      if (e.message === 'Expected function to throw') throw e;
    }
  }

  function summary() {
    console.log(`\n${suiteName}: ${passed}/${total} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  }

  console.log(`\n📋 ${suiteName}\n`);

  return { test, assert, assertEqual, assertDeepEqual, assertThrows, summary };
}
