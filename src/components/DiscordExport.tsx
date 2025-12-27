import { useState } from "react";
import {
  useGridStore,
  toDiscordText,
  splitDiscordText,
} from "../store/gridStore";

type CharLimit = 2000 | 4000;

export function DiscordExport() {
  const [charLimit, setCharLimit] = useState<CharLimit>(2000);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const { cols, rows, cells } = useGridStore();

  const discordText = toDiscordText(cols, rows, cells);
  const chunks = splitDiscordText(discordText, charLimit);

  const copyToClipboard = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <h3 className="text-xs font-medium text-black/50">Message Limit</h3>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCharLimit(2000)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            charLimit === 2000
              ? "bg-black text-white"
              : "bg-black/10 text-black/60 hover:bg-black/20"
          }`}
        >
          2K
        </button>
        <button
          onClick={() => setCharLimit(4000)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            charLimit === 4000
              ? "bg-black text-white"
              : "bg-black/10 text-black/60 hover:bg-black/20"
          }`}
        >
          4K (Nitro)
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">
        {chunks.map((chunk, index) => (
          <div key={index} className="flex flex-col gap-1">
            {chunks.length > 1 && (
              <div className="text-xs text-black/50">
                Part {index + 1} of {chunks.length} ({chunk.length} chars)
              </div>
            )}
            <textarea
              readOnly
              value={chunk}
              className="w-full flex-1 min-h-[120px] p-2 text-xs font-mono bg-white border border-black/20 rounded resize-none focus:outline-none focus:border-black/40"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
            <button
              onClick={() => copyToClipboard(chunk, index)}
              className="w-full py-1.5 text-xs rounded transition-colors bg-black/10 text-black/70 hover:bg-black/20 active:bg-black/30"
            >
              {copiedIndex === index ? "Copied!" : "Copy"}
            </button>
          </div>
        ))}
      </div>

      <div className="text-xs text-black/40 text-center">
        {discordText.length} total chars
      </div>
    </div>
  );
}
