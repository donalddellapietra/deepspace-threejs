// Uniform-layer tree-walk renderer for Three.js.
// Port of Rust src/world/render.rs

import * as THREE from 'three';
import { Palette } from '../block';
import { WorldState, worldExtentVoxels } from './state';
import {
  NodeId, EMPTY_NODE, EMPTY_VOXEL, MAX_LAYER,
  BRANCH_FACTOR, NODE_VOXELS_PER_AXIS, CHILDREN_PER_NODE,
  slotCoords, slotIndex, voxelIdx, VoxelGrid,
} from './tree';
import {
  WorldAnchor, cellSizeAtLayer, extentForLayer, scaleForLayer, targetLayerFor,
} from './view';
import { bakeVolume } from './mesher';

import { MIN_ZOOM, MAX_ZOOM } from '../editor/mod';
export const RADIUS_VIEW_CELLS = 32;

// ----------------------------------------------------------------- mesh cache

const meshCache = new Map<NodeId, Map<number, THREE.BufferGeometry>>();

function getOrBakeMesh(
  world: WorldState, nodeId: NodeId,
): Map<number, THREE.BufferGeometry> {
  let cached = meshCache.get(nodeId);
  if (cached) return cached;

  const node = world.library.get(nodeId);
  if (!node) return new Map();

  let baked: Map<number, THREE.BufferGeometry>;
  if (node.children) {
    // Non-leaf: bake 125x25 = 3125 grid (5*25 per axis)
    const childVoxels: (Uint8Array | null)[] = node.children.map(id => {
      if (id === EMPTY_NODE) return null;
      return world.library.get(id)?.voxels ?? null;
    });
    const size = BRANCH_FACTOR * NODE_VOXELS_PER_AXIS;
    baked = bakeVolume(size, (x, y, z) => {
      if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return null;
      const slot = slotIndex(
        Math.floor(x / NODE_VOXELS_PER_AXIS),
        Math.floor(y / NODE_VOXELS_PER_AXIS),
        Math.floor(z / NODE_VOXELS_PER_AXIS),
      );
      const voxels = childVoxels[slot];
      if (!voxels) return null;
      const v = voxels[voxelIdx(x % NODE_VOXELS_PER_AXIS, y % NODE_VOXELS_PER_AXIS, z % NODE_VOXELS_PER_AXIS)];
      return v === EMPTY_VOXEL ? null : v;
    });
  } else {
    // Leaf: bake 25^3
    const voxels = node.voxels;
    baked = bakeVolume(NODE_VOXELS_PER_AXIS, (x, y, z) => {
      if (x < 0 || y < 0 || z < 0 || x >= NODE_VOXELS_PER_AXIS || y >= NODE_VOXELS_PER_AXIS || z >= NODE_VOXELS_PER_AXIS) return null;
      const v = voxels[voxelIdx(x, y, z)];
      return v === EMPTY_VOXEL ? null : v;
    });
  }

  meshCache.set(nodeId, baked);
  return baked;
}

// ----------------------------------------------------------------- tree walk

interface Visit {
  pathKey: string;
  nodeId: NodeId;
  originLeaves: [bigint, bigint, bigint];
  scale: number;
}

function walk(
  world: WorldState, emitLayer: number, targetLayer: number,
  cameraPos: THREE.Vector3, radiusBevy: number, anchor: WorldAnchor,
): Visit[] {
  if (world.root === EMPTY_NODE) return [];

  // Precompute child extents
  const childExtentLeaves: bigint[] = new Array(MAX_LAYER + 1);
  let ext = worldExtentVoxels();
  childExtentLeaves[0] = ext;
  for (let layer = 1; layer <= MAX_LAYER; layer++) {
    ext /= 5n;
    childExtentLeaves[layer] = ext;
  }

  const visits: Visit[] = [];
  const radiusSq = radiusBevy * radiusBevy;

  interface WalkFrame {
    nodeId: NodeId;
    pathKey: string;
    originLeaves: [bigint, bigint, bigint];
    depth: number;
  }

  const stack: WalkFrame[] = [{
    nodeId: world.root,
    pathKey: '',
    originLeaves: [0n, 0n, 0n],
    depth: 0,
  }];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const { nodeId, pathKey, originLeaves, depth } = frame;

    // Bevy-space origin
    const ox = Number(originLeaves[0] - anchor.leafCoord[0]);
    const oy = Number(originLeaves[1] - anchor.leafCoord[1]);
    const oz = Number(originLeaves[2] - anchor.leafCoord[2]);
    const extent = extentForLayer(depth);

    // AABB distance to camera
    const dx = Math.max(ox - cameraPos.x, 0, cameraPos.x - (ox + extent));
    const dy = Math.max(oy - cameraPos.y, 0, cameraPos.y - (oy + extent));
    const dz = Math.max(oz - cameraPos.z, 0, cameraPos.z - (oz + extent));
    if (dx * dx + dy * dy + dz * dz > radiusSq) continue;

    if (depth === emitLayer) {
      visits.push({
        pathKey,
        nodeId,
        originLeaves,
        scale: scaleForLayer(targetLayer),
      });
      continue;
    }

    const node = world.library.get(nodeId);
    if (!node) continue;
    if (!node.children) {
      visits.push({ pathKey, nodeId, originLeaves, scale: scaleForLayer(depth) });
      continue;
    }

    const childExtent = childExtentLeaves[depth + 1];
    for (let slot = 0; slot < CHILDREN_PER_NODE; slot++) {
      const childId = node.children[slot];
      if (childId === EMPTY_NODE) continue;
      const [sx, sy, sz] = slotCoords(slot);
      const childOrigin: [bigint, bigint, bigint] = [
        originLeaves[0] + BigInt(sx) * childExtent,
        originLeaves[1] + BigInt(sy) * childExtent,
        originLeaves[2] + BigInt(sz) * childExtent,
      ];
      stack.push({
        nodeId: childId,
        pathKey: pathKey + '/' + slot,
        originLeaves: childOrigin,
        depth: depth + 1,
      });
    }
  }

  return visits;
}

