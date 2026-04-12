// Content-addressed voxel tree system
// Port of the Rust deepspace-game voxel tree to TypeScript

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BRANCH_FACTOR = 5;
export const CHILDREN_PER_NODE = 125; // 5^3
export const NODE_VOXELS_PER_AXIS = 25;
export const NODE_VOXELS = 15625; // 25^3
export const MAX_LAYER = 12;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A voxel value: 0 = empty, 1..255 = palette index. */
export type Voxel = number;
export const EMPTY_VOXEL: Voxel = 0;

/** Typed array holding one node's voxel data (25^3 = 15 625 entries). */
export type VoxelGrid = Uint8Array;

/** Content-addressed node handle. 0 = EMPTY_NODE (sentinel). */
export type NodeId = number;
export const EMPTY_NODE: NodeId = 0;

/** 125 child NodeIds for a non-leaf node. */
export type Children = number[];

// ---------------------------------------------------------------------------
// Node stored inside the library
// ---------------------------------------------------------------------------

export interface Node {
  voxels: Uint8Array;
  children: Children | null; // null for leaf nodes
  refCount: number;
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

/** Row-major voxel index inside a 25^3 grid (x varies fastest). */
export function voxelIdx(x: number, y: number, z: number): number {
  return (z * NODE_VOXELS_PER_AXIS + y) * NODE_VOXELS_PER_AXIS + x;
}

/** Slot index inside a 5^3 child array (x varies fastest). */
export function slotIndex(x: number, y: number, z: number): number {
  return (z * BRANCH_FACTOR + y) * BRANCH_FACTOR + x;
}

/** Inverse of slotIndex -> [x, y, z]. */
export function slotCoords(slot: number): [number, number, number] {
  const x = slot % BRANCH_FACTOR;
  const y = Math.floor(slot / BRANCH_FACTOR) % BRANCH_FACTOR;
  const z = Math.floor(slot / (BRANCH_FACTOR * BRANCH_FACTOR));
  return [x, y, z];
}

// ---------------------------------------------------------------------------
// Grid constructors
// ---------------------------------------------------------------------------

export function emptyVoxelGrid(): VoxelGrid {
  return new Uint8Array(NODE_VOXELS);
}

export function filledVoxelGrid(fill: Voxel): VoxelGrid {
  const grid = new Uint8Array(NODE_VOXELS);
  grid.fill(fill);
  return grid;
}

export function uniformChildren(id: NodeId): Children {
  const arr: Children = new Array(CHILDREN_PER_NODE);
  for (let i = 0; i < CHILDREN_PER_NODE; i++) arr[i] = id;
  return arr;
}

// ---------------------------------------------------------------------------
// FNV-1a hash helpers
// ---------------------------------------------------------------------------

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1aBytes(data: Uint8Array): number {
  let h = FNV_OFFSET;
  for (let i = 0, len = data.length; i < len; i++) {
    h ^= data[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

function fnv1aU32Array(arr: number[]): number {
  let h = FNV_OFFSET;
  for (let i = 0, len = arr.length; i < len; i++) {
    const v = arr[i];
    h ^= v & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Equality helpers
// ---------------------------------------------------------------------------

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0, len = a.length; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function childrenEqual(a: Children, b: Children): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0, len = a.length; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// NodeLibrary – content-addressed, reference-counted node store
// ---------------------------------------------------------------------------

export class NodeLibrary {
  nodes: Map<NodeId, Node> = new Map();

  /** Hash -> NodeId for leaf dedup. */
  private leafByHash: Map<number, NodeId[]> = new Map();

  /** Hash -> NodeId for non-leaf dedup. */
  private nonLeafByHash: Map<number, NodeId[]> = new Map();

  private nextId: NodeId = 1; // 0 is reserved for EMPTY_NODE

  // -----------------------------------------------------------------------
  // Insert
  // -----------------------------------------------------------------------

  /** Insert a leaf node (voxels only, no children). Returns a deduped NodeId. */
  insertLeaf(voxels: Uint8Array): NodeId {
    const hash = fnv1aBytes(voxels);
    const bucket = this.leafByHash.get(hash);
    if (bucket) {
      for (const existingId of bucket) {
        const existing = this.nodes.get(existingId)!;
        if (existing.children === null && uint8ArraysEqual(existing.voxels, voxels)) {
          return existingId; // dedup: don't touch refCount (matches Rust)
        }
      }
    }
    const id = this.nextId++;
    const node: Node = {
      voxels: new Uint8Array(voxels), // clone
      children: null,
      refCount: 0, // leaves start at 0; caller decides whether to ref_inc
    };
    this.nodes.set(id, node);
    if (bucket) {
      bucket.push(id);
    } else {
      this.leafByHash.set(hash, [id]);
    }
    return id;
  }

  /** Insert a non-leaf node (voxels + children). Returns a deduped NodeId. */
  insertNonLeaf(voxels: Uint8Array, children: Children): NodeId {
    const hash = fnv1aU32Array(children);
    const bucket = this.nonLeafByHash.get(hash);
    if (bucket) {
      for (const existingId of bucket) {
        const existing = this.nodes.get(existingId)!;
        if (existing.children !== null && childrenEqual(existing.children, children)) {
          return existingId; // dedup: don't touch refCount (matches Rust)
        }
      }
    }
    // Fresh insert – ref_inc every child
    for (let i = 0; i < children.length; i++) {
      this.refInc(children[i]);
    }
    const id = this.nextId++;
    const node: Node = {
      voxels: new Uint8Array(voxels),
      children: children.slice(), // clone
      refCount: 0, // starts at 0; caller uses ref_inc externally
    };
    this.nodes.set(id, node);
    if (bucket) {
      bucket.push(id);
    } else {
      this.nonLeafByHash.set(hash, [id]);
    }
    return id;
  }

  // -----------------------------------------------------------------------
  // Lookup
  // -----------------------------------------------------------------------

  get(id: NodeId): Node | undefined {
    if (id === EMPTY_NODE) return undefined;
    return this.nodes.get(id);
  }

  // -----------------------------------------------------------------------
  // Reference counting
  // -----------------------------------------------------------------------

  refInc(id: NodeId): void {
    if (id === EMPTY_NODE) return;
    const node = this.nodes.get(id);
    if (node) node.refCount++;
  }

  refDec(id: NodeId): void {
    if (id === EMPTY_NODE) return;
    const node = this.nodes.get(id);
    if (!node) return;
    node.refCount--;
    if (node.refCount <= 0) {
      this.evict(id, node);
    }
  }

  private evict(id: NodeId, node: Node): void {
    // Remove from hash table
    if (node.children === null) {
      const hash = fnv1aBytes(node.voxels);
      const bucket = this.leafByHash.get(hash);
      if (bucket) {
        const idx = bucket.indexOf(id);
        if (idx !== -1) bucket.splice(idx, 1);
        if (bucket.length === 0) this.leafByHash.delete(hash);
      }
    } else {
      const hash = fnv1aU32Array(node.children);
      const bucket = this.nonLeafByHash.get(hash);
      if (bucket) {
        const idx = bucket.indexOf(id);
        if (idx !== -1) bucket.splice(idx, 1);
        if (bucket.length === 0) this.nonLeafByHash.delete(hash);
      }
      // Cascade: ref_dec all children
      for (let i = 0; i < node.children.length; i++) {
        this.refDec(node.children[i]);
      }
    }
    this.nodes.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Downsampling
// ---------------------------------------------------------------------------

/**
 * Downsample 125 child voxel grids (each 25^3) into a single parent 25^3
 * grid. Presence-preserving majority vote: only returns EMPTY_VOXEL when all
 * 125 source voxels are empty; otherwise picks the most common non-empty
 * value (ties broken by lower voxel id).
 */
export function downsample(childGrids: Uint8Array[]): VoxelGrid {
  const parent = new Uint8Array(NODE_VOXELS);
  // Reusable count array for majority vote (indices 0..255)
  const counts = new Uint16Array(256);

  for (let pz = 0; pz < NODE_VOXELS_PER_AXIS; pz++) {
    for (let py = 0; py < NODE_VOXELS_PER_AXIS; py++) {
      for (let px = 0; px < NODE_VOXELS_PER_AXIS; px++) {
        // Which child slot does this parent voxel fall in?
        const cx = Math.floor(px / BRANCH_FACTOR);
        const cy = Math.floor(py / BRANCH_FACTOR);
        const cz = Math.floor(pz / BRANCH_FACTOR);
        const childSlot = slotIndex(cx, cy, cz);
        const childGrid = childGrids[childSlot];

        // Base coordinates within the child's grid
        const bx = (px % BRANCH_FACTOR) * BRANCH_FACTOR;
        const by = (py % BRANCH_FACTOR) * BRANCH_FACTOR;
        const bz = (pz % BRANCH_FACTOR) * BRANCH_FACTOR;

        // Clear counts
        counts.fill(0);

        // Sample the 5^3 block from the child grid
        for (let dz = 0; dz < BRANCH_FACTOR; dz++) {
          for (let dy = 0; dy < BRANCH_FACTOR; dy++) {
            for (let dx = 0; dx < BRANCH_FACTOR; dx++) {
              const v = childGrid[voxelIdx(bx + dx, by + dy, bz + dz)];
              counts[v]++;
            }
          }
        }

        // Majority vote (presence-preserving)
        if (counts[EMPTY_VOXEL] === CHILDREN_PER_NODE) {
          // All empty
          parent[voxelIdx(px, py, pz)] = EMPTY_VOXEL;
        } else {
          let bestVal = 0;
          let bestCount = 0;
          for (let v = 1; v < 256; v++) {
            if (counts[v] > bestCount || (counts[v] === bestCount && counts[v] > 0 && v < bestVal)) {
              bestCount = counts[v];
              bestVal = v;
            }
          }
          // If no non-empty voxels found (shouldn't happen given above check),
          // fall back to empty. Otherwise use bestVal.
          parent[voxelIdx(px, py, pz)] = bestVal === 0 ? EMPTY_VOXEL : bestVal;
        }
      }
    }
  }

  return parent;
}

/**
 * Incrementally re-downsample only the 5x5x5 region of the parent grid
 * owned by `changedSlot`, using `newChildVoxels` for that slot.
 */
export function downsampleUpdatedSlot(
  oldParentVoxels: Uint8Array,
  newChildVoxels: Uint8Array,
  changedSlot: number,
): VoxelGrid {
  const parent = new Uint8Array(oldParentVoxels); // clone
  const [cx, cy, cz] = slotCoords(changedSlot);
  const counts = new Uint16Array(256);

  // The 5x5x5 region of parent voxels owned by this slot
  const pxBase = cx * BRANCH_FACTOR;
  const pyBase = cy * BRANCH_FACTOR;
  const pzBase = cz * BRANCH_FACTOR;

  for (let lpz = 0; lpz < BRANCH_FACTOR; lpz++) {
    for (let lpy = 0; lpy < BRANCH_FACTOR; lpy++) {
      for (let lpx = 0; lpx < BRANCH_FACTOR; lpx++) {
        const px = pxBase + lpx;
        const py = pyBase + lpy;
        const pz = pzBase + lpz;

        const bx = lpx * BRANCH_FACTOR;
        const by = lpy * BRANCH_FACTOR;
        const bz = lpz * BRANCH_FACTOR;

        counts.fill(0);

        for (let dz = 0; dz < BRANCH_FACTOR; dz++) {
          for (let dy = 0; dy < BRANCH_FACTOR; dy++) {
            for (let dx = 0; dx < BRANCH_FACTOR; dx++) {
              const v = newChildVoxels[voxelIdx(bx + dx, by + dy, bz + dz)];
              counts[v]++;
            }
          }
        }

        if (counts[EMPTY_VOXEL] === CHILDREN_PER_NODE) {
          parent[voxelIdx(px, py, pz)] = EMPTY_VOXEL;
        } else {
          let bestVal = 0;
          let bestCount = 0;
          for (let v = 1; v < 256; v++) {
            if (counts[v] > bestCount || (counts[v] === bestCount && counts[v] > 0 && v < bestVal)) {
              bestCount = counts[v];
              bestVal = v;
            }
          }
          parent[voxelIdx(px, py, pz)] = bestVal === 0 ? EMPTY_VOXEL : bestVal;
        }
      }
    }
  }

  return parent;
}

/**
 * Convenience: fetch all 125 child voxel grids from the library and
 * downsample them into a parent grid. Missing/empty nodes get an empty grid.
 */
export function downsampleFromLibrary(
  library: NodeLibrary,
  children: Children,
): VoxelGrid {
  const grids: Uint8Array[] = new Array(CHILDREN_PER_NODE);
  const empty = emptyVoxelGrid();
  for (let i = 0; i < CHILDREN_PER_NODE; i++) {
    const node = library.get(children[i]);
    grids[i] = node ? node.voxels : empty;
  }
  return downsample(grids);
}
