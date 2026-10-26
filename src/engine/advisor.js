// Decision logic: turns the plan into "what should this player do right now"
// for their class, floor and phase.

import { getClass } from '../data/classes.js';
import { getFloor } from '../data/floors.js';
import { PUZZLES, ROOM_TYPES } from '../data/rooms.js';
import { buildExecutionPlan, describeStep, terminalAssignments } from './plans.js';
import { fmt } from './route.js';

function roomLabel(state, id) {
  const r = state.map.rooms[id];
  if (!r) return id;
  const t = ROOM_TYPES[r.type]?.label ?? r.type;
  return `${r.name ?? r.id} (${r.type === 'normal' ? r.shape : t})`;
}

// Short class-specific hint for a step, so two classes given the same room
// still get different instructions.
function classHint(cls, state, step) {
  const r = step.roomId ? state.map.rooms[step.roomId] : null;
  const id = cls.id;
  if (step.kind === 'puzzle') {
    const pz = PUZZLES[r?.puzzle] ?? PUZZLES.unknown;
    if (pz.ranged && !cls.traits.ranged) return `${pz.name} favours ranged classes - ask a Mage/Archer if one is close. ${pz.tip}`;
    return pz.tip;
  }
  if (step.kind === 'explore') {
    return id === 'mage' || id === 'archer'
      ? 'Check whether this is the blood room or a key room and record it immediately.'
      : 'Clear whatever room you find and record its type and secret count.';
  }
  if (step.kind === 'secrets') return 'Re-enter only for the planned secrets/crypts, then leave.';
  if (!r) return '';
  if (r.type === 'miniboss') return { berserk: 'Miniboss: burst it with your ultimate.', archer: 'Miniboss: kite and shoot; do not trade melee hits.', mage: 'Miniboss: burst from range.', tank: 'Miniboss: hold it while you whittle it down; you will be slower than damage classes.', healer: 'Miniboss: slow for you - ask a damage class if one is adjacent.' }[id];
  if (r.type === 'trap') return id === 'tank' || id === 'healer' ? 'Trap room: you survive it best - walk the safe path, then clear.' : 'Trap room: follow the safe path; damage classes die here most.';
  if (r.shape === '2x2' || r.shape === 'L') return { berserk: 'Large room: group mobs and burst.', archer: 'Large room: clear casters first from range.', mage: 'Large room: pull everything into one pack and area-clear.', tank: 'Large room: pull mobs to a corner; this will take you longer.', healer: 'Large room: slow for you - focus secrets while clearing.' }[id];
  return { berserk: 'Clear fast and move on.', archer: 'Clear from the doorway where possible.', mage: 'One pull, one cast.', tank: 'Clear steadily; you are safe to take damage.', healer: 'Clear and sweep the secrets.' }[id];
}

function stepAction(state, cls, step) {
  const r = step.roomId ? state.map.rooms[step.roomId] : null;
  const via = step.path?.length > 2 ? ` via ${step.path.slice(1, -1).join(' → ')}` : '';
  const extras = [];
  if (step.secrets) extras.push(`${step.secrets} secret${step.secrets > 1 ? 's' : ''}${r?.secretsTotal == null ? ' (est.)' : ''}`);
  if (step.crypts) extras.push(`${step.crypts} crypt${step.crypts > 1 ? 's' : ''}`);
  const extraText = extras.length ? ` - collect ${extras.join(' + ')}` : '';
  let title;
  switch (step.kind) {
    case 'rush': title = `Rush blood${via}`; break;
    case 'puzzle': title = `Solve ${PUZZLES[r?.puzzle]?.name ?? 'puzzle'} in ${r?.id}`; break;
    case 'explore': title = `Explore unknown cell ${step.cell[0]},${step.cell[1]} (from ${step.at})`; break;
    case 'secrets': title = `Return to ${roomLabel(state, step.roomId)}${extraText}`; break;
    case 'visit': title = `Visit ${roomLabel(state, step.roomId)}`; break;
    default: title = `Clear ${roomLabel(state, step.roomId)}${extraText}`;
  }
  return {
    type: step.kind,
    title,
    detail: classHint(cls, state, step),
    roomId: step.roomId,
    cell: step.cell,
    path: step.path,
    eta: { travelSec: step.travelSec, workSec: step.workSec, endsAt: step.endsAt },
    confidence: step.confidence === 'confirmed' ? 'high' : step.confidence === 'estimated' ? 'medium' : 'low',
  };
}

