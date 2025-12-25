import {
  Application,
  Container,
  Graphics,
  FederatedPointerEvent,
} from "pixi.js";

const MIN_GRID_HEIGHT_RATIO = 0.45;
const MIN_VISIBLE_CELLS = 4;

let app: Application | null = null;
let sceneContainer: Container | null = null;
let gridGraphics: Graphics | null = null;

let isDragging = false;
let isShiftHeld = false;
let lastPointerPosition = { x: 0, y: 0 };

let currentGridInfo = { width: 0, height: 0, cellSize: 0, cols: 0, rows: 0 };
let lastScreenSize = { width: 0, height: 0 };
let hasMovedView = false;
let resizeObserver: ResizeObserver | null = null;

export async function initCanvas(container: HTMLElement): Promise<Application> {
  if (app) {
    return app;
  }

  app = new Application();

  await app.init({
    resizeTo: container,
    background: "white",
    antialias: true,
  });

  container.appendChild(app.canvas);

  sceneContainer = new Container();
  app.stage.addChild(sceneContainer);

  setupPanZoom(container);
  drawGrid(8, 8);
  setInitialView();

  return app;
}

function setupPanZoom(container: HTMLElement): void {
  if (!app || !sceneContainer) return;

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  app.stage.on("pointerdown", onDragStart);
  app.stage.on("pointermove", onDragMove);
  app.stage.on("pointerup", onDragEnd);
  app.stage.on("pointerupoutside", onDragEnd);

  app.canvas.addEventListener("wheel", onWheel, { passive: false });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(onResize);
  });
  resizeObserver.observe(container);

  lastScreenSize = { width: app.screen.width, height: app.screen.height };
}

function onResize(): void {
  if (!app || !sceneContainer) return;

  const newWidth = app.screen.width;
  const newHeight = app.screen.height;

  if (!hasMovedView) {
    drawGrid(currentGridInfo.cols, currentGridInfo.rows);
    setInitialView();
  } else {
    const oldCenterX = lastScreenSize.width / 2;
    const oldCenterY = lastScreenSize.height / 2;

    const worldCenterX =
      (oldCenterX - sceneContainer.x) / sceneContainer.scale.x;
    const worldCenterY =
      (oldCenterY - sceneContainer.y) / sceneContainer.scale.y;

    const newCenterX = newWidth / 2;
    const newCenterY = newHeight / 2;

    sceneContainer.x = newCenterX - worldCenterX * sceneContainer.scale.x;
    sceneContainer.y = newCenterY - worldCenterY * sceneContainer.scale.y;
  }

  lastScreenSize = { width: newWidth, height: newHeight };
  app.stage.hitArea = app.screen;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Shift" && !isShiftHeld) {
    isShiftHeld = true;
    updateCursor();
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === "Shift") {
    isShiftHeld = false;
    isDragging = false;
    updateCursor();
  }
}

function updateCursor(): void {
  if (!app) return;
  if (isShiftHeld) {
    app.canvas.style.cursor = isDragging ? "grabbing" : "grab";
  } else {
    app.canvas.style.cursor = "default";
  }
}

function onDragStart(event: FederatedPointerEvent): void {
  if (!isShiftHeld) return;
  isDragging = true;
  lastPointerPosition = { x: event.global.x, y: event.global.y };
  updateCursor();
}

function onDragMove(event: FederatedPointerEvent): void {
  if (!isDragging || !sceneContainer) return;

  const dx = event.global.x - lastPointerPosition.x;
  const dy = event.global.y - lastPointerPosition.y;

  sceneContainer.x += dx;
  sceneContainer.y += dy;

  lastPointerPosition = { x: event.global.x, y: event.global.y };
  hasMovedView = true;
}

function onDragEnd(): void {
  isDragging = false;
  updateCursor();
}

