// Dungeon map model: a grid of cells, rooms that occupy one or more cells and
// doors between adjacent rooms. All functions operate on plain JSON objects so
// maps persist and replay without conversion.

import { ROOM_TYPES, PUZZLES, SHAPE_SECRET_ESTIMATE, TYPE_SECRET_ESTIMATE, inferShape } from '../data/rooms.js';

export const DOOR_TYPES = ['assumed', 'normal', 'wither', 'blood', 'wall'];

export function createMap(grid) {
  return { w: grid.w, h: grid.h, rooms: {}, doors: {}, cells: {} };
}

export const cellKey = (x, y) => `${x},${y}`;
export const doorKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class MapError extends Error {}

function assert(cond, msg) {
  if (!cond) throw new MapError(msg);
}

function normalizeCells(cells) {
  assert(Array.isArray(cells) && cells.length > 0, 'Room needs at least one cell');
  const seen = new Set();
  return cells.map((c) => {
    const [x, y] = Array.isArray(c) ? c : [c.x, c.y];
    assert(Number.isInteger(x) && Number.isInteger(y), 'Cell coordinates must be integers');
    const k = cellKey(x, y);
    assert(!seen.has(k), `Duplicate cell ${k}`);
    seen.add(k);
    return [x, y];
  });
}

function isContiguous(cells) {
  const set = new Set(cells.map(([x, y]) => cellKey(x, y)));
  const stack = [cells[0]];
  const seen = new Set([cellKey(...cells[0])]);
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = cellKey(x + dx, y + dy);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
  }
  return seen.size === cells.length;
}

export function estimateSecrets(room) {
  if (room.type in TYPE_SECRET_ESTIMATE) return TYPE_SECRET_ESTIMATE[room.type];
  return SHAPE_SECRET_ESTIMATE[room.shape] ?? 3;
}

export function addRoom(map, input) {
  const id = String(input.id ?? '').trim();
  assert(id, 'Room id is required');
  assert(!map.rooms[id], `Room "${id}" already exists`);
  const type = input.type ?? 'normal';
  assert(ROOM_TYPES[type], `Unknown room type "${type}"`);
  const cells = normalizeCells(input.cells);
  for (const [x, y] of cells) {
    assert(x >= 0 && y >= 0 && x < map.w && y < map.h, `Cell ${x},${y} is outside the ${map.w}x${map.h} grid`);
    const owner = map.cells[cellKey(x, y)];
    assert(!owner, `Cell ${x},${y} already belongs to room "${owner}"`);
  }
  assert(isContiguous(cells), 'Room cells must be contiguous');
  const shape = inferShape(cells);
  assert(shape, 'Rooms can occupy at most 4 cells');
  if (type === 'blood' || type === 'entrance' || type === 'fairy') {
    const dup = Object.values(map.rooms).find((r) => r.type === type);
    assert(!dup, `Map already has a ${type} room ("${dup?.id}")`);
  }
  if (type === 'puzzle' && input.puzzle) assert(PUZZLES[input.puzzle], `Unknown puzzle "${input.puzzle}"`);

  const room = {
    id,
    name: input.name ?? null,
    type,
    shape,
    cells,
    secretsTotal: input.secretsTotal ?? null,
    secretsFound: input.secretsFound ?? 0,
    crypts: input.crypts ?? null,
    cryptsBlown: 0,
    puzzle: type === 'puzzle' ? input.puzzle ?? 'unknown' : null,
    puzzleResult: null, // 'solved' | 'failed'
    hasWitherKey: Boolean(input.hasWitherKey),
    state: input.state ?? 'discovered', // discovered | cleared
    clearedBy: null,
  };
  if (type === 'entrance') room.state = 'cleared';
  map.rooms[id] = room;
  for (const [x, y] of cells) map.cells[cellKey(x, y)] = id;
  return room;
}

export function updateRoom(map, id, patch) {
  const room = map.rooms[id];
  assert(room, `Unknown room "${id}"`);
  const next = { ...patch };
  if (next.cells) {
    const cells = normalizeCells(next.cells);
    for (const [x, y] of cells) {
      assert(x >= 0 && y >= 0 && x < map.w && y < map.h, `Cell ${x},${y} is outside the ${map.w}x${map.h} grid`);
      const owner = map.cells[cellKey(x, y)];
      assert(!owner || owner === id, `Cell ${x},${y} already belongs to room "${owner}"`);
    }
    assert(isContiguous(cells), 'Room cells must be contiguous');
    const shape = inferShape(cells);
    assert(shape, 'Rooms can occupy at most 4 cells');
    for (const [x, y] of room.cells) delete map.cells[cellKey(x, y)];
    for (const [x, y] of cells) map.cells[cellKey(x, y)] = id;
    room.cells = cells;
    room.shape = shape;
    delete next.cells;
    pruneDoors(map);
  }
  if (next.type) {
    assert(ROOM_TYPES[next.type], `Unknown room type "${next.type}"`);
    if (['blood', 'entrance', 'fairy'].includes(next.type)) {
      const dup = Object.values(map.rooms).find((r) => r.type === next.type && r.id !== id);
      assert(!dup, `Map already has a ${next.type} room ("${dup?.id}")`);
    }
    if (next.type === 'puzzle' && !room.puzzle && !next.puzzle) next.puzzle = 'unknown';
    if (next.type !== 'puzzle') { next.puzzle = null; next.puzzleResult = null; }
  }
  if (next.puzzle) assert(PUZZLES[next.puzzle], `Unknown puzzle "${next.puzzle}"`);
  for (const k of ['secretsTotal', 'secretsFound', 'crypts', 'cryptsBlown']) {
    if (next[k] != null) assert(Number.isInteger(next[k]) && next[k] >= 0, `${k} must be a non-negative integer`);
  }
  const allowed = ['name', 'type', 'secretsTotal', 'secretsFound', 'crypts', 'cryptsBlown', 'puzzle', 'puzzleResult', 'hasWitherKey', 'state', 'clearedBy'];
  for (const k of Object.keys(next)) if (allowed.includes(k)) room[k] = next[k];
  if (room.secretsTotal != null && room.secretsFound > room.secretsTotal) room.secretsTotal = room.secretsFound;
  return room;
}