function bossAction(state, cls, floor, playerId) {
  const phases = floor.boss.phases.filter((p) => !p.masterOnly || floor.master);
  const phase = phases.find((p) => p.id === state.bossPhase) ?? phases[0];
  const idx = phases.indexOf(phase);
  const duties = cls.floors[`F${floor.number}`]?.boss ?? [];
  let detail = phase.mechanics.join(' ');
  let title = `${floor.boss.name} - ${phase.name}`;
  if (floor.number === 7) {
    const tag = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4', p5: 'M7 P5' }[phase.id];
    const mine = duties.filter((d) => d.startsWith(tag));
    if (mine.length) detail = `${mine.join(' ')} ${detail}`;
    if (phase.id === 'p3') {
      const ta = terminalAssignments(state.floorId, state.party, state.strategy.terminalOverrides);
      const todo = [];
      for (const s of ta.sections) {
        if (s.device.playerId === playerId && !state.terminals[`s${s.section}.device`]) todo.push(`S${s.section} ${s.device.name}`);
        for (const t of s.terminals) if (t.playerId === playerId && !state.terminals[`s${s.section}.terminal${t.index}`]) todo.push(`S${s.section} terminal ${t.index}`);
        for (const l of s.levers) if (l.playerId === playerId && !state.terminals[`s${s.section}.lever${l.index}`]) todo.push(`S${s.section} lever ${l.index}`);
      }
      title = todo.length ? `Goldor terminals: ${todo[0]}` : 'Goldor terminals: your slots are done - help the slowest section';
      if (todo.length > 1) detail = `Then: ${todo.slice(1, 4).join(', ')}. ${detail}`;
    }
  } else if (duties.length) {
    detail = `${duties.join(' ')} ${detail}`;
  }
  const next = phases[idx + 1] ? `Next phase: ${phases[idx + 1].name}` : 'Final phase';
  return { type: 'boss', title, detail, next, confidence: floor.number === 7 ? 'medium' : 'high' };
}

