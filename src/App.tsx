import { initCanvas, destroyCanvas } from "./canvas";
import "./App.css";

export function App() {
  const handleContainerRef = (node: HTMLDivElement | null) => {
    if (node) {
      initCanvas(node);
    } else {
      destroyCanvas();
    }
  };

  return (
    <main className="flex w-screen h-screen overflow-hidden">
      <aside className="w-64 h-full shrink-0 bg-black/10" />
      <div
        ref={handleContainerRef}
        className="flex-1 h-full min-w-0 overflow-hidden"
      />
      <aside className="w-64 h-full shrink-0 bg-black/10" />
    </main>
  );
}
