// Route engine: turns the known map + run state into per-player routes,
// time estimates, a projected score and a list of detected problems.
//
// Pipeline
//   1. Shortest paths between every pair of known rooms (Dijkstra on doors,
//      with adjacency treated as an "assumed" door when nothing is recorded).
//   2. Objectives: uncleared rooms, puzzles, frontier exploration, and
//      revisits of cleared rooms when more secrets are needed.
//   3. Secret selection: choose which secrets to collect so the floor's
//      requirement (plus buffer) is met at the lowest time cost.
//   4. Assignment: makespan-aware cheapest insertion across the party, seeded
//      by locked assignments and the adopted plan so routes stay stable, then
//      2-opt improvement per player.
//   5. Timeline (clear, blood camp, boss) and projected score.
//   6. Diagnostics: rebalance opportunities, schedule risk, score shortfall.

import { getFloor } from '../data/floors.js';
import { getClass } from '../data/classes.js';
import { PUZZLES, SHAPE_CLEAR_SEC, TYPE_CLEAR_SEC, SECRET_SEC, CRYPT_SEC } from '../data/rooms.js';
import * as M from './map.js';
import { elapsedSec } from './state.js';
import { computeScore, gradeThreshold, fullSpeedDeadline, speedScore } from './score.js';

export const TRAVEL = {
  doorSec: 3,
  cellSec: 4,
  witherDoorSec: 6, // using a held key
  assumedDoorSec: 2, // uncertainty penalty on unrecorded connections
  revisitSec: 10, // overhead to re-enter a cleared room for missed secrets
  deadPlayerSec: 15, // expected delay before a dead player is revived
  exploreCellSec: 22, // clearing an unknown room discovered at the frontier
};

const AVG_CELLS_PER_ROOM = 1.7;
const AVG_SECRETS_PER_UNKNOWN_ROOM = 3.5;

// ---------------------------------------------------------------- graph ----

export function buildGraph(map) {
  const ids = Object.keys(map.rooms);
  const edges = {};
  for (const id of ids) {
    const [cx, cy] = M.centroid(map.rooms[id]);
    edges[id] = M.connections(map, id).map((c) => {
      const [ox, oy] = M.centroid(map.rooms[c.to]);
      let cost = TRAVEL.doorSec + Math.hypot(cx - ox, cy - oy) * TRAVEL.cellSec;
      if (c.type === 'assumed') cost += TRAVEL.assumedDoorSec;
      if (c.type === 'wither' && !c.opened) cost += TRAVEL.witherDoorSec;
      return { ...c, cost };
    });
  }
  const dist = {};
  const prev = {};
  for (const src of ids) {
    const d = { [src]: 0 };
    const p = {};
    const done = new Set();
    while (true) {
      let u = null;
      for (const k in d) if (!done.has(k) && (u === null || d[k] < d[u])) u = k;
      if (u === null) break;
      done.add(u);
      for (const e of edges[u]) {
        const nd = d[u] + e.cost;
        if (d[e.to] === undefined || nd < d[e.to]) {
          d[e.to] = nd;
          p[e.to] = u;
        }
      }
    }
    dist[src] = d;
    prev[src] = p;
  }
  const travel = (a, b) => {
    if (a === b) return 0;
    const v = dist[a]?.[b];
    return v === undefined ? Infinity : v;
  };
  const path = (a, b) => {
    if (a === b) return [a];
    if (travel(a, b) === Infinity) return null;
    const out = [b];
    let cur = b;
    while (cur !== a) {
      cur = prev[a][cur];
      out.push(cur);
    }
    return out.reverse();
  };
  return { ids, edges, travel, path };
}

// Doors along a path, used to count wither keys and assumed connections.
function pathDoors(map, path) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const d = map.doors[M.doorKey(path[i - 1], path[i])];
    out.push({ a: path[i - 1], b: path[i], type: d?.type ?? 'assumed', opened: d ? d.opened : true });
  }
  return out;
}

// ------------------------------------------------------------- durations ---

export function clearSeconds(room, cls, floor) {
  const t = cls.traits;
  if (room.type === 'puzzle') {
    const pz = PUZZLES[room.puzzle] ?? PUZZLES.unknown;
    let s = pz.estSec * t.puzzleSpeed;
    if (pz.ranged) s *= t.ranged ? 0.8 : 1.25;
    return s * (t.affinity.puzzle ?? 1);
  }
  const base = TYPE_CLEAR_SEC[room.type] ?? SHAPE_CLEAR_SEC[room.shape] ?? 30;
  if (room.type === 'fairy' || room.type === 'entrance') return base;
  return base * floor.clearScale * t.clearSpeed * (t.affinity[room.type] ?? 1);
}

