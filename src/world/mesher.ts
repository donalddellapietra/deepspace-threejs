import * as THREE from "three";

// ---------- Face table ----------

interface FaceDef {
  neighborOffset: [number, number, number];
  verts: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]];
  normal: [number, number, number];
}

const FACES: FaceDef[] = [
  // +X
  { neighborOffset: [1, 0, 0], verts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], normal: [1, 0, 0] },
  // -X
  { neighborOffset: [-1, 0, 0], verts: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], normal: [-1, 0, 0] },
  // +Y
  { neighborOffset: [0, 1, 0], verts: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], normal: [0, 1, 0] },
  // -Y
  { neighborOffset: [0, -1, 0], verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], normal: [0, -1, 0] },
  // +Z
  { neighborOffset: [0, 0, 1], verts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], normal: [0, 0, 1] },
  // -Z
  { neighborOffset: [0, 0, -1], verts: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], normal: [0, 0, -1] },
];

// ---------- AO ----------

const AO_CURVE = [0.6, 0.75, 0.9, 1.0];

function computeAO(
  face: FaceDef,
  bx: number,
  by: number,
  bz: number,
  isSolid: (x: number, y: number, z: number) => boolean,
): [number, number, number, number] {
  const [nx, ny, nz] = face.normal;

  // Sample base: block position + face normal
  const sbx = bx + nx;
  const sby = by + ny;
  const sbz = bz + nz;

  // Determine the two tangent axes (indices into xyz where normal == 0)
  // and the normal axis index
  const ao: [number, number, number, number] = [0, 0, 0, 0];

  for (let vi = 0; vi < 4; vi++) {
    const v = face.verts[vi];

    // For each tangent axis, map vertex coord (0 or 1) to direction (-1 or +1)
    const dirs: [number, number, number] = [0, 0, 0];

    for (let axis = 0; axis < 3; axis++) {
      if (face.normal[axis] !== 0) continue; // skip the normal axis
      dirs[axis] = v[axis] === 0 ? -1 : 1;
    }

    // Separate the two tangent axes. Build per-axis offsets.
    // tangent axis 1: first non-normal axis, tangent axis 2: second
    let t1Axis = -1;
    let t2Axis = -1;
    for (let axis = 0; axis < 3; axis++) {
      if (face.normal[axis] !== 0) continue;
      if (t1Axis === -1) t1Axis = axis;
      else t2Axis = axis;
    }

    const d1: [number, number, number] = [0, 0, 0];
    d1[t1Axis] = dirs[t1Axis];

    const d2: [number, number, number] = [0, 0, 0];
    d2[t2Axis] = dirs[t2Axis];

    const side1 = isSolid(sbx + d1[0], sby + d1[1], sbz + d1[2]) ? 1 : 0;
    const side2 = isSolid(sbx + d2[0], sby + d2[1], sbz + d2[2]) ? 1 : 0;

    let corner: number;
    if (side1 === 1 && side2 === 1) {
      corner = 1;
    } else {
      corner = isSolid(sbx + dirs[0], sby + dirs[1], sbz + dirs[2]) ? 1 : 0;
    }

    ao[vi] = 3 - (side1 + side2 + corner);
  }

  return ao;
}

// ---------- Per-type geometry collector ----------

class MeshCollector {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  vertexCount = 0;

  addQuad(
    bx: number,
    by: number,
    bz: number,
    face: FaceDef,
    ao: [number, number, number, number],
  ): void {
    const base = this.vertexCount;

    for (let i = 0; i < 4; i++) {
      const v = face.verts[i];
      this.positions.push(bx + v[0], by + v[1], bz + v[2]);
      this.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      const c = AO_CURVE[ao[i]];
      this.colors.push(c, c, c);
    }

    // Quad flipping to avoid AO artifacts
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      // Standard winding
      this.indices.push(base + 0, base + 1, base + 2);
      this.indices.push(base + 0, base + 2, base + 3);
    } else {
      // Flipped winding
      this.indices.push(base + 1, base + 2, base + 3);
      this.indices.push(base + 1, base + 3, base + 0);
    }

    this.vertexCount += 4;
  }

  buildGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(this.indices, 1));
    return geo;
  }
}

// ---------- Public API ----------

export function bakeVolume(
  size: number,
  get: (x: number, y: number, z: number) => number | null,
): Map<number, THREE.BufferGeometry> {
  const collectors = new Map<number, MeshCollector>();

  const isSolid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return false;
    return get(x, y, z) !== null;
  };

  // Iterate y, z, x (row-major like Rust)
  for (let y = 0; y < size; y++) {
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const voxel = get(x, y, z);
        if (voxel === null) continue;

        let collector = collectors.get(voxel);
        if (!collector) {
          collector = new MeshCollector();
          collectors.set(voxel, collector);
        }

        for (const face of FACES) {
          const nx = x + face.neighborOffset[0];
          const ny = y + face.neighborOffset[1];
          const nz = z + face.neighborOffset[2];

          // Add face only if neighbor is empty
          if (nx < 0 || ny < 0 || nz < 0 || nx >= size || ny >= size || nz >= size || get(nx, ny, nz) === null) {
            const ao = computeAO(face, x, y, z, isSolid);
            collector.addQuad(x, y, z, face, ao);
          }
        }
      }
    }
  }

  const result = new Map<number, THREE.BufferGeometry>();
  for (const [voxelType, collector] of collectors) {
    result.set(voxelType, collector.buildGeometry());
  }
  return result;
}
