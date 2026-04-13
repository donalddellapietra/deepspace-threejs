export interface SlotInfo {
  kind: 'block' | 'model';
  index: number;
  name: string;
  color: [number, number, number, number];
}

export interface HotbarState {
  active: number;
  slots: SlotInfo[];
  layer: number;
}

export interface BlockInfo {
  voxel: number;
  name: string;
  color: [number, number, number, number];
}

export interface MeshInfo {
  index: number;
  layer: number;
}

export interface InventoryState {
  open: boolean;
  builtinBlocks: BlockInfo[];
  customBlocks: BlockInfo[];
  savedMeshes: MeshInfo[];
  layer: number;
}

export interface ColorPickerState {
  open: boolean;
  r: number;
  g: number;
  b: number;
}

export interface ModeIndicatorState {
  layer: number;
  saveMode: boolean;
  saveEligible: boolean;
  entityEditMode: boolean;
}

export interface ToastMessage {
  text: string;
  id: number;
}
