// Editor: hotbar, zoom, place/remove blocks, save mode.
// Port of Rust src/editor/

import * as THREE from 'three';
import { EMPTY_VOXEL, Palette, Voxel } from '../block';
import { MAX_LAYER } from '../world/tree';
import { WorldState } from '../world/state';
import { Player } from '../player';
import { snapToGround } from '../world/collision';
import { TargetedBlock } from '../interaction/mod';
import { editAtLayerPos, installSubtree, subtreePathForLayerPos } from '../world/edit';
import { targetLayerFor, cellSizeAtLayer, bevyCenterOfLayerPos, layerPosFromBevy, WorldAnchor } from '../world/view';
import { LayerPos } from '../world/position';
import { NodeId } from '../world/tree';

export const MIN_ZOOM = 2;
export const MAX_ZOOM = MAX_LAYER;

// ---------------------------------------------------------------- hotbar

export type HotbarItem = { kind: 'block'; voxel: Voxel } | { kind: 'model'; index: number };

export class Hotbar {
  // Per-layer hotbar: slots[layer][0..9]
  private slots: Map<number, HotbarItem[]> = new Map();
  active = 0;

  getSlots(layer: number): HotbarItem[] {
    let s = this.slots.get(layer);
    if (!s) {
      // Default: first 10 block types
      s = [];
      for (let i = 0; i < 10; i++) {
        s.push({ kind: 'block', voxel: (i + 1) as Voxel });
      }
      this.slots.set(layer, s);
    }
    return s;
  }

  activeItem(layer: number): HotbarItem {
    return this.getSlots(layer)[this.active];
  }

  assignBlock(layer: number, slot: number, voxel: Voxel): void {
    this.getSlots(layer)[slot] = { kind: 'block', voxel };
  }

  assignMesh(layer: number, slot: number, index: number): void {
    this.getSlots(layer)[slot] = { kind: 'model', index };
  }
}

// ---------------------------------------------------------------- save mode

export interface SavedMesh {
  nodeId: NodeId;
  layer: number;
}

export class SaveMode {
  active = false;
  items: SavedMesh[] = [];

  toggle(): void {
    this.active = !this.active;
  }

  eligible(viewLayer: number): boolean {
    return viewLayer <= MAX_LAYER - 2;
  }
}

// ---------------------------------------------------------------- editor state

export class EditorState {
  viewLayer = MAX_LAYER;
  hotbar = new Hotbar();
  saveMode = new SaveMode();
  inventoryOpen = false;
  colorPickerOpen = false;
  colorPickerRgb: [number, number, number] = [0.5, 0.5, 0.5];

  zoomIn(player: Player, world: WorldState): boolean {
    if (this.viewLayer < MAX_ZOOM) {
      this.viewLayer++;
      snapToGround(player.position, world, this.viewLayer);
      player.velocity.y = 0;
      return true;
    }
    return false;
  }

  zoomOut(player: Player, world: WorldState): boolean {
    if (this.viewLayer > MIN_ZOOM) {
      this.viewLayer--;
      snapToGround(player.position, world, this.viewLayer);
      player.velocity.y = 0;
      return true;
    }
    return false;
  }

  handleKeyDown(
    code: string, player: Player, world: WorldState,
    targeted: TargetedBlock, anchor: WorldAnchor,
  ): void {
    if (this.inventoryOpen || this.colorPickerOpen) {
      if (code === 'KeyE') this.inventoryOpen = false;
      if (code === 'KeyC') this.colorPickerOpen = false;
      if (code === 'Escape') {
        this.inventoryOpen = false;
        this.colorPickerOpen = false;
      }
      return;
    }

    // Zoom
    if (code === 'KeyF') this.zoomIn(player, world);
    if (code === 'KeyQ') this.zoomOut(player, world);

    // Reset
    if (code === 'KeyR') player.reset(world, this.viewLayer);

    // Inventory / color picker
    if (code === 'KeyE') this.inventoryOpen = true;
    if (code === 'KeyC') this.colorPickerOpen = true;

    // Save mode
    if (code === 'KeyV') this.saveMode.toggle();

    // Hotbar slots
    const digitKeys = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
    const idx = digitKeys.indexOf(code);
    if (idx !== -1) this.hotbar.active = idx;

    if (code === 'Escape') {
      this.saveMode.active = false;
    }
  }

  handleMouseDown(
    button: number, world: WorldState,
    targeted: TargetedBlock, anchor: WorldAnchor, cursorLocked: boolean,
  ): void {
    if (!cursorLocked || this.inventoryOpen || this.colorPickerOpen) return;

    if (button === 0 && !this.saveMode.active) {
      // Left click: remove block
      if (targeted.hitLayerPos) {
        editAtLayerPos(world, targeted.hitLayerPos, EMPTY_VOXEL);
      }
    } else if (button === 0 && this.saveMode.active) {
      // Save mode click
      if (targeted.hitLayerPos && this.saveMode.eligible(this.viewLayer)) {
        const tgt = targetLayerFor(this.viewLayer);
        const path = subtreePathForLayerPos(targeted.hitLayerPos);
        // Walk to get the nodeId
        let id = world.root;
        for (const slot of path) {
          const node = world.library.get(id);
          if (!node || !node.children) break;
          id = node.children[slot];
        }
        world.library.refInc(id); // pin the subtree so edits can't evict it
        this.saveMode.items.push({ nodeId: id, layer: tgt });
        this.saveMode.active = false;
      }
    } else if (button === 2) {
      // Right click: place block
      if (!targeted.hitLayerPos || !targeted.normal) return;
      const cs = cellSizeAtLayer(this.viewLayer);
      const hitCenter = bevyCenterOfLayerPos(targeted.hitLayerPos, anchor);
      const placeCenter = hitCenter.clone().addScaledVector(targeted.normal, cs);
      const placeLp = layerPosFromBevy(placeCenter, this.viewLayer, anchor);
      if (!placeLp) return;

      const item = this.hotbar.activeItem(this.viewLayer);
      if (item.kind === 'block') {
        editAtLayerPos(world, placeLp, item.voxel);
      } else {
        const saved = this.saveMode.items[item.index];
        if (!saved) return;
        const path = subtreePathForLayerPos(placeLp);
        installSubtree(world, path, saved.nodeId);
      }
    }
  }

  createCustomBlock(palette: Palette): Voxel {
    const [r, g, b] = this.colorPickerRgb;
    return palette.register({
      name: `Custom #${palette.length - 9}`,
      color: [r, g, b, 1],
      roughness: 0.9,
      metallic: 0,
      transparent: false,
    });
  }
}
