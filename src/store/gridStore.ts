import { create } from "zustand";

const HISTORY_LIMIT = 50;

type GridSnapshot = {
  cols: number;
  rows: number;
  cells: Record<string, string>;
};

interface GridState {
  cols: number;
  rows: number;
  cells: Record<string, string>; // "x,y" -> blockId

  // History
  past: GridSnapshot[];
  future: GridSnapshot[];

  // Actions
  setCell: (x: number, y: number, blockId: string) => void;
  setGrid: (cols: number, rows: number, cells: Record<string, string>) => void;
  clearGrid: (cols: number, rows: number) => void;

  // History actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useGridStore = create<GridState>((set, get) => ({
  cols: 8,
  rows: 8,
  cells: {},
  past: [],
  future: [],

  setCell: (x, y, blockId) =>
    set((state) => ({
      cells: { ...state.cells, [`${x},${y}`]: blockId },
      // Clear future on new changes (standard undo/redo behavior)
      future: [],
    })),

  setGrid: (cols, rows, cells) =>
    set(() => ({
      cols,
      rows,
      cells,
      future: [],
    })),

  clearGrid: (cols, rows) =>
    set(() => ({
      cols,
      rows,
      cells: {},
      future: [],
    })),

  pushHistory: () =>
    set((state) => {
      const snapshot: GridSnapshot = {
        cols: state.cols,
        rows: state.rows,
        cells: { ...state.cells },
      };
      const newPast = [...state.past, snapshot];
      if (newPast.length > HISTORY_LIMIT) {
        newPast.shift();
      }
      return { past: newPast, future: [] };
    }),

  undo: () => {
    const state = get();
    if (state.past.length === 0) return;

    const newPast = [...state.past];
    const previous = newPast.pop()!;
    const currentSnapshot: GridSnapshot = {
      cols: state.cols,
      rows: state.rows,
      cells: { ...state.cells },
    };

    set({
      cols: previous.cols,
      rows: previous.rows,
      cells: previous.cells,
      past: newPast,
      future: [currentSnapshot, ...state.future],
    });
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return;

    const newFuture = [...state.future];
    const next = newFuture.shift()!;
    const currentSnapshot: GridSnapshot = {
      cols: state.cols,
      rows: state.rows,
      cells: { ...state.cells },
    };

    set({
      cols: next.cols,
      rows: next.rows,
      cells: next.cells,
      past: [...state.past, currentSnapshot],
      future: newFuture,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));

/**
 * Convert the current grid state to Discord emoji text format.
 * Each cell becomes :XX: where XX is the two-digit block ID.
 * Empty cells default to :00:.
 */
export function toDiscordText(
  cols: number,
  rows: number,
  cells: Record<string, string>
): string {
  const lines: string[] = [];

  for (let y = 0; y < rows; y++) {
    let row = "";
    for (let x = 0; x < cols; x++) {
      const blockId = cells[`${x},${y}`] ?? "00";
      row += `:${blockId.padStart(2, "0")}:`;
    }
    lines.push(row);
  }

  return lines.join("\n");
}

/**
 * Split Discord text into chunks that fit within the character limit.
 * Splits on newline boundaries to keep rows intact.
 */
export function splitDiscordText(text: string, charLimit: number): string[] {
  if (text.length <= charLimit) {
    return [text];
  }

  const lines = text.split("\n");
  const chunks: string[] = [];
  let currentChunk = "";

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > charLimit) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = line;
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