function objectiveSeconds(obj, ctx, cls) {
  const { floor, map } = ctx;
  const t = cls.traits;
  let s = 0;
  if (obj.kind === 'explore') s = TRAVEL.exploreCellSec * floor.clearScale * t.clearSpeed;
  else if (obj.kind === 'secrets') s = TRAVEL.revisitSec;
  else s = clearSeconds(map.rooms[obj.roomId], cls, floor);
  s += obj.secrets * SECRET_SEC * t.secretSpeed;
  s += obj.crypts * CRYPT_SEC;
  return s;
}

// ------------------------------------------------------------- planning ----

export function remainingSecrets(room) {
  const total = room.secretsTotal ?? M.estimateSecrets(room);
  return Math.max(0, total - room.secretsFound);
}

function resolveRusher(state, ctx) {
  const s = state.strategy;
  if (s.bloodRusher === null || s.bloodRusher === 'none') return null;
  if (s.bloodRusher && s.bloodRusher !== 'auto') return state.party.find((p) => p.id === s.bloodRusher) ?? null;
  if (state.party.length < 2 || s.splitMode === 'stack') return null;
  let best = null;
  for (const p of state.party) {
    const score = getClass(p.class).traits.bloodRushScore;
    if (!best || score > best.score) best = { p, score };
  }
  return best.p;
}

function resolvePuzzleSolver(state) {
  const s = state.strategy;
  if (s.puzzleSolver && s.puzzleSolver !== 'auto') return state.party.find((p) => p.id === s.puzzleSolver) ?? null;
  for (const cls of ['healer', 'tank', 'berserk', 'archer', 'mage']) {
    const p = state.party.find((x) => x.class === cls);
    if (p) return p;
  }
  return null;
}

function scoreContext(state, floor) {
  const map = state.map;
  const rooms = Object.values(map.rooms);
  const unknown = M.unknownCells(map).length;
  const estUnknownRooms = unknown / AVG_CELLS_PER_ROOM;
  const knownRooms = rooms.length;
  const totalRoomsEst = Math.max(1, Math.round(knownRooms + estUnknownRooms));
  let knownSecrets = 0;
  let confirmedSecrets = 0;
  for (const r of rooms) {
    const total = r.secretsTotal ?? M.estimateSecrets(r);
    knownSecrets += Math.max(total, r.secretsFound);
    if (r.secretsTotal != null) confirmedSecrets += r.secretsTotal;
  }
  const unknownSecretsEst = estUnknownRooms * AVG_SECRETS_PER_UNKNOWN_ROOM;
  const totalSecretsEst = Math.max(1, Math.round(knownSecrets + unknownSecretsEst));
  const found = rooms.reduce((s, r) => s + r.secretsFound, 0);
  const required = Math.ceil(floor.secretRequirement * totalSecretsEst);
  return {
    knownRooms,
    totalRoomsEst,
    clearedRooms: rooms.filter((r) => r.state === 'cleared').length,
    totalSecretsEst,
    secretsFound: found,
    secretsRequired: required,
    secretConfidence: totalSecretsEst > 0 ? confirmedSecrets / totalSecretsEst : 0,
    unknownCells: unknown,
  };
}

function buildObjectives(state, ctx) {
  const { map } = ctx;
  const objectives = [];
  for (const r of Object.values(map.rooms)) {
    if (r.type === 'entrance' || r.type === 'blood') continue;
    if (r.state !== 'cleared') {
      objectives.push({
        id: r.id,
        kind: r.type === 'puzzle' ? 'puzzle' : r.type === 'fairy' ? 'visit' : 'clear',
        roomId: r.id,
        at: r.id,
        secrets: 0,
        secretsAvailable: r.type === 'puzzle' ? 0 : remainingSecrets(r),
        crypts: 0,
        cryptsAvailable: r.crypts != null ? Math.max(0, r.crypts - r.cryptsBlown) : 0,
        confidence: r.secretsTotal != null ? 'confirmed' : 'estimated',
      });
    } else if (r.type !== 'puzzle' && r.type !== 'fairy') {
      const rem = remainingSecrets(r);
      const cr = r.crypts != null ? Math.max(0, r.crypts - r.cryptsBlown) : 0;
      if (rem > 0 || cr > 0) {
        objectives.push({
          id: `${r.id}#revisit`,
          kind: 'secrets',
          roomId: r.id,
          at: r.id,
          secrets: 0,
          secretsAvailable: rem,
          crypts: 0,
          cryptsAvailable: cr,
          optional: true,
          confidence: r.secretsTotal != null ? 'confirmed' : 'estimated',
        });
      }
    }
  }
  // Frontier exploration: unknown cells next to known rooms.
  for (const f of M.frontier(map)) {
    const reachable = f.touching.filter((id) => ctx.graph.ids.includes(id));
    if (!reachable.length) continue;
    objectives.push({
      id: `explore@${f.cell[0]},${f.cell[1]}`,
      kind: 'explore',
      roomId: null,
      cell: f.cell,
      at: reachable[0],
      touching: reachable,
      secrets: 0,
      secretsAvailable: 0,
      crypts: 0,
      cryptsAvailable: 0,
      confidence: 'unknown',
    });
  }
  // Only explore a bounded number of frontier cells; each discovery
  // re-triggers planning anyway.
  const explores = objectives.filter((o) => o.kind === 'explore');
  if (explores.length > 6) {
    const keep = new Set(explores.slice(0, 6).map((o) => o.id));
    return objectives.filter((o) => o.kind !== 'explore' || keep.has(o.id));
  }
  return objectives;
}

