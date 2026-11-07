/**
 * Loop Recall: The Lost Facility - Core Game Logic & Rules
 * Decoupled pure logic for testing and deterministic simulation.
 */

export interface PlayerStats {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  battery: number;
  maxBattery: number;
  isSprinting: boolean;
  isCrouching: boolean;
  flashlightOn: boolean;
  isHiding: boolean;
  isDead: boolean;
}

export type MonsterState = 'idle' | 'patrol' | 'investigate' | 'chase' | 'search' | 'attack';

export interface MonsterAI {
  state: MonsterState;
  position: { x: number; z: number };
  targetPosition: { x: number; z: number };
  patrolWaypoints: Array<{ x: number; z: number }>;
  currentWaypointIdx: number;
  alertTimer: number;
  searchTimer: number;
  chaseSpeed: number;
  patrolSpeed: number;
  detectionRangeNormal: number;
  detectionRangeSprint: number;
  detectionRangeFlashlight: number;
  hearingRangeCrouch: number;
  attackRange: number;
}

export interface FacilityState {
  currentSector: string;
  hasKeycardAlpha: boolean;
  hasKeycardOmega: boolean;
  generatorStep: number;
  generatorRequiredSequence: number[];
  generatorActive: boolean;
  containmentVentsPurged: boolean;
  airlockUnlocked: boolean;
  escaped: boolean;
  activeObjectiveId: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  type: 'keycard' | 'battery' | 'medkit' | 'document' | 'tool';
  count: number;
}

// Player simulation tick
export function updatePlayerStats(
  stats: PlayerStats,
  dt: number,
  input: { sprintIntent: boolean; moveMagnitude: number }
): PlayerStats {
  const next = { ...stats };
  if (next.isDead) return next;

  // Stamina logic
  const isMoving = input.moveMagnitude > 0.05;
  if (input.sprintIntent && isMoving && !next.isCrouching && !next.isHiding && next.stamina > 5) {
    next.isSprinting = true;
    next.stamina = Math.max(0, next.stamina - 22 * dt);
    if (next.stamina <= 0) {
      next.isSprinting = false;
    }
  } else {
    next.isSprinting = false;
    const regenRate = next.isCrouching ? 20 : 14;
    next.stamina = Math.min(next.maxStamina, next.stamina + regenRate * dt);
  }

  // Battery logic
  if (next.flashlightOn && !next.isHiding) {
    next.battery = Math.max(0, next.battery - 1.2 * dt);
    if (next.battery <= 0) {
      next.flashlightOn = false;
    }
  }

  return next;
}

// Battery flickering probability calculation (when battery is low or monster is close)
export function getFlashlightFlickerIntensity(battery: number, monsterDist: number): number {
  if (battery <= 0) return 1.0;
  let flicker = 0;
  if (battery < 25) {
    flicker += (25 - battery) / 25 * 0.6;
  }
  if (monsterDist < 12) {
    flicker += Math.max(0, (12 - monsterDist) / 12 * 0.9);
  }
  return Math.min(1.0, flicker);
}

