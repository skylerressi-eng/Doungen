import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionPlan, terminalAssignments } from '../src/engine/plans.js';
import { CLASS_IDS } from '../src/data/classes.js';
import { FLOOR_IDS } from '../src/data/floors.js';

const PARTY = [
  { id: 'b', class: 'berserk' }, { id: 'a', class: 'archer' }, { id: 'm', class: 'mage' }, { id: 't', class: 'tank' }, { id: 'h', class: 'healer' },
];

test('every class has a distinct plan with all sections on every floor', () => {
  for (const floor of FLOOR_IDS) {
    const plans = CLASS_IDS.map((c) => buildExecutionPlan({ classId: c, floorId: floor, party: PARTY, playerId: PARTY.find((p) => p.class === c).id }));
    const bodies = plans.map((p) => JSON.stringify(p.sections));
    assert.equal(new Set(bodies).size, CLASS_IDS.length, floor);
    for (const p of plans) {
      for (const id of ['initial', 'clearing', 'route', 'secrets', 'puzzles', 'coordination', 'boss', 'recovery']) {
        assert.ok(p.sections.find((s) => s.id === id).items.length > 0, `${floor} ${p.classId} ${id}`);
      }
    }
  }
});

test('floor context appears in plans', () => {
  const f6 = buildExecutionPlan({ classId: 'healer', floorId: 'F6' });
  const text = f6.sections.flatMap((s) => s.items.map((i) => i.text)).join('\n');
  assert.match(text, /85% of all secrets/);
  assert.match(text, /Mimic/);
  assert.match(text, /Sadan/);
});

test('party composition adjusts duties', () => {
  const noTank = PARTY.filter((p) => p.class !== 'tank');
  const plan = buildExecutionPlan({ classId: 'berserk', floorId: 'F5', party: noTank, playerId: 'b' });
  assert.ok(plan.sections.find((s) => s.id === 'boss').items.some((i) => /No Tank/.test(i.text)));
  const noHealer = PARTY.filter((p) => p.class !== 'healer');
  const tank = buildExecutionPlan({ classId: 'tank', floorId: 'F5', party: noHealer, playerId: 't' });
  assert.ok(tank.sections.find((s) => s.id === 'puzzles').items.some((i) => /primary puzzle solver/.test(i.text)));
});

test('F7 terminal assignments cover every slot and follow class devices', () => {
  const ta = terminalAssignments('F7', PARTY);
  assert.equal(ta.sections.length, 4);
  const devices = Object.fromEntries(ta.sections.map((s) => [s.device.id, s.device.playerId]));
  assert.deepEqual(devices, { simon_says: 'b', lights: 'h', arrow_align: 't', target_shoot: 'a' });
  for (const s of ta.sections) {
    for (const t of s.terminals) assert.ok(t.playerId && t.playerId !== s.device.playerId);
    for (const l of s.levers) assert.ok(l.playerId);
  }
  const over = terminalAssignments('F7', PARTY, { 's1.device': 'm' });
  assert.equal(over.sections[0].device.playerId, 'm');
  const duo = terminalAssignments('F7', [{ id: 'x', class: 'mage' }, { id: 'y', class: 'mage' }]);
  assert.ok(duo.sections.every((s) => s.device.playerId));
  assert.equal(terminalAssignments('F5', PARTY), null);
});