// Decide how many secrets/crypts each objective collects.
function selectSecretsAndCrypts(objectives, state, sc) {
  const mode = state.strategy.secretMode;
  let need = 0;
  if (mode === 'all') need = Infinity;
  else if (mode === 'target') need = Math.max(0, sc.secretsRequired + (state.strategy.secretBuffer ?? 0) - sc.secretsFound);
  const candidates = objectives
    .filter((o) => o.secretsAvailable > 0)
    .map((o) => ({ o, costPer: SECRET_SEC + (o.kind === 'secrets' ? TRAVEL.revisitSec / o.secretsAvailable + 8 : 0) }))
    .sort((a, b) => a.costPer - b.costPer);
  let planned = 0;
  for (const { o } of candidates) {
    if (planned >= need) break;
    const take = Math.min(o.secretsAvailable, need - planned);
    o.secrets = take;
    planned += take;
  }
  let cryptNeed = Math.max(0, (state.strategy.cryptTarget ?? 5) - state.crypts);
  for (const o of [...objectives].sort((a, b) => (a.kind === 'secrets') - (b.kind === 'secrets'))) {
    if (cryptNeed <= 0) break;
    if (o.cryptsAvailable > 0) {
      o.crypts = Math.min(o.cryptsAvailable, cryptNeed);
      cryptNeed -= o.crypts;
    }
  }
  // Revisits with nothing to collect are dropped.
  return {
    objectives: objectives.filter((o) => o.kind !== 'secrets' || o.secrets > 0 || o.crypts > 0),
    plannedSecrets: planned,
    secretsShortBy: Number.isFinite(need) ? Math.max(0, need - planned) : 0,
    cryptsShortBy: cryptNeed,
  };
}

function routeTime(route, ctx) {
  let t = route.delay;
  let cur = route.start;
  for (const step of route.steps) {
    t += ctx.graph.travel(cur, step.at) + step.work + (step.kind === 'explore' ? TRAVEL.cellSec : 0);
    cur = step.at;
  }
  if (ctx.bloodId && route.endAtBlood) t += ctx.graph.travel(cur, ctx.bloodId);
  return t;
}

function insertionOptions(route, obj, work, ctx) {
  let best = null;
  const minIndex = route.fixedPrefix;
  for (let i = minIndex; i <= route.steps.length; i++) {
    const steps = [...route.steps.slice(0, i), { ...obj, work }, ...route.steps.slice(i)];
    const t = routeTime({ ...route, steps }, ctx);
    if (!best || t < best.t) best = { i, t };
  }
  return best;
}

function twoOpt(route, ctx) {
  let improved = true;
  let bestT = routeTime(route, ctx);
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = route.fixedPrefix; i < route.steps.length - 1; i++) {
      for (let j = i + 1; j < route.steps.length; j++) {
        const steps = [...route.steps.slice(0, i), ...route.steps.slice(i, j + 1).reverse(), ...route.steps.slice(j + 1)];
        const t = routeTime({ ...route, steps }, ctx);
        if (t + 0.01 < bestT) {
          route.steps = steps;
          bestT = t;
          improved = true;
        }
      }
    }
  }
  return route;
}

