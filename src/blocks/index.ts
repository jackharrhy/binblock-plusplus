const blockModules = import.meta.glob<{ default: string }>(
  ["./*.png", "./*.gif"],
  {
    eager: true,
  }
);

export const DEFAULT_BLOCK_ID = "col7";

export const blocks = Object.entries(blockModules)
  .map(([path, module]) => {
    const id = path.match(/\.\/(.+)\.(png|gif)$/)?.[1];
    if (!id) return null;
    return { id, url: module.default };
  })
  .filter((b): b is { id: string; url: string } => b !== null)
  .sort((a, b) => a.id.localeCompare(b.id));

export type Block = (typeof blocks)[number];

export type GridState = {
  cols: number;
  rows: number;
  cells: Record<string, string | null>;
};
