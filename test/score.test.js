import test from 'node:test';
import assert from 'node:assert/strict';
import { speedScore, gradeFor, exploreScore, skillScore, bonusScore, computeScore, fullSpeedDeadline, secretsNeeded } from '../src/engine/score.js';

test('speed score follows the wiki curve and per-floor allowance', () => {
  assert.equal(speedScore('F1', 600), 100); // T = 480
  assert.equal(speedScore('F1', 612), 99); // T = 492 -> ceil(140 - 41)
  assert.equal(speedScore('F1', 720), 90); // T = 600
  assert.equal(speedScore('F4', 720), 100); // 240s allowance
  assert.equal(speedScore('F7', 840), 100);
  assert.equal(speedScore('F7', 1200), 80); // T = 840
  assert.equal(speedScore('M1', 480), 100);
  assert.equal(speedScore('M1', 481), 100);
  assert.equal(speedScore('M1', 600), 90);
  assert.equal(speedScore('M6', 600), 100);
  assert.equal(speedScore('F1', 120 + 1140), 70);
  assert.equal(speedScore('F1', 120 + 4000), 0);
  assert.equal(speedScore('F1', 100, { bossKilled: false, clearedRatio: 0.55 }), 55);
  assert.equal(fullSpeedDeadline('F6'), 720);
});

test('grade thresholds', () => {
  assert.equal(gradeFor(317), 'S+');
  assert.equal(gradeFor(300), 'S+');
  assert.equal(gradeFor(299), 'S');
  assert.equal(gradeFor(270), 'S');
  assert.equal(gradeFor(269), 'A');
  assert.equal(gradeFor(230), 'A');
  assert.equal(gradeFor(160), 'B');
  assert.equal(gradeFor(100), 'C');
  assert.equal(gradeFor(99), 'D');
});

test('explore score uses the floor secret requirement', () => {
  assert.equal(exploreScore('F5', { clearedRooms: 20, totalRooms: 20, secretsFound: 70, totalSecrets: 100 }), 100);
  assert.equal(exploreScore('F5', { clearedRooms: 20, totalRooms: 20, secretsFound: 35, totalSecrets: 100 }), 80);
  assert.equal(exploreScore('F1', { clearedRooms: 10, totalRooms: 20, secretsFound: 30, totalSecrets: 100 }), 70);
  assert.equal(exploreScore('M2', { clearedRooms: 20, totalRooms: 20, secretsFound: 99, totalSecrets: 100 }), 99);
  assert.equal(secretsNeeded('F6', 100), 85);
});

test('skill score penalties: deaths, spirit pet, failed puzzles', () => {
  assert.equal(skillScore({ clearedRooms: 20, totalRooms: 20 }), 100);
  assert.equal(skillScore({ clearedRooms: 20, totalRooms: 20, deaths: 2 }), 96);
  assert.equal(skillScore({ clearedRooms: 20, totalRooms: 20, deaths: 2, spiritPet: true }), 97);
  assert.equal(skillScore({ clearedRooms: 20, totalRooms: 20, failedPuzzles: 1 }), 86);
  assert.equal(skillScore({ clearedRooms: 10, totalRooms: 20 }), 60);
});

test('bonus score caps crypts, gates mimic to F6+', () => {
  assert.equal(bonusScore('F5', { crypts: 7, mimic: true }), 5);
  assert.equal(bonusScore('F6', { crypts: 7, mimic: true }), 7);
  assert.equal(bonusScore('M7', { crypts: 5, mimic: true, prince: true, ezpz: true }), 18);
});

test('a perfect F7 run is S+', () => {
  const s = computeScore('F7', { clearedRooms: 30, totalRooms: 30, secretsFound: 120, totalSecrets: 120, crypts: 5, mimic: true, elapsedSec: 700 });
  assert.deepEqual([s.skill, s.explore, s.speed, s.bonus, s.total, s.grade], [100, 100, 100, 7, 307, 'S+']);
});