// ----------------------------------------------------------------- renderer

export class WorldRenderer {
  private scene: THREE.Scene;
  private palette: Palette;
  private entities = new Map<string, { group: THREE.Group; nodeId: NodeId }>();
  private lastEmitLayer = -1;

  constructor(scene: THREE.Scene, palette: Palette) {
    this.scene = scene;
    this.palette = palette;
  }

  render(world: WorldState, viewLayer: number, anchor: WorldAnchor, cameraPos: THREE.Vector3): void {
    const targetLayer = targetLayerFor(viewLayer);
    const emitLayer = Math.max(targetLayer - 1, 0);
    const radiusBevy = RADIUS_VIEW_CELLS * cellSizeAtLayer(viewLayer);

    // If emit layer changed, clear everything
    if (emitLayer !== this.lastEmitLayer) {
      for (const [, { group }] of this.entities) {
        this.scene.remove(group);
        this.disposeGroup(group);
      }
      this.entities.clear();
      this.lastEmitLayer = emitLayer;
    }

    const visits = walk(world, emitLayer, targetLayer, cameraPos, radiusBevy, anchor);

    const alive = new Map<string, { group: THREE.Group; nodeId: NodeId }>();

    for (const visit of visits) {
      const ox = Number(visit.originLeaves[0] - anchor.leafCoord[0]);
      const oy = Number(visit.originLeaves[1] - anchor.leafCoord[1]);
      const oz = Number(visit.originLeaves[2] - anchor.leafCoord[2]);

      const existing = this.entities.get(visit.pathKey);
      if (existing && existing.nodeId === visit.nodeId) {
        // Reuse — just update position
        existing.group.position.set(ox, oy, oz);
        existing.group.scale.setScalar(visit.scale);
        alive.set(visit.pathKey, existing);
        this.entities.delete(visit.pathKey);
        continue;
      }

      // Remove old if node changed
      if (existing) {
        this.scene.remove(existing.group);
        this.disposeGroup(existing.group);
        this.entities.delete(visit.pathKey);
      }

      // Spawn new
      const baked = getOrBakeMesh(world, visit.nodeId);
      const group = new THREE.Group();
      group.position.set(ox, oy, oz);
      group.scale.setScalar(visit.scale);

      for (const [voxelType, geometry] of baked) {
        const mat = this.palette.material(voxelType);
        if (!mat) continue;
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // Enable vertex colors for AO
        mat.vertexColors = true;
        mesh.material = mat;
        group.add(mesh);
      }

      this.scene.add(group);
      alive.set(visit.pathKey, { group, nodeId: visit.nodeId });
    }

    // Despawn everything not visited
    for (const [, { group }] of this.entities) {
      this.scene.remove(group);
      this.disposeGroup(group);
    }
    this.entities = alive;
  }

  private disposeGroup(group: THREE.Group): void {
    // Don't dispose geometries — they're cached in meshCache
    // Don't dispose materials — they're shared from Palette
    group.clear();
  }

  invalidateMeshCache(nodeId: NodeId): void {
    meshCache.delete(nodeId);
  }

  clearAll(): void {
    for (const [, { group }] of this.entities) {
      this.scene.remove(group);
      this.disposeGroup(group);
    }
    this.entities.clear();
    meshCache.clear();
  }
}
