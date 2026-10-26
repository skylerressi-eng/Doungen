import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager, FileStore, MemoryStore } from '../src/session.js';

const party = [{ id: 'p1', class: 'mage', isSelf: true }, { id: 'p2', class: 'healer' }];
const rooms = [
  { type: 'room_add', room: { id: 'E', type: 'entrance', cells: [[0, 0]] } },
  { type: 'room_add', room: { id: 'R1', cells: [[1, 0], [2, 0]] } },
  { type: 'room_add', room: { id: 'BL', type: 'blood', cells: [[3, 0]] } },
];

test('sessions persist to disk and resume after restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-'));
  try {
    const m1 = new SessionManager(new FileStore(dir));
    const id = m1.create({ floorId: 'F2', party });
    m1.apply(id, rooms);
    m1.apply(id, { type: 'room_clear', roomId: 'R1', playerId: 'p1' });
    const m2 = new SessionManager(new FileStore(dir));
    const v = m2.view(id);
    assert.equal(v.state.map.rooms.R1.state, 'cleared');
    assert.equal(v.state.party.find((p) => p.id === 'p1').location, 'R1');
    assert.equal(m2.list().length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid batches are rejected atomically', () => {
  const m = new SessionManager(new MemoryStore());
  const id = m.create({ floorId: 'F1', party });
  assert.throws(() => m.apply(id, [rooms[0], { type: 'room_add', room: { id: 'X', cells: [[0, 0]] } }]), /already belongs/);
  assert.deepEqual(m.get(id).state.map.rooms, {});
  assert.equal(m.get(id).session.events.length, 0);
});

test('run start auto-locks the plan; undo removes both and redo restores both', () => {
  let now = 1000;
  const m = new SessionManager(new MemoryStore(), { now: () => now });
  const id = m.create({ floorId: 'F1', party });
  m.apply(id, rooms);
  m.apply(id, { type: 'run_start' });
  assert.ok(m.get(id).state.adoptedPlan);
  assert.equal(m.get(id).state.phase, 'clearing');
  now += 30000;
  assert.equal(Math.round(m.view(id).elapsed), 30);
  m.undo(id);
  assert.equal(m.get(id).state.phase, 'setup');
  assert.equal(m.get(id).state.adoptedPlan, null);
  m.redo(id);
  assert.equal(m.get(id).state.phase, 'clearing');
  assert.ok(m.get(id).state.adoptedPlan);
});

test('revert removes a past mistaken entry and replays', () => {
  const m = new SessionManager(new MemoryStore());
  const id = m.create({ floorId: 'F1', party });
  m.apply(id, rooms);
  const [ev] = m.apply(id, { type: 'room_clear', roomId: 'R1' });
  m.apply(id, { type: 'secrets_add', roomId: 'BL', delta: 0 });
  m.revert(id, ev.seq);
  assert.equal(m.get(id).state.map.rooms.R1.state, 'discovered');
});

test('clock pause, resume and correction', () => {
  let now = 0;
  const m = new SessionManager(new MemoryStore(), { now: () => now });
  const id = m.create({ floorId: 'F1', party });
  m.apply(id, [...rooms, { type: 'run_start' }]);
  now = 10_000;
  m.apply(id, { type: 'clock_pause' });
  now = 50_000;
  assert.equal(Math.round(m.view(id).elapsed), 10);
  m.apply(id, { type: 'clock_resume' });
  now = 55_000;
  assert.equal(Math.round(m.view(id).elapsed), 15);
  m.apply(id, { type: 'clock_set', elapsed: 120 });
  now = 60_000;
  assert.equal(Math.round(m.view(id).elapsed), 125);
});

test('party validation', () => {
  const m = new SessionManager(new MemoryStore());
  assert.throws(() => m.create({ floorId: 'F1', party: [] }), /1-5/);
  assert.throws(() => m.create({ floorId: 'F1', party: [{ class: 'wizard' }] }), /unknown class/);
  assert.throws(() => m.create({ floorId: 'F9', party }), /Unknown floor/);
});
