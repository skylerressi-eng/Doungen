// Class-aware execution plans. A plan is composed from the class's general
// guidance, the floor's boss duties, the party composition, the configured
// strategy and the roles the route engine resolved (blood rusher, puzzle
// solver). Each item records where it came from and how confident it is.

import { getClass, CLASS_IDS } from '../data/classes.js';
import { getFloor } from '../data/floors.js';
import { PUZZLES } from '../data/rooms.js';

export const PLAN_SECTIONS = [
  { id: 'initial', label: 'Initial priorities' },
  { id: 'clearing', label: 'Room clearing' },
  { id: 'route', label: 'Route' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'puzzles', label: 'Puzzles & terminals' },
  { id: 'coordination', label: 'Party coordination' },
  { id: 'boss', label: 'Boss' },
  { id: 'recovery', label: 'Recovery when behind' },
];

const item = (text, source, confidence = 'high') => ({ text, source, confidence });

export function terminalAssignments(floorId, party, overrides = {}) {
  const floor = getFloor(floorId);
  const spec = floor.boss.terminals;
  if (!spec) return null;
  const sections = [];
  const deviceOwner = {};
  // Default device owners by class, then explicit overrides.
  for (const dev of spec.devices) {
    const key = `s${dev.section}.device`;
    let owner = overrides[key] ?? null;
    if (!owner) {
      const byClass = party.find((p) => getClass(p.class).floors.F7?.terminals?.device === dev.id && !Object.values(deviceOwner).includes(p.id));
      owner = byClass?.id ?? null;
    }
    deviceOwner[dev.section] = owner;
  }
  // Devices without an owner go to the player with the fewest devices,
  // preferring classes without a default device (Mage).
  for (const dev of spec.devices) {
    if (deviceOwner[dev.section]) continue;
    const counts = Object.fromEntries(party.map((p) => [p.id, Object.values(deviceOwner).filter((x) => x === p.id).length]));
    const pick = [...party].sort((a, b) => counts[a.id] - counts[b.id] || (getClass(a.class).floors.F7.terminals.device ? 1 : 0) - (getClass(b.class).floors.F7.terminals.device ? 1 : 0))[0];
    deviceOwner[dev.section] = pick?.id ?? null;
  }
  for (const dev of spec.devices) {
    const s = dev.section;
    const termCount = spec.terminalsPerSection[s - 1];
    const others = party.filter((p) => p.id !== deviceOwner[s]);
    const pool = others.length ? others : party;
    const terminals = [];
    for (let i = 1; i <= termCount; i++) {
      const key = `s${s}.t${i}`;
      terminals.push({ index: i, playerId: overrides[key] ?? pool[(i - 1 + s - 1) % pool.length].id });
    }
    const load = Object.fromEntries(party.map((p) => [p.id, terminals.filter((t) => t.playerId === p.id).length + (deviceOwner[s] === p.id ? 1 : 0)]));
    const byLoad = [...party].sort((a, b) => load[a.id] - load[b.id]);
    const levers = [];
    for (let i = 1; i <= spec.levers; i++) {
      const key = `s${s}.l${i}`;
      levers.push({ index: i, playerId: overrides[key] ?? byLoad[(i - 1) % byLoad.length].id });
    }
    sections.push({ section: s, device: { ...dev, playerId: deviceOwner[s] }, terminals, levers });
  }
  return { sections, confidence: spec.confidence, note: 'Default split follows common class conventions; parties often use their own - override per slot.' };
}

