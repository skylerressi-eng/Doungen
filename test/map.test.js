import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/engine/map.js';

const fresh = () => M.createMap({ w: 4, h: 4 });

test('shape inference and validation', () => {
  const m = fresh();
  assert.equal(M.addRoom(m, { id: 'a', cells: [[0, 0]] }).shape, '1x1');
  assert.equal(M.addRoom(m, { id: 'b', cells: [[1, 0], [2, 0], [3, 0]] }).shape, '1x3');
  assert.equal(M.addRoom(m, { id: 'c', cells: [[0, 1], [1, 1], [0, 2]] }).shape, 'L');
  assert.equal(M.addRoom(m, { id: 'd', cells: [[2, 1], [3, 1], [2, 2], [3, 2]] }).shape, '2x2');
  assert.throws(() => M.addRoom(m, { id: 'e', cells: [[0, 0]] }), /already belongs/);
  assert.throws(() => M.addRoom(m, { id: 'e', cells: [[0, 3], [2, 3]] }), /contiguous/);
  assert.throws(() => M.addRoom(m, { id: 'e', cells: [[4, 3]] }), /outside/);
  assert.throws(() => M.addRoom(m, { id: 'a', cells: [[1, 3]] }), /already exists/);
  M.addRoom(m, { id: 'bl', type: 'blood', cells: [[1, 3]] });
  assert.throws(() => M.addRoom(m, { id: 'bl2', type: 'blood', cells: [[0, 3]] }), /already has a blood/);
});

test('doors require adjacency; walls remove connections', () => {
  const m = fresh();
  M.addRoom(m, { id: 'a', cells: [[0, 0]] });
  M.addRoom(m, { id: 'b', cells: [[1, 0]] });
  M.addRoom(m, { id: 'c', cells: [[3, 3]] });
  assert.throws(() => M.setDoor(m, { a: 'a', b: 'c' }), /not adjacent/);
  assert.deepEqual(M.connections(m, 'a').map((c) => [c.to, c.type]), [['b', 'assumed']]);
  M.setDoor(m, { a: 'a', b: 'b', type: 'wither' });
  assert.equal(M.connections(m, 'a')[0].opened, false);
  M.setDoor(m, { a: 'b', b: 'a', type: 'wall' });
  assert.deepEqual(M.connections(m, 'a'), []);
  M.setDoor(m, { a: 'a', b: 'b', type: 'assumed' });
  assert.equal(M.connections(m, 'a').length, 1);
});

test('room correction: moving cells keeps data and prunes stale doors', () => {
  const m = fresh();
  M.addRoom(m, { id: 'a', cells: [[0, 0]] });
  M.addRoom(m, { id: 'b', cells: [[1, 0]], secretsTotal: 4 });
  M.setDoor(m, { a: 'a', b: 'b', type: 'normal' });
  M.updateRoom(m, 'b', { cells: [[2, 2], [2, 3]] });
  assert.equal(m.rooms.b.shape, '1x2');
  assert.equal(m.rooms.b.secretsTotal, 4);
  assert.equal(m.cells['1,0'], undefined);
  assert.deepEqual(m.doors, {});
});

test('frontier lists unknown cells next to known rooms', () => {
  const m = fresh();
  M.addRoom(m, { id: 'e', type: 'entrance', cells: [[0, 3]] });
  const f = M.frontier(m).map((x) => x.cell.join(','));
  assert.deepEqual(f.sort(), ['0,2', '1,3']);
  assert.equal(M.completeness(m), 1 / 16);
});
