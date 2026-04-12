import { filledVoxelGrid, emptyVoxelGrid, NODE_VOXELS } from './tree';
import { voxelFromBlock, BlockType } from '../block';

export function generateGrassLeaf(): Uint8Array {
  return filledVoxelGrid(voxelFromBlock(BlockType.Grass));
}

export function generateAirLeaf(): Uint8Array {
  return emptyVoxelGrid();
}