export function buildExecutionPlan({ classId, floorId, party = [], strategy = {}, playerId = null, roles = {}, plan = null }) {
  const cls = getClass(classId);
  const floor = getFloor(floorId);
  const floorKey = `F${floor.number}`;
  const fdata = cls.floors[floorKey] ?? {};
  const sections = Object.fromEntries(PLAN_SECTIONS.map((s) => [s.id, []]));
  const add = (sec, text, source, confidence) => sections[sec].push(item(text, source, confidence));

  for (const sec of Object.keys(cls.general)) for (const t of cls.general[sec]) add(sec, t, 'class');

  // Floor context
  const pct = Math.round(floor.secretRequirement * 100);
  add('secrets', `${floor.name} needs ${pct}% of all secrets for full explore score.`, 'floor');
  if (floor.number >= 6) add('secrets', 'F6+: secret requirement is high - only skip secrets when you are ahead of the requirement.', 'floor');
  if (floor.mimicBonus) add('clearing', 'Mimic: kill it (+2 bonus). It hides as a chest in a normal room - open suspicious chests with the party ready.', 'floor');
  if (floor.hasTrapRoom) add('route', 'There is a trap room on this floor; route it with your most survivable player.', 'floor');
  add('boss', `${floor.boss.name}: ${floor.boss.summary}`, 'floor');
  for (const t of fdata.boss ?? []) add('boss', t, 'floor', floor.number === 7 ? 'medium' : 'high');
  if (floor.master) for (const t of cls.master ?? []) add('initial', t, 'floor');

  // Party composition
  const classes = party.map((p) => p.class);
  const me = party.find((p) => p.id === playerId);
  const has = (c) => classes.includes(c);
  if (!has('tank') && classes.length > 1) {
    if (classId === 'berserk' || (classId === 'healer' && !has('berserk'))) {
      add('boss', 'No Tank in the party: you hold boss attention between damage windows.', 'party');
    } else add('coordination', 'No Tank: spread out at the boss and do not stand behind the aggro holder.', 'party');
  }
  if (!has('healer') && classes.length > 1) {
    add('recovery', 'No Healer: avoid risky pulls - every death costs 2 skill points and nobody heals.', 'party');
    if (classId === 'tank') add('puzzles', 'No Healer: you are the primary puzzle solver.', 'party');
  }
  const same = classes.filter((c) => c === classId).length;
  if (same > 1) add('coordination', `${same} ${cls.name}s in the party: split by quadrant so you do not overlap rooms.`, 'party');
  if (classes.length === 1) add('initial', 'Solo run: you must clear, rush blood and solve every puzzle - clear toward blood and open it last.', 'party');

  // Strategy
  if (strategy.secretMode === 'all') add('secrets', 'Strategy: collect every secret.', 'strategy');
  else if (strategy.secretMode === 'none') add('secrets', 'Strategy: skip secrets; clear only.', 'strategy');
  else add('secrets', `Strategy: collect the requirement plus ${strategy.secretBuffer ?? 2} buffer, then stop.`, 'strategy');
  if (strategy.splitMode === 'stack') add('route', 'Strategy: stack mode - the party moves together room to room.', 'strategy');
  if (strategy.ezpz) add('coordination', 'Paul EZPZ active: +10 bonus gives room for one failed puzzle or a slow boss.', 'strategy');
  if (strategy.target === 'S+') add('initial', 'Target S+ (300): full clear, full secret requirement, finish under the speed limit, 5 crypts.', 'strategy');

  // Resolved roles
  if (playerId && roles.bloodRusher === playerId) {
    sections.initial.unshift(item('You are the blood rusher: go straight to blood, opening wither doors, then camp.', 'role'));
    if (plan?.rush) sections.route.unshift(item(`Blood path: ${plan.rush.path.join(' → ')} (${plan.rush.witherDoors} wither door(s), ~${plan.rush.travelSec}s).`, 'role', plan.rush.assumedDoors ? 'medium' : 'high'));
  } else if (playerId && roles.bloodRusher && roles.bloodRusher !== playerId) {
    const rusher = party.find((p) => p.id === roles.bloodRusher);
    add('coordination', `${rusher?.name ?? roles.bloodRusher} is rushing blood - clear rooms behind them.`, 'role');
  }
  if (playerId && roles.puzzleSolver === playerId) {
    sections.puzzles.unshift(item('You are the puzzle solver for this run.', 'role'));
    const puzzles = plan?.routes?.[playerId]?.steps.filter((s) => s.kind === 'puzzle') ?? [];
    for (const s of puzzles) sections.puzzles.push(item(`Planned: ${s.roomId}`, 'role'));
  }

  // F7 terminal assignments
  if (floor.number === 7 && party.length) {
    const ta = terminalAssignments(floorId, party, strategy.terminalOverrides ?? {});
    for (const s of ta.sections) {
      const mine = [];
      if (s.device.playerId === playerId) mine.push(`device (${s.device.name})`);
      for (const t of s.terminals) if (t.playerId === playerId) mine.push(`terminal ${t.index}`);
      for (const l of s.levers) if (l.playerId === playerId) mine.push(`lever ${l.index}`);
      if (playerId && mine.length) add('puzzles', `Goldor section ${s.section}: ${mine.join(', ')}.`, 'role', ta.confidence === 'estimated' ? 'medium' : ta.confidence);
    }
  }

  // Character-specific opener derived from the live route
  const steps = playerId ? plan?.routes?.[playerId]?.steps ?? [] : [];
  if (steps.length) {
    const first = steps.slice(0, 3).map((s) => describeStep(s)).join(' → ');
    sections.initial.unshift(item(`Opening route: ${first}`, 'route', steps[0].confidence === 'confirmed' ? 'high' : 'medium'));
  }

  return {
    classId,
    className: cls.name,
    role: cls.role,
    floorId: floor.id,
    playerId,
    isSelf: Boolean(me?.isSelf),
    sections: PLAN_SECTIONS.map((s) => ({ ...s, items: sections[s.id] })),
  };
}

export function describeStep(s) {
  switch (s.kind) {
    case 'rush': return 'rush blood';
    case 'puzzle': return `solve ${s.roomId}`;
    case 'explore': return `explore ${s.cell[0]},${s.cell[1]}`;
    case 'secrets': return `secrets in ${s.roomId}`;
    case 'visit': return `visit ${s.roomId}`;
    default: return `clear ${s.roomId}`;
  }
}

export function allClassPlans(floorId) {
  return CLASS_IDS.map((c) => buildExecutionPlan({ classId: c, floorId }));
}

export function puzzleTip(puzzleId) {
  return PUZZLES[puzzleId]?.tip ?? PUZZLES.unknown.tip;
}
