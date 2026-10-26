// Scenario runner: replays a documented dungeon scenario through the real
// session manager and checks expectations at each step. Used by the test
// suite and by `npm run scenarios`.
//
// Scenario format (JSON):
// {
//   "name": "...", "description": "...", "floor": "F5",
//   "party": [{ "id": "p1", "class": "mage", "isSelf": true }, ...],
//   "strategy": { ... },
//   "layout": ["E A A .", ...],          // optional initial map; "." = unknown
//   "rooms": { "E": { "type": "entrance" }, "A": { "secretsTotal": 4 } },
//   "steps": [{ "note": "...", "elapsed": 30, "events": [...], "layout": [...], "expect": { ... } }]
// }
// A step's "layout" adds any rooms that are not on the map yet (discoveries).

import fs from 'node:fs';
import path from 'node:path';
import { SessionManager, MemoryStore } from './session.js';
import { gradeThreshold } from './engine/score.js';

const START_MS = 1_700_000_000_000;

export function layoutToRooms(layout, roomDefs = {}, existing = {}) {
  const cells = {};
  layout.forEach((line, y) => {
    line.trim().split(/\s+/).forEach((tok, x) => {
      if (tok === '.') return;
      (cells[tok] ??= []).push([x, y]);
    });
  });
  return Object.entries(cells)
    .filter(([id]) => !existing[id])
    .map(([id, c]) => ({ type: 'room_add', room: { id, cells: c, ...(roomDefs[id] ?? {}) } }));
}

export function runScenario(sc) {
  let now = START_MS;
  const mgr = new SessionManager(new MemoryStore(), { now: () => now });
  const grid = sc.grid ?? (sc.layout ? { w: sc.layout[0].trim().split(/\s+/).length, h: sc.layout.length } : undefined);
  const id = mgr.create({ name: sc.name, floorId: sc.floor, party: sc.party, strategy: sc.strategy ?? {}, grid });
  if (sc.layout) mgr.apply(id, layoutToRooms(sc.layout, sc.rooms));
  const results = [];
  for (const [i, step] of (sc.steps ?? []).entries()) {
    now = START_MS + (step.elapsed ?? 0) * 1000;
    const events = [];
    if (step.layout) events.push(...layoutToRooms(step.layout, { ...(sc.rooms ?? {}), ...(step.rooms ?? {}) }, mgr.get(id).state.map.rooms));
    events.push(...(step.events ?? []));
    let error = null;
    try {
      if (events.length) mgr.apply(id, events);
    } catch (err) {
      error = err.message;
    }
    const view = mgr.view(id);
    const failures = [];
    if (error && !step.expectError) failures.push(`events rejected: ${error}`);
    if (step.expectError && !error) failures.push(`expected events to be rejected (${step.expectError})`);
    if (step.expectError && error && !error.includes(step.expectError)) failures.push(`expected error containing "${step.expectError}", got "${error}"`);
    checkExpectations(view, step.expect ?? {}, failures);
    results.push({ index: i + 1, note: step.note ?? '', elapsed: step.elapsed ?? 0, failures, summary: summarize(view) });
  }
  return { name: sc.name, description: sc.description, results, ok: results.every((r) => !r.failures.length) };
}

function summarize(view) {
  const { plan, advice, state } = view;
  return {
    phase: state.phase,
    projected: plan.score ? `${plan.score.projected.total} ${plan.score.projected.grade}` : null,
    finish: plan.timeline?.finishAt ?? null,
    warnings: (plan.warnings ?? []).map((w) => w.id),
    actions: Object.fromEntries(state.party.map((p) => [p.id, `${p.class}: ${advice[p.id].action.title}`])),
    routes: Object.fromEntries(Object.entries(plan.routes ?? {}).map(([pid, r]) => [pid, r.steps.map((s) => s.kind === 'explore' ? `?${s.cell}` : s.kind === 'rush' ? 'RUSH' : s.roomId)])),
  };
}

