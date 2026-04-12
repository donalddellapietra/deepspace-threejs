// Edit walks: single-voxel leaf edits and bulk higher-layer edits.
// Port of Rust src/world/edit.rs

import { Position, LayerPos, NODE_PATH_LEN } from './position';
import { WorldState } from './state';
import {
  NodeId, Voxel, VoxelGrid, EMPTY_VOXEL, MAX_LAYER, BRANCH_FACTOR,
  NODE_VOXELS_PER_AXIS, CHILDREN_PER_NODE,
  voxelIdx, slotIndex, filledVoxelGrid, uniformChildren,
  downsample, downsampleUpdatedSlot, NodeLibrary,
} from './tree';

export function subtreePathForLayerPos(lp: LayerPos): number[] {
  const path: number[] = [];
  for (let i = 0; i < lp.layer; i++) path.push(lp.pathSlots[i]);
  if (lp.layer >= MAX_LAYER) return path;
  const b = BRANCH_FACTOR;
  const slotA = slotIndex(
    Math.floor(lp.cell[0] / b), Math.floor(lp.cell[1] / b), Math.floor(lp.cell[2] / b),
  );
  path.push(slotA);
  if (lp.layer + 1 < MAX_LAYER) {
    const slotB = slotIndex(lp.cell[0] % b, lp.cell[1] % b, lp.cell[2] % b);
    path.push(slotB);
  }
  return path;
}

function descendTo(world: WorldState, path: number[]): NodeId {
  let id = world.root;
  for (const slot of path) {
    const node = world.library.get(id);
    if (!node || !node.children) throw new Error('descendTo: missing node or premature leaf');
    id = node.children[slot];
  }
  return id;
}

function buildSolidChain(world: WorldState, voxel: Voxel, targetLayer: number): NodeId {
  const leafVoxels = filledVoxelGrid(voxel);
  let chainId = world.library.insertLeaf(leafVoxels);
  let chainLayer = MAX_LAYER;
  while (chainLayer > targetLayer) {
    const node = world.library.get(chainId)!;
    const refs: Uint8Array[] = new Array(CHILDREN_PER_NODE).fill(node.voxels);
    const voxels = downsample(refs);
    const children = uniformChildren(chainId);
    chainId = world.library.insertNonLeaf(voxels, children);
    chainLayer--;
  }
  return chainId;
}

export function editAtLayerPos(world: WorldState, lp: LayerPos, voxel: Voxel): void {
  const cx = lp.cell[0], cy = lp.cell[1], cz = lp.cell[2];
  const b = BRANCH_FACTOR;

  if (lp.layer === MAX_LAYER) {
    // Leaf single-voxel edit
    const leafPath: number[] = [];
    for (let i = 0; i < NODE_PATH_LEN; i++) leafPath.push(lp.pathSlots[i]);
    const leafId = descendTo(world, leafPath);
    const node = world.library.get(leafId)!;
    const newVoxels = new Uint8Array(node.voxels);
    newVoxels[voxelIdx(cx, cy, cz)] = voxel;
    const newLeafId = world.library.insertLeaf(newVoxels);
    installSubtree(world, leafPath, newLeafId);
    return;
  }

  if (lp.layer === MAX_LAYER - 1) {
    // One above leaf: fill 5^3 region
    const childSlot = slotIndex(Math.floor(cx / b), Math.floor(cy / b), Math.floor(cz / b));
    const leafPath: number[] = [];
    for (let i = 0; i < lp.layer; i++) leafPath.push(lp.pathSlots[i]);
    leafPath.push(childSlot);

    const leafId = descendTo(world, leafPath);
    const node = world.library.get(leafId)!;
    const newVoxels = new Uint8Array(node.voxels);
    const rx0 = (cx % b) * b, ry0 = (cy % b) * b, rz0 = (cz % b) * b;
    for (let dz = 0; dz < b; dz++) {
      for (let dy = 0; dy < b; dy++) {
        for (let dx = 0; dx < b; dx++) {
          newVoxels[voxelIdx(rx0 + dx, ry0 + dy, rz0 + dz)] = voxel;
        }
      }
    }
    const newLeafId = world.library.insertLeaf(newVoxels);
    installSubtree(world, leafPath, newLeafId);
    return;
  }

  // Two+ layers above leaves: replace subtree with solid chain
  const slotA = slotIndex(Math.floor(cx / b), Math.floor(cy / b), Math.floor(cz / b));
  const slotB = slotIndex(cx % b, cy % b, cz % b);
  const subPath: number[] = [];
  for (let i = 0; i < lp.layer; i++) subPath.push(lp.pathSlots[i]);
  subPath.push(slotA);
  subPath.push(slotB);
  const tgtLayer = lp.layer + 2;
  const chainId = buildSolidChain(world, voxel, tgtLayer);
  installSubtree(world, subPath, chainId);
}

export function installSubtree(world: WorldState, ancestorSlots: number[], newNodeId: NodeId): void {
  const descent: { parentId: NodeId; slot: number }[] = [];
  let currentId = world.root;
  for (const slot of ancestorSlots) {
    descent.push({ parentId: currentId, slot });
    const node = world.library.get(currentId);
    if (!node || !node.children) throw new Error('installSubtree: missing node');
    currentId = node.children[slot];
  }

  let childId = newNodeId;
  for (let i = descent.length - 1; i >= 0; i--) {
    const { parentId, slot } = descent[i];
    const parent = world.library.get(parentId)!;
    const oldChildren = parent.children!;
    const newChildren = oldChildren.slice();
    newChildren[slot] = childId;

    const newChildNode = world.library.get(childId)!;
    const newVoxels = downsampleUpdatedSlot(parent.voxels, newChildNode.voxels, slot);
    childId = world.library.insertNonLeaf(newVoxels, newChildren);
  }

  world.swapRoot(childId);
}

export function getVoxel(world: WorldState, position: Position): Voxel {
  let currentId = world.root;
  for (let i = 0; i < NODE_PATH_LEN; i++) {
    const node = world.library.get(currentId);
    if (!node || !node.children) throw new Error('getVoxel: missing node');
    currentId = node.children[position.path[i]];
  }
  const leaf = world.library.get(currentId);
  if (!leaf) throw new Error('getVoxel: missing leaf');
  return leaf.voxels[voxelIdx(position.voxel[0], position.voxel[1], position.voxel[2])];
}
