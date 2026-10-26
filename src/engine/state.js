// Event-sourced run state. A session is a list of events; the current state is
// produced by replaying them through applyEvent(). This gives deterministic
// recalculation, cheap undo, and an audit trail of every correction the
// player made.

import { getFloor, BOSSES } from '../data/floors.js';
import { CLASS_IDS } from '../data/classes.js';
import * as M from './map.js';

export const DEFAULT_STRATEGY = {
  target: 'S+', // 'S+' | 'S' | 'A' | 'complete'
  secretMode: 'target', // 'all' | 'target' | 'none'
  secretBuffer: 2, // extra secrets above the requirement in 'target' mode
  bloodRusher: 'auto', // 'auto' | playerId | null
  puzzleSolver: 'auto', // 'auto' | playerId
  cryptTarget: 5,
  spiritPet: false,
  ezpz: false,
  splitMode: 'split', // 'split' | 'stack'
  terminalOverrides: {}, // { "s1.device": playerId, "s2.t3": playerId }
};

export const EVENT_TYPES = [
  'run_start', 'clock_set', 'clock_pause', 'clock_resume',
  'map_resize', 'room_add', 'room_update', 'room_remove', 'door_set', 'door_open',
  'room_clear', 'room_unclear', 'secrets_set', 'secrets_add', 'puzzle_result', 'crypts_add',
  'death', 'revive', 'mimic', 'prince', 'key_add', 'blood_open',
  'player_move', 'player_add', 'player_remove', 'player_update',
  'assign', 'strategy_update', 'plan_adopt', 'plan_release',
  'boss_start', 'boss_phase', 'terminal_set', 'run_complete', 'note',
];

export class EventError extends Error {}

function assert(cond, msg) {
  if (!cond) throw new EventError(msg);
}

export function validateParty(party) {
  assert(Array.isArray(party) && party.length >= 1 && party.length <= 5, 'Party must have 1-5 players');
  const ids = new Set();
  let self = 0;
  const out = party.map((p, i) => {
    const id = String(p.id ?? `p${i + 1}`);
    assert(!ids.has(id), `Duplicate player id "${id}"`);
    ids.add(id);
    const cls = String(p.class ?? '').toLowerCase();
    assert(CLASS_IDS.includes(cls), `Player "${id}" has unknown class "${p.class}"`);
    if (p.isSelf) self++;
    return { id, name: p.name ?? id, class: cls, isSelf: Boolean(p.isSelf), location: null, deaths: 0, alive: true };
  });
  assert(self <= 1, 'Only one player can be marked as you');
  if (self === 0) out[0].isSelf = true;
  return out;
}

export function initialState({ floorId, party, strategy = {}, grid }) {
  const floor = getFloor(floorId);
  return {
    floorId: floor.id,
    map: M.createMap(grid ?? floor.grid),
    party: validateParty(party),
    strategy: { ...DEFAULT_STRATEGY, ...strategy, terminalOverrides: { ...(strategy.terminalOverrides ?? {}) } },
    clock: { startedAtMs: null, offsetSec: 0, running: false },
    phase: 'setup', // setup | clearing | boss | complete
    bloodOpened: false,
    bloodCleared: false,
    witherKeys: 0,
    crypts: 0,
    mimic: false,
    prince: false,
    spiritPetUsed: false,
    deathPenalty: 0,
    deaths: 0,
    bossPhase: null,
    bossKilled: false,
    terminals: {},
    assignments: {}, // roomId -> { playerId, locked }
    adoptedPlan: null, // objectiveId -> playerId, set when the party adopts a plan
    notes: [],
    lastEventAt: null,
  };
}

const player = (state, id) => {
  const p = state.party.find((x) => x.id === id);
  assert(p, `Unknown player "${id}"`);
  return p;
};

const room = (state, id) => {
  const r = state.map.rooms[id];
  assert(r, `Unknown room "${id}"`);
  return r;
};