export function removeRoom(map, id, { keepDoors = false } = {}) {
  const room = map.rooms[id];
  assert(room, `Unknown room "${id}"`);
  for (const [x, y] of room.cells) delete map.cells[cellKey(x, y)];
  delete map.rooms[id];
  if (!keepDoors) pruneDoors(map);
}

function pruneDoors(map) {
  for (const [k, d] of Object.entries(map.doors)) {
    if (!map.rooms[d.a] || !map.rooms[d.b] || !areAdjacent(map, d.a, d.b)) delete map.doors[k];
  }
}

export function areAdjacent(map, a, b) {
  const ra = map.rooms[a];
  if (!ra || !map.rooms[b]) return false;
  for (const [x, y] of ra.cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (map.cells[cellKey(x + dx, y + dy)] === b) return true;
    }
  }
  return false;
}

export function setDoor(map, { a, b, type = 'normal', opened = false }) {
  assert(map.rooms[a] && map.rooms[b], 'Door must connect two known rooms');
  assert(a !== b, 'Door must connect two different rooms');
  assert(DOOR_TYPES.includes(type), `Unknown door type "${type}"`);
  assert(areAdjacent(map, a, b), `Rooms "${a}" and "${b}" are not adjacent`);
  const k = doorKey(a, b);
  if (type === 'assumed') {
    delete map.doors[k];
    return null;
  }
  const [x, y] = a < b ? [a, b] : [b, a];
  map.doors[k] = { a: x, b: y, type, opened: Boolean(opened) || type === 'normal' };
  return map.doors[k];
}

export function openDoor(map, a, b) {
  const d = map.doors[doorKey(a, b)];
  assert(d, `No recorded door between "${a}" and "${b}"`);
  assert(d.type !== 'wall', 'Cannot open a wall');
  d.opened = true;
  return d;
}

export function adjacentRooms(map, id) {
  const room = map.rooms[id];
  if (!room) return [];
  const out = new Set();
  for (const [x, y] of room.cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const other = map.cells[cellKey(x + dx, y + dy)];
      if (other && other !== id) out.add(other);
    }
  }
  return [...out];
}

// Connections the router may use. Adjacent rooms without a recorded door are
// "assumed" connected (low confidence) unless the pair is marked as a wall.
export function connections(map, id) {
  return adjacentRooms(map, id)
    .map((other) => {
      const d = map.doors[doorKey(id, other)];
      if (d?.type === 'wall') return null;
      return { to: other, type: d?.type ?? 'assumed', opened: d ? d.opened : true, recorded: Boolean(d) };
    })
    .filter(Boolean);
}

export function centroid(room) {
  const n = room.cells.length;
  return [room.cells.reduce((s, c) => s + c[0], 0) / n, room.cells.reduce((s, c) => s + c[1], 0) / n];
}

export function unknownCells(map) {
  const out = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (!map.cells[cellKey(x, y)]) out.push([x, y]);
  return out;
}

// Unknown cells touching a known room: where the next discovery will happen.
export function frontier(map) {
  const out = [];
  for (const [x, y] of unknownCells(map)) {
    const touching = new Set();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = map.cells[cellKey(x + dx, y + dy)];
      if (r) touching.add(r);
    }
    if (touching.size) out.push({ cell: [x, y], touching: [...touching] });
  }
  return out;
}

export function completeness(map) {
  return Object.keys(map.cells).length / (map.w * map.h);
}

export function resizeMap(map, w, h) {
  assert(Number.isInteger(w) && Number.isInteger(h) && w >= 2 && h >= 2 && w <= 8 && h <= 8, 'Grid must be between 2x2 and 8x8');
  for (const room of Object.values(map.rooms)) {
    for (const [x, y] of room.cells) assert(x < w && y < h, `Room "${room.id}" would be outside a ${w}x${h} grid`);
  }
  map.w = w;
  map.h = h;
}
