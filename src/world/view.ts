// Layer-space coordinate math, floating anchor, and solidity queries.
// Port of Rust src/world/view.rs

import * as THREE from 'three';
import {
  MAX_LAYER, BRANCH_FACTOR, NODE_VOXELS_PER_AXIS,
  EMPTY_NODE, EMPTY_VOXEL, voxelIdx, slotIndex, slotCoords,
} from './tree';
import { Position, LayerPos, NODE_PATH_LEN, layerPosFromLeaf } from './position';
import { WorldState, worldExtentVoxels } from './state';

// ---------------------------------------------------------------- anchor

export interface WorldAnchor {
  leafCoord: [bigint, bigint, bigint];
}

export function defaultAnchor(): WorldAnchor {
  return { leafCoord: [0n, 0n, 0n] };
}

// ----------------------------------------------------- per-layer sizes

export function scaleForLayer(layer: number): number {
  let acc = 1;
  for (let i = 0; i < MAX_LAYER - layer; i++) acc *= 5;
  return acc;
}

export function extentForLayer(layer: number): number {
  return scaleForLayer(layer) * NODE_VOXELS_PER_AXIS;
}

export function cellSizeAtLayer(layer: number): number {
  return scaleForLayer(layer);
}

export function targetLayerFor(viewLayer: number): number {
  return Math.min(viewLayer + 2, MAX_LAYER);
}

// ------------------------------------------------------ leaf coord math

export function positionToLeafCoord(pos: Position): [bigint, bigint, bigint] {
  const coord: [bigint, bigint, bigint] = [0n, 0n, 0n];
  let extent = worldExtentVoxels();
  for (let depth = 0; depth < NODE_PATH_LEN; depth++) {
    const childExtent = extent / 5n;
    const [sx, sy, sz] = slotCoords(pos.path[depth]);
    coord[0] += BigInt(sx) * childExtent;
    coord[1] += BigInt(sy) * childExtent;
    coord[2] += BigInt(sz) * childExtent;
    extent = childExtent;
  }
  coord[0] += BigInt(pos.voxel[0]);
  coord[1] += BigInt(pos.voxel[1]);
  coord[2] += BigInt(pos.voxel[2]);
  return coord;
}

export function positionFromLeafCoord(coord: [bigint, bigint, bigint]): Position | null {
  const worldMax = worldExtentVoxels();
  if (coord[0] < 0n || coord[1] < 0n || coord[2] < 0n ||
      coord[0] >= worldMax || coord[1] >= worldMax || coord[2] >= worldMax) {
    return null;
  }
  const rem: [bigint, bigint, bigint] = [coord[0], coord[1], coord[2]];
  const path = new Uint8Array(NODE_PATH_LEN);
  let extent = worldMax;
  for (let depth = 0; depth < NODE_PATH_LEN; depth++) {
    const childExtent = extent / 5n;
    const sx = Number(rem[0] / childExtent);
    const sy = Number(rem[1] / childExtent);
    const sz = Number(rem[2] / childExtent);
    path[depth] = slotIndex(sx, sy, sz);
    rem[0] -= BigInt(sx) * childExtent;
    rem[1] -= BigInt(sy) * childExtent;
    rem[2] -= BigInt(sz) * childExtent;
    extent = childExtent;
  }
  return {
    path,
    voxel: [Number(rem[0]), Number(rem[1]), Number(rem[2])],
    offset: [0, 0, 0],
  };
}

// ------------------------------------------------------ conversions

export function bevyFromPosition(pos: Position, anchor: WorldAnchor): THREE.Vector3 {
  const coord = positionToLeafCoord(pos);
  return new THREE.Vector3(
    Number(coord[0] - anchor.leafCoord[0]) + pos.offset[0],
    Number(coord[1] - anchor.leafCoord[1]) + pos.offset[1],
    Number(coord[2] - anchor.leafCoord[2]) + pos.offset[2],
  );
}