function checkExpectations(view, ex, failures) {
  const { plan, advice, state } = view;
  const fail = (m) => failures.push(m);
  const warnIds = (plan.warnings ?? []).map((w) => w.id);
  const roomsInRoutes = new Set(Object.values(plan.routes ?? {}).flatMap((r) => r.steps.map((s) => s.roomId)).filter(Boolean));

  if (ex.phase && state.phase !== ex.phase) fail(`phase ${state.phase} != ${ex.phase}`);
  if (ex.rusher !== undefined && plan.roles?.bloodRusher !== ex.rusher) fail(`rusher ${plan.roles?.bloodRusher} != ${ex.rusher}`);
  if (ex.puzzleSolver && plan.roles?.puzzleSolver !== ex.puzzleSolver) fail(`puzzle solver ${plan.roles?.puzzleSolver} != ${ex.puzzleSolver}`);
  for (const w of ex.warnings ?? []) if (!warnIds.includes(w)) fail(`missing warning "${w}" (have: ${warnIds.join(', ') || 'none'})`);
  for (const w of ex.noWarnings ?? []) if (warnIds.includes(w)) fail(`unexpected warning "${w}"`);
  for (const [rid, pid] of Object.entries(ex.assignedTo ?? {})) {
    if (plan.assignments?.[rid] !== pid) fail(`${rid} assigned to ${plan.assignments?.[rid]} instead of ${pid}`);
  }
  for (const rid of ex.planned ?? []) if (!roomsInRoutes.has(rid)) fail(`room ${rid} is not on any route`);
  for (const rid of ex.notPlanned ?? []) if (roomsInRoutes.has(rid)) fail(`room ${rid} should not be on any route`);
  if (ex.allRoomsPlanned) {
    for (const r of Object.values(state.map.rooms)) {
      if (r.state === 'cleared' || r.type === 'entrance' || r.type === 'blood') continue;
      if (!roomsInRoutes.has(r.id)) fail(`uncleared room ${r.id} is not on any route`);
    }
  }
  if (ex.exploring != null) {
    const n = Object.values(plan.routes ?? {}).flatMap((r) => r.steps).filter((s) => s.kind === 'explore').length;
    if (ex.exploring && !n) fail('expected exploration steps');
    if (!ex.exploring && n) fail(`expected no exploration steps, found ${n}`);
  }
  for (const [pid, a] of Object.entries(ex.actions ?? {})) {
    const act = advice[pid]?.action;
    if (!act) { fail(`no advice for ${pid}`); continue; }
    if (a.type && act.type !== a.type) fail(`${pid} action ${act.type} ("${act.title}") != ${a.type}`);
    if (a.titleIncludes && !act.title.includes(a.titleIncludes)) fail(`${pid} action title "${act.title}" lacks "${a.titleIncludes}"`);
    if (a.roomId && act.roomId !== a.roomId) fail(`${pid} action room ${act.roomId} != ${a.roomId}`);
  }
  if (ex.gradeAtLeast) {
    const t = plan.score?.projected.total ?? 0;
    if (t < gradeThreshold(ex.gradeAtLeast)) fail(`projected ${t} below ${ex.gradeAtLeast}`);
  }
  if (ex.gradeBelow) {
    const t = plan.score?.projected.total ?? 0;
    if (t >= gradeThreshold(ex.gradeBelow)) fail(`projected ${t} not below ${ex.gradeBelow}`);
  }
  if (ex.secretsPlannedAtLeast != null && (plan.secrets?.planned ?? 0) < ex.secretsPlannedAtLeast) fail(`planned secrets ${plan.secrets?.planned} < ${ex.secretsPlannedAtLeast}`);
  if (ex.revisits) {
    const rv = Object.values(plan.routes).flatMap((r) => r.steps).filter((s) => s.kind === 'secrets').map((s) => s.roomId);
    for (const rid of ex.revisits) if (!rv.includes(rid)) fail(`expected a secret revisit of ${rid} (have ${rv.join(', ') || 'none'})`);
  }
  if (ex.finishBefore != null && plan.timeline.finishAt >= ex.finishBefore) fail(`finish ${plan.timeline.finishAt}s not before ${ex.finishBefore}s`);
  if (ex.finishAfter != null && plan.timeline.finishAt <= ex.finishAfter) fail(`finish ${plan.timeline.finishAt}s not after ${ex.finishAfter}s`);
  if (ex.maxRouteSpread != null) {
    const est = Object.values(plan.routes).map((r) => r.estSec);
    const spread = Math.max(...est) - Math.min(...est);
    if (spread > ex.maxRouteSpread) fail(`route spread ${spread}s > ${ex.maxRouteSpread}s`);
  }
  if (ex.partySize != null && state.party.length !== ex.partySize) fail(`party size ${state.party.length} != ${ex.partySize}`);
  if (ex.distinctClassAdvice) {
    const texts = state.party.map((p) => JSON.stringify(advice[p.id].plan.sections.map((s) => s.items.map((i) => i.text))));
    if (new Set(texts).size !== texts.length) fail('two players received identical execution plans');
  }
  for (const [pid, text] of Object.entries(ex.planIncludes ?? {})) {
    const all = advice[pid].plan.sections.flatMap((s) => s.items.map((i) => i.text)).join('\n');
    if (!all.includes(text)) fail(`${pid}'s plan lacks "${text}"`);
  }
  if (ex.recoveryFor) for (const pid of ex.recoveryFor) if (!advice[pid].recovery.length) fail(`${pid} has no recovery advice`);
  if (ex.adopted != null && Boolean(state.adoptedPlan) !== ex.adopted) fail(`adopted plan ${Boolean(state.adoptedPlan)} != ${ex.adopted}`);
  if (ex.unreachable != null) {
    if (ex.unreachable === 0 && plan.unreachable.length) fail(`unexpected unreachable: ${plan.unreachable.join(', ')}`);
    if (ex.unreachable > 0 && plan.unreachable.length < ex.unreachable) fail(`expected ${ex.unreachable} unreachable, got ${plan.unreachable.length}`);
  }
}

export function loadScenarios(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}
