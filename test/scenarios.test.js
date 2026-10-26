import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarios, runScenario } from '../src/scenarios.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scenarios');

for (const sc of loadScenarios(dir)) {
  test(`scenario ${sc.file}: ${sc.name}`, () => {
    const r = runScenario(sc);
    const failures = r.results.flatMap((s) => s.failures.map((f) => `step ${s.index} (${s.note}): ${f}`));
    assert.deepEqual(failures, []);
  });
}