function assign(objectives, players, ctx, seeds) {
  const routes = Object.fromEntries(players.map((p) => [p.id, p.route]));
  const work = (o, pid) => objectiveSeconds(o, ctx, getClass(ctx.playerById[pid].class));
  const pending = [];
  // Seeds (locked assignments and the adopted plan) are inserted first.
  for (const o of objectives) {
    const pid = seeds[o.id];
    if (pid && routes[pid]) {
      const w = work(o, pid);
      const opt = insertionOptions(routes[pid], o, w, ctx);
      if (Number.isFinite(opt.t)) routes[pid].steps.splice(opt.i, 0, { ...o, work: w, seeded: true });
      else pending.push(o);
    } else pending.push(o);
  }
  const times = () => Object.fromEntries(Object.entries(routes).map(([pid, r]) => [pid, routeTime(r, ctx)]));
  while (pending.length) {
    const cur = times();
    const makespan = Math.max(...Object.values(cur));
    let best = null;
    for (let oi = 0; oi < pending.length; oi++) {
      const o = pending[oi];
      for (const pid of Object.keys(routes)) {
        const w = work(o, pid);
        const opt = insertionOptions(routes[pid], o, w, ctx);
        if (!Number.isFinite(opt.t)) continue;
        const delta = opt.t - cur[pid];
        const pref = ctx.preference(o, pid);
        const score = Math.max(opt.t, makespan) + delta * pref;
        if (!best || score < best.score) best = { oi, pid, i: opt.i, w, score };
      }
    }
    if (!best) break; // remaining objectives unreachable
    const [o] = pending.splice(best.oi, 1);
    routes[best.pid].steps.splice(best.i, 0, { ...o, work: best.w });
  }
  for (const r of Object.values(routes)) twoOpt(r, ctx);
  relocate(routes, ctx, work);
  return { routes, unreachable: pending };
}

// Move steps off the slowest route while that lowers the makespan. Locked
// and seeded (adopted-plan) steps stay put so the plan remains stable.
function relocate(routes, ctx, work) {
  for (let iter = 0; iter < 60; iter++) {
    const times = Object.fromEntries(Object.entries(routes).map(([pid, r]) => [pid, routeTime(r, ctx)]));
    const slowId = Object.keys(times).reduce((a, b) => (times[a] >= times[b] ? a : b));
    const slow = routes[slowId];
    const makespan = times[slowId];
    let best = null;
    for (let i = slow.fixedPrefix; i < slow.steps.length; i++) {
      const step = slow.steps[i];
      if (step.seeded) continue;
      const without = { ...slow, steps: slow.steps.filter((_, k) => k !== i) };
      const slowT = routeTime(without, ctx);
      for (const pid of Object.keys(routes)) {
        if (pid === slowId) continue;
        const w = work(step, pid);
        const opt = insertionOptions(routes[pid], step, w, ctx);
        if (!Number.isFinite(opt.t)) continue;
        const others = Object.keys(times).filter((k) => k !== slowId && k !== pid).map((k) => times[k]);
        const newMax = Math.max(slowT, opt.t, ...others);
        if (newMax < makespan - 1 && (!best || newMax < best.newMax)) best = { i, pid, opt, w, newMax };
      }
    }
    if (!best) return;
    const [step] = slow.steps.splice(best.i, 1);
    routes[best.pid].steps.splice(best.opt.i, 0, { ...step, work: best.w });
    twoOpt(routes[best.pid], ctx);
    twoOpt(slow, ctx);
  }
}

function materialize(route, ctx, elapsed) {
  let t = route.delay;
  let cur = route.start;
  const steps = [];
  for (const s of route.steps) {
    const travel = ctx.graph.travel(cur, s.at) + (s.kind === 'explore' ? TRAVEL.cellSec : 0);
    const path = ctx.graph.path(cur, s.at) ?? [];
    const doors = pathDoors(ctx.map, path);
    const startsAt = t + travel;
    t = startsAt + s.work;
    steps.push({
      kind: s.kind,
      objectiveId: s.id,
      roomId: s.roomId,
      cell: s.cell ?? null,
      at: s.at,
      path,
      travelSec: Math.round(travel),
      workSec: Math.round(s.work),
      startsAt: Math.round(elapsed + startsAt),
      endsAt: Math.round(elapsed + t),
      secrets: s.secrets,
      crypts: s.crypts,
      confidence: s.kind === 'explore' ? 'unknown' : doors.some((d) => d.type === 'assumed') ? 'assumed-path' : s.confidence,
    });
    cur = s.at;
  }
  return steps;
}

