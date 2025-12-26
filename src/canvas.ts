import {
  Application,
  Container,
  Graphics,
  FederatedPointerEvent,
} from "pixi.js";
import createDebug from "debug";

const debug = createDebug("binblock:canvas");

const MIN_GRID_HEIGHT_RATIO = 0.45;
const MIN_VISIBLE_CELLS = 4;

export class CanvasController {
  private app: Application;
  private sceneContainer: Container;
  private gridGraphics: Graphics | null = null;

  private isDragging = false;
  private isShiftHeld = false;
  private lastPointerPosition = { x: 0, y: 0 };

  private currentGridInfo = {
    width: 0,
    height: 0,
    cellSize: 0,
    cols: 0,
    rows: 0,
  };
  private lastScreenSize = { width: 0, height: 0 };
  private hasMovedView = false;
  private resizeObserver: ResizeObserver | null = null;

  private boundOnWheel: (e: WheelEvent) => void;
  private boundOnKeyDown: (e: KeyboardEvent) => void;
  private boundOnKeyUp: (e: KeyboardEvent) => void;
  private boundOnDragStart: (e: FederatedPointerEvent) => void;
  private boundOnDragMove: (e: FederatedPointerEvent) => void;
  private boundOnDragEnd: () => void;

  private constructor(app: Application) {
    this.app = app;
    this.sceneContainer = new Container();
    this.app.stage.addChild(this.sceneContainer);

    this.boundOnWheel = this.onWheel.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);
    this.boundOnDragStart = this.onDragStart.bind(this);
    this.boundOnDragMove = this.onDragMove.bind(this);
    this.boundOnDragEnd = this.onDragEnd.bind(this);
  }

  static async create(container: HTMLElement): Promise<CanvasController> {
    debug("creating canvas");

    const app = new Application();

    await app.init({
      resizeTo: container,
      background: "white",
      antialias: true,
    });

    container.appendChild(app.canvas);
    debug("canvas appended, size: %dx%d", app.screen.width, app.screen.height);

    const controller = new CanvasController(app);
    controller.setupPanZoom(container);
    controller.drawGrid(8, 8);
    controller.setInitialView();

    debug("canvas initialized");
    return controller;
  }

  private setupPanZoom(container: HTMLElement): void {
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;

    this.app.stage.on("pointerdown", this.boundOnDragStart);
    this.app.stage.on("pointermove", this.boundOnDragMove);
    this.app.stage.on("pointerup", this.boundOnDragEnd);
    this.app.stage.on("pointerupoutside", this.boundOnDragEnd);

    this.app.canvas.addEventListener("wheel", this.boundOnWheel, {
      passive: false,
    });

    window.addEventListener("keydown", this.boundOnKeyDown);
    window.addEventListener("keyup", this.boundOnKeyUp);

    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => this.onResize());
    });
    this.resizeObserver.observe(container);

    this.lastScreenSize = {
      width: this.app.screen.width,
      height: this.app.screen.height,
    };
  }

  private onResize(): void {
    const newWidth = this.app.screen.width;
    const newHeight = this.app.screen.height;
    debug(
      "resize: %dx%d -> %dx%d",
      this.lastScreenSize.width,
      this.lastScreenSize.height,
      newWidth,
      newHeight
    );

    if (!this.hasMovedView) {
      debug("resize: resetting to initial view");
      this.drawGrid(this.currentGridInfo.cols, this.currentGridInfo.rows);
      this.setInitialView();
    } else {
      const oldCenterX = this.lastScreenSize.width / 2;
      const oldCenterY = this.lastScreenSize.height / 2;

      const worldCenterX =
        (oldCenterX - this.sceneContainer.x) / this.sceneContainer.scale.x;
      const worldCenterY =
        (oldCenterY - this.sceneContainer.y) / this.sceneContainer.scale.y;

      const newCenterX = newWidth / 2;
      const newCenterY = newHeight / 2;

      this.sceneContainer.x =
        newCenterX - worldCenterX * this.sceneContainer.scale.x;
      this.sceneContainer.y =
        newCenterY - worldCenterY * this.sceneContainer.scale.y;
    }

    this.lastScreenSize = { width: newWidth, height: newHeight };
    this.app.stage.hitArea = this.app.screen;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Shift" && !this.isShiftHeld) {
      this.isShiftHeld = true;
      this.updateCursor();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.key === "Shift") {
      this.isShiftHeld = false;
      this.isDragging = false;
      this.updateCursor();
    }
  }

  private updateCursor(): void {
    if (this.isShiftHeld) {
      this.app.canvas.style.cursor = this.isDragging ? "grabbing" : "grab";
    } else {
      this.app.canvas.style.cursor = "default";
    }
  }

  private onDragStart(event: FederatedPointerEvent): void {
    if (!this.isShiftHeld) return;
    this.isDragging = true;
    this.lastPointerPosition = { x: event.global.x, y: event.global.y };
    this.updateCursor();
  }

  private onDragMove(event: FederatedPointerEvent): void {
    if (!this.isDragging) return;

    const dx = event.global.x - this.lastPointerPosition.x;
    const dy = event.global.y - this.lastPointerPosition.y;

    this.sceneContainer.x += dx;
    this.sceneContainer.y += dy;

    this.lastPointerPosition = { x: event.global.x, y: event.global.y };
    this.hasMovedView = true;
  }

  private onDragEnd(): void {
    this.isDragging = false;
    this.updateCursor();
  }

  private onWheel(event: WheelEvent): void {
    if (!this.isShiftHeld) return;
    event.preventDefault();

    const scaleAmount = 1.1;
    const direction = event.deltaY < 0 ? 1 : -1;
    const factor = direction > 0 ? scaleAmount : 1 / scaleAmount;

    const screenHeight = this.app.screen.height;
    const screenWidth = this.app.screen.width;

    const minScale =
      (screenHeight * MIN_GRID_HEIGHT_RATIO) / this.currentGridInfo.height;
    const maxScaleFromWidth =
      screenWidth / (this.currentGridInfo.cellSize * MIN_VISIBLE_CELLS);
    const maxScaleFromHeight =
      screenHeight / (this.currentGridInfo.cellSize * MIN_VISIBLE_CELLS);
    const maxScale = Math.min(maxScaleFromWidth, maxScaleFromHeight);

    let newScale = this.sceneContainer.scale.x * factor;
    newScale = Math.max(minScale, Math.min(maxScale, newScale));

    if (newScale === this.sceneContainer.scale.x) return;

    const pointerX = event.offsetX;
    const pointerY = event.offsetY;

    const worldPos = {
      x: (pointerX - this.sceneContainer.x) / this.sceneContainer.scale.x,
      y: (pointerY - this.sceneContainer.y) / this.sceneContainer.scale.y,
    };

    this.sceneContainer.scale.x = newScale;
    this.sceneContainer.scale.y = newScale;

    this.sceneContainer.x = pointerX - worldPos.x * this.sceneContainer.scale.x;
    this.sceneContainer.y = pointerY - worldPos.y * this.sceneContainer.scale.y;

    debug("zoom: scale=%.3f", newScale);
    this.hasMovedView = true;
  }

  drawGrid(cols: number, rows: number): void {
    debug("drawGrid: %dx%d", cols, rows);

    if (this.gridGraphics) {
      this.gridGraphics.destroy();
    }

    this.gridGraphics = new Graphics();
    this.sceneContainer.addChild(this.gridGraphics);

    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;

    const cellSize = Math.min(screenWidth / cols, screenHeight / rows);
    const gridWidth = cellSize * cols;
    const gridHeight = cellSize * rows;

    this.currentGridInfo = {
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
      this.gridGraphics.moveTo(x, offsetY);
      this.gridGraphics.lineTo(x, offsetY + gridHeight);
    }

    for (let j = 0; j <= rows; j++) {
      const y = offsetY + j * cellSize;
      this.gridGraphics.moveTo(offsetX, y);
      this.gridGraphics.lineTo(offsetX + gridWidth, y);
    }

    this.gridGraphics.stroke({ width: 2, color: 0x000000, alpha: 0.15 });
  }

  private setInitialView(): void {
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;

    const paddingCells = 1;
    const paddedWidth =
      this.currentGridInfo.width +
      2 * paddingCells * this.currentGridInfo.cellSize;
    const paddedHeight =
      this.currentGridInfo.height +
      2 * paddingCells * this.currentGridInfo.cellSize;

    const scaleFromWidth = screenWidth / paddedWidth;
    const scaleFromHeight = screenHeight / paddedHeight;
    const scale = Math.min(scaleFromWidth, scaleFromHeight);

    this.sceneContainer.scale.set(scale);

    const scaledWidth = screenWidth * scale;
    const scaledHeight = screenHeight * scale;

    this.sceneContainer.x = (screenWidth - scaledWidth) / 2;
    this.sceneContainer.y = (screenHeight - scaledHeight) / 2;
  }

  destroy(): void {
    debug("destroying canvas");

    this.app.canvas.removeEventListener("wheel", this.boundOnWheel);
    window.removeEventListener("keydown", this.boundOnKeyDown);
    window.removeEventListener("keyup", this.boundOnKeyUp);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.app.destroy(true, { children: true });

    debug("canvas destroyed");
  }

  getApp(): Application {
    return this.app;
  }

  hasViewMoved(): boolean {
    return this.hasMovedView;
  }

  resetView(): void {
    this.drawGrid(this.currentGridInfo.cols, this.currentGridInfo.rows);
    this.setInitialView();
    this.hasMovedView = false;
  }
}
