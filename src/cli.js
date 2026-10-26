#!/usr/bin/env node
// Command-line entry points:
//   node src/cli.js scenarios [--verbose]   run the documented scenarios
//   node src/cli.js plan <class> <floor>     print a class execution plan
//   node src/cli.js serve                    start the dashboard server

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarios, runScenario } from './scenarios.js';
import { buildExecutionPlan } from './engine/plans.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'scenarios') {
  const verbose = args.includes('--verbose');
  let failed = 0;
  for (const sc of loadScenarios(path.join(ROOT, 'scenarios'))) {
    const r = runScenario(sc);
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${sc.file}  ${r.name}`);
    for (const step of r.results) {
      if (verbose || step.failures.length) {
        console.log(`   step ${step.index} @${step.elapsed}s ${step.note}`);
        console.log(`     projected ${step.summary.projected} · finish ${step.summary.finish}s · warnings [${step.summary.warnings.join(', ')}]`);
        for (const [pid, a] of Object.entries(step.summary.actions)) console.log(`     ${pid} ${a}`);
        if (verbose) for (const [pid, rt] of Object.entries(step.summary.routes)) console.log(`       route ${pid}: ${rt.join(' > ') || '-'}`);
        for (const f of step.failures) console.log(`     ✗ ${f}`);
      }
    }
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
} else if (cmd === 'plan') {
  const [cls, floor] = args;
  const plan = buildExecutionPlan({ classId: cls ?? 'mage', floorId: floor ?? 'F7' });
  console.log(`${plan.className} - ${plan.role} - ${plan.floorId}`);
  for (const s of plan.sections) {
    if (!s.items.length) continue;
    console.log(`\n${s.label}`);
    for (const i of s.items) console.log(`  - ${i.text}${i.confidence !== 'high' ? ` [${i.confidence}]` : ''}`);
  }
} else if (cmd === 'serve') {
  const { SessionManager, FileStore } = await import('./session.js');
  const { createServer } = await import('./server.js');
  const port = Number(process.env.PORT ?? 4545);
  const host = process.env.HOST ?? '127.0.0.1';
  const dir = process.env.DATA_DIR ?? path.join(ROOT, 'data', 'sessions');
  createServer({ manager: new SessionManager(new FileStore(dir)), log: console.log }).listen(port, host, () => console.log(`Dungeon Co-Pilot running at http://${host}:${port}`));
} else {
  console.log('Usage: node src/cli.js <scenarios [--verbose] | plan <class> <floor> | serve>');
  process.exit(cmd ? 1 : 0);
}
