import { create } from "zustand";

export type Tool =
  | "pencil"
  | "line"
  | "rect"
  | "rect-filled"
  | "circle"
  | "circle-filled"
  | "fill";

interface AppState {
  currentTool: Tool;
  gridCols: number;
  gridRows: number;

  setTool: (tool: Tool) => void;
  setGridSize: (cols: number, rows: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentTool: "pencil",
  gridCols: 8,
  gridRows: 8,

  setTool: (tool) => set({ currentTool: tool }),
  setGridSize: (cols, rows) => set({ gridCols: cols, gridRows: rows }),
}));
