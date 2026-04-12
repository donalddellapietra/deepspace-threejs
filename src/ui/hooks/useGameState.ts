import { useSyncExternalStore } from 'react';
import type { HotbarState, InventoryState, ColorPickerState, ModeIndicatorState, ToastMessage } from '../types';

type Listener = () => void;

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next: T) => { value = next; listeners.forEach(l => l()); },
    subscribe: (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

export const hotbarStore = createStore<HotbarState>({ active: 0, slots: [], layer: 2 });
export const inventoryStore = createStore<InventoryState>({ open: false, builtinBlocks: [], customBlocks: [], savedMeshes: [], layer: 2 });
export const colorPickerStore = createStore<ColorPickerState>({ open: false, r: 0.5, g: 0.5, b: 0.5 });
export const modeIndicatorStore = createStore<ModeIndicatorState>({ layer: 2, saveMode: false, saveEligible: false });
export const toastStore = createStore<ToastMessage | null>(null);

export function useHotbar(): HotbarState {
  return useSyncExternalStore(hotbarStore.subscribe, hotbarStore.get);
}
export function useInventory(): InventoryState {
  return useSyncExternalStore(inventoryStore.subscribe, inventoryStore.get);
}
export function useColorPicker(): ColorPickerState {
  return useSyncExternalStore(colorPickerStore.subscribe, colorPickerStore.get);
}
export function useModeIndicator(): ModeIndicatorState {
  return useSyncExternalStore(modeIndicatorStore.subscribe, modeIndicatorStore.get);
}
export function useToast(): ToastMessage | null {
  return useSyncExternalStore(toastStore.subscribe, toastStore.get);
}
export function clearToast() { toastStore.set(null); }
