import { blocks } from "../blocks";

interface BlockPaletteProps {
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}

export function BlockPalette({ selectedBlockId, onSelect }: BlockPaletteProps) {
  return (
    <div className="h-full flex flex-col p-2">
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-4">
          {blocks.map((block) => (
            <button
              key={block.id}
              onClick={() => onSelect(block.id)}
              className={`
                aspect-square rounded transition-all
                ${
                  selectedBlockId === block.id
                    ? "bg-blue-500/30 ring-2 ring-blue-500"
                    : "hover:bg-white/20"
                }
              `}
            >
              <img
                src={block.url}
                alt={`Block ${block.id}`}
                className="w-full h-full object-contain"
                draggable={false}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
