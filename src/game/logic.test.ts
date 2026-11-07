import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updatePlayerStats,
  getFlashlightFlickerIntensity,
  updateMonsterAI,
  evaluateGeneratorSwitch,
  checkAABBCollision,
  type PlayerStats,
  type MonsterAI,
  type FacilityState,
  type AABB
} from './logic';

test('Player stamina decreases during sprint and regenerates when walking or idle', () => {
  const initialStats: PlayerStats = {
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    battery: 100,
    maxBattery: 100,
    isSprinting: false,
    isCrouching: false,
    flashlightOn: false,
    isHiding: false,
    isDead: false
  };

  // Sprinting for 1 second
  const sprinting = updatePlayerStats(initialStats, 1.0, { sprintIntent: true, moveMagnitude: 1.0 });
  assert.equal(sprinting.isSprinting, true);
  assert.ok(sprinting.stamina < 100, 'Stamina should decrease while sprinting');

  // Resting for 1 second
  const resting = updatePlayerStats(sprinting, 1.0, { sprintIntent: false, moveMagnitude: 0 });
  assert.equal(resting.isSprinting, false);
  assert.ok(resting.stamina > sprinting.stamina, 'Stamina should regenerate when resting');
});

test('Flashlight consumes battery and flickers at low power or monster proximity', () => {
  const stats: PlayerStats = {
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    battery: 20,
    maxBattery: 100,
    isSprinting: false,
    isCrouching: false,
    flashlightOn: true,
    isHiding: false,
    isDead: false
  };

  const updated = updatePlayerStats(stats, 5.0, { sprintIntent: false, moveMagnitude: 0 });
  assert.ok(updated.battery < 20, 'Battery should deplete when flashlight is on');

  const flickerFar = getFlashlightFlickerIntensity(15, 30);
  const flickerNearMonster = getFlashlightFlickerIntensity(15, 5);
  assert.ok(flickerNearMonster > flickerFar, 'Monster proximity should intensify flashlight flicker');
});

test('Monster AI responds to line of sight and sprinting footstep noise', () => {
  const monster: MonsterAI = {
    state: 'patrol',
    position: { x: 0, z: 0 },
    targetPosition: { x: 0, z: 0 },
    patrolWaypoints: [{ x: 5, z: 0 }, { x: -5, z: 0 }],
    currentWaypointIdx: 0,
    alertTimer: 0,
    searchTimer: 0,
    chaseSpeed: 6.0,
    patrolSpeed: 2.2,
    detectionRangeNormal: 14.0,
    detectionRangeSprint: 24.0,
    detectionRangeFlashlight: 26.0,
    hearingRangeCrouch: 2.5,
    attackRange: 1.8
  };

  const playerStats: PlayerStats = {
    health: 100,
    maxHealth: 100,
    stamina: 80,
    maxStamina: 100,
    battery: 90,
    maxBattery: 100,
    isSprinting: true,
    isCrouching: false,
    flashlightOn: false,
    isHiding: false,
    isDead: false
  };

  // Player is 18m away, sprinting without line of sight -> monster hears sprint and investigates
  const res1 = updateMonsterAI(monster, { x: 18, z: 0 }, playerStats, 0.1, false);
  assert.equal(res1.monster.state, 'investigate');

  // Player has direct line of sight within visual range -> monster enters chase
  const res2 = updateMonsterAI(monster, { x: 10, z: 0 }, playerStats, 0.1, true);
  assert.equal(res2.monster.state, 'chase');
  assert.equal(res2.triggeredStinger, true);

  // Player is hiding in locker -> monster cannot see player even within normal range
  const hidingPlayer = { ...playerStats, isHiding: true, isSprinting: false };
  const res3 = updateMonsterAI(monster, { x: 8, z: 0 }, hidingPlayer, 0.1, true);
  assert.notEqual(res3.monster.state, 'chase', 'Monster should not chase player hidden inside locker');
});

test('Generator puzzle progression and sequence reset on mismatch', () => {
  const state: FacilityState = {
    currentSector: 'Sector 4: Generator Room',
    hasKeycardAlpha: true,
    hasKeycardOmega: false,
    generatorStep: 0,
    generatorRequiredSequence: [2, 0, 3, 1], // switch indices
    generatorActive: false,
    containmentVentsPurged: false,
    airlockUnlocked: false,
    escaped: false,
    activeObjectiveId: 'obj_restore_power'
  };

  // Correct first switch
  const step1 = evaluateGeneratorSwitch(state, 2);
  assert.equal(step1.isSuccess, false);
  assert.equal(step1.sequenceReset, false);
  assert.equal(step1.state.generatorStep, 1);

  // Incorrect second switch (pressed 1 instead of 0)
  const stepFail = evaluateGeneratorSwitch(step1.state, 1);
  assert.equal(stepFail.sequenceReset, true);
  assert.equal(stepFail.state.generatorStep, 0);

  // Correct full sequence
  let current = state;
  current = evaluateGeneratorSwitch(current, 2).state;
  current = evaluateGeneratorSwitch(current, 0).state;
  current = evaluateGeneratorSwitch(current, 3).state;
  const finalStep = evaluateGeneratorSwitch(current, 1);
  assert.equal(finalStep.isSuccess, true);
  assert.equal(finalStep.state.generatorActive, true);
});

test('AABB collision resolution pushes player outside of obstacle bounds', () => {
  const wall: AABB = { minX: 10, maxX: 12, minZ: 0, maxZ: 10 };
  const radius = 0.5;

  // Player tries to walk inside the wall at x=10.2, z=5.0
  const check = checkAABBCollision(10.2, 5.0, radius, [wall]);
  assert.equal(check.collided, true);
  assert.ok(check.resolvedX < 10.0 || check.resolvedX > 12.0, 'Player position should be resolved outside wall');
});
