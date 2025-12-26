import { CanvasController } from "./canvas";
import "./App.css";

export function App() {
  const handleContainerRef = (node: HTMLDivElement | null) => {
    if (!node) return;

    let controller: CanvasController | null = null;

    CanvasController.create(node).then((c) => {
      controller = c;
    });

    return () => {
      controller?.destroy();
    };
  };

  return (
    <main className="flex w-screen h-screen overflow-hidden">
      <aside className="w-[16rem] h-full shrink-0 bg-black/10" />
      <div
        ref={handleContainerRef}
        className="flex-1 h-full min-w-0 overflow-hidden"
      />
      <aside className="w-[16rem] h-full shrink-0 bg-black/10" />
    </main>
  );
}
