import {
  NodeLibrary,
  NodeId,
  EMPTY_NODE,
  MAX_LAYER,
  BRANCH_FACTOR,
  NODE_VOXELS_PER_AXIS,
  CHILDREN_PER_NODE,
  Children,
  uniformChildren,
  slotCoords,
  slotIndex,
  downsampleFromLibrary,
} from './tree';
import { generateGrassLeaf, generateAirLeaf } from './generator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ground level in leaf-voxel coordinates: 5^(MAX_LAYER-1) = 5^11 = 48828125 */
export const GROUND_Y_VOXELS = Math.pow(BRANCH_FACTOR, MAX_LAYER - 1); // 48828125

/** How many layers from the bottom use the transition logic. */
export const GROUND_TRANSITION_DEPTH = 2;

/**
 * World extent in leaf voxels along one axis: 25 * 5^12.
 * This exceeds 2^32 so we use BigInt.
 */
export function worldExtentVoxels(): bigint {
  return BigInt(NODE_VOXELS_PER_AXIS) * (5n ** BigInt(MAX_LAYER)); // 25 * 5^12 = 6103515625
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a 125-element children array where slot.y == 0 gets `bottom`
 * and slot.y >= 1 gets `air`.
 */
function mixedBottomChildren(bottom: NodeId, air: NodeId): Children {
  const children: Children = new Array(CHILDREN_PER_NODE);
  for (let i = 0; i < CHILDREN_PER_NODE; i++) {
    const [_sx, sy, _sz] = slotCoords(i);
    children[i] = sy === 0 ? bottom : air;
  }
  return children;
}

// ---------------------------------------------------------------------------
// WorldState
// ---------------------------------------------------------------------------

export class WorldState {
  root: NodeId = EMPTY_NODE;
  library: NodeLibrary = new NodeLibrary();

  constructor() {
    this.buildGrasslandRoot();
  }

  /**
   * Atomically swap the root node. Ref-counts the new root before releasing
   * the old one so cascading eviction cannot destroy shared subtrees.
   */
  swapRoot(newRootId: NodeId): void {
    if (newRootId === this.root) return;
    this.library.refInc(newRootId);
    const old = this.root;
    this.root = newRootId;
    this.library.refDec(old);
  }

  /**
   * Build the initial grassland world: a flat ground plane at GROUND_Y_VOXELS
   * with grass below and air above.
   */
  private buildGrasslandRoot(): void {
    // Insert leaf nodes
    const grassLeafId = this.library.insertLeaf(generateGrassLeaf());
    const airLeafId = this.library.insertLeaf(generateAirLeaf());

    let curBottom: NodeId = grassLeafId;
    let curAir: NodeId = airLeafId;

    // Build from layer MAX_LAYER-1 down to layer 0
    for (let k = MAX_LAYER - 1; k >= 0; k--) {
      // Extent in leaf-voxels of one node at layer k:
      // layerExtent = rootExtent / 5^k = 25 * 5^(MAX_LAYER - k)
      const layerExtent = NODE_VOXELS_PER_AXIS * Math.pow(BRANCH_FACTOR, MAX_LAYER - k);

      let bottomChildren: Children;

      if (layerExtent <= GROUND_Y_VOXELS) {
        // Entire node fits below ground -- uniform bottom
        bottomChildren = uniformChildren(curBottom);
      } else {
        // Mixed: bottom row of children (sy==0) is curBottom, rest is curAir
        bottomChildren = mixedBottomChildren(curBottom, curAir);
      }

      // Downsample and insert the bottom (ground) pattern
      const bottomVoxels = downsampleFromLibrary(this.library, bottomChildren);
      const newBottom = this.library.insertNonLeaf(bottomVoxels, bottomChildren);

      // Build the air pattern for layers > 0
      let newAir: NodeId = curAir;
      if (k > 0) {
        const airChildren = uniformChildren(curAir);
        const airVoxels = downsampleFromLibrary(this.library, airChildren);
        newAir = this.library.insertNonLeaf(airVoxels, airChildren);
      }

      curBottom = newBottom;
      curAir = newAir;
    }

    this.swapRoot(curBottom);
  }
}
