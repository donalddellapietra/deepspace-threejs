import { MAX_LAYER, BRANCH_FACTOR, NODE_VOXELS_PER_AXIS, slotCoords, slotIndex } from './tree';

export const NODE_PATH_LEN = 12;

export interface Position {
  path: Uint8Array;                   // length NODE_PATH_LEN, each 0..124
  voxel: [number, number, number];    // each 0..24
  offset: [number, number, number];   // each 0.0..1.0
}

export function zeroPath(): Uint8Array {
  return new Uint8Array(NODE_PATH_LEN);
}

export function originPosition(): Position {
  return { path: zeroPath(), voxel: [0, 0, 0], offset: [0, 0, 0] };
}

export function clonePosition(p: Position): Position {
  return {
    path: new Uint8Array(p.path),
    voxel: [p.voxel[0], p.voxel[1], p.voxel[2]],
    offset: [p.offset[0], p.offset[1], p.offset[2]],
  };
}

// Cross one leaf boundary on the given axis. Walks up the path until
// finding an ancestor whose slot can step, then resets lower slots and
// voxel to the opposite face. Mirrors Rust step_neighbor_leaf exactly.
function stepNeighborLeaf(pos: Position, axis: number, positive: boolean): boolean {
  const delta = positive ? 1 : -1;
  const resetSlotAxis = positive ? 0 : BRANCH_FACTOR - 1;
  const resetVoxelAxis = positive ? 0 : NODE_VOXELS_PER_AXIS - 1;

  let layerIdx = NODE_PATH_LEN - 1;
  while (true) {
    const slot = pos.path[layerIdx];
    const [sx, sy, sz] = slotCoords(slot);
    const ax: [number, number, number] = [sx, sy, sz];
    const newA = ax[axis] + delta;
    if (newA >= 0 && newA < BRANCH_FACTOR) {
      ax[axis] = newA;
      pos.path[layerIdx] = slotIndex(ax[0], ax[1], ax[2]);
      for (let lower = layerIdx + 1; lower < NODE_PATH_LEN; lower++) {
        const ls = pos.path[lower];
        const [lx, ly, lz] = slotCoords(ls);
        const lax: [number, number, number] = [lx, ly, lz];
        lax[axis] = resetSlotAxis;
        pos.path[lower] = slotIndex(lax[0], lax[1], lax[2]);
      }
      pos.voxel[axis] = resetVoxelAxis;
      return true;
    }
    if (layerIdx === 0) return false;
    layerIdx--;
  }
}

export function stepVoxels(pos: Position, axis: number, delta: number): boolean {
  if (delta === 0) return true;
  const savedPath = new Uint8Array(pos.path);
  const savedVoxel = pos.voxel[axis];

  let newV = pos.voxel[axis] + delta;
  while (newV >= NODE_VOXELS_PER_AXIS) {
    if (!stepNeighborLeaf(pos, axis, true)) {
      pos.path.set(savedPath);
      pos.voxel[axis] = savedVoxel;
      return false;
    }
    newV -= NODE_VOXELS_PER_AXIS;
  }
  while (newV < 0) {
    if (!stepNeighborLeaf(pos, axis, false)) {
      pos.path.set(savedPath);
      pos.voxel[axis] = savedVoxel;
      return false;
    }
    newV += NODE_VOXELS_PER_AXIS;
  }
  pos.voxel[axis] = newV;
  return true;
}

export function addOffsetAxis(pos: Position, axis: number, delta: number): boolean {
  const newOffset = pos.offset[axis] + delta;
  const whole = Math.floor(newOffset);
  if (whole !== 0 && !stepVoxels(pos, axis, whole)) {
    return false;
  }
  pos.offset[axis] = newOffset - whole;
  return true;
}

// ---------------------------------------------------------------------------
// LayerPos
// ---------------------------------------------------------------------------

export interface LayerPos {
  pathSlots: Uint8Array;
  cell: [number, number, number];
  layer: number;
}

export function layerPosFromLeaf(leaf: Position, layer: number): LayerPos {
  const pathSlots = new Uint8Array(NODE_PATH_LEN);
  pathSlots.set(leaf.path);

  let cx = leaf.voxel[0];
  let cy = leaf.voxel[1];
  let cz = leaf.voxel[2];

  for (let depth = NODE_PATH_LEN - 1; depth >= layer; depth--) {
    const [sx, sy, sz] = slotCoords(leaf.path[depth]);
    cx = BRANCH_FACTOR * sx + Math.floor(cx / BRANCH_FACTOR);
    cy = BRANCH_FACTOR * sy + Math.floor(cy / BRANCH_FACTOR);
    cz = BRANCH_FACTOR * sz + Math.floor(cz / BRANCH_FACTOR);
  }

  return { pathSlots, cell: [cx, cy, cz], layer };
}

export function layerPosPath(lp: LayerPos): Uint8Array {
  return lp.pathSlots.slice(0, lp.layer);
}
