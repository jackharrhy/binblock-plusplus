import { useAppStore, type Tool } from "../store/appStore";
import { useGridStore } from "../store/gridStore";
import { DiscordExport } from "./DiscordExport";

const toolModules = import.meta.glob<{ default: string }>(
  "../icons/tools/*.png",
  { eager: true }
);

const toolIcons: Record<string, string> = {
  pencil: toolModules["../icons/tools/pencil.png"]?.default,
  line: toolModules["../icons/tools/line.png"]?.default,
  rect: toolModules["../icons/tools/rectangle.png"]?.default,
  "rect-filled": toolModules["../icons/tools/rectangle-filled.png"]?.default,
  circle: toolModules["../icons/tools/circle.png"]?.default,
  "circle-filled": toolModules["../icons/tools/circle-filled.png"]?.default,
  fill: toolModules["../icons/tools/fill.png"]?.default,
};

const TOOLS: { id: Tool; label: string }[] = [
  { id: "pencil", label: "Pencil" },
  { id: "line", label: "Line" },
  { id: "rect", label: "Rectangle" },
  { id: "rect-filled", label: "Fill Rectangle" },
  { id: "circle", label: "Circle" },
  { id: "circle-filled", label: "Fill Circle" },
  { id: "fill", label: "Flood Fill" },
];

interface RightSidebarProps {
  onClearGrid: () => void;
  onResizeGrid: (cols: number, rows: number) => void;
  onExportPng: () => void;
}

export function RightSidebar({
  onClearGrid,
  onResizeGrid,
  onExportPng,
}: RightSidebarProps) {
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
        <div className="grid grid-cols-2 gap-1">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setTool(tool.id)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                currentTool === tool.id
                  ? "bg-black/10"
                  : "bg-black/5 hover:bg-black/10"
              }`}
            >
              <img
                src={toolIcons[tool.id]}
                alt={tool.label}
                className="w-4 h-4 object-contain"
              />
              <span className="truncate">{tool.label}</span>
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

      <section className="p-3">
        <button
          onClick={onExportPng}
          className="w-full py-2 text-xs font-medium rounded transition-colors bg-blue-200 text-blue-800 hover:bg-blue-300 active:bg-blue-300"
        >
          Export as PNG
        </button>
      </section>

      <hr className="border-black/10" />

      <section className="flex-1 min-h-0 flex flex-col p-3">
        <DiscordExport />
      </section>
    </div>
  );
}