function computeRoutes(state, ctx, sc, { seeds, rusher, elapsed }) {
  const { floor } = ctx;
  // Once the boss starts the map is finished: nothing left to route.
  const clearing = state.phase === 'setup' || state.phase === 'clearing';
  const { objectives, plannedSecrets, secretsShortBy, cryptsShortBy } = clearing
    ? selectSecretsAndCrypts(buildObjectives(state, ctx), state, sc)
    : { objectives: [], plannedSecrets: 0, secretsShortBy: 0, cryptsShortBy: 0 };
  const fallbackStart = Object.values(state.map.rooms).find((r) => r.type === 'entrance')?.id ?? ctx.graph.ids[0];
  const players = state.party.map((p) => {
    const start = p.location && state.map.rooms[p.location] ? p.location : fallbackStart;
    return {
      id: p.id,
      route: {
        start,
        delay: p.alive ? 0 : TRAVEL.deadPlayerSec,
        steps: [],
        fixedPrefix: 0,
        endAtBlood: true,
      },
    };
  });

  // A rusher who already opened blood camps it before taking more rooms.
  if (rusher && ctx.bloodId && state.bloodOpened && !state.bloodCleared && state.phase === 'clearing') {
    const pr = players.find((p) => p.id === rusher.id);
    pr.route.start = ctx.bloodId;
    pr.route.delay += floor.bloodCampSec;
  }

  // Blood rush prefix: travel the rusher to blood and open it first.
  let rushInfo = null;
  if (rusher && ctx.bloodId && !state.bloodOpened && state.phase !== 'boss') {
    const pr = players.find((p) => p.id === rusher.id);
    const path = ctx.graph.path(pr.route.start, ctx.bloodId);
    if (path) {
      const doors = pathDoors(ctx.map, path);
      const locked = doors.filter((d) => d.type === 'wither' && !d.opened).length;
      const keyRooms = Object.values(state.map.rooms).filter((r) => r.hasWitherKey && r.state !== 'cleared');
      const travel = ctx.graph.travel(pr.route.start, ctx.bloodId);
      rushInfo = {
        playerId: rusher.id,
        path,
        travelSec: Math.round(travel),
        witherDoors: locked,
        keysHeld: state.witherKeys,
        keysMissing: Math.max(0, locked - state.witherKeys - keyRooms.length),
        keyRooms: keyRooms.map((r) => r.id),
        assumedDoors: doors.filter((d) => d.type === 'assumed').length,
      };
      // Rusher fetches key rooms first when short on keys.
      const keysNeeded = Math.max(0, locked - state.witherKeys);
      const keyObjs = objectives
        .filter((o) => o.kind === 'clear' && state.map.rooms[o.roomId].hasWitherKey)
        .sort((a, b) => ctx.graph.travel(pr.route.start, a.at) - ctx.graph.travel(pr.route.start, b.at))
        .slice(0, keysNeeded);
      for (const o of keyObjs) {
        const w = objectiveSeconds(o, ctx, getClass(rusher.class));
        pr.route.steps.push({ ...o, work: w, keyFetch: true });
      }
      // The rush itself is modeled as a step whose position is blood.
      pr.route.steps.push({ id: '__rush__', kind: 'rush', roomId: ctx.bloodId, at: ctx.bloodId, secrets: 0, crypts: 0, work: 3, confidence: rushInfo.assumedDoors ? 'assumed-path' : 'confirmed' });
      pr.route.fixedPrefix = pr.route.steps.length;
      for (const o of keyObjs) objectives.splice(objectives.indexOf(o), 1);
    }
  }

  const playerById = Object.fromEntries(state.party.map((p) => [p.id, p]));
  const puzzleSolver = resolvePuzzleSolver(state);
  const lockedSeeds = {};
  for (const [rid, a] of Object.entries(state.assignments)) if (a.locked) lockedSeeds[rid] = a.playerId;
  const allSeeds = { ...seeds, ...lockedSeeds };
  ctx.playerById = playerById;
  ctx.preference = (o, pid) => {
    let w = 1;
    if (o.kind === 'puzzle' && puzzleSolver) w *= pid === puzzleSolver.id ? 0.5 : 1.3;
    if (rusher && pid === rusher.id) w *= 1.15; // rusher should keep capacity for the camp
    return w;
  };
  const { routes, unreachable } = assign(objectives, players, ctx, allSeeds);

  const out = {};
  for (const p of players) {
    const r = routes[p.id];
    const steps = materialize(r, ctx, elapsed);
    out[p.id] = {
      playerId: p.id,
      start: r.start,
      steps,
      estSec: Math.round(routeTime(r, ctx)),
      finishAt: Math.round(elapsed + routeTime(r, ctx)),
    };
  }
  return { routes: out, rushInfo, objectives, plannedSecrets, secretsShortBy, cryptsShortBy, unreachable, puzzleSolver };
}

function assignmentsOf(routes) {
  const out = {};
  for (const r of Object.values(routes)) for (const s of r.steps) if (s.objectiveId && s.kind !== 'rush') out[s.objectiveId] = r.playerId;
  return out;
}

