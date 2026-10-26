// Catacombs score model (Hypixel SkyBlock Wiki, "Dungeon Score").
//
//   Skill   = 20 + floor(80 * clearedRooms / totalRooms) - 2*deaths - 14*failedPuzzles
//             (equals 100 - penalties on a full clear; the room-weighted part
//             lets the projection reflect partially cleared maps)
//   Explore = floor(60 * clearedRooms / totalRooms)
//             + min(40, floor(40 * secrets / (requirement * totalSecrets)))
//   Speed   = piecewise curve on T = elapsed - allowance
//   Bonus   = min(5, crypts) + mimic(2, F6+) + prince(1) + ezpz(10)

import { getFloor } from '../data/floors.js';
import { PUZZLE_FAIL_PENALTY } from '../data/rooms.js';

export const GRADES = [
  { grade: 'S+', min: 300 },
  { grade: 'S', min: 270 },
  { grade: 'A', min: 230 },
  { grade: 'B', min: 160 },
  { grade: 'C', min: 100 },
  { grade: 'D', min: 0 },
];

export function gradeFor(total) {
  return GRADES.find((g) => total >= g.min).grade;
}

export function gradeThreshold(grade) {
  const g = GRADES.find((x) => x.grade === grade);
  if (!g) throw new Error(`Unknown grade ${grade}`);
  return g.min;
}

export function speedScore(floorId, elapsedSec, { bossKilled = true, clearedRatio = 1 } = {}) {
  if (!bossKilled) return Math.floor(100 * clamp01(clearedRatio));
  const floor = getFloor(floorId);
  const t = elapsedSec - floor.speedAllowanceSec;
  if (t < 480) return 100;
  if (t < 600) return Math.ceil(140 - t / 12);
  if (t < 840) return Math.ceil(115 - t / 24);
  if (t < 1140) return Math.ceil(108 - t / 30);
  if (t < 3940) return Math.ceil(98.5 - t / 40);
  return 0;
}

// Elapsed seconds at which the speed score is still 100.
export function fullSpeedDeadline(floorId) {
  const floor = getFloor(floorId);
  return 480 + floor.speedAllowanceSec;
}

export function deathPenalty(deaths, spiritPetFirstDeath = false) {
  if (deaths <= 0) return 0;
  return deaths * 2 - (spiritPetFirstDeath ? 1 : 0);
}

export function skillScore({ clearedRooms, totalRooms, deaths = 0, failedPuzzles = 0, spiritPet = false }) {
  const ratio = totalRooms > 0 ? clearedRooms / totalRooms : 0;
  const raw = 20 + Math.floor(80 * clamp01(ratio)) - deathPenalty(deaths, spiritPet) - PUZZLE_FAIL_PENALTY * failedPuzzles;
  return Math.max(0, Math.min(100, raw));
}

export function secretsNeeded(floorId, totalSecrets) {
  return Math.ceil(getFloor(floorId).secretRequirement * totalSecrets);
}

export function exploreScore(floorId, { clearedRooms, totalRooms, secretsFound, totalSecrets }) {
  const roomPart = totalRooms > 0 ? Math.floor(60 * clamp01(clearedRooms / totalRooms)) : 0;
  const req = getFloor(floorId).secretRequirement * totalSecrets;
  const secretPart = req > 0 ? Math.min(40, Math.floor((40 * secretsFound) / req)) : 0;
  return roomPart + secretPart;
}

export function bonusScore(floorId, { crypts = 0, mimic = false, prince = false, ezpz = false }) {
  const floor = getFloor(floorId);
  return Math.min(5, crypts) + (mimic && floor.mimicBonus ? 2 : 0) + (prince ? 1 : 0) + (ezpz ? 10 : 0);
}

export function computeScore(floorId, input) {
  const skill = skillScore(input);
  const explore = exploreScore(floorId, input);
  const speed = speedScore(floorId, input.elapsedSec, { bossKilled: input.bossKilled ?? true, clearedRatio: input.totalRooms ? input.clearedRooms / input.totalRooms : 0 });
  const bonus = bonusScore(floorId, input);
  const total = skill + explore + speed + bonus;
  return { skill, explore, speed, bonus, total, grade: gradeFor(total) };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
