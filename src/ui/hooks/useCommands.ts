// Command queue: UI → game loop
// Unlike the Rust version (which polled via wasm-bindgen), we use a simple queue
// that the game loop drains each frame.

export type UiCommand =
  | { cmd: 'selectHotbarSlot'; slot: number }
  | { cmd: 'assignBlockToSlot'; voxel: number }
  | { cmd: 'assignMeshToSlot'; meshIndex: number }
  | { cmd: 'setColorPickerRgb'; r: number; g: number; b: number }
  | { cmd: 'createBlock' }
  | { cmd: 'toggleInventory' }
  | { cmd: 'toggleColorPicker' };

const queue: UiCommand[] = [];

export function sendCommand(cmd: UiCommand) { queue.push(cmd); }
export function drainCommands(): UiCommand[] { return queue.splice(0); }

// Convenience wrappers
export function selectHotbarSlot(slot: number) { sendCommand({ cmd: 'selectHotbarSlot', slot }); }
export function assignBlockToSlot(voxel: number) { sendCommand({ cmd: 'assignBlockToSlot', voxel }); }
export function assignMeshToSlot(meshIndex: number) { sendCommand({ cmd: 'assignMeshToSlot', meshIndex }); }
export function setColorPickerRgb(r: number, g: number, b: number) { sendCommand({ cmd: 'setColorPickerRgb', r, g, b }); }
export function createBlock() { sendCommand({ cmd: 'createBlock' }); }
export function toggleInventory() { sendCommand({ cmd: 'toggleInventory' }); }
export function toggleColorPicker() { sendCommand({ cmd: 'toggleColorPicker' }); }