function timeline(state, ctx, routes, rushInfo, elapsed) {
  const { floor } = ctx;
  const finishTimes = Object.values(routes).map((r) => r.finishAt);
  const clearDoneAt = finishTimes.length ? Math.max(elapsed, ...finishTimes) : elapsed;
  let campStart;
  if (state.bloodCleared) campStart = null;
  else if (state.bloodOpened) campStart = elapsed;
  else if (rushInfo) {
    const rushStep = routes[rushInfo.playerId].steps.find((s) => s.kind === 'rush');
    campStart = rushStep ? rushStep.endsAt : clearDoneAt;
  } else campStart = clearDoneAt;
  const bloodDoneAt = state.bloodCleared ? elapsed : Math.max(campStart + floor.bloodCampSec, elapsed);
  const portalSec = 8;
  let bossStartAt = Math.max(clearDoneAt, bloodDoneAt) + portalSec;
  let bossRemaining = floor.bossSec;
  if (state.phase === 'boss') {
    bossStartAt = elapsed;
    const phases = floor.boss.phases.filter((p) => !p.masterOnly || floor.master);
    const idx = Math.max(0, phases.findIndex((p) => p.id === state.bossPhase));
    bossRemaining = Math.round(floor.bossSec * (1 - idx / phases.length));
  }
  if (state.phase === 'complete') return { clearDoneAt: elapsed, bloodDoneAt: elapsed, bossStartAt: elapsed, finishAt: elapsed, campStart: null };
  return {
    clearDoneAt: Math.round(clearDoneAt),
    campStart: campStart == null ? null : Math.round(campStart),
    bloodDoneAt: Math.round(bloodDoneAt),
    bossStartAt: Math.round(bossStartAt),
    finishAt: Math.round(bossStartAt + bossRemaining),
  };
}

function projectScore(state, ctx, sc, result, tl, elapsed) {
  const rooms = Object.values(state.map.rooms);
  const failed = rooms.filter((r) => r.type === 'puzzle' && r.puzzleResult === 'failed').length;
  const unreachablePuzzles = result.unreachable.filter((o) => o.kind === 'puzzle').length;
  const expectedUnknownPuzzles = Math.max(0, ctx.floor.expectedPuzzles - rooms.filter((r) => r.type === 'puzzle').length);
  const plannedCrypts = Object.values(result.routes).reduce((s, r) => s + r.steps.reduce((a, x) => a + (x.crypts ?? 0), 0), 0);
  const base = {
    totalRooms: sc.totalRoomsEst,
    deaths: state.deaths,
    spiritPet: state.spiritPetUsed,
    failedPuzzles: failed,
    totalSecrets: sc.totalSecretsEst,
    mimic: state.mimic,
    prince: state.prince,
    ezpz: state.strategy.ezpz,
  };
  const current = computeScore(state.floorId, {
    ...base,
    clearedRooms: sc.clearedRooms,
    secretsFound: sc.secretsFound,
    crypts: state.crypts,
    elapsedSec: elapsed,
    bossKilled: state.phase === 'complete' ? state.bossKilled : true,
  });
  const reachableRooms = sc.totalRoomsEst - result.unreachable.filter((o) => o.kind !== 'explore' && o.kind !== 'secrets').length;
  const projected = computeScore(state.floorId, {
    ...base,
    failedPuzzles: failed + unreachablePuzzles,
    clearedRooms: state.phase === 'complete' ? sc.clearedRooms : reachableRooms,
    secretsFound: sc.secretsFound + (state.phase === 'complete' ? 0 : result.plannedSecrets),
    crypts: state.crypts + plannedCrypts,
    elapsedSec: tl.finishAt,
    bossKilled: state.phase === 'complete' ? state.bossKilled : true,
  });
  // Penalty points the plan already counts on vs. those still at risk.
  // Speed is computed with the *real* elapsed for "current" to show the trend.
  return {
    current,
    projected,
    deathPenaltyApplied: state.deathPenalty,
    unknownPuzzlesExpected: expectedUnknownPuzzles,
    mimicAvailable: ctx.floor.mimicBonus && !state.mimic,
  };
}

