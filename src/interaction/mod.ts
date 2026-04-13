// Block targeting via view-layer voxel DDA raycast.
// Port of Rust src/interaction/mod.rs

import * as THREE from 'three';
import { LayerPos } from '../world/position';
import { WorldState } from '../world/state';
import {
  WorldAnchor, cellSizeAtLayer, cellOriginForAnchor,
  isLayerPosSolid, layerPosFromBevy,
} from '../world/view';

const MAX_REACH_CELLS = 16;

export interface TargetedBlock {
  hitLayerPos: LayerPos | null;
  normal: THREE.Vector3 | null;
}

export function updateTarget(
  cameraPos: THREE.Vector3, cameraDir: THREE.Vector3,
  world: WorldState, viewLayer: number, anchor: WorldAnchor,
): TargetedBlock {
  const result = ddaViewCells(world, viewLayer, cameraPos, cameraDir, anchor);
  if (result) {
    return { hitLayerPos: result[0], normal: result[1] };
  }
  return { hitLayerPos: null, normal: null };
}

function ddaViewCells(
  world: WorldState, viewLayer: number,
  origin: THREE.Vector3, dir: THREE.Vector3, anchor: WorldAnchor,
): [LayerPos, THREE.Vector3] | null {
  const cellSizeLeaves = cellSizeAtLayer(viewLayer);
  const cellSizeBI = BigInt(Math.round(cellSizeLeaves));
  const cellOrigin = cellOriginForAnchor(anchor, cellSizeBI);
  const cellSize = cellSizeLeaves / anchor.norm; // normalized Bevy units

  const local = new THREE.Vector3().subVectors(origin, cellOrigin);
  const pos = new THREE.Vector3(
    Math.floor(local.x / cellSize),
    Math.floor(local.y / cellSize),
    Math.floor(local.z / cellSize),
  );

  const step = new THREE.Vector3(
    dir.x >= 0 ? 1 : -1,
    dir.y >= 0 ? 1 : -1,
    dir.z >= 0 ? 1 : -1,
  );

  const inv = new THREE.Vector3(
    Math.abs(dir.x) > 1e-10 ? 1 / dir.x : 1e30,
    Math.abs(dir.y) > 1e-10 ? 1 / dir.y : 1e30,
    Math.abs(dir.z) > 1e-10 ? 1 / dir.z : 1e30,
  );

  const nextX = step.x > 0 ? cellOrigin.x + (pos.x + 1) * cellSize : cellOrigin.x + pos.x * cellSize;
  const nextY = step.y > 0 ? cellOrigin.y + (pos.y + 1) * cellSize : cellOrigin.y + pos.y * cellSize;
  const nextZ = step.z > 0 ? cellOrigin.z + (pos.z + 1) * cellSize : cellOrigin.z + pos.z * cellSize;

  const tMax = new THREE.Vector3(
    (nextX - origin.x) * inv.x,
    (nextY - origin.y) * inv.y,
    (nextZ - origin.z) * inv.z,
  );

  const tDelta = new THREE.Vector3(
    Math.abs(cellSize * inv.x),
    Math.abs(cellSize * inv.y),
    Math.abs(cellSize * inv.z),
  );

  const normal = new THREE.Vector3();
  let first = true;

  for (let i = 0; i < MAX_REACH_CELLS; i++) {
    if (!first) {
      const center = new THREE.Vector3(
        cellOrigin.x + (pos.x + 0.5) * cellSize,
        cellOrigin.y + (pos.y + 0.5) * cellSize,
        cellOrigin.z + (pos.z + 0.5) * cellSize,
      );
      const lp = layerPosFromBevy(center, viewLayer, anchor);
      if (lp && isLayerPosSolid(world, lp)) {
        return [lp, normal.clone()];
      }
    }
    first = false;

    if (tMax.x < tMax.y && tMax.x < tMax.z) {
      pos.x += step.x;
      tMax.x += tDelta.x;
      normal.set(-step.x, 0, 0);
    } else if (tMax.y < tMax.z) {
      pos.y += step.y;
      tMax.y += tDelta.y;
      normal.set(0, -step.y, 0);
    } else {
      pos.z += step.z;
      tMax.z += tDelta.z;
      normal.set(0, 0, -step.z);
    }
  }
  return null;
}
