// Class profiles and floor-specific duties for the five Catacombs classes.
//
// Each class has:
//  - numeric planning traits used by the route engine (relative clear speed,
//    affinities for room types, whether it is a natural blood rusher, etc.)
//  - general execution guidance split into the plan sections the dashboard
//    shows (initial priorities, clearing, routing, secrets, puzzles/terminals,
//    coordination, boss, recovery)
//  - per-floor boss responsibilities and notes.
//
// Guidance reflects common community practice. Boss role splits (especially
// F7/M7 devices and dragon teams) vary between parties, so those items carry
// a confidence level and the party can override them in the strategy.

export const CLASS_IDS = ['berserk', 'archer', 'mage', 'tank', 'healer'];

export const CLASSES = {
  berserk: {
    id: 'berserk',
    name: 'Berserk',
    role: 'Melee damage / fast room clearer',
    traits: {
      clearSpeed: 0.9, // multiplier on clear time (lower is faster)
      secretSpeed: 0.9,
      puzzleSpeed: 1.0,
      ranged: false,
      bloodRushScore: 0.7,
      affinity: { normal: 1.0, miniboss: 0.85, trap: 0.9, puzzle: 1.05, fairy: 1, blood: 1, unknown: 1 },
      survivability: 0.8,
    },
    general: {
      initial: [
        'Take the room cluster furthest from the entrance on your side - melee clears large mob rooms fastest.',
        'Kill wither-key holders on your path and call the key in party chat.',
        'Check for crypts while clearing; you blow them up as you pass.',
      ],
      clearing: [
        'Pull mobs into tight groups and burst them; do not leave stragglers that block the room clear.',
        'Prioritise miniboss rooms (Shadow Assassin, Lost/Frozen Adventurer, Angry Archaeologist) - you clear them fastest.',
        'Clear 2x2 and L rooms on your route before 1x1 side rooms.',
      ],
      route: [
        'Follow a single sweep through your quadrant; never cross the map unless the planner reassigns you.',
        'Finish your share, then move toward blood so you are in position for the camp.',
      ],
      secrets: [
        'Collect secrets in rooms you clear only up to the floor target - your time is worth more on mob rooms.',
        'Bat secrets and item secrets on the way are worth grabbing; skip long lever/redstone chains unless secrets are short.',
      ],
      puzzles: [
        'You are a backup puzzle solver; take melee-friendly puzzles (Boulder, Tic Tac Toe, Three Weirdos) if they sit on your route.',
      ],
      coordination: [
        'Call out key pickups and wither door openings.',
        'Tell the Healer before pulling large groups so they can stay in range.',
      ],
      boss: ['Primary melee damage; stay on the boss during damage windows.'],
      recovery: [
        'If the run is behind, drop optional secrets on your remaining rooms and clear only.',
        'Pick up the largest unassigned room near you before heading to blood.',
        'If you died, clear the nearest room on respawn rather than walking back to your old route.',
      ],
    },
    floors: {
      F1: { boss: ['Melee Bonzo during both phases; stay mobile to avoid balloon explosions.'] },
      F2: { boss: ['Kill the Undead Priest first, then the Warrior; follow Scarf when he teleports.'] },
      F3: { boss: ['Kill the Healthy and Reinforced guardians; avoid the Laser Guardian beam.', 'Melee the Professor\'s Guardian legs in the final phase.'] },
      F4: { boss: ['Kill Spirit animals immediately so the Spirit Bow keeps respawning; leave the bow to Archer.'] },
      F5: { boss: ['Wait for the real-Livid call before swinging; then burst the real Livid.'] },
      F6: { boss: ['Clear Terracottas quickly in phase 1.', 'Burst the Diamond Giant and Bigfoot in phase 2; dodge the stomp.'] },
      F7: {
        boss: [
          'P1 Maxor: help with crystals if Mage/Archer are not on them; burst Maxor during the stun.',
          'P3 Goldor: default device is Simon Says in section 1, then your assigned terminals.',
          'P4 Necron: melee damage during stuns.',
        ],
        terminals: { device: 'simon_says', confidence: 'medium' },
      },
    },
    master: ['Master Mode mobs survive single pulls; group more aggressively and use your ultimate for crowded rooms.'],
  },

  archer: {
    id: 'archer',
    name: 'Archer',
    role: 'Ranged damage / blood camper',
    traits: {
      clearSpeed: 0.92,
      secretSpeed: 0.95,
      puzzleSpeed: 1.0,
      ranged: true,
      bloodRushScore: 0.85,
      affinity: { normal: 1.0, miniboss: 0.95, trap: 1.0, puzzle: 0.95, fairy: 1, blood: 0.8, unknown: 1 },
      survivability: 0.75,
    },
    general: {
      initial: [
        'Take the rooms along the blood path, or blood rush if assigned - you are a natural blood camper.',
        'Open wither doors toward blood as soon as keys are available.',
      ],
      clearing: [
        'Clear from range; kill casters and archers first so melee can collapse on the rest.',
        'Ranged puzzles (Higher or Lower, Ice Path) are fastest for you.',
      ],
      route: [
        'Route through the blood path first, then clear the rooms adjacent to blood so you are near the camp.',
      ],
      secrets: [
        'Shoot bats and distant item secrets on the way through.',
        'Hit secret targets/levers from range to save travel.',
      ],
      puzzles: ['Preferred solver for Higher or Lower (Blaze) and Ice Path.'],
      coordination: [
        'Call when blood is open and when the Watcher finishes spawning.',
        'Tell the party which rooms near blood you have taken so nobody doubles back.',
      ],
      boss: ['Primary ranged damage; keep uptime during every damage window.'],
      recovery: [
        'If behind, open blood immediately and camp - camp time overlaps clearing.',
        'Take ranged puzzles off slower players if they are still unsolved.',
      ],
    },
    floors: {
      F1: { boss: ['Shoot Bonzo from range; pop balloons that come toward the party.'] },
      F2: { boss: ['Shoot the Undead Priest first, then the Undead Archer and Mage.'] },
      F3: { boss: ['Focus the Chaos and Laser Guardians from range.', 'Ranged damage on the Professor\'s Guardian head.'] },
      F4: { boss: ['You pick up the Spirit Bow and shoot Thorn - stand where the bow spawns.'] },
      F5: { boss: ['Call the real Livid by colour; shoot it as soon as identified.'] },
      F6: { boss: ['Shoot Terracottas on the far side of the arena.', 'Damage L.A.S.R. from range in phase 2.'] },
      F7: {
        boss: [
          'P1 Maxor: carry a crystal to a pad, then damage.',
          'P2 Storm: damage Storm while he is stunned under a crusher.',
          'P3 Goldor: default device is Target Shooting (section 4, "i4").',
          'P4 Necron: ranged damage during stuns.',
          'M7 P5: you are typically on a dragon team - confirm your colour before the phase.',
        ],
        terminals: { device: 'target_shoot', confidence: 'medium' },
      },
    },
    master: ['Master Mode blood mobs have far more health - start the camp as early as possible.'],
  },

  mage: {
    id: 'mage',
    name: 'Mage',
    role: 'Area damage / fastest clearer',
    traits: {
      clearSpeed: 0.82,
      secretSpeed: 1.0,
      puzzleSpeed: 1.0,
      ranged: true,
      bloodRushScore: 1.0,
      affinity: { normal: 0.95, miniboss: 0.95, trap: 1.0, puzzle: 1.0, fairy: 1, blood: 0.75, unknown: 1 },
      survivability: 0.7,
    },
    general: {
      initial: [
        'Blood rush by default: follow the blood path, open wither doors, open blood.',
        'If someone else rushes, take the largest rooms - your area damage clears 2x2/L rooms fastest.',
      ],
      clearing: [
        'Pull the whole room and clear with area damage; one pass per room.',
        'Clear the blood room mobs from the Watcher as they spawn while camping.',
      ],
      route: [
        'Rusher: entrance -> blood path -> blood; then clear rooms adjacent to blood.',
        'Clearer: sweep the large rooms in your quadrant, leave 1x1s to support classes.',
      ],
      secrets: [
        'Grab secrets only on your route; your camp time matters more than extra secrets.',
      ],
      puzzles: ['Can solve any puzzle; take Higher or Lower if no Archer is nearby.'],
      coordination: [
        'Announce "blood open" and how many waves remain.',
        'Tell the party when blood is done so everybody heads to the boss.',
      ],
      boss: ['Burst damage and add clear; save ultimate for the main damage window.'],
      recovery: [
        'Behind schedule: start blood camping immediately - camping overlaps clearing time.',
        'If the map is incomplete late in the run, explore the unknown side on your way to blood.',
      ],
    },
    floors: {
      F1: { boss: ['Burst Bonzo; clear his minions with area damage.'] },
      F2: { boss: ['Area damage on the minion group; finish the Priest first.'] },
      F3: { boss: ['Clear the guardians with area damage; burst the Professor\'s Guardian.'] },
      F4: { boss: ['Kill Spirit animals fast (especially the Spirit Bear) to keep bows spawning.'] },
      F5: { boss: ['Burst the real Livid after the call; clear clones only if they threaten the Healer.'] },
      F6: { boss: ['Area-clear Terracottas in phase 1; burst giants in phase 2.'] },
      F7: {
        boss: [
          'P1 Maxor: place crystals, then burst Maxor.',
          'P2 Storm: main damage under the crusher.',
          'P3 Goldor: terminals and levers - you are the fastest terminal runner (no default device).',
          'P4 Necron: burst during stuns.',
          'M7 P5: confirm dragon team; usually on the opposite team from Archer.',
        ],
        terminals: { device: null, confidence: 'medium' },
      },
    },
    master: ['Master Mode: if you are the only Mage, keep blood rush - camp time decides the speed score.'],
  },

  tank: {
    id: 'tank',
    name: 'Tank',
    role: 'Damage absorber / boss aggro',
    traits: {
      clearSpeed: 1.25,
      secretSpeed: 1.0,
      puzzleSpeed: 0.95,
      ranged: false,
      bloodRushScore: 0.3,
      affinity: { normal: 1.1, miniboss: 1.0, trap: 0.85, puzzle: 0.85, fairy: 1, blood: 1.1, unknown: 1 },
      survivability: 1.4,
    },
    general: {
      initial: [
        'Take puzzle rooms and trap rooms near the entrance - you survive traps and solve puzzles while others clear.',
        'Keep your health high going into blood and boss; your deaths cost the most time.',
      ],
      clearing: [
        'Clear 1x1 and trap rooms; leave large mob rooms to damage classes.',
        'Hold aggro in rooms you share with damage classes.',
      ],
      route: [
        'Sweep puzzles and side rooms near the entrance, then move toward blood.',
      ],
      secrets: [
        'You are a good secret collector - take secret-heavy rooms if the score target needs them.',
      ],
      puzzles: ['Default puzzle solver alongside the Healer.'],
      coordination: [
        'Call boss aggro and when you are using Castle of Stone.',
        'Tell damage dealers when you are in position at the boss.',
      ],
      boss: ['Hold the boss\'s attention; keep it away from the Healer and ranged classes.'],
      recovery: [
        'If puzzles are failing, keep solving them anyway - an unsolved puzzle at the end costs the same as a failed one.',
        'Pick up secret-heavy rooms to compensate for missed secrets elsewhere.',
      ],
    },
    floors: {
      F1: { boss: ['Hold Bonzo\'s attention; stand between Bonzo and the Healer.'] },
      F2: { boss: ['Pull the Undead Warrior off the damage classes.'] },
      F3: { boss: ['Absorb the Chaos Guardian spread; position the party behind you.'] },
      F4: { boss: ['Shield the Spirit Bow carrier; tank Thorn\'s projectiles.'] },
      F5: { boss: ['Hold the real Livid once identified; keep clones off the Healer.'] },
      F6: { boss: ['Tank giant aggro in phase 2 and Sadan in phase 3.'] },
      F7: {
        boss: [
          'P2 Storm: lure Storm onto the crusher pads.',
          'P3 Goldor: default device is Arrow Align (section 3); protect terminal runners from Goldor.',
          'P4 Necron: take Necron\'s aggro and keep him away from the party.',
          'M7 P5: you usually pair with Archer on a dragon team - confirm before the phase.',
        ],
        terminals: { device: 'arrow_align', confidence: 'low' },
      },
    },
    master: ['Master Mode: use your defensive ultimate before the first boss damage window.'],
  },

  healer: {
    id: 'healer',
    name: 'Healer',
    role: 'Support / reviver / puzzle solver',
    traits: {
      clearSpeed: 1.2,
      secretSpeed: 0.9,
      puzzleSpeed: 0.9,
      ranged: true,
      bloodRushScore: 0.4,
      affinity: { normal: 1.1, miniboss: 1.1, trap: 1.0, puzzle: 0.8, fairy: 1, blood: 1.05, unknown: 1 },
      survivability: 1.1,
    },
    general: {
      initial: [
        'Take puzzles first - you are the default puzzle solver.',
        'Blow up crypts in rooms you pass to secure the crypt bonus.',
      ],
      clearing: [
        'Clear 1x1 rooms and secret-heavy rooms; leave large mob rooms to damage classes.',
        'Stay within healing range of the party in shared rooms.',
      ],
      route: [
        'Puzzle-first route: visit all puzzle rooms, then the secret-heavy rooms around them.',
      ],
      secrets: [
        'You are the primary secret collector; take secrets other classes skipped when the target is short.',
      ],
      puzzles: ['Default puzzle solver. Failed puzzles cost 14 skill points each - take your time on risky ones.'],
      coordination: [
        'Revive dead players before continuing your route.',
        'Ask for help on puzzles that suit ranged classes (Higher or Lower) if they are far from your route.',
      ],
      boss: ['Keep the party alive, revive immediately, use Wish before big damage windows.'],
      recovery: [
        'If deaths are stacking, stay with the party instead of splitting.',
        'If secrets are short, sweep skipped secrets in cleared rooms on the way to blood.',
        'If crypts are below 5, blow crypts in cleared rooms before boss.',
      ],
    },
    floors: {
      F1: { boss: ['Stay in range of everyone; Wish if two players drop low in phase 2.'] },
      F2: { boss: ['Heal through the Undead Mage and Archer projectiles.'] },
      F3: { boss: ['Watch for Laser Guardian damage; revive quickly.'] },
      F4: { boss: ['Kill Spirit animals when the party is healthy; keep the bow carrier alive.'] },
      F5: { boss: ['Blindness hides health bars - heal proactively and call low players.'] },
      F6: { boss: ['Stay central in phase 1, at range from Bigfoot in phase 2, behind the Tank in phase 3.'] },
      F7: {
        boss: [
          'P2 Storm: help lure Storm onto pads.',
          'P3 Goldor: default device is Lights (section 2); then assigned terminals.',
          'P4 Necron: keep Tank alive, Wish before the final burst.',
        ],
        terminals: { device: 'lights', confidence: 'low' },
      },
    },
    master: ['Master Mode: revives are the run - never die before reviving a teammate.'],
  },
};

export function getClass(id) {
  const c = CLASSES[String(id).toLowerCase()];
  if (!c) throw new Error(`Unknown class "${id}"`);
  return c;
}
