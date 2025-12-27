import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useGridStore } from "./store/gridStore";
import type { CanvasController } from "./canvas";

type MenuEventPayload = string;

let unlistenFn: UnlistenFn | null = null;
let canvasRef: CanvasController | null = null;

export function setCanvasRef(canvas: CanvasController | null): void {
  canvasRef = canvas;
}

export async function initMenuListeners(): Promise<void> {
  // Clean up any existing listener
  if (unlistenFn) {
    unlistenFn();
  }

  unlistenFn = await listen<MenuEventPayload>("menu-event", (event) => {
    const menuId = event.payload;
    console.log("Menu event:", menuId);

    switch (menuId) {
      case "edit:undo":
        handleUndo();
        break;
      case "edit:redo":
        handleRedo();
        break;
      case "edit:clear":
        handleClear();
        break;
      case "view:reset":
        handleResetView();
        break;
    }
  });
}

export function cleanupMenuListeners(): void {
  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }
}

function handleUndo(): void {
  const store = useGridStore.getState();
  if (store.canUndo()) {
    store.undo();
    // Sync canvas with new store state
    canvasRef?.syncFromStore();
  }
}

function handleRedo(): void {
  const store = useGridStore.getState();
  if (store.canRedo()) {
    store.redo();
    // Sync canvas with new store state
    canvasRef?.syncFromStore();
  }
}

function handleClear(): void {
  // Push history before clearing
  useGridStore.getState().pushHistory();
  canvasRef?.clearAllCells();
}

function handleResetView(): void {
  canvasRef?.resetView();
}