export function advise(state, plan, playerId) {
  const p = state.party.find((x) => x.id === playerId) ?? state.party.find((x) => x.isSelf);
  const cls = getClass(p.class);
  const floor = getFloor(state.floorId);
  const route = plan.routes?.[p.id];
  const steps = route?.steps ?? [];
  const exec = buildExecutionPlan({ classId: p.class, floorId: state.floorId, party: state.party, strategy: state.strategy, playerId: p.id, roles: plan.roles ?? {}, plan });
  let action;
  const dead = state.party.filter((x) => !x.alive);

  if (state.phase === 'complete') {
    action = { type: 'complete', title: 'Run complete', detail: plan.score ? `Final estimate ${plan.score.current.total} (${plan.score.current.grade}).` : '', confidence: 'high' };
  } else if (plan.empty) {
    action = { type: 'setup', title: 'Add the entrance room to start', detail: 'Click a cell on the map, set its type to Entrance and save. Add rooms as they appear on your in-game map.', confidence: 'high' };
  } else if (!p.alive) {
    action = { type: 'wait_revive', title: 'You are dead - wait for a revive', detail: cls.general.recovery.find((t) => /died|respawn/.test(t)) ?? 'Call your position for the Healer.', confidence: 'high' };
  } else if (dead.length && (p.class === 'healer' || (!state.party.some((x) => x.class === 'healer' && x.alive) && state.phase !== 'boss'))) {
    action = { type: 'revive', title: `Revive ${dead.map((d) => d.name).join(', ')}`, detail: 'A dead teammate stalls their whole route; reviving is the highest-value action right now.', confidence: 'high' };
  } else if (state.phase === 'setup') {
    const first = steps[0];
    action = {
      type: 'setup',
      title: first ? `Ready up - first: ${describeStep(first)}` : 'Ready up',
      detail: exec.sections.find((s) => s.id === 'initial').items.slice(0, 2).map((i) => i.text).join(' '),
      confidence: plan.confidence?.overall.level ?? 'low',
    };
  } else if (state.phase === 'boss') {
    action = bossAction(state, cls, floor, p.id);
  } else if (plan.roles?.bloodRusher === p.id && state.bloodOpened && !state.bloodCleared && ['mage', 'archer', 'berserk'].includes(p.class)) {
    action = { type: 'blood_camp', title: 'Camp blood: kill the Watcher\'s mobs as they spawn', detail: `Rooms after the camp: ${steps.slice(0, 3).map(describeStep).join(', ') || 'none'}.`, roomId: plan.rush?.path?.at(-1), confidence: 'high' };
  } else if (steps.length) {
    action = stepAction(state, cls, steps[0]);
  } else {
    const bloodRoom = Object.values(state.map.rooms).find((r) => r.type === 'blood');
    const remainingAny = Object.values(plan.routes).some((r) => r.steps.length);
    if (!bloodRoom) action = { type: 'explore', title: 'Find the blood room', detail: 'Blood room is not on the map yet - check the unexplored edges.', confidence: 'low' };
    else if (!state.bloodOpened && plan.roles?.bloodRusher && plan.roles.bloodRusher !== p.id && state.party.find((x) => x.id === plan.roles.bloodRusher)?.alive) {
      const rusher = state.party.find((x) => x.id === plan.roles.bloodRusher);
      action = { type: 'support', title: `Move toward blood - ${rusher.name} is opening it`, detail: remainingAny ? 'Your rooms are done: help the slowest teammate on the way, then be ready to camp.' : 'Be at blood when it opens to speed up the camp.', roomId: bloodRoom.id, confidence: 'medium' };
    } else if (!state.bloodOpened) action = { type: 'go_blood', title: `Open blood (${bloodRoom.id})`, detail: 'Your route is done; open blood so the Watcher starts spawning.', roomId: bloodRoom.id, confidence: 'high' };
    else if (!state.bloodCleared) action = { type: 'blood_camp', title: 'Help camp blood', detail: remainingAny ? 'Your rooms are done; kill blood mobs while the others finish.' : 'All rooms done - finish the Watcher\'s mobs.', roomId: bloodRoom.id, confidence: 'high' };
    else if (state.crypts < (state.strategy.cryptTarget ?? 5) && plan.timeline.finishAt < plan.timeline.bossStartAt + floor.bossSec) action = { type: 'crypts', title: `Blow ${5 - state.crypts} more crypt(s) before boss`, detail: 'Crypts are 1 bonus point each up to 5.', confidence: 'medium' };
    else if (remainingAny) action = { type: 'support', title: 'Support the slowest teammate', detail: 'Your share is done - help whoever has the longest route remaining.', confidence: 'medium' };
    else action = { type: 'enter_boss', title: 'Enter the boss room', detail: `Boss: ${floor.boss.name}. ${floor.boss.summary}`, confidence: 'high' };
  }

  // Recovery suggestions when behind, chosen from this class's guidance.
  const behind = plan.warnings?.some((w) => w.id === 'behind_schedule' || w.id === 'score_short');
  const recovery = behind ? cls.general.recovery : [];

  return {
    playerId: p.id,
    name: p.name,
    class: p.class,
    className: cls.name,
    phase: state.phase,
    action,
    next: steps.slice(action.type === steps[0]?.kind ? 1 : 0, 5).map((s) => ({ ...stepAction(state, cls, s), at: fmt(s.endsAt) })),
    route: route ? { estSec: route.estSec, finishAt: route.finishAt } : null,
    recovery,
    plan: exec,
    warnings: (plan.warnings ?? []).filter((w) => !w.id.startsWith('dead_') || w.id === `dead_${p.id}` || p.class === 'healer'),
  };
}

export function adviseAll(state, plan) {
  return Object.fromEntries(state.party.map((p) => [p.id, advise(state, plan, p.id)]));
}
