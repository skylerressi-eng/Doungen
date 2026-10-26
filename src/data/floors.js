// Floor reference data for The Catacombs.
//
// Score constants (time limits, allowances, secret requirements) follow the
// Hypixel SkyBlock Wiki "Dungeon Score" page. Grid sizes, puzzle counts and
// timing estimates are typical values used for planning only; every value the
// game does not publish is marked as an estimate so the dashboard can show a
// confidence indicator for anything derived from it.

export const SECRET_REQUIREMENT = {
  F1: 0.3, F2: 0.4, F3: 0.5, F4: 0.6, F5: 0.7, F6: 0.85, F7: 1.0,
  M1: 1.0, M2: 1.0, M3: 1.0, M4: 1.0, M5: 1.0, M6: 1.0, M7: 1.0,
};

// Minutes before the speed score starts dropping.
const TIME_LIMIT_MIN = {
  F1: 10, F2: 10, F3: 10, F4: 12, F5: 10, F6: 12, F7: 14,
  M1: 8, M2: 8, M3: 8, M4: 8, M5: 8, M6: 10, M7: 14,
};

// Seconds subtracted from elapsed time before applying the speed curve.
const SPEED_ALLOWANCE = {
  F1: 120, F2: 120, F3: 120, F4: 240, F5: 120, F6: 240, F7: 360,
  M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 120, M7: 360,
};

// Typical map grid (cells are 1x1 room units). Estimates; the dashboard lets
// the player resize the grid when the real layout differs.
const GRID = {
  1: { w: 4, h: 4 }, 2: { w: 4, h: 5 }, 3: { w: 5, h: 5 }, 4: { w: 5, h: 6 },
  5: { w: 6, h: 6 }, 6: { w: 6, h: 6 }, 7: { w: 6, h: 6 },
};

const EXPECTED_PUZZLES = { 1: 1, 2: 2, 3: 2, 4: 3, 5: 3, 6: 3, 7: 3 };

// Planning estimates (seconds) for the post-clear part of a run.
const BLOOD_CAMP_SEC = { 1: 45, 2: 50, 3: 55, 4: 65, 5: 70, 6: 75, 7: 85 };
const BOSS_SEC = { 1: 45, 2: 60, 3: 90, 4: 90, 5: 60, 6: 120, 7: 300 };
const MASTER_BOSS_SEC = { 1: 60, 2: 70, 3: 110, 4: 120, 5: 70, 6: 140, 7: 420 };

