import { useMemo } from "react";
import { blocks, DEFAULT_BLOCK_ID } from "../blocks";
import {
  blockGroups,
  expandBlockGroup,
  getGroupedBlockIds,
} from "../blocks/groups";
import { cn } from "../lib/utils";

interface BlockPaletteProps {
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
}

type BlockGroup = {
  key: string;
  blockIds: string[];
  isUngrouped: boolean;
};

export function BlockPalette({ selectedBlockId, onSelect }: BlockPaletteProps) {
  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), []);

  const groups = useMemo((): BlockGroup[] => {
    const result: BlockGroup[] = [];
    const groupedIds = getGroupedBlockIds(blockGroups);

    for (const [key, specifiers] of Object.entries(blockGroups)) {
      const blockIds = expandBlockGroup(specifiers).filter((id) =>
        blockMap.has(id)
      );
      if (blockIds.length > 0) {
        result.push({ key, blockIds, isUngrouped: false });
      }
    }

    const ungroupedIds = blocks
      .map((b) => b.id)
      .filter((id) => !groupedIds.has(id));

    if (ungroupedIds.length > 0) {
      result.push({
        key: "_ungrouped",
        blockIds: ungroupedIds,
        isUngrouped: true,
      });
    }

    return result;
  }, [blockMap]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {groups.map((group) => (
          <div
            key={group.key}
            className={cn(
              "rounded-lg",
              group.isUngrouped && "bg-red-500/20 p-1.5"
            )}
          >
            <div className="grid grid-cols-4">
              {group.blockIds.map((id) => {
                const block = blockMap.get(id);
                if (!block) return null;
                return (
                  <button
                    key={block.id}
                    onClick={() => onSelect(block.id)}
                    className={cn(
                      "aspect-square rounded transition-all duration-100",
                      selectedBlockId === block.id
                        ? "relative z-10 scale-110 bg-blue-500/30 ring-2 ring-blue-500/50"
                        : "hover:bg-white/20"
                    )}
                  >
                    <img
                      src={block.url}
                      alt={`Block ${block.id}`}
                      title={`:${block.id}:`}
                      className={cn(
                        "w-full h-full object-contain",
                        block.id === DEFAULT_BLOCK_ID &&
                          "border-2 border-black"
                      )}
                      draggable={false}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
