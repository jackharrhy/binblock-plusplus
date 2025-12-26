import { useState, useRef, useEffect } from "react";
import { CanvasController } from "./canvas";
import { BlockPalette } from "./components/BlockPalette";
import "./App.css";

export function App() {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const controllerRef = useRef<CanvasController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleBlockSelect = (blockId: string) => {
    setSelectedBlockId(blockId);
    controllerRef.current?.setSelectedBlock(blockId);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    CanvasController.create(container).then((controller) => {
      if (cancelled) {
        controller.destroy();
        return;
      }
      controllerRef.current = controller;
    });

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (controllerRef.current && selectedBlockId !== null) {
      controllerRef.current.setSelectedBlock(selectedBlockId);
    }
  }, [selectedBlockId]);

  return (
    <main className="flex w-screen h-screen overflow-hidden">
      <aside className="w-[18rem] h-full shrink-0 bg-black/10">
        <BlockPalette
          selectedBlockId={selectedBlockId}
          onSelect={handleBlockSelect}
        />
      </aside>
      <div
        ref={containerRef}
        className="flex-1 h-full min-w-0 overflow-hidden"
      />
      <aside className="w-[18rem] h-full shrink-0 bg-black/10" />
    </main>
  );
}