export const BOSSES = {
  1: {
    id: 'bonzo',
    name: 'Bonzo',
    summary: 'Two-phase fight. Bonzo is revived after the first kill; the second phase throws more explosive balloons.',
    phases: [
      { id: 'p1', name: 'Bonzo', mechanics: ['Bonzo throws balloons that explode on impact - keep moving, do not stand in clumps.', 'His "Spirit" minions are low priority; focus Bonzo.'] },
      { id: 'p2', name: 'Bonzo (revived)', mechanics: ['After his first death Bonzo revives with a firework burst - back off for the animation.', 'Phase two hits harder; Healer should be in range before it starts.'] },
    ],
  },
  2: {
    id: 'scarf',
    name: 'Scarf',
    summary: 'Scarf summons four undead minions (Warrior, Priest, Mage, Archer). Kill the minions, then Scarf.',
    phases: [
      { id: 'p1', name: 'Minions', mechanics: ['Kill the Undead Priest first - it revives the other minions.', 'The Undead Mage and Archer deal ranged damage; break line of sight while the Priest dies.'] },
      { id: 'p2', name: 'Scarf', mechanics: ['Scarf teleports between platforms - ranged classes follow, melee waits at landing spots.'] },
    ],
  },
  3: {
    id: 'professor',
    name: 'The Professor',
    summary: 'Four Guardians (Healthy, Reinforced, Chaos, Laser), then The Professor, then his giant guardian form.',
    phases: [
      { id: 'p1', name: 'Guardians', mechanics: ['Kill the four guardians; the Laser Guardian\'s beam must be dodged, not tanked.', 'Chaos Guardian fires a spread - stand behind the Tank.'] },
      { id: 'p2', name: 'The Professor', mechanics: ['The Professor is vulnerable once all guardians are dead.'] },
      { id: 'p3', name: 'Professor\'s Guardian', mechanics: ['Final form is a large guardian with a laser - burst damage and keep the Healer alive.'] },
    ],
  },
  4: {
    id: 'thorn',
    name: 'Thorn',
    summary: 'Thorn only takes damage from the Spirit Bow, which spawns after Spirit animals are killed.',
    phases: [
      { id: 'p1', name: 'Spirit animals', mechanics: ['Kill Spirit animals (the Spirit Bear in particular) to spawn the Spirit Bow.', 'Spirit animals must be killed quickly or they heal Thorn.'] },
      { id: 'p2', name: 'Spirit Bow', mechanics: ['One player picks up the Spirit Bow and shoots Thorn; repeat until Thorn dies.', 'Everyone else keeps killing animals so the next bow spawns immediately.'] },
    ],
  },
  5: {
    id: 'livid',
    name: 'Livid',
    summary: 'Livid splits into clones; only the real Livid takes damage. Match the real one by colour.',
    phases: [
      { id: 'p1', name: 'Identify', mechanics: ['The real Livid\'s nametag colour matches the coloured wool shown in the arena - call it out in party chat.', 'Hitting fake Livids wastes time; wait for the call.'] },
      { id: 'p2', name: 'Burst', mechanics: ['Livid applies blindness and a dagger throw - burst during the window after he lands.'] },
    ],
  },
  6: {
    id: 'sadan',
    name: 'Sadan',
    summary: 'Three phases: Terracotta army, four Giants, then Sadan himself.',
    phases: [
      { id: 'p1', name: 'Terracottas', mechanics: ['Kill Terracottas before they respawn from their flowers; spread out across the arena.'] },
      { id: 'p2', name: 'Giants', mechanics: ['Diamond Giant, Bigfoot, L.A.S.R. and the Jolly Pink Giant - kill them one at a time, dodge L.A.S.R.\'s beam and Bigfoot\'s stomp.'] },
      { id: 'p3', name: 'Sadan', mechanics: ['Sadan becomes a giant - Tank holds aggro while damage dealers burst; Healer stays at range.'] },
    ],
  },
  7: {
    id: 'necron',
    name: 'Necron (Wither Lords)',
    summary: 'Maxor, Storm, Goldor (terminals) and Necron. Master Mode adds the Wither King and dragons.',
    phases: [
      { id: 'p1', name: 'Maxor', mechanics: ['Pick up energy crystals and place them on both pads to fire the laser at Maxor; damage him while he is stunned.', 'Repeat the crystals for the second stun.'] },
      { id: 'p2', name: 'Storm', mechanics: ['Lure Storm under a crusher pillar and trigger it to stun him; damage during the stun.', 'Take cover from Giga Lightning.'] },
      { id: 'p3', name: 'Goldor (terminals)', mechanics: ['Four sections, each with terminals, two levers and a device. All must be completed to open the gate.', 'Stay ahead of Goldor\'s damage aura while moving between sections.', 'After the fourth section, break the core and kill Goldor.'] },
      { id: 'p4', name: 'Necron', mechanics: ['Tank holds Necron; damage dealers burst when he is stunned.', 'Avoid the frenzy/lightning patterns - deaths here are expensive for score.'] },
      { id: 'p5', name: 'Wither King (Master Mode)', masterOnly: true, mechanics: ['Collect and place the relics, then kill the dragons as they spawn, each in its own colour area.', 'Dragon split is a party decision - agree on teams before the phase starts.'] },
    ],
    terminals: {
      sections: 4,
      terminalsPerSection: [4, 5, 4, 4],
      levers: 2,
      devices: [
        { section: 1, id: 'simon_says', name: 'Simon Says' },
        { section: 2, id: 'lights', name: 'Lights' },
        { section: 3, id: 'arrow_align', name: 'Arrow Align' },
        { section: 4, id: 'target_shoot', name: 'Target Shooting (i4)' },
      ],
      confidence: 'estimated',
    },
  },
};

function makeFloor(id) {
  const master = id.startsWith('M');
  const n = Number(id.slice(1));
  return {
    id,
    number: n,
    master,
    name: `${master ? 'Master Mode ' : ''}Floor ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][n - 1]}`,
    secretRequirement: SECRET_REQUIREMENT[id],
    timeLimitSec: TIME_LIMIT_MIN[id] * 60,
    speedAllowanceSec: SPEED_ALLOWANCE[id],
    grid: { ...GRID[n] },
    expectedPuzzles: EXPECTED_PUZZLES[n],
    hasTrapRoom: n >= 3,
    mimicBonus: n >= 6,
    // Mobs are tankier in Master Mode; used to scale clear-time estimates.
    clearScale: master ? 1.3 : 1 + (n - 1) * 0.04,
    bloodCampSec: Math.round(BLOOD_CAMP_SEC[n] * (master ? 1.2 : 1)),
    bossSec: master ? MASTER_BOSS_SEC[n] : BOSS_SEC[n],
    boss: BOSSES[n],
    estimates: ['grid', 'expectedPuzzles', 'bloodCampSec', 'bossSec', 'clearScale'],
  };
}

export const FLOOR_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'];
export const FLOORS = Object.fromEntries(FLOOR_IDS.map((id) => [id, makeFloor(id)]));

export function getFloor(id) {
  const floor = FLOORS[String(id).toUpperCase()];
  if (!floor) throw new Error(`Unknown floor "${id}"`);
  return floor;
}
