// Room and puzzle reference data. Secret counts and clear times are planning
// estimates; once the player enters a real total the estimate is replaced and
// its confidence becomes "confirmed".

export const ROOM_TYPES = {
  entrance: { label: 'Entrance', color: '#3fae4f', countsForClear: true, autoClearOnVisit: true },
  normal: { label: 'Room', color: '#8a6a45', countsForClear: true },
  puzzle: { label: 'Puzzle', color: '#9b59d0', countsForClear: true },
  trap: { label: 'Trap', color: '#e0802b', countsForClear: true },
  miniboss: { label: 'Miniboss', color: '#e3c73a', countsForClear: true },
  fairy: { label: 'Fairy', color: '#e77fb8', countsForClear: true, autoClearOnVisit: true },
  blood: { label: 'Blood', color: '#c0392b', countsForClear: true },
  unknown: { label: 'Unknown', color: '#5b6470', countsForClear: true },
};

export const SHAPES = ['1x1', '1x2', '1x3', '1x4', 'L', '2x2'];

// Average secrets by shape for ordinary rooms.
export const SHAPE_SECRET_ESTIMATE = { '1x1': 3, '1x2': 4, '1x3': 5, '1x4': 6, L: 5, '2x2': 7 };

// Average clear time (seconds) for an average class, before floor scaling.
export const SHAPE_CLEAR_SEC = { '1x1': 20, '1x2': 30, '1x3': 40, '1x4': 50, L: 42, '2x2': 52 };

export const TYPE_CLEAR_SEC = { entrance: 0, fairy: 4, blood: 0, trap: 35, miniboss: 35 };
export const TYPE_SECRET_ESTIMATE = { entrance: 0, fairy: 0, blood: 0, puzzle: 0, trap: 3, miniboss: 4 };

export const SECRET_SEC = 8; // average time to grab one secret inside a room
export const CRYPT_SEC = 6; // average time to blow up one crypt

export const PUZZLES = {
  quiz: { name: 'Quiz (Ouro)', estSec: 35, ranged: false, risk: 'medium', tip: 'Three questions about SkyBlock trivia; step on the platform for the correct answer. A wrong answer fails the puzzle.' },
  three_weirdos: { name: 'Three Weirdos', estSec: 15, ranged: false, risk: 'medium', tip: 'Only one statement set is consistent: exactly one weirdo tells the truth. Open the chest of the one holding the reward.' },
  tic_tac_toe: { name: 'Tic Tac Toe', estSec: 20, ranged: false, risk: 'low', tip: 'Play for a draw or win: take the centre or a corner first and always block a two-in-a-row.' },
  water_board: { name: 'Water Board', estSec: 45, ranged: false, risk: 'medium', tip: 'Flip the levers so water reaches every coloured gate in order; plan the lever order before pulling.' },
  teleport_maze: { name: 'Teleport Maze', estSec: 25, ranged: false, risk: 'low', tip: 'Step on pads and watch where they lead; the correct pad sends you toward the centre.' },
  higher_lower: { name: 'Higher or Lower (Blaze)', estSec: 40, ranged: true, risk: 'medium', tip: 'Kill the blazes in health order (lowest-first or highest-first as indicated). Ranged classes are fastest.' },
  boulder: { name: 'Boulder', estSec: 35, ranged: false, risk: 'low', tip: 'Push boulders to open a path to the chest; plan the route before pushing.' },
  ice_fill: { name: 'Ice Fill', estSec: 25, ranged: false, risk: 'low', tip: 'Cross every ice block exactly once on each layer; trace the path before moving.' },
  ice_path: { name: 'Ice Path (Silverfish)', estSec: 30, ranged: true, risk: 'low', tip: 'Hit the silverfish so it slides along the ice to the exit; one hit per slide.' },
  creeper_beams: { name: 'Creeper Beams', estSec: 30, ranged: false, risk: 'low', tip: 'Connect each pair of lanterns with a beam that passes through the creeper.' },
  unknown: { name: 'Unknown puzzle', estSec: 35, ranged: false, risk: 'medium', tip: 'Identify the puzzle on entry and update the room so the plan can use its real duration.' },
};

export const PUZZLE_FAIL_PENALTY = 14;

export function inferShape(cells) {
  const n = cells.length;
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const bw = Math.max(...xs) - Math.min(...xs) + 1;
  const bh = Math.max(...ys) - Math.min(...ys) + 1;
  if (n === 1) return '1x1';
  if (n === 2) return '1x2';
  if (n === 3) return bw === 3 || bh === 3 ? '1x3' : 'L';
  if (n === 4) return bw === 2 && bh === 2 ? '2x2' : '1x4';
  return null;
}