export function elapsedSec(state, nowMs = Date.now()) {
  const c = state.clock;
  if (!c.running || c.startedAtMs == null) return c.offsetSec;
  return c.offsetSec + Math.max(0, (nowMs - c.startedAtMs) / 1000);
}

function wrapMap(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof M.MapError) throw new EventError(err.message);
    throw err;
  }
}

function clearRoom(state, r, playerId) {
  if (r.state === 'cleared') return;
  r.state = 'cleared';
  r.clearedBy = playerId ?? null;
  if (r.hasWitherKey) state.witherKeys += 1;
  if (r.type === 'blood') {
    state.bloodCleared = true;
    state.bloodOpened = true;
  }
}

export function applyEvent(state, ev) {
  assert(ev && EVENT_TYPES.includes(ev.type), `Unknown event type "${ev?.type}"`);
  const at = ev.at ?? state.lastEventAt ?? 0;
  switch (ev.type) {
    case 'run_start':
      assert(state.phase === 'setup', 'Run already started');
      state.phase = 'clearing';
      state.clock = { startedAtMs: at, offsetSec: ev.elapsed ?? 0, running: true };
      {
        const ent = Object.values(state.map.rooms).find((r) => r.type === 'entrance');
        if (ent) for (const p of state.party) p.location ??= ent.id;
      }
      break;
    case 'clock_set':
      assert(Number.isFinite(ev.elapsed) && ev.elapsed >= 0, 'clock_set needs elapsed >= 0');
      state.clock.offsetSec = ev.elapsed;
      state.clock.startedAtMs = at;
      break;
    case 'clock_pause':
      state.clock.offsetSec = elapsedSec(state, at);
      state.clock.running = false;
      break;
    case 'clock_resume':
      state.clock.startedAtMs = at;
      state.clock.running = state.phase !== 'setup' && state.phase !== 'complete';
      break;
    case 'map_resize':
      wrapMap(() => M.resizeMap(state.map, ev.w, ev.h));
      break;
    case 'room_add': {
      const r = wrapMap(() => M.addRoom(state.map, ev.room ?? {}));
      if (r.type === 'entrance') for (const p of state.party) p.location ??= r.id;
      break;
    }
    case 'room_update': {
      const r = room(state, ev.roomId);
      const patch = { ...(ev.patch ?? {}) };
      wrapMap(() => M.updateRoom(state.map, r.id, patch));
      if (patch.state === 'cleared') { r.state = 'discovered'; clearRoom(state, r, patch.clearedBy); }
      break;
    }
    case 'room_remove':
      room(state, ev.roomId);
      wrapMap(() => M.removeRoom(state.map, ev.roomId));
      delete state.assignments[ev.roomId];
      for (const p of state.party) if (p.location === ev.roomId) p.location = null;
      break;
    case 'door_set':
      wrapMap(() => M.setDoor(state.map, { a: ev.a, b: ev.b, type: ev.doorType ?? 'normal', opened: ev.opened }));
      break;
    case 'door_open': {
      const d = state.map.doors[M.doorKey(ev.a, ev.b)];
      if (d && d.type === 'wither' && !d.opened) {
        assert(state.witherKeys > 0 || ev.force, 'No wither key held - pick up a key first (or force to correct)');
        if (state.witherKeys > 0) state.witherKeys -= 1;
      }
      if (d && d.type === 'blood') state.bloodOpened = true;
      if (d) wrapMap(() => M.openDoor(state.map, ev.a, ev.b));
      else assert(M.areAdjacent(state.map, ev.a, ev.b), 'Rooms are not adjacent');
      break;
    }
    case 'room_clear': {
      const r = room(state, ev.roomId);
      if (ev.playerId) player(state, ev.playerId).location = r.id;
      clearRoom(state, r, ev.playerId);
      if (ev.secretsFound != null) wrapMap(() => M.updateRoom(state.map, r.id, { secretsFound: ev.secretsFound }));
      break;
    }
    case 'room_unclear': {
      const r = room(state, ev.roomId);
      if (r.state === 'cleared' && r.hasWitherKey) state.witherKeys = Math.max(0, state.witherKeys - 1);
      r.state = 'discovered';
      r.clearedBy = null;
      if (r.type === 'blood') state.bloodCleared = false;
      break;
    }
    case 'secrets_set': {
      const r = room(state, ev.roomId);
      const patch = {};
      if (ev.total != null) patch.secretsTotal = ev.total;
      if (ev.found != null) patch.secretsFound = ev.found;
      if (patch.secretsTotal != null && (patch.secretsFound ?? r.secretsFound) > patch.secretsTotal) {
        throw new EventError('Found secrets cannot exceed the room total');
      }
      wrapMap(() => M.updateRoom(state.map, r.id, patch));
      break;
    }
    case 'secrets_add': {
      const r = room(state, ev.roomId);
      const delta = ev.delta ?? 1;
      const next = Math.max(0, r.secretsFound + delta);
      wrapMap(() => M.updateRoom(state.map, r.id, { secretsFound: next }));
      break;
    }
    case 'puzzle_result': {
      const r = room(state, ev.roomId);
      assert(r.type === 'puzzle', `Room "${r.id}" is not a puzzle`);
      assert([null, 'solved', 'failed'].includes(ev.result ?? null), 'Puzzle result must be solved, failed or null');
      r.puzzleResult = ev.result ?? null;
      if (ev.result) clearRoom(state, r, ev.playerId);
      else if (r.state === 'cleared') r.state = 'discovered';
      if (ev.playerId) player(state, ev.playerId).location = r.id;
      break;
    }
    case 'crypts_add': {
      const delta = ev.delta ?? 1;
      state.crypts = Math.max(0, state.crypts + delta);
      if (ev.roomId) {
        const r = room(state, ev.roomId);
        r.cryptsBlown = Math.max(0, r.cryptsBlown + delta);
        if (r.crypts != null && r.cryptsBlown > r.crypts) r.crypts = r.cryptsBlown;
      }
      break;
    }
    case 'death': {
      const p = player(state, ev.playerId);
      p.deaths += 1;
      p.alive = false;
      state.deaths += 1;
      const firstWithPet = state.deaths === 1 && state.strategy.spiritPet;
      if (firstWithPet) state.spiritPetUsed = true;
      state.deathPenalty += firstWithPet ? 1 : 2;
      break;
    }
    case 'revive':
      player(state, ev.playerId).alive = true;
      break;
    case 'mimic':
      state.mimic = ev.killed !== false;
      break;
    case 'prince':
      state.prince = ev.killed !== false;
      break;
    case 'key_add':
      state.witherKeys = Math.max(0, state.witherKeys + (ev.delta ?? 1));
      break;
    case 'blood_open':
      state.bloodOpened = true;
      break;
    case 'player_move': {
      const p = player(state, ev.playerId);
      if (ev.roomId != null) room(state, ev.roomId);
      p.location = ev.roomId ?? null;
      const r = ev.roomId && state.map.rooms[ev.roomId];
      if (r && r.type === 'fairy') clearRoom(state, r, p.id);
      if (r && r.type === 'blood') state.bloodOpened = true;
      break;
    }
    case 'player_add': {
      assert(state.party.length < 5, 'Party is full');
      const [p] = validateParty([{ ...ev.player, isSelf: false }]);
      assert(!state.party.some((x) => x.id === p.id), `Player "${p.id}" already exists`);
      p.isSelf = false;
      p.location = ev.player?.location ?? Object.values(state.map.rooms).find((r) => r.type === 'entrance')?.id ?? null;
      state.party.push(p);
      break;
    }
    case 'player_remove': {
      const p = player(state, ev.playerId);
      assert(state.party.length > 1, 'Cannot remove the last player');
      state.party = state.party.filter((x) => x.id !== p.id);
      if (p.isSelf) state.party[0].isSelf = true;
      for (const [rid, a] of Object.entries(state.assignments)) if (a.playerId === p.id) delete state.assignments[rid];
      if (state.strategy.bloodRusher === p.id) state.strategy.bloodRusher = 'auto';
      if (state.strategy.puzzleSolver === p.id) state.strategy.puzzleSolver = 'auto';
      state.adoptedPlan = null; // party changed: plan must be recomputed
      break;
    }
    case 'player_update': {
      const p = player(state, ev.playerId);
      const patch = ev.patch ?? {};
      if (patch.class != null) {
        const cls = String(patch.class).toLowerCase();
        assert(CLASS_IDS.includes(cls), `Unknown class "${patch.class}"`);
        p.class = cls;
        state.adoptedPlan = null;
      }
      if (patch.name != null) p.name = String(patch.name);
      if (patch.isSelf) for (const x of state.party) x.isSelf = x.id === p.id;
      break;
    }
    case 'assign': {
      const r = room(state, ev.roomId);
      if (ev.playerId == null) delete state.assignments[r.id];
      else {
        player(state, ev.playerId);
        state.assignments[r.id] = { playerId: ev.playerId, locked: ev.locked !== false };
      }
      break;
    }
    case 'strategy_update': {
      const patch = ev.patch ?? {};
      if (patch.secretMode) assert(['all', 'target', 'none'].includes(patch.secretMode), 'Invalid secretMode');
      if (patch.target) assert(['S+', 'S', 'A', 'complete'].includes(patch.target), 'Invalid target');
      if (patch.splitMode) assert(['split', 'stack'].includes(patch.splitMode), 'Invalid splitMode');
      for (const k of ['bloodRusher', 'puzzleSolver']) {
        if (patch[k] != null && patch[k] !== 'auto') player(state, patch[k]);
      }
      state.strategy = {
        ...state.strategy,
        ...patch,
        terminalOverrides: { ...state.strategy.terminalOverrides, ...(patch.terminalOverrides ?? {}) },
      };
      break;
    }
    case 'plan_adopt':
      assert(ev.assignments && typeof ev.assignments === 'object', 'plan_adopt needs assignments');
      state.adoptedPlan = { ...ev.assignments };
      break;
    case 'plan_release':
      state.adoptedPlan = null;
      break;
    case 'boss_start': {
      assert(state.phase !== 'complete', 'Run already complete');
      state.phase = 'boss';
      const boss = BOSSES[getFloor(state.floorId).number];
      state.bossPhase = boss.phases[0].id;
      if (!state.clock.running) {
        state.clock.running = true;
        state.clock.startedAtMs = at;
      }
      break;
    }
    case 'boss_phase': {
      const boss = BOSSES[getFloor(state.floorId).number];
      assert(boss.phases.some((p) => p.id === ev.phase), `Unknown boss phase "${ev.phase}"`);
      state.phase = 'boss';
      state.bossPhase = ev.phase;
      break;
    }
    case 'terminal_set': {
      assert(getFloor(state.floorId).number === 7, 'Terminals only exist on Floor 7');
      assert(Number.isInteger(ev.section) && ev.section >= 1 && ev.section <= 4, 'Section must be 1-4');
      assert(['terminal', 'lever', 'device'].includes(ev.kind), 'kind must be terminal, lever or device');
      state.terminals[`s${ev.section}.${ev.kind}${ev.kind === 'device' ? '' : ev.index}`] = ev.done !== false;
      break;
    }
    case 'run_complete':
      state.clock.offsetSec = ev.elapsed ?? elapsedSec(state, at);
      state.clock.running = false;
      state.phase = 'complete';
      state.bossKilled = ev.bossKilled !== false;
      break;
    case 'note':
      state.notes.push({ at, text: String(ev.text ?? '') });
      break;
  }
  state.lastEventAt = at;
  return state;
}

export function replay(init, events) {
  const state = initialState(init);
  for (const ev of events) applyEvent(state, ev);
  return state;
}
