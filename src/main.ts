// Deep Space — Three.js port entry point

import * as THREE from 'three';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';

import './ui/index.css';
import App from './ui/App';

import { Palette, ALL_BLOCK_TYPES, getBlockProperties } from './block';
import { WorldState } from './world/state';
import { WorldRenderer } from './world/render';
import { Player, spawnAnchor, PLAYER_HEIGHT } from './player';
import { FpsCamera } from './camera';
import { EditorState } from './editor/mod';
import { updateTarget, TargetedBlock } from './interaction/mod';
import { cellSizeAtLayer, WorldAnchor, targetLayerFor, bevyOriginOfLayerPos } from './world/view';
import { MAX_LAYER } from './world/tree';
import { drainCommands } from './ui/hooks/useCommands';
import {
  hotbarStore, inventoryStore, colorPickerStore,
  modeIndicatorStore, toastStore,
} from './ui/hooks/useGameState';
import type { SlotInfo, BlockInfo } from './ui/types';

// ---------------------------------------------------------------- init

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(new THREE.Color(0.5, 0.7, 0.9));

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const scene = new THREE.Scene();

// Lighting — matches Bevy setup
const ambientLight = new THREE.AmbientLight(new THREE.Color(0.9, 0.95, 1.0), 2.0);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
dirLight.position.set(0.4, 0.7, 0.3).normalize();
scene.add(dirLight);

// Crosshair
const crosshair = document.createElement('div');
crosshair.style.cssText = 'position:fixed;top:50%;left:50%;width:4px;height:4px;margin:-2px 0 0 -2px;background:rgba(255,255,255,0.8);z-index:20;pointer-events:none;';
document.body.appendChild(crosshair);

// Game state
const palette = new Palette();
const world = new WorldState();
const player = new Player();
const fpsCamera = new FpsCamera(canvas);
const editor = new EditorState();
const worldRenderer = new WorldRenderer(scene, palette);

let anchor: WorldAnchor = spawnAnchor();
let targeted: TargetedBlock = { hitLayerPos: null, normal: null };

// Highlight gizmo
const highlightBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0xffffff }),
);
highlightBox.visible = false;
scene.add(highlightBox);

// ---------------------------------------------------------------- input

const keysDown = new Set<string>();
const keysJustPressed = new Set<string>();

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keysDown.add(e.code);
  keysJustPressed.add(e.code);
});

document.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

canvas.addEventListener('mousedown', (e) => {
  editor.handleMouseDown(e.button, world, targeted, anchor, fpsCamera.cursorLocked);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- React mount

const root = createRoot(document.getElementById('root')!);
root.render(createElement(App));

// ---------------------------------------------------------------- UI state sync

function pushUiState(): void {
  const viewLayer = editor.viewLayer;
  const slots = editor.hotbar.getSlots(viewLayer);

  // Hotbar
  const slotInfos: SlotInfo[] = slots.map((item, i) => {
    if (item.kind === 'block') {
      const entry = palette.get(item.voxel);
      return {
        kind: 'block',
        index: item.voxel,
        name: entry?.name ?? `Block ${item.voxel}`,
        color: entry?.color ?? [0.5, 0.5, 0.5, 1],
      };
    } else {
      return {
        kind: 'model',
        index: item.index,
        name: `Mesh #${item.index}`,
        color: [0.3, 0.9, 0.8, 1],
      };
    }
  });
  hotbarStore.set({ active: editor.hotbar.active, slots: slotInfos, layer: viewLayer });

  // Inventory
  const builtinBlocks: BlockInfo[] = ALL_BLOCK_TYPES.map(bt => {
    const props = getBlockProperties(bt);
    return { voxel: bt + 1, name: props.name, color: props.color };
  });
  const customBlocks: BlockInfo[] = [];
  for (let i = ALL_BLOCK_TYPES.length; i < palette.length; i++) {
    const entry = palette.entries[i];
    customBlocks.push({ voxel: i + 1, name: entry.name, color: entry.color });
  }
  const tgtLayer = targetLayerFor(viewLayer);
  const savedMeshes = editor.saveMode.items
    .map((m, i) => ({ index: i, layer: m.layer }))
    .filter(m => m.layer === tgtLayer);

  inventoryStore.set({
    open: editor.inventoryOpen,
    builtinBlocks,
    customBlocks,
    savedMeshes,
    layer: viewLayer,
  });

  // Color picker
  colorPickerStore.set({
    open: editor.colorPickerOpen,
    r: editor.colorPickerRgb[0],
    g: editor.colorPickerRgb[1],
    b: editor.colorPickerRgb[2],
  });

  // Mode indicator
  modeIndicatorStore.set({
    layer: viewLayer,
    saveMode: editor.saveMode.active,
    saveEligible: editor.saveMode.eligible(viewLayer),
    entityEditMode: editor.entityEditMode,
  });
}

function processUiCommands(): void {
  for (const cmd of drainCommands()) {
    switch (cmd.cmd) {
      case 'selectHotbarSlot':
        editor.hotbar.active = cmd.slot;
        break;
      case 'assignBlockToSlot':
        editor.hotbar.assignBlock(editor.viewLayer, editor.hotbar.active, cmd.voxel);
        break;
      case 'assignMeshToSlot':
        editor.hotbar.assignMesh(editor.viewLayer, editor.hotbar.active, cmd.meshIndex);
        break;
      case 'setColorPickerRgb':
        editor.colorPickerRgb = [cmd.r, cmd.g, cmd.b];
        break;
      case 'createBlock':
        editor.createCustomBlock(palette);
        break;
      case 'toggleInventory':
        editor.inventoryOpen = !editor.inventoryOpen;
        break;
      case 'toggleColorPicker':
        editor.colorPickerOpen = !editor.colorPickerOpen;
        break;
    }
  }
}

// ---------------------------------------------------------------- game loop

let lastTime = performance.now();
let toastId = 0;

function gameLoop(): void {
  requestAnimationFrame(gameLoop);

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
  lastTime = now;

  // Process keyboard input for editor
  for (const code of keysJustPressed) {
    editor.handleKeyDown(code, player, world, targeted, anchor, fpsCamera.zoomTransition);
  }

  // Process UI commands
  processUiCommands();

  // Player update (needs keysJustPressed for jump)
  player.update(dt, keysDown, keysJustPressed, world, editor.viewLayer, editor.inventoryOpen || editor.colorPickerOpen);

  // Clear just-pressed after all consumers have read it
  keysJustPressed.clear();

  // Sync anchor
  anchor = player.getAnchor(editor.viewLayer);

  // Camera
  fpsCamera.update(player, editor.viewLayer, anchor, dt);

  // Interaction (raycast)
  const cameraPos = fpsCamera.camera.position.clone();
  const cameraDir = fpsCamera.getForward();
  targeted = updateTarget(cameraPos, cameraDir, world, editor.viewLayer, anchor);

  // Highlight
  if (targeted.hitLayerPos && !editor.saveMode.active) {
    const cs = cellSizeAtLayer(editor.viewLayer) / anchor.norm;
    const origin = bevyOriginOfLayerPos(targeted.hitLayerPos, anchor);
    highlightBox.position.set(origin.x + cs * 0.5, origin.y + cs * 0.5, origin.z + cs * 0.5);
    highlightBox.scale.setScalar(cs * 1.02);
    highlightBox.visible = true;
  } else {
    highlightBox.visible = false;
  }

  // Render world
  worldRenderer.render(world, editor.viewLayer, anchor, cameraPos);

  // Push UI state
  pushUiState();

  // Render Three.js
  renderer.render(scene, fpsCamera.camera);
}

gameLoop();
