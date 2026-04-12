// First-person camera: yaw + pitch from mouse, follows player.
// Port of Rust src/camera.rs

import * as THREE from 'three';
import { Player, PLAYER_HEIGHT } from './player';
import { cellSizeAtLayer, WorldAnchor } from './world/view';

const SENSITIVITY = 0.003;

export class FpsCamera {
  camera: THREE.PerspectiveCamera;
  cursorLocked = false;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    // Pointer lock
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

  private _pendingDx = 0;
  private _pendingDy = 0;

  update(player: Player, viewLayer: number, anchor: WorldAnchor): void {
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

    // Follow player
    const playerBevy = player.getBevyPosition(anchor);
    const cell = cellSizeAtLayer(viewLayer);
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
