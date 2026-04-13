// First-person camera with zoom transition animation.
// Port of Rust src/camera.rs

import * as THREE from 'three';
import { Player, PLAYER_HEIGHT } from './player';
import { cellSizeAtLayer, scaleForLayer, targetLayerFor, WorldAnchor } from './world/view';

const SENSITIVITY = 0.003;
const ZOOM_TRANSITION_SECS = 0.3;

// ------------------------------------------------- zoom transition

interface AnimatingZoom {
  fromCellSize: number;
  toCellSize: number;
  t: number;
}

export class ZoomTransition {
  private active: AnimatingZoom | null = null;

  start(fromLayer: number, toLayer: number): void {
    const fromNorm = scaleForLayer(targetLayerFor(fromLayer));
    const toNorm = scaleForLayer(targetLayerFor(toLayer));
    this.active = {
      fromCellSize: scaleForLayer(fromLayer) / fromNorm,
      toCellSize: scaleForLayer(toLayer) / toNorm,
      t: 0,
    };
  }

  tick(dt: number): void {
    if (!this.active) return;
    this.active.t += dt / ZOOM_TRANSITION_SECS;
    if (this.active.t >= 1) {
      this.active = null;
    }
  }

  effectiveCellSize(currentLayer: number, anchor: WorldAnchor): number {
    if (!this.active) {
      return scaleForLayer(currentLayer) / anchor.norm;
    }
    const t = Math.min(1, Math.max(0, this.active.t));
    const ease = t * t * (3 - 2 * t); // smoothstep
    return this.active.fromCellSize + (this.active.toCellSize - this.active.fromCellSize) * ease;
  }
}

// ------------------------------------------------- camera

export class FpsCamera {
  camera: THREE.PerspectiveCamera;
  cursorLocked = false;
  zoomTransition = new ZoomTransition();

  private _pendingDx = 0;
  private _pendingDy = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    canvas.addEventListener('click', () => {
      if (!this.cursorLocked) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.cursorLocked = document.pointerLockElement === canvas;
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.cursorLocked) return;
      this._pendingDx += e.movementX;
      this._pendingDy += e.movementY;
    });
  }

  update(player: Player, viewLayer: number, anchor: WorldAnchor, dt: number): void {
    // Tick zoom transition
    this.zoomTransition.tick(dt);

    // Apply accumulated mouse delta
    if (this.cursorLocked) {
      player.yaw -= this._pendingDx * SENSITIVITY;
      player.pitch = Math.min(
        Math.PI / 2 - 0.05,
        Math.max(-Math.PI / 2 + 0.05, player.pitch + this._pendingDy * SENSITIVITY),
      );
    }
    this._pendingDx = 0;
    this._pendingDy = 0;

    // Follow player with interpolated cell size
    const playerBevy = player.getBevyPosition(anchor);
    const cell = this.zoomTransition.effectiveCellSize(viewLayer, anchor);
    const eyeHeight = PLAYER_HEIGHT * cell;

    this.camera.position.set(playerBevy.x, playerBevy.y + eyeHeight, playerBevy.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(-player.pitch, player.yaw, 0);
  }

  getForward(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    return dir;
  }

  unlock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.cursorLocked = false;
  }
}
