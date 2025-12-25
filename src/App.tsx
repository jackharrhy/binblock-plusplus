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
    <main style={{ width: "100vw", height: "100vh", margin: 0, padding: 0 }}>
      <div ref={handleContainerRef} style={{ width: "100%", height: "100%" }} />
    </main>
  );
}
