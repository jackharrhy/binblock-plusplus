const blockModules = import.meta.glob<{ default: string }>("./*.png", {
  eager: true,
});

export const DEFAULT_BLOCK_ID = "12";

export const blocks = Object.entries(blockModules)
  .map(([path, module]) => {
    const id = path.match(/\.\/(.+)\.png$/)?.[1];
    if (!id) return null;
    return { id, url: module.default };
  })
  .filter((b): b is { id: string; url: string } => b !== null)
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

export type Block = (typeof blocks)[number];

export type GridState = {
  cols: number;
  rows: number;
  cells: Record<string, string | null>;
};
