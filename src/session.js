// Session manager: owns sessions, validates and persists events, and
// recomputes the plan after every change. Sessions are stored as JSON files
// (one per session) so a restart resumes exactly where the run left off.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { initialState, applyEvent, replay, EventError, validateParty, elapsedSec } from './engine/state.js';
import { computePlan } from './engine/route.js';
import { advise } from './engine/advisor.js';
import { terminalAssignments } from './engine/plans.js';
import { getFloor } from './data/floors.js';

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Invalid session id');
    return path.join(this.dir, `${id}.json`);
  }
  load(id) {
    const f = this.file(id);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  }
  save(session) {
    const f = this.file(session.id);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(session, null, 1));
    fs.renameSync(tmp, f);
  }
  delete(id) {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  list() {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  }
}

export class MemoryStore {
  constructor() { this.m = new Map(); }
  load(id) { return this.m.has(id) ? structuredClone(this.m.get(id)) : null; }
  save(s) { this.m.set(s.id, structuredClone(s)); }
  delete(id) { this.m.delete(id); }
  list() { return [...this.m.keys()]; }
}

export class SessionManager extends EventEmitter {
  constructor(store, { now = () => Date.now() } = {}) {
    super();
    this.store = store;
    this.now = now;
    this.cache = new Map(); // id -> { session, state }
  }

  create({ name, floorId, party, strategy = {}, grid } = {}) {
    const floor = getFloor(floorId ?? 'F7');
    validateParty(party ?? []);
    const init = { floorId: floor.id, party, strategy, grid: grid ?? floor.grid };
    initialState(init); // validates
    const session = {
      id: crypto.randomUUID(),
      name: name || `${floor.name} run`,
      createdAt: this.now(),
      updatedAt: this.now(),
      init,
      events: [],
      undone: [],
    };
    this.store.save(session);
    this.cache.set(session.id, { session, state: replay(init, []) });
    return session.id;
  }

  get(id) {
    let c = this.cache.get(id);
    if (!c) {
      const session = this.store.load(id);
      if (!session) return null;
      c = { session, state: replay(session.init, session.events) };
      this.cache.set(id, c);
    }
    return c;
  }

  list() {
    return this.store.list().map((id) => {
      const c = this.get(id);
      return c && { id, name: c.session.name, floorId: c.state.floorId, phase: c.state.phase, updatedAt: c.session.updatedAt, party: c.state.party.map((p) => ({ name: p.name, class: p.class })) };
    }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Applies events atomically: either all are valid and stored, or none.
  apply(id, events) {
    const c = this.get(id);
    if (!c) throw new EventError('Unknown session');
    const list = Array.isArray(events) ? events : [events];
    const draft = structuredClone(c.state);
    const stamped = [];
    for (const raw of list) {
      const ev = { ...raw, at: raw.at ?? this.now(), seq: c.session.events.length + stamped.length + 1 };
      applyEvent(draft, ev);
      stamped.push(ev);
    }
    // Lock in the plan at run start so later discoveries extend it instead of
    // reshuffling everyone's route.
    if (stamped.some((e) => e.type === 'run_start') && !draft.adoptedPlan) {
      const plan = computePlan(draft, { nowMs: stamped.at(-1).at });
      if (!plan.empty) {
        const ev = { type: 'plan_adopt', assignments: plan.assignments, auto: true, at: stamped.at(-1).at, seq: c.session.events.length + stamped.length + 1 };
        applyEvent(draft, ev);
        stamped.push(ev);
      }
    }
    c.session.events.push(...stamped);
    c.session.undone = [];
    c.session.updatedAt = this.now();
    c.state = draft;
    this.store.save(c.session);
    this.emit('change', id);
    return stamped;
  }

  undo(id) {
    const c = this.get(id);
    if (!c || !c.session.events.length) return null;
    const ev = c.session.events.pop();
    const removed = [ev];
    // An auto-adopt is part of the run_start that triggered it.
    if (ev.type === 'plan_adopt' && ev.auto && c.session.events.at(-1)?.type === 'run_start') removed.unshift(c.session.events.pop());
    c.session.undone.push(...removed.reverse());
    c.state = replay(c.session.init, c.session.events);
    c.session.updatedAt = this.now();
    this.store.save(c.session);
    this.emit('change', id);
    return removed;
  }

  redo(id) {
    const c = this.get(id);
    if (!c || !c.session.undone.length) return null;
    const ev = c.session.undone.pop();
    const toApply = [ev];
    if (ev.type === 'run_start' && c.session.undone.at(-1)?.auto) toApply.push(c.session.undone.pop());
    const draft = structuredClone(c.state);
    for (const e of toApply) applyEvent(draft, e);
    c.session.events.push(...toApply);
    c.state = draft;
    this.store.save(c.session);
    this.emit('change', id);
    return toApply;
  }

  // Remove a specific past event (correcting a mistaken entry). Fails if the
  // remaining history no longer replays.
  revert(id, seq) {
    const c = this.get(id);
    if (!c) throw new EventError('Unknown session');
    const events = c.session.events.filter((e) => e.seq !== seq);
    if (events.length === c.session.events.length) throw new EventError(`No event #${seq}`);
    const state = replay(c.session.init, events);
    c.session.events = events;
    c.state = state;
    this.store.save(c.session);
    this.emit('change', id);
  }

  remove(id) {
    this.cache.delete(id);
    this.store.delete(id);
  }

  view(id, { playerId, elapsed } = {}) {
    const c = this.get(id);
    if (!c) return null;
    const nowMs = this.now();
    const plan = computePlan(c.state, { nowMs, elapsed });
    const self = c.state.party.find((p) => p.isSelf);
    const advice = Object.fromEntries(c.state.party.map((p) => [p.id, advise(c.state, plan, p.id)]));
    return {
      session: { id, name: c.session.name, createdAt: c.session.createdAt, updatedAt: c.session.updatedAt, canUndo: c.session.events.length > 0, canRedo: c.session.undone.length > 0 },
      state: c.state,
      elapsed: elapsedSec(c.state, nowMs),
      plan,
      selfId: playerId ?? self.id,
      advice,
      terminals: getFloor(c.state.floorId).number === 7 ? terminalAssignments(c.state.floorId, c.state.party, c.state.strategy.terminalOverrides) : null,
      events: c.session.events.slice(-40),
    };
  }
}