function onWheel(event: WheelEvent): void {
  if (!app || !sceneContainer || !isShiftHeld) return;
  event.preventDefault();

  const scaleAmount = 1.1;
  const direction = event.deltaY < 0 ? 1 : -1;
  const factor = direction > 0 ? scaleAmount : 1 / scaleAmount;

  const screenHeight = app.screen.height;
  const screenWidth = app.screen.width;

  const minScale =
    (screenHeight * MIN_GRID_HEIGHT_RATIO) / currentGridInfo.height;
  const maxScaleFromWidth =
    screenWidth / (currentGridInfo.cellSize * MIN_VISIBLE_CELLS);
  const maxScaleFromHeight =
    screenHeight / (currentGridInfo.cellSize * MIN_VISIBLE_CELLS);
  const maxScale = Math.min(maxScaleFromWidth, maxScaleFromHeight);

  let newScale = sceneContainer.scale.x * factor;
  newScale = Math.max(minScale, Math.min(maxScale, newScale));

  if (newScale === sceneContainer.scale.x) return;

  const pointerX = event.offsetX;
  const pointerY = event.offsetY;

  const worldPos = {
    x: (pointerX - sceneContainer.x) / sceneContainer.scale.x,
    y: (pointerY - sceneContainer.y) / sceneContainer.scale.y,
  };

  sceneContainer.scale.x = newScale;
  sceneContainer.scale.y = newScale;

  sceneContainer.x = pointerX - worldPos.x * sceneContainer.scale.x;
  sceneContainer.y = pointerY - worldPos.y * sceneContainer.scale.y;

  hasMovedView = true;
}

export function drawGrid(cols: number, rows: number): void {
  if (!app || !sceneContainer) return;

  if (gridGraphics) {
    gridGraphics.destroy();
  }

  gridGraphics = new Graphics();
  sceneContainer.addChild(gridGraphics);

  const screenWidth = app.screen.width;
  const screenHeight = app.screen.height;

  const cellSize = Math.min(screenWidth / cols, screenHeight / rows);
  const gridWidth = cellSize * cols;
  const gridHeight = cellSize * rows;

  currentGridInfo = {
    width: gridWidth,
    height: gridHeight,
    cellSize,
    cols,
    rows,
  };

  const offsetX = (screenWidth - gridWidth) / 2;
  const offsetY = (screenHeight - gridHeight) / 2;

  for (let i = 0; i <= cols; i++) {
    const x = offsetX + i * cellSize;
    gridGraphics.moveTo(x, offsetY);
    gridGraphics.lineTo(x, offsetY + gridHeight);
  }

  for (let j = 0; j <= rows; j++) {
    const y = offsetY + j * cellSize;
    gridGraphics.moveTo(offsetX, y);
    gridGraphics.lineTo(offsetX + gridWidth, y);
  }

  gridGraphics.stroke({ width: 2, color: 0x000000, alpha: 0.15 });
}

function setInitialView(): void {
  if (!app || !sceneContainer) return;

  const screenWidth = app.screen.width;
  const screenHeight = app.screen.height;

  const paddingCells = 1;
  const paddedWidth =
    currentGridInfo.width + 2 * paddingCells * currentGridInfo.cellSize;
  const paddedHeight =
    currentGridInfo.height + 2 * paddingCells * currentGridInfo.cellSize;

  const scaleFromWidth = screenWidth / paddedWidth;
  const scaleFromHeight = screenHeight / paddedHeight;
  const scale = Math.min(scaleFromWidth, scaleFromHeight);

  sceneContainer.scale.set(scale);

  const scaledWidth = screenWidth * scale;
  const scaledHeight = screenHeight * scale;

  sceneContainer.x = (screenWidth - scaledWidth) / 2;
  sceneContainer.y = (screenHeight - scaledHeight) / 2;
}

export function destroyCanvas(): void {
  if (app) {
    app.canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    resizeObserver?.disconnect();
    resizeObserver = null;
    app.destroy(true, { children: true });
    app = null;
    sceneContainer = null;
    gridGraphics = null;
    isDragging = false;
    isShiftHeld = false;
    hasMovedView = false;
  }
}

export function getApp(): Application | null {
  return app;
}

export function hasViewMoved(): boolean {
  return hasMovedView;
}

export function resetView(): void {
  if (!app || !sceneContainer) return;
  drawGrid(currentGridInfo.cols, currentGridInfo.rows);
  setInitialView();
  hasMovedView = false;
}
