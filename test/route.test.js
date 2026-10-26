import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyEvent } from '../src/engine/state.js';
import { computePlan, buildGraph } from '../src/engine/route.js';
import { layoutToRooms } from '../src/scenarios.js';

const PARTY = [
  { id: 'm', class: 'mage', isSelf: true },
  { id: 'a', class: 'archer' },
  { id: 'b', class: 'berserk' },
  { id: 't', class: 'tank' },
  { id: 'h', class: 'healer' },
];
const LAYOUT = [
  'B1 B1 R5 R5 BL R6',
  'B1 B1 P2 R7 R7 R6',
  'R2 R3 R3 R3 MB R8',
  'R2 P1 FA R4 R4 R8',
  'R9 R9 R10 R4 T1 R11',
  'E R12 R10 R13 R13 R11',
];
const DEFS = { E: { type: 'entrance' }, BL: { type: 'blood' }, FA: { type: 'fairy' }, P1: { type: 'puzzle' }, P2: { type: 'puzzle', puzzle: 'higher_lower' }, MB: { type: 'miniboss' }, T1: { type: 'trap' } };

function build(floorId = 'F5', party = PARTY, extra = []) {
  const s = initialState({ floorId, party });
  for (const e of [...layoutToRooms(LAYOUT, DEFS), ...extra]) applyEvent(s, e);
  return s;
}
const routeRooms = (plan) => new Set(Object.values(plan.routes).flatMap((r) => r.steps.map((x) => x.roomId)).filter(Boolean));

test('graph distances respect walls', () => {
  const s = build();
  const g = buildGraph(s.map);
  const direct = g.travel('R2', 'R9');
  assert.ok(Number.isFinite(direct));
  applyEvent(s, { type: 'door_set', a: 'R2', b: 'R9', doorType: 'wall' });
  const g2 = buildGraph(s.map);
  assert.ok(g2.travel('R2', 'R9') > direct);
  assert.ok(!g2.path('R2', 'R9').every((x, i, arr) => i === 0 || arr.length === 2));
});

test('every uncleared room is planned exactly once', () => {
  const plan = computePlan(build(), { elapsed: 0 });
  const seen = Object.values(plan.routes).flatMap((r) => r.steps.map((x) => x.objectiveId)).filter((x) => x && x !== '__rush__');
  assert.equal(new Set(seen).size, seen.length);
  for (const id of ['B1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'MB', 'T1', 'P1', 'P2', 'FA']) assert.ok(routeRooms(plan).has(id), id);
});

test('locked assignments are respected', () => {
  const s = build();
  applyEvent(s, { type: 'assign', roomId: 'R6', playerId: 't' });
  applyEvent(s, { type: 'assign', roomId: 'R12', playerId: 'm' });
  const plan = computePlan(s, { elapsed: 0 });
  assert.equal(plan.assignments.R6, 't');
  assert.equal(plan.assignments.R12, 'm');
});

test('route recalculates when a room is discovered and when rooms are cleared', () => {
  const s = initialState({ floorId: 'F5', party: PARTY });
  for (const e of layoutToRooms(['E R1 R2 . . .', '. . . . . .', '. . . . . .', '. . . . . .', '. . . . . .', '. . . . . .'], DEFS)) applyEvent(s, e);
  const p1 = computePlan(s, { elapsed: 0 });
  assert.ok(Object.values(p1.routes).some((r) => r.steps.some((x) => x.kind === 'explore')));
  applyEvent(s, { type: 'room_add', room: { id: 'R3', cells: [[3, 0], [3, 1]] } });
  const p2 = computePlan(s, { elapsed: 10 });
  assert.ok(routeRooms(p2).has('R3'));
  applyEvent(s, { type: 'room_clear', roomId: 'R3', playerId: 'b' });
  applyEvent(s, { type: 'secrets_set', roomId: 'R3', total: 4, found: 4 });
  const p3 = computePlan(s, { elapsed: 20 });
  assert.ok(!routeRooms(p3).has('R3'));
});

test('blood rush fetches a wither key when the path is locked', () => {
  const s = build('F5', PARTY, [
    { type: 'room_update', roomId: 'R12', patch: { hasWitherKey: true } },
    { type: 'door_set', a: 'BL', b: 'R5', doorType: 'wall' },
    { type: 'door_set', a: 'BL', b: 'R6', doorType: 'wall' },
    { type: 'door_set', a: 'BL', b: 'R7', doorType: 'wither' },
  ]);
  const plan = computePlan(s, { elapsed: 0 });
  assert.equal(plan.roles.bloodRusher, 'm');
  const steps = plan.routes.m.steps;
  assert.equal(steps[0].roomId, 'R12');
  assert.equal(steps[1].kind, 'rush');
  assert.equal(plan.rush.witherDoors, 1);
  assert.equal(plan.rush.path.at(-2), 'R7');
});

test('secret mode changes the secrets planned', () => {
  const s = build();
  const target = computePlan(s, { elapsed: 0 }).secrets.planned;
  applyEvent(s, { type: 'strategy_update', patch: { secretMode: 'all' } });
  const all = computePlan(s, { elapsed: 0 }).secrets.planned;
  applyEvent(s, { type: 'strategy_update', patch: { secretMode: 'none' } });
  const none = computePlan(s, { elapsed: 0 }).secrets.planned;
  assert.ok(all > target && target > none && none === 0, `${all} > ${target} > ${none}`);
});

test('a dead player gets a revive delay and the finish moves later', () => {
  const s = build();
  const before = computePlan(s, { elapsed: 0 });
  applyEvent(s, { type: 'death', playerId: 'b' });
  const after = computePlan(s, { elapsed: 0 });
  assert.ok(after.score.projected.skill === 98);
  assert.ok(after.warnings.some((w) => w.id === 'dead_b'));
  assert.ok(after.timeline.finishAt >= before.timeline.finishAt);
});

test('balance: routes on a full map are within 90s of each other', () => {
  const plan = computePlan(build(), { elapsed: 0 });
  const est = Object.values(plan.routes).map((r) => r.estSec);
  assert.ok(Math.max(...est) - Math.min(...est) <= 90, est.join(','));
});

test('empty map returns a setup plan', () => {
  const s = initialState({ floorId: 'F1', party: [{ class: 'mage' }] });
  const plan = computePlan(s, { elapsed: 0 });
  assert.equal(plan.empty, true);
  assert.equal(plan.warnings[0].id, 'empty_map');
});
