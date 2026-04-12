// Swept-AABB collision on Position directly.
// Port of Rust src/world/collision.rs

import * as THREE from 'three';
import { Position, clonePosition } from './position';
import { WorldState } from './state';
import {
  WorldAnchor, cellSizeAtLayer, cellOriginForAnchor, targetLayerFor,
  isLayerPosSolid, layerPosFromBevy, bevyFromPosition,
  positionToLeafCoord, positionFromLeafCoord,
} from './view';

// ------------------------------------------------------------ player AABB

export const PLAYER_HW = 0.3;
export const PLAYER_H = 1.7;

interface Aabb {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

function playerAabb(x: number, y: number, z: number, viewCell: number): Aabb {
  const hw = PLAYER_HW * viewCell;
  const h = PLAYER_H * viewCell;
  return { minX: x - hw, minY: y, minZ: z - hw, maxX: x + hw, maxY: y + h, maxZ: z + hw };
}

// ----------------------------------------------------- local-frame helpers

function localAnchor(pos: Position): WorldAnchor {
  return { leafCoord: positionToLeafCoord(pos) };
}

function localBevy(pos: Position, anchor: WorldAnchor): THREE.Vector3 {
  return bevyFromPosition(pos, anchor);
}

function positionFromLocal(local: THREE.Vector3, anchor: WorldAnchor): Position | null {
  const fx = Math.floor(local.x);
  const fy = Math.floor(local.y);
  const fz = Math.floor(local.z);
  const newLeaf: [bigint, bigint, bigint] = [
    anchor.leafCoord[0] + BigInt(fx),
    anchor.leafCoord[1] + BigInt(fy),
    anchor.leafCoord[2] + BigInt(fz),
  ];
  const newPos = positionFromLeafCoord(newLeaf);
  if (!newPos) return null;
  newPos.offset = [local.x - fx, local.y - fy, local.z - fz];
  return newPos;
}

// ----------------------------------------------------------- block grid

function getAabbComponent(aabb: Aabb, axis: number, isMin: boolean): number {
  if (axis === 0) return isMin ? aabb.minX : aabb.maxX;
  if (axis === 1) return isMin ? aabb.minY : aabb.maxY;
  return isMin ? aabb.minZ : aabb.maxZ;
}

function clipAxis(
  player: Aabb, delta: number, axis: number,
  bx: number, by: number, bz: number,
  blockSize: number, coX: number, coY: number, coZ: number,
): number {
  const a1 = axis === 0 ? 1 : 0;
  const a2 = axis <= 1 ? 2 : 1;

  const bMin = [coX + bx * blockSize, coY + by * blockSize, coZ + bz * blockSize];
  const bMax = [bMin[0] + blockSize, bMin[1] + blockSize, bMin[2] + blockSize];

  if (getAabbComponent(player, a1, false) <= bMin[a1] ||
      getAabbComponent(player, a1, true) >= bMax[a1]) return delta;
  if (getAabbComponent(player, a2, false) <= bMin[a2] ||
      getAabbComponent(player, a2, true) >= bMax[a2]) return delta;

  if (delta < 0) {
    const face = bMax[axis];
    const gap = face - getAabbComponent(player, axis, true);
    if (gap <= 0 && gap > delta) return gap;
  } else if (delta > 0) {
    const face = bMin[axis];
    const gap = face - getAabbComponent(player, axis, false);
    if (gap >= 0 && gap < delta) return gap;
  }
  return delta;
}

function isTargetBlockSolid(
  world: WorldState, targetLayer: number,
  bx: number, by: number, bz: number,
  blockSize: number, coX: number, coY: number, coZ: number,
  anchor: WorldAnchor,
): boolean {
  const center = new THREE.Vector3(
    coX + (bx + 0.5) * blockSize,
    coY + (by + 0.5) * blockSize,
    coZ + (bz + 0.5) * blockSize,
  );
  const lp = layerPosFromBevy(center, targetLayer, anchor);
  if (!lp) return false;
  return isLayerPosSolid(world, lp);
}

// --------------------------------------------------------- public API

function copyPosInto(dst: Position, src: Position): void {
  dst.path.set(src.path);
  dst.voxel[0] = src.voxel[0]; dst.voxel[1] = src.voxel[1]; dst.voxel[2] = src.voxel[2];
  dst.offset[0] = src.offset[0]; dst.offset[1] = src.offset[1]; dst.offset[2] = src.offset[2];
}

export function moveAndCollide(
  pos: Position, vel: THREE.Vector3,
  horizontalDelta: THREE.Vector2, dt: number,
  world: WorldState, viewLayer: number,
): void {
  const viewCell = cellSizeAtLayer(viewLayer);
  const targetLayer = targetLayerFor(viewLayer);
  const blockSize = cellSizeAtLayer(targetLayer);
  const blockSizeBI = BigInt(Math.round(blockSize));

  const anchor = localAnchor(pos);
  const co = cellOriginForAnchor(anchor, blockSizeBI);
  const coX = co.x, coY = co.y, coZ = co.z;

  const lp = localBevy(pos, anchor);
  let localX = lp.x, localY = lp.y, localZ = lp.z;

  let dy = vel.y * dt;
  const dx0 = horizontalDelta.x;
  const dz0 = horizontalDelta.y;

  const pa = playerAabb(localX, localY, localZ, viewCell);
  const expandedMin = [
    pa.minX + Math.min(dx0, 0) - blockSize,
    pa.minY + Math.min(dy, 0) - blockSize,
    pa.minZ + Math.min(dz0, 0) - blockSize,
  ];
  const expandedMax = [
    pa.maxX + Math.max(dx0, 0) + blockSize,
    pa.maxY + Math.max(dy, 0) + blockSize,
    pa.maxZ + Math.max(dz0, 0) + blockSize,
  ];

  const bMinX = Math.floor((expandedMin[0] - coX) / blockSize);
  const bMinY = Math.floor((expandedMin[1] - coY) / blockSize);
  const bMinZ = Math.floor((expandedMin[2] - coZ) / blockSize);
  const bMaxX = Math.floor((expandedMax[0] - coX - 1e-5) / blockSize);
  const bMaxY = Math.floor((expandedMax[1] - coY - 1e-5) / blockSize);
  const bMaxZ = Math.floor((expandedMax[2] - coZ - 1e-5) / blockSize);

  const blocks: [number, number, number][] = [];
  for (let by = bMinY; by <= bMaxY; by++) {
    for (let bz = bMinZ; bz <= bMaxZ; bz++) {
      for (let bx = bMinX; bx <= bMaxX; bx++) {
        if (isTargetBlockSolid(world, targetLayer, bx, by, bz, blockSize, coX, coY, coZ, anchor)) {
          blocks.push([bx, by, bz]);
        }
      }
    }
  }

  // Y first
  let aabb = playerAabb(localX, localY, localZ, viewCell);
  const origDy = dy;
  for (const [bx, by, bz] of blocks) {
    dy = clipAxis(aabb, dy, 1, bx, by, bz, blockSize, coX, coY, coZ);
  }
  localY += dy;
  if (Math.abs(dy - origDy) > 1e-6) vel.y = 0;

  // X
  aabb = playerAabb(localX, localY, localZ, viewCell);
  let dx = dx0;
  for (const [bx, by, bz] of blocks) {
    dx = clipAxis(aabb, dx, 0, bx, by, bz, blockSize, coX, coY, coZ);
  }
  localX += dx;

  // Z
  aabb = playerAabb(localX, localY, localZ, viewCell);
  let dz = dz0;
  for (const [bx, by, bz] of blocks) {
    dz = clipAxis(aabb, dz, 2, bx, by, bz, blockSize, coX, coY, coZ);
  }
  localZ += dz;

  const updated = positionFromLocal(new THREE.Vector3(localX, localY, localZ), anchor);
  if (updated) copyPosInto(pos, updated);
}

export function onGround(pos: Position, world: WorldState, viewLayer: number): boolean {
  const viewCell = cellSizeAtLayer(viewLayer);
  const targetLayer = targetLayerFor(viewLayer);
  const blockSize = cellSizeAtLayer(targetLayer);
  const blockSizeBI = BigInt(Math.round(blockSize));

  const anchor = localAnchor(pos);
  const co = cellOriginForAnchor(anchor, blockSizeBI);
  const coX = co.x, coY = co.y, coZ = co.z;
  const lp = localBevy(pos, anchor);

  const aabb = playerAabb(lp.x, lp.y, lp.z, viewCell);
  const probe: Aabb = {
    minX: aabb.minX, minY: aabb.minY - 0.1 * blockSize, minZ: aabb.minZ,
    maxX: aabb.maxX, maxY: aabb.maxY, maxZ: aabb.maxZ,
  };

  const bMinX = Math.floor((probe.minX - coX) / blockSize);
  const bMinY = Math.floor((probe.minY - coY) / blockSize);
  const bMinZ = Math.floor((probe.minZ - coZ) / blockSize);
  const bMaxX = Math.floor(((probe.maxX - coX) - 1e-5) / blockSize);
  const bMaxY = Math.floor(((probe.maxY - coY) - 1e-5) / blockSize);
  const bMaxZ = Math.floor(((probe.maxZ - coZ) - 1e-5) / blockSize);

  let testDy = -0.05 * blockSize;
  for (let by = bMinY; by <= bMaxY; by++) {
    for (let bz = bMinZ; bz <= bMaxZ; bz++) {
      for (let bx = bMinX; bx <= bMaxX; bx++) {
        if (isTargetBlockSolid(world, targetLayer, bx, by, bz, blockSize, coX, coY, coZ, anchor)) {
          testDy = clipAxis(aabb, testDy, 1, bx, by, bz, blockSize, coX, coY, coZ);
        }
      }
    }
  }
  return Math.abs(testDy) < 0.04 * blockSize;
}

export function snapToGround(pos: Position, world: WorldState, viewLayer: number): void {
  const targetLayer = targetLayerFor(viewLayer);
  const blockSize = cellSizeAtLayer(targetLayer);
  const blockSizeBI = BigInt(Math.round(blockSize));

  const anchor = localAnchor(pos);
  const co = cellOriginForAnchor(anchor, blockSizeBI);
  const coX = co.x, coY = co.y, coZ = co.z;
  const lp = localBevy(pos, anchor);

  const bx = Math.floor((lp.x - coX) / blockSize);
  const bz = Math.floor((lp.z - coZ) / blockSize);
  let by = Math.floor((lp.y - coY) / blockSize);

  const solidAt = (testBy: number) =>
    isTargetBlockSolid(world, targetLayer, bx, testBy, bz, blockSize, coX, coY, coZ, anchor);

  let newY: number | null = null;
  if (solidAt(by)) {
    for (let i = 0; i < 256; i++) {
      by++;
      if (!solidAt(by)) { newY = coY + by * blockSize; break; }
    }
  } else {
    for (let i = 0; i < 256; i++) {
      by--;
      if (solidAt(by)) { newY = coY + (by + 1) * blockSize; break; }
    }
  }

  if (newY !== null) {
    const updated = positionFromLocal(new THREE.Vector3(lp.x, newY, lp.z), anchor);
    if (updated) copyPosInto(pos, updated);
  }
}
