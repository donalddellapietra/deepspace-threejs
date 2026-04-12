import { MAX_LAYER, BRANCH_FACTOR, NODE_VOXELS_PER_AXIS, slotCoords, slotIndex } from './tree';

/** Number of entries in a node path (equals MAX_LAYER). */
export const NODE_PATH_LEN = 12;

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

export interface Position {
  path: Uint8Array;                   // length NODE_PATH_LEN, each 0..124
  voxel: [number, number, number];    // each 0..24
  offset: [number, number, number];   // each 0.0..1.0
}

export function zeroPath(): Uint8Array {
  return new Uint8Array(NODE_PATH_LEN);
}

export function originPosition(): Position {
  return {
    path: zeroPath(),
    voxel: [0, 0, 0],
    offset: [0, 0, 0],
  };
}

export function clonePosition(p: Position): Position {
  return {
    path: new Uint8Array(p.path),
    voxel: [p.voxel[0], p.voxel[1], p.voxel[2]],
    offset: [p.offset[0], p.offset[1], p.offset[2]],
  };
}

// ---------------------------------------------------------------------------
// stepVoxels – step by signed integer voxels on one axis
// ---------------------------------------------------------------------------

/**
 * Step `pos` by `delta` voxels along `axis` (0=x, 1=y, 2=z).
 *
 * When the voxel coordinate leaves 0..24, we walk up the path to find the
 * nearest ancestor whose slot can absorb the step on that axis, then reset
 * all lower slots and the voxel to the opposite face.
 *
 * Returns `false` (and restores `pos`) if the step walks past the root.
 */
export function stepVoxels(pos: Position, axis: number, delta: number): boolean {
  if (delta === 0) return true;

  // Snapshot for rollback.
  const saved = clonePosition(pos);

  let v = pos.voxel[axis] + delta;

  // Fast path: stays inside the leaf.
  if (v >= 0 && v < NODE_VOXELS_PER_AXIS) {
    pos.voxel[axis] = v;
    return true;
  }

  // We need to carry into the path.  Walk upward from the deepest path slot
  // (index NODE_PATH_LEN - 1) toward the root (index 0).
  // At each depth the coordinate along `axis` comes from slotCoords.
  // We accumulate carry until we find a level that absorbs it.

  // Determine carry direction and the residual voxel.
  // carry > 0 means we step toward higher slot coords; < 0 toward lower.
  let carry: number;
  if (v < 0) {
    // E.g. v = -1  =>  carry = -1, new voxel = NODE_VOXELS_PER_AXIS - 1
    carry = Math.floor(v / NODE_VOXELS_PER_AXIS);              // negative
    v = v - carry * NODE_VOXELS_PER_AXIS;                       // 0..24
  } else {
    carry = Math.floor(v / NODE_VOXELS_PER_AXIS);              // positive
    v = v - carry * NODE_VOXELS_PER_AXIS;
  }
  pos.voxel[axis] = v;

  // Walk up the path from leaf toward root.
  for (let depth = NODE_PATH_LEN - 1; depth >= 0; depth--) {
    const [sx, sy, sz] = slotCoords(pos.path[depth]);
    const coords: [number, number, number] = [sx, sy, sz];

    let c = coords[axis] + carry;

    if (c >= 0 && c < BRANCH_FACTOR) {
      // Absorbed at this depth.
      coords[axis] = c;
      pos.path[depth] = slotIndex(coords[0], coords[1], coords[2]);
      // Reset all slots below this depth to the appropriate face.
      const faceSlotCoord = carry > 0 ? 0 : BRANCH_FACTOR - 1;
      for (let d = depth + 1; d < NODE_PATH_LEN; d++) {
        const [lx, ly, lz] = slotCoords(pos.path[d]);
        const lc: [number, number, number] = [lx, ly, lz];
        lc[axis] = faceSlotCoord;
        pos.path[d] = slotIndex(lc[0], lc[1], lc[2]);
      }
      return true;
    }

    // Still carrying – propagate upward.
    if (c < 0) {
      carry = Math.floor(c / BRANCH_FACTOR);
      c = c - carry * BRANCH_FACTOR;
    } else {
      carry = Math.floor(c / BRANCH_FACTOR);
      c = c - carry * BRANCH_FACTOR;
    }
    coords[axis] = c;
    pos.path[depth] = slotIndex(coords[0], coords[1], coords[2]);
  }

  // Carry still nonzero after root – walked off the world.  Rollback.
  pos.path.set(saved.path);
  pos.voxel[0] = saved.voxel[0];
  pos.voxel[1] = saved.voxel[1];
  pos.voxel[2] = saved.voxel[2];
  pos.offset[0] = saved.offset[0];
  pos.offset[1] = saved.offset[1];
  pos.offset[2] = saved.offset[2];
  return false;
}

// ---------------------------------------------------------------------------
// addOffsetAxis – sub-voxel movement with carry
// ---------------------------------------------------------------------------

/**
 * Add a floating-point `delta` to `pos.offset[axis]`, carrying whole voxels
 * into `stepVoxels`.  Returns `false` (position untouched) on overflow.
 */
export function addOffsetAxis(pos: Position, axis: number, delta: number): boolean {
  const saved = clonePosition(pos);

  let o = pos.offset[axis] + delta;
  let voxelDelta = Math.floor(o);
  o = o - voxelDelta;

  // Normalize so offset stays in [0, 1).
  if (o < 0) {
    o += 1;
    voxelDelta -= 1;
  }

  pos.offset[axis] = o;

  if (voxelDelta !== 0) {
    if (!stepVoxels(pos, axis, voxelDelta)) {
      // Rollback.
      pos.path.set(saved.path);
      pos.voxel[0] = saved.voxel[0];
      pos.voxel[1] = saved.voxel[1];
      pos.voxel[2] = saved.voxel[2];
      pos.offset[0] = saved.offset[0];
      pos.offset[1] = saved.offset[1];
      pos.offset[2] = saved.offset[2];
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// LayerPos
// ---------------------------------------------------------------------------

export interface LayerPos {
  pathSlots: Uint8Array;                // length NODE_PATH_LEN, first `layer` entries valid
  cell: [number, number, number];       // each 0..24
  layer: number;                        // 0..=MAX_LAYER
}

/**
 * Project a leaf `Position` down to layer `layer`, producing a `LayerPos`.
 *
 * Walks up from the leaf, folding each depth's slot coordinates into the
 * cell via:  c_axis = 5 * s_axis + floor(c_axis / 5)
 */
export function layerPosFromLeaf(leaf: Position, layer: number): LayerPos {
  const pathSlots = new Uint8Array(NODE_PATH_LEN);
  pathSlots.set(leaf.path);

  let cx = leaf.voxel[0];
  let cy = leaf.voxel[1];
  let cz = leaf.voxel[2];

  // Walk from deepest depth up to `layer`.
  for (let depth = NODE_PATH_LEN - 1; depth >= layer; depth--) {
    const [sx, sy, sz] = slotCoords(leaf.path[depth]);
    cx = BRANCH_FACTOR * sx + Math.floor(cx / BRANCH_FACTOR);
    cy = BRANCH_FACTOR * sy + Math.floor(cy / BRANCH_FACTOR);
    cz = BRANCH_FACTOR * sz + Math.floor(cz / BRANCH_FACTOR);
  }

  return {
    pathSlots,
    cell: [cx, cy, cz],
    layer,
  };
}

/**
 * Return the valid prefix of a `LayerPos` path (first `lp.layer` elements).
 */
export function layerPosPath(lp: LayerPos): Uint8Array {
  return lp.pathSlots.slice(0, lp.layer);
}
