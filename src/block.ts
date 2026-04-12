// Block types and palette — mirrors Rust src/block/mod.rs

import * as THREE from 'three';

export enum BlockType {
  Stone = 0, Dirt = 1, Grass = 2, Wood = 3, Leaf = 4,
  Sand = 5, Water = 6, Brick = 7, Metal = 8, Glass = 9,
}

export const ALL_BLOCK_TYPES: BlockType[] = [
  BlockType.Stone, BlockType.Dirt, BlockType.Grass, BlockType.Wood, BlockType.Leaf,
  BlockType.Sand, BlockType.Water, BlockType.Brick, BlockType.Metal, BlockType.Glass,
];

export interface BlockProperties {
  color: [number, number, number, number]; // r,g,b,a in 0..1
  roughness: number;
  metallic: number;
  transparent: boolean;
  name: string;
}

const BLOCK_PROPS: Record<BlockType, BlockProperties> = {
  [BlockType.Stone]: { color: [0.5, 0.5, 0.5, 1.0], roughness: 0.9, metallic: 0.0, transparent: false, name: 'Stone' },
  [BlockType.Dirt]:  { color: [0.45, 0.3, 0.15, 1.0], roughness: 0.9, metallic: 0.0, transparent: false, name: 'Dirt' },
  [BlockType.Grass]: { color: [0.3, 0.6, 0.2, 1.0], roughness: 0.9, metallic: 0.0, transparent: false, name: 'Grass' },
  [BlockType.Wood]:  { color: [0.55, 0.35, 0.15, 1.0], roughness: 0.9, metallic: 0.0, transparent: false, name: 'Wood' },
  [BlockType.Leaf]:  { color: [0.2, 0.5, 0.1, 1.0], roughness: 0.9, metallic: 0.0, transparent: false, name: 'Leaf' },
  [BlockType.Sand]:  { color: [0.85, 0.8, 0.55, 1.0], roughness: 0.9, metallic: 0.0, transparent: false, name: 'Sand' },
  [BlockType.Water]: { color: [0.2, 0.4, 0.8, 0.7], roughness: 0.1, metallic: 0.0, transparent: true, name: 'Water' },
  [BlockType.Brick]: { color: [0.7, 0.3, 0.2, 1.0], roughness: 0.9, metallic: 0.0, transparent: false, name: 'Brick' },
  [BlockType.Metal]: { color: [0.75, 0.75, 0.8, 1.0], roughness: 0.2, metallic: 0.9, transparent: false, name: 'Metal' },
  [BlockType.Glass]: { color: [0.85, 0.9, 1.0, 0.3], roughness: 0.1, metallic: 0.0, transparent: true, name: 'Glass' },
};

export function getBlockProperties(bt: BlockType): BlockProperties {
  return BLOCK_PROPS[bt];
}

// Voxel is a u8. 0 = empty, 1..=255 = palette index.
export type Voxel = number;
export const EMPTY_VOXEL: Voxel = 0;

export function voxelFromBlock(bt: BlockType | null): Voxel {
  if (bt === null) return EMPTY_VOXEL;
  return bt + 1;
}

export function blockFromVoxel(v: Voxel): BlockType | null {
  if (v === EMPTY_VOXEL) return null;
  const idx = v - 1;
  if (idx < 0 || idx >= ALL_BLOCK_TYPES.length) return null;
  return ALL_BLOCK_TYPES[idx];
}

// ---------- Palette ----------

export interface PaletteEntry {
  name: string;
  color: [number, number, number, number];
  roughness: number;
  metallic: number;
  transparent: boolean;
  material: THREE.MeshStandardMaterial;
}

export class Palette {
  entries: PaletteEntry[] = [];

  constructor() {
    for (const bt of ALL_BLOCK_TYPES) {
      const props = getBlockProperties(bt);
      this.register(props);
    }
  }

  get(voxel: Voxel): PaletteEntry | null {
    if (voxel === 0) return null;
    return this.entries[voxel - 1] ?? null;
  }

  material(voxel: Voxel): THREE.MeshStandardMaterial | null {
    return this.get(voxel)?.material ?? null;
  }

  register(props: BlockProperties): Voxel {
    if (this.entries.length >= 255) throw new Error('Palette full');
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(props.color[0], props.color[1], props.color[2]),
      roughness: props.roughness,
      metalness: props.metallic,
      transparent: props.transparent,
      opacity: props.color[3],
      side: THREE.FrontSide,
    });
    if (props.transparent) {
      mat.depthWrite = false;
    }
    this.entries.push({
      name: props.name,
      color: props.color,
      roughness: props.roughness,
      metallic: props.metallic,
      transparent: props.transparent,
      material: mat,
    });
    return this.entries.length as Voxel; // 1-based
  }

  get length(): number {
    return this.entries.length;
  }

  iter(): [Voxel, PaletteEntry][] {
    return this.entries.map((e, i) => [(i + 1) as Voxel, e]);
  }
}
