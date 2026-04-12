// Player entity: gravity + WASD + jump with Position as authority.
// Port of Rust src/player.rs

import * as THREE from 'three';
import { Position, NODE_PATH_LEN, clonePosition } from './world/position';
import { GROUND_TRANSITION_DEPTH } from './world/state';
import { slotIndex, NODE_VOXELS_PER_AXIS } from './world/tree';
import { PLAYER_H, moveAndCollide, onGround, snapToGround } from './world/collision';
import {
  WorldAnchor, positionToLeafCoord, bevyFromPosition, cellSizeAtLayer,
} from './world/view';
import { WorldState } from './world/state';

export const PLAYER_HEIGHT = PLAYER_H;
const WALK_SPEED_CELLS = 8;
const SPRINT_SPEED_CELLS = 16;
const JUMP_IMPULSE_CELLS = 8;
const GRAVITY_CELLS = 20;

export function spawnPosition(): Position {
  const path = new Uint8Array(NODE_PATH_LEN);
  const midSlot = slotIndex(2, 0, 2);
  path.fill(midSlot);
  // At GROUND_TRANSITION_DEPTH, sy=1 → first air region above ground
  path[GROUND_TRANSITION_DEPTH] = slotIndex(2, 1, 2);
  const mid = Math.floor(NODE_VOXELS_PER_AXIS / 2);
  return {
    path,
    voxel: [mid, 2, mid],
    offset: [0.5, 0, 0.5],
  };
}

export function spawnAnchor(): WorldAnchor {
  return { leafCoord: positionToLeafCoord(spawnPosition()) };
}

export class Player {
  position: Position;
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  constructor() {
    this.position = spawnPosition();
  }

  update(
    dt: number, keys: Set<string>, justPressed: Set<string>,
    world: WorldState, viewLayer: number, inventoryOpen: boolean,
  ): void {
    if (inventoryOpen) return;

    const cell = cellSizeAtLayer(viewLayer);
    const walkSpeed = WALK_SPEED_CELLS * cell;
    const sprintSpeed = SPRINT_SPEED_CELLS * cell;
    const jumpImpulse = JUMP_IMPULSE_CELLS * cell;
    const gravity = GRAVITY_CELLS * cell;

    // Camera-relative horizontal basis
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    let inputX = 0, inputZ = 0;
    if (keys.has('KeyW')) inputZ += 1;
    if (keys.has('KeyS')) inputZ -= 1;
    if (keys.has('KeyD')) inputX += 1;
    if (keys.has('KeyA')) inputX -= 1;

    // Jump
    if (justPressed.has('Space') && onGround(this.position, world, viewLayer)) {
      this.velocity.y = jumpImpulse;
    }

    // Gravity
    this.velocity.y -= gravity * dt;

    // Horizontal
    const speed = keys.has('ShiftLeft') ? sprintSpeed : walkSpeed;
    let hDelta = new THREE.Vector2();
    if (inputX !== 0 || inputZ !== 0) {
      const dir = new THREE.Vector3()
        .addScaledVector(forward, inputZ)
        .addScaledVector(right, inputX)
        .normalize();
      hDelta.set(dir.x * speed * dt, dir.z * speed * dt);
    }

    moveAndCollide(this.position, this.velocity, hDelta, dt, world, viewLayer);
  }

  getAnchor(): WorldAnchor {
    return { leafCoord: positionToLeafCoord(this.position) };
  }

  getBevyPosition(anchor: WorldAnchor): THREE.Vector3 {
    return bevyFromPosition(this.position, anchor);
  }

  reset(world: WorldState, viewLayer: number): void {
    const sp = spawnPosition();
    this.position.path.set(sp.path);
    this.position.voxel = [...sp.voxel];
    this.position.offset = [...sp.offset];
    this.velocity.set(0, 0, 0);
    snapToGround(this.position, world, viewLayer);
  }
}