export function positionFromBevy(bevy: THREE.Vector3, anchor: WorldAnchor): Position | null {
  if (!isFinite(bevy.x) || !isFinite(bevy.y) || !isFinite(bevy.z)) return null;
  const fx = Math.floor(bevy.x);
  const fy = Math.floor(bevy.y);
  const fz = Math.floor(bevy.z);
  const coord: [bigint, bigint, bigint] = [
    anchor.leafCoord[0] + BigInt(fx),
    anchor.leafCoord[1] + BigInt(fy),
    anchor.leafCoord[2] + BigInt(fz),
  ];
  const pos = positionFromLeafCoord(coord);
  if (!pos) return null;
  pos.offset = [bevy.x - fx, bevy.y - fy, bevy.z - fz];
  return pos;
}

export function layerPosFromBevy(
  bevy: THREE.Vector3,
  layer: number,
  anchor: WorldAnchor,
): LayerPos | null {
  const leaf = positionFromBevy(bevy, anchor);
  if (!leaf) return null;
  return layerPosFromLeaf(leaf, layer);
}

// ------------------------------------------------------ cell origin

export function cellOriginForAnchor(anchor: WorldAnchor, cellSizeLeaves: bigint): THREE.Vector3 {
  // rem_euclid for BigInt
  const remEuclid = (a: bigint, b: bigint): bigint => {
    const r = a % b;
    return r < 0n ? r + b : r;
  };
  return new THREE.Vector3(
    -Number(remEuclid(anchor.leafCoord[0], cellSizeLeaves)),
    -Number(remEuclid(anchor.leafCoord[1], cellSizeLeaves)),
    -Number(remEuclid(anchor.leafCoord[2], cellSizeLeaves)),
  );
}

// ------------------------------------------------------ layer pos coords

export function layerPosMinLeafCoord(lp: LayerPos): [bigint, bigint, bigint] {
  const coord: [bigint, bigint, bigint] = [0n, 0n, 0n];
  let extent = worldExtentVoxels();
  for (let depth = 0; depth < lp.layer; depth++) {
    const childExtent = extent / 5n;
    const [sx, sy, sz] = slotCoords(lp.pathSlots[depth]);
    coord[0] += BigInt(sx) * childExtent;
    coord[1] += BigInt(sy) * childExtent;
    coord[2] += BigInt(sz) * childExtent;
    extent = childExtent;
  }
  // After descending lp.layer slots, extent is the node's axis size.
  // A cell is extent/25 leaves wide.
  const cellSizeLeaves = extent / BigInt(NODE_VOXELS_PER_AXIS);
  coord[0] += BigInt(lp.cell[0]) * cellSizeLeaves;
  coord[1] += BigInt(lp.cell[1]) * cellSizeLeaves;
  coord[2] += BigInt(lp.cell[2]) * cellSizeLeaves;
  return coord;
}

export function bevyOriginOfLayerPos(lp: LayerPos, anchor: WorldAnchor): THREE.Vector3 {
  const leaf = layerPosMinLeafCoord(lp);
  return new THREE.Vector3(
    Number(leaf[0] - anchor.leafCoord[0]),
    Number(leaf[1] - anchor.leafCoord[1]),
    Number(leaf[2] - anchor.leafCoord[2]),
  );
}

export function bevyCenterOfLayerPos(lp: LayerPos, anchor: WorldAnchor): THREE.Vector3 {
  const cell = cellSizeAtLayer(lp.layer);
  const origin = bevyOriginOfLayerPos(lp, anchor);
  return origin.addScalar(cell * 0.5);
}

// -------------------------------------------------------- solidity

export function isLayerPosSolid(world: WorldState, lp: LayerPos): boolean {
  let id = world.root;
  for (let depth = 0; depth < lp.layer; depth++) {
    const slot = lp.pathSlots[depth];
    const node = world.library.get(id);
    if (!node) return false;
    if (!node.children) return false;
    id = node.children[slot];
    if (id === EMPTY_NODE) return false;
  }
  const node = world.library.get(id);
  if (!node) return false;
  const v = node.voxels[voxelIdx(lp.cell[0], lp.cell[1], lp.cell[2])];
  return v !== EMPTY_VOXEL;
}