// Monster perception and state machine transition
export function updateMonsterAI(
  monster: MonsterAI,
  playerPos: { x: number; z: number },
  playerStats: PlayerStats,
  dt: number,
  hasDirectLOS: boolean
): { monster: MonsterAI; damageDealt: number; triggeredStinger: boolean } {
  const next = {
    ...monster,
    position: { ...monster.position },
    targetPosition: { ...monster.targetPosition }
  };
  let damageDealt = 0;
  let triggeredStinger = false;

  const dx = playerPos.x - next.position.x;
  const dz = playerPos.z - next.position.z;
  const distToPlayer = Math.hypot(dx, dz);

  // If player is inside a hiding spot (locker), monster loses direct targeting unless already right in front
  const effectiveLOS = hasDirectLOS && (!playerStats.isHiding || distToPlayer < 2.0);

  // Perception thresholds
  let audibleRange = 6.0;
  if (playerStats.isSprinting) {
    audibleRange = next.detectionRangeSprint; // 24.0
  } else if (playerStats.isCrouching) {
    audibleRange = next.hearingRangeCrouch; // 2.5
  }

  let visualRange = next.detectionRangeNormal; // 14.0
  if (playerStats.flashlightOn) {
    visualRange = next.detectionRangeFlashlight; // 26.0
  }

  const canHearPlayer = distToPlayer < audibleRange && !playerStats.isHiding;
  const canSeePlayer = effectiveLOS && distToPlayer < visualRange;

  // State Machine
  switch (next.state) {
    case 'idle':
    case 'patrol': {
      if (canSeePlayer) {
        next.state = 'chase';
        next.targetPosition = { x: playerPos.x, z: playerPos.z };
        triggeredStinger = true;
      } else if (canHearPlayer) {
        next.state = 'investigate';
        next.targetPosition = { x: playerPos.x, z: playerPos.z };
        next.alertTimer = 6.0;
      } else {
        // Patrol movement towards current waypoint
        if (next.patrolWaypoints.length > 0) {
          const wp = next.patrolWaypoints[next.currentWaypointIdx];
          const wpDist = Math.hypot(wp.x - next.position.x, wp.z - next.position.z);
          if (wpDist < 1.0) {
            next.currentWaypointIdx = (next.currentWaypointIdx + 1) % next.patrolWaypoints.length;
          } else {
            const step = next.patrolSpeed * dt;
            next.position.x += ((wp.x - next.position.x) / wpDist) * step;
            next.position.z += ((wp.z - next.position.z) / wpDist) * step;
          }
        }
      }
      break;
    }

    case 'investigate': {
      if (canSeePlayer) {
        next.state = 'chase';
        next.targetPosition = { x: playerPos.x, z: playerPos.z };
        triggeredStinger = true;
      } else {
        const tDist = Math.hypot(next.targetPosition.x - next.position.x, next.targetPosition.z - next.position.z);
        if (tDist > 0.8) {
          const step = next.patrolSpeed * 1.3 * dt;
          next.position.x += ((next.targetPosition.x - next.position.x) / tDist) * step;
          next.position.z += ((next.targetPosition.z - next.position.z) / tDist) * step;
        }
        next.alertTimer -= dt;
        if (next.alertTimer <= 0) {
          next.state = 'search';
          next.searchTimer = 5.0;
        }
      }
      break;
    }

    case 'chase': {
      if (canSeePlayer) {
        next.targetPosition = { x: playerPos.x, z: playerPos.z };
      }

      const tDist = Math.hypot(next.targetPosition.x - next.position.x, next.targetPosition.z - next.position.z);

      if (distToPlayer <= next.attackRange && !playerStats.isHiding) {
        next.state = 'attack';
        damageDealt = 40; // Heavy strike
      } else if (tDist > 0.4) {
        const step = next.chaseSpeed * dt;
        next.position.x += ((next.targetPosition.x - next.position.x) / tDist) * step;
        next.position.z += ((next.targetPosition.z - next.position.z) / tDist) * step;
      }

      // If line of sight lost and reached last known target
      if (!canSeePlayer && tDist <= 1.2) {
        next.state = 'search';
        next.searchTimer = 6.0;
      }
      break;
    }

    case 'attack': {
      // Wind-down to chase or search
      if (distToPlayer > next.attackRange) {
        next.state = 'chase';
      } else {
        damageDealt = 25 * dt; // Continuous close contact damage
      }
      break;
    }

    case 'search': {
      if (canSeePlayer) {
        next.state = 'chase';
        next.targetPosition = { x: playerPos.x, z: playerPos.z };
        triggeredStinger = true;
      } else if (canHearPlayer) {
        next.state = 'investigate';
        next.targetPosition = { x: playerPos.x, z: playerPos.z };
        next.alertTimer = 4.0;
      } else {
        next.searchTimer -= dt;
        if (next.searchTimer <= 0) {
          next.state = 'patrol';
        }
      }
      break;
    }
  }

  return { monster: next, damageDealt, triggeredStinger };
}

// Facility puzzle sequence and progression validator
export function evaluateGeneratorSwitch(
  currentState: FacilityState,
  switchIndex: number
): { state: FacilityState; isSuccess: boolean; sequenceReset: boolean } {
  const next = { ...currentState };
  const expectedSwitch = next.generatorRequiredSequence[next.generatorStep];

  if (switchIndex === expectedSwitch) {
    next.generatorStep += 1;
    if (next.generatorStep >= next.generatorRequiredSequence.length) {
      next.generatorActive = true;
      next.activeObjectiveId = 'obj_access_containment';
      return { state: next, isSuccess: true, sequenceReset: false };
    }
    return { state: next, isSuccess: false, sequenceReset: false };
  } else {
    // Sequence mismatch resets the puzzle
    next.generatorStep = 0;
    return { state: next, isSuccess: false, sequenceReset: true };
  }
}

// Box collision checker
export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function checkAABBCollision(
  x: number,
  z: number,
  radius: number,
  colliders: AABB[]
): { collided: boolean; resolvedX: number; resolvedZ: number } {
  let resX = x;
  let resZ = z;
  let collided = false;

  for (const box of colliders) {
    const isInsideX = resX >= box.minX && resX <= box.maxX;
    const isInsideZ = resZ >= box.minZ && resZ <= box.maxZ;

    if (isInsideX && isInsideZ) {
      // Center is completely inside the box: find closest edge and push out by radius
      collided = true;
      const dMinX = resX - box.minX;
      const dMaxX = box.maxX - resX;
      const dMinZ = resZ - box.minZ;
      const dMaxZ = box.maxZ - resZ;
      const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);

      if (minD === dMinX) {
        resX = box.minX - radius;
      } else if (minD === dMaxX) {
        resX = box.maxX + radius;
      } else if (minD === dMinZ) {
        resZ = box.minZ - radius;
      } else {
        resZ = box.maxZ + radius;
      }
      continue;
    }

    // Closest point on box boundary
    const closestX = Math.max(box.minX, Math.min(resX, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(resZ, box.maxZ));

    const distX = resX - closestX;
    const distZ = resZ - closestZ;
    const distanceSq = distX * distX + distZ * distZ;

    if (distanceSq < radius * radius) {
      collided = true;
      const dist = Math.sqrt(distanceSq) || 0.001;
      const penetration = radius - dist;
      resX += (distX / dist) * penetration;
      resZ += (distZ / dist) * penetration;
    }
  }

  return { collided, resolvedX: resX, resolvedZ: resZ };
}