function confidenceOf(state, ctx, sc, rushInfo) {
  const mapC = M.completeness(state.map);
  const edges = Object.values(ctx.graph.edges).flat();
  const recorded = edges.length ? edges.filter((e) => e.recorded).length / edges.length : 0;
  const doorC = 0.6 + 0.4 * recorded; // assumed doors are usually right
  const secretC = Math.min(1, 0.4 + 0.6 * sc.secretConfidence);
  const timeC = 0.55 + 0.25 * mapC + (rushInfo && rushInfo.assumedDoors === 0 ? 0.1 : 0);
  const overall = mapC * 0.4 + doorC * 0.2 + secretC * 0.2 + timeC * 0.2;
  const level = (v) => (v >= 0.8 ? 'high' : v >= 0.55 ? 'medium' : 'low');
  return {
    map: { value: round2(mapC), level: level(mapC) },
    doors: { value: round2(doorC), level: level(doorC) },
    secrets: { value: round2(secretC), level: level(secretC) },
    time: { value: round2(timeC), level: level(timeC) },
    overall: { value: round2(overall), level: level(overall) },
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function diagnostics(state, ctx, sc, primary, fresh, tl, score, elapsed) {
  const warnings = [];
  const floor = ctx.floor;
  const target = state.strategy.target;
  const targetPts = target === 'complete' ? 0 : gradeThreshold(target);
  const push = (w) => warnings.push(w);

  if (fresh && state.adoptedPlan) {
    const a = Math.max(0, ...Object.values(primary.routes).map((r) => r.estSec));
    const b = Math.max(0, ...Object.values(fresh.routes).map((r) => r.estSec));
    const savings = a - b;
    if (savings > Math.max(15, a * 0.08)) {
      push({
        id: 'rebalance',
        severity: 'high',
        title: `Current plan is inefficient: rebalancing saves ~${Math.round(savings)}s`,
        detail: 'Room discoveries or party changes made the adopted assignment slower than a fresh one. Adopt the optimized plan to apply it.',
        action: { type: 'plan_adopt', assignments: assignmentsOf(fresh.routes) },
      });
    }
  }

  const deadline = fullSpeedDeadline(state.floorId);
  if (tl.finishAt > deadline && state.phase !== 'complete') {
    const lost = 100 - speedScore(state.floorId, tl.finishAt);
    const tips = [];
    if (state.strategy.secretMode === 'all') tips.push('Switch secrets to "target" mode - collect only what the requirement needs.');
    if (!state.bloodOpened && primary.rushInfo == null && ctx.bloodId) tips.push('Assign a blood rusher so the camp overlaps clearing.');
    if (primary.cryptsShortBy === 0 && state.crypts < (state.strategy.cryptTarget ?? 5)) tips.push('Crypt detours cost time; skip crypts in revisits.');
    tips.push('Drop revisits of cleared rooms; collect secrets only in rooms still to clear.');
    push({
      id: 'behind_schedule',
      severity: lost >= 5 ? 'high' : 'medium',
      title: `Projected finish ${fmt(tl.finishAt)} exceeds the full-speed limit ${fmt(deadline)} (-${lost} speed)`,
      detail: tips.join(' '),
    });
  }

  if (primary.secretsShortBy > 0) {
    push({
      id: 'secrets_short',
      severity: sc.unknownCells > 0 ? 'medium' : 'high',
      title: `Known rooms are ${primary.secretsShortBy} secret(s) short of the requirement`,
      detail: sc.unknownCells > 0
        ? 'Explore the unknown part of the map - undiscovered rooms should hold the rest.'
        : 'Every known secret is planned. Correct room secret totals if they are wrong, or accept a lower explore score.',
    });
  }

  if (target !== 'complete' && score.projected.total < targetPts && state.phase !== 'complete') {
    const p = score.projected;
    const missing = [];
    if (p.skill < 100) missing.push(`skill ${p.skill}/100 (deaths/puzzles)`);
    if (p.explore < 100) missing.push(`explore ${p.explore}/100`);
    if (p.speed < 100) missing.push(`speed ${p.speed}/100`);
    if (p.bonus < 5) missing.push(`bonus ${p.bonus} (crypts ${state.crypts}/5)`);
    push({
      id: 'score_short',
      severity: 'high',
      title: `Projected ${p.total} (${p.grade}) is below ${target} (${targetPts})`,
      detail: `Missing: ${missing.join(', ')}.${score.mimicAvailable ? ' Killing the Mimic adds 2.' : ''}`,
    });
  }

  if (primary.cryptsShortBy > 0 && state.phase === 'clearing') {
    push({
      id: 'crypts_short',
      severity: 'low',
      title: `Crypts ${state.crypts}/5 - no known crypts left for ${primary.cryptsShortBy}`,
      detail: 'Record crypt counts on rooms as you see them so the planner can route through them.',
    });
  }

  const ests = Object.values(primary.routes).map((r) => r.estSec);
  if (ests.length > 1) {
    const max = Math.max(...ests);
    const min = Math.min(...ests);
    if (max - min > 45 && max > min * 1.8) {
      const slow = Object.values(primary.routes).find((r) => r.estSec === max);
      push({ id: 'imbalance', severity: 'medium', title: `Route imbalance: ${nameOf(state, slow.playerId)} has ${max - min}s more work`, detail: 'Hand one of their rooms to the least-loaded player or adopt the optimized plan.' });
    }
  }

  for (const r of Object.values(primary.routes)) {
    const p = state.party.find((x) => x.id === r.playerId);
    if (!p.alive) push({ id: `dead_${p.id}`, severity: 'high', title: `${p.name} is dead`, detail: 'Revive before continuing - routes include a revive delay.' });
  }

  if (!ctx.bloodId && elapsed > 60 && state.phase === 'clearing') {
    push({ id: 'blood_unknown', severity: 'medium', title: 'Blood room not located', detail: 'Explore the unknown edges of the map first; the blood room is usually far from the entrance.' });
  }

  if (M.completeness(state.map) < 0.7 && elapsed > 120 && state.phase === 'clearing') {
    push({ id: 'map_incomplete', severity: 'medium', title: `Only ${Math.round(M.completeness(state.map) * 100)}% of the map is known`, detail: 'Room count and secret totals are estimates; add discovered rooms to firm up the plan.' });
  }

  if (primary.rushInfo?.keysMissing > 0) {
    push({ id: 'keys_missing', severity: 'medium', title: `Blood path needs ${primary.rushInfo.keysMissing} more wither key(s)`, detail: 'Mark rooms that hold wither keys, or record the doors if they are not wither doors.' });
  }

  const failed = Object.values(state.map.rooms).filter((r) => r.puzzleResult === 'failed');
  if (failed.length) {
    push({ id: 'puzzle_failed', severity: 'medium', title: `${failed.length} puzzle(s) failed (-${failed.length * 14} skill)`, detail: 'Recover the points elsewhere: all 5 crypts, Mimic (F6+), and full secret requirement.' });
  }

  if (primary.unreachable.length) {
    push({ id: 'unreachable', severity: 'medium', title: `${primary.unreachable.length} objective(s) unreachable on the known map`, detail: 'A door is probably marked as a wall, or a connecting room is missing. Correct the map.' });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return warnings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const nameOf = (state, id) => state.party.find((p) => p.id === id)?.name ?? id;
export function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function computePlan(state, { nowMs = Date.now(), elapsed } = {}) {
  const floor = getFloor(state.floorId);
  const t = elapsed ?? elapsedSec(state, nowMs);
  const graph = buildGraph(state.map);
  const blood = Object.values(state.map.rooms).find((r) => r.type === 'blood');
  const ctx = { floor, map: state.map, graph, bloodId: blood?.id ?? null };
  const sc = scoreContext(state, floor);
  const rusher = resolveRusher(state, ctx);

  if (!graph.ids.length) {
    return {
      elapsed: Math.round(t),
      empty: true,
      routes: {},
      warnings: [{ id: 'empty_map', severity: 'high', title: 'Map is empty', detail: 'Add the entrance room to start planning.' }],
      score: null,
      timeline: null,
      confidence: null,
      scoreContext: sc,
      roles: { bloodRusher: rusher?.id ?? null, puzzleSolver: resolvePuzzleSolver(state)?.id ?? null },
    };
  }

  const seeds = state.adoptedPlan ?? {};
  const primary = computeRoutes(state, ctx, sc, { seeds, rusher, elapsed: t });
  const fresh = state.adoptedPlan ? computeRoutes(state, ctx, sc, { seeds: {}, rusher, elapsed: t }) : null;
  const tl = timeline(state, ctx, primary.routes, primary.rushInfo, t);
  const score = projectScore(state, ctx, sc, primary, tl, t);
  const warnings = diagnostics(state, ctx, sc, primary, fresh, tl, score, t);

  return {
    elapsed: Math.round(t),
    routes: primary.routes,
    assignments: assignmentsOf(primary.routes),
    rush: primary.rushInfo,
    roles: { bloodRusher: rusher?.id ?? null, puzzleSolver: primary.puzzleSolver?.id ?? null },
    secrets: {
      found: sc.secretsFound,
      required: sc.secretsRequired,
      totalEst: sc.totalSecretsEst,
      planned: primary.plannedSecrets,
      shortBy: primary.secretsShortBy,
    },
    crypts: { blown: state.crypts, target: state.strategy.cryptTarget ?? 5, shortBy: primary.cryptsShortBy },
    rooms: { known: sc.knownRooms, totalEst: sc.totalRoomsEst, cleared: sc.clearedRooms },
    unreachable: primary.unreachable.map((o) => o.id),
    timeline: tl,
    score,
    confidence: confidenceOf(state, ctx, sc, primary.rushInfo),
    warnings,
    scoreContext: sc,
  };
}
