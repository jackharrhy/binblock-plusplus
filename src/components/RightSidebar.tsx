import { useAppStore, type Tool } from "../store/appStore";
import { useGridStore } from "../store/gridStore";
import { DiscordExport } from "./DiscordExport";

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "pencil", label: "Pencil", icon: "✏️" },
  { id: "line", label: "Line", icon: "📏" },
  { id: "rect", label: "Rectangle", icon: "▢" },
  { id: "rect-filled", label: "Rectangle (Filled)", icon: "■" },
  { id: "circle", label: "Circle", icon: "○" },
  { id: "circle-filled", label: "Circle (Filled)", icon: "●" },
  { id: "fill", label: "Fill", icon: "🪣" },
];

interface RightSidebarProps {
  onClearGrid: () => void;
  onResizeGrid: (cols: number, rows: number) => void;
}

export function RightSidebar({ onClearGrid, onResizeGrid }: RightSidebarProps) {
  const { currentTool, setTool, gridCols, gridRows, setGridSize } =
    useAppStore();

  const handleGridSizeChange = (dimension: "cols" | "rows", value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 64) return;

    const newCols = dimension === "cols" ? num : gridCols;
    const newRows = dimension === "rows" ? num : gridRows;

    setGridSize(newCols, newRows);
    onResizeGrid(newCols, newRows);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <section className="p-3">
        <h3 className="text-xs font-medium text-black/50 mb-2">Tools</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setTool(tool.id)}
              title={tool.label}
              className={`aspect-square flex items-center justify-center text-xl rounded transition-colors ${
                currentTool === tool.id
                  ? "bg-black text-white"
                  : "bg-black/5 hover:bg-black/10"
              }`}
            >
              {tool.icon}
            </button>
          ))}
        </div>
      </section>

      <hr className="border-black/10" />

      <section className="p-3">
        <h3 className="text-xs font-medium text-black/50 mb-2">Grid Size</h3>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs text-black/40">Width</label>
            <input
              type="number"
              min={1}
              max={64}
              value={gridCols}
              onChange={(e) => handleGridSizeChange("cols", e.target.value)}
              className="w-full px-2 py-1 text-sm border border-black/20 rounded focus:outline-none focus:border-black/40"
            />
          </div>
          <div className="text-black/30 pt-4">×</div>
          <div className="flex-1">
            <label className="text-xs text-black/40">Height</label>
            <input
              type="number"
              min={1}
              max={64}
              value={gridRows}
              onChange={(e) => handleGridSizeChange("rows", e.target.value)}
              className="w-full px-2 py-1 text-sm border border-black/20 rounded focus:outline-none focus:border-black/40"
            />
          </div>
        </div>
        <button
          onClick={() => {
            useGridStore.getState().pushHistory();
            onClearGrid();
          }}
          className="w-full mt-3 py-1.5 text-xs rounded transition-colors bg-red-500/10 text-red-600 hover:bg-red-500/20 active:bg-red-500/30"
        >
          Clear Grid
        </button>
      </section>

      <hr className="border-black/10" />

      <section className="flex-1 min-h-0 flex flex-col p-3">
        <DiscordExport />
      </section>
    </div>
  );
}
