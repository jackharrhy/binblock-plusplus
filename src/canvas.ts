import {
  Application,
  Container,
  Graphics,
  FederatedPointerEvent,
  Sprite,
  Texture,
} from "pixi.js";
import createDebug from "debug";
import { blocks, type GridState } from "./blocks";

const debug = createDebug("binblock:canvas");

const MIN_GRID_HEIGHT_RATIO = 0.45;
const MIN_VISIBLE_CELLS = 4;

export class CanvasController {
  private app: Application;
  private sceneContainer: Container;
  private gridGraphics: Graphics | null = null;
  private blocksContainer: Container;

  private isDragging = false;
  private isShiftHeld = false;
  private isPainting = false;
  private isErasing = false;
  private lastPointerPosition = { x: 0, y: 0 };

  private onBlockPicked: ((blockId: string) => void) | null = null;

  private currentGridInfo = {
    width: 0,
    height: 0,
    cellSize: 0,
    cols: 0,
    rows: 0,
    offsetX: 0,
    offsetY: 0,
  };
  private lastScreenSize = { width: 0, height: 0 };
  private hasMovedView = false;
  private resizeObserver: ResizeObserver | null = null;

  private blockTextures: Map<string, Texture> = new Map();
  private gridData: Map<string, string> = new Map();
  private cellSprites: Map<string, Sprite> = new Map();
  private selectedBlockId: string | null = null;

  private targetScale = 1;
  private targetX = 0;
  private targetY = 0;
  private isAnimating = false;
  private readonly ZOOM_LERP_FACTOR = 0.15;

  private boundOnWheel: (e: WheelEvent) => void;
  private boundOnKeyDown: (e: KeyboardEvent) => void;
  private boundOnKeyUp: (e: KeyboardEvent) => void;
  private boundOnDragStart: (e: FederatedPointerEvent) => void;
  private boundOnDragMove: (e: FederatedPointerEvent) => void;
  private boundOnDragEnd: () => void;
  private boundOnContextMenu: (e: Event) => void;

  private constructor(app: Application) {
    this.app = app;
    this.sceneContainer = new Container();
    this.blocksContainer = new Container();
    this.app.stage.addChild(this.sceneContainer);
    this.sceneContainer.addChild(this.blocksContainer);

    this.boundOnWheel = this.onWheel.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);
    this.boundOnDragStart = this.onDragStart.bind(this);
    this.boundOnDragMove = this.onDragMove.bind(this);
    this.boundOnDragEnd = this.onDragEnd.bind(this);
    this.boundOnContextMenu = (e: Event) => e.preventDefault();
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
    await controller.loadBlocks();
    controller.setupPanZoom(container);
    controller.drawGrid(8, 8);
    controller.setInitialView();

    debug("canvas initialized");
    return controller;
  }

  private async loadBlocks(): Promise<void> {
    debug("loading %d block textures", blocks.length);

    const loadPromises = blocks.map(async (block) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () =>
          reject(new Error(`Failed to load image: ${block.url}`));
        img.src = block.url;
      });

      const texture = Texture.from(img);
      this.blockTextures.set(block.id, texture);
    });

    await Promise.all(loadPromises);
    debug("loaded %d block textures", this.blockTextures.size);
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
    this.app.canvas.addEventListener("contextmenu", this.boundOnContextMenu);

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

    this.stopAnimation();

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

      this.targetScale = this.sceneContainer.scale.x;
      this.targetX = this.sceneContainer.x;
      this.targetY = this.sceneContainer.y;
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
    let cursor: string;
    if (this.isShiftHeld) {
      cursor = this.isDragging ? "grabbing" : "grab";
    } else if (this.selectedBlockId) {
      cursor = "crosshair";
    } else {
      cursor = "default";
    }
    debug(
      "updateCursor: %s (shift=%s, selected=%s)",
      cursor,
      this.isShiftHeld,
      this.selectedBlockId
    );
    this.app.canvas.style.cursor = cursor;
  }

  private onDragStart(event: FederatedPointerEvent): void {
    debug(
      "onDragStart: shift=%s, button=%d, selectedBlock=%s, pos=(%d,%d)",
      this.isShiftHeld,
      event.button,
      this.selectedBlockId,
      event.global.x,
      event.global.y
    );

    // Middle-click: pick block from cell
    if (event.button === 1) {
      this.pickBlockAtPosition(event.global.x, event.global.y);
      return;
    }

    // Right-click: erase (set to 00)
    if (event.button === 2) {
      this.isErasing = true;
      this.eraseAtPosition(event.global.x, event.global.y);
      return;
    }

    // Left-click
    if (this.isShiftHeld) {
      this.isDragging = true;
      this.lastPointerPosition = { x: event.global.x, y: event.global.y };
      this.stopAnimation();
      this.updateCursor();
    } else if (this.selectedBlockId) {
      this.isPainting = true;
      this.paintAtPosition(event.global.x, event.global.y);
    }
  }

  private onDragMove(event: FederatedPointerEvent): void {
    if (this.isDragging) {
      const dx = event.global.x - this.lastPointerPosition.x;
      const dy = event.global.y - this.lastPointerPosition.y;

      this.sceneContainer.x += dx;
      this.sceneContainer.y += dy;

      // Keep targets in sync so any future animation starts from current position
      this.targetX = this.sceneContainer.x;
      this.targetY = this.sceneContainer.y;

      this.lastPointerPosition = { x: event.global.x, y: event.global.y };
      this.hasMovedView = true;
    } else if (this.isErasing) {
      this.eraseAtPosition(event.global.x, event.global.y);
    } else if (this.isPainting && this.selectedBlockId) {
      this.paintAtPosition(event.global.x, event.global.y);
    }
  }

  private onDragEnd(): void {
    this.isDragging = false;
    this.isPainting = false;
    this.isErasing = false;
    this.updateCursor();
  }

  private onWheel(event: WheelEvent): void {
    if (!this.isShiftHeld) return;
    event.preventDefault();

    const scaleAmount = 1.08;
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

    const baseScale = this.isAnimating
      ? this.targetScale
      : this.sceneContainer.scale.x;
    let newScale = baseScale * factor;
    newScale = Math.max(minScale, Math.min(maxScale, newScale));

    if (newScale === this.targetScale && this.isAnimating) return;

    const pointerX = event.offsetX;
    const pointerY = event.offsetY;

    const worldPos = {
      x: (pointerX - this.sceneContainer.x) / this.sceneContainer.scale.x,
      y: (pointerY - this.sceneContainer.y) / this.sceneContainer.scale.y,
    };

    this.targetScale = newScale;
    this.targetX = pointerX - worldPos.x * newScale;
    this.targetY = pointerY - worldPos.y * newScale;

    if (!this.isAnimating) {
      this.isAnimating = true;
      this.app.ticker.add(this.animateZoom, this);
    }

    debug("zoom target: scale=%.3f", newScale);
    this.hasMovedView = true;
  }

  private stopAnimation(): void {
    if (this.isAnimating) {
      this.app.ticker.remove(this.animateZoom, this);
      this.isAnimating = false;
      // Sync targets to current position
      this.targetScale = this.sceneContainer.scale.x;
      this.targetX = this.sceneContainer.x;
      this.targetY = this.sceneContainer.y;
      debug("animation stopped");
    }
  }

  private animateZoom(): void {
    const currentScale = this.sceneContainer.scale.x;
    const currentX = this.sceneContainer.x;
    const currentY = this.sceneContainer.y;

    const newScale =
      currentScale + (this.targetScale - currentScale) * this.ZOOM_LERP_FACTOR;
    const newX = currentX + (this.targetX - currentX) * this.ZOOM_LERP_FACTOR;
    const newY = currentY + (this.targetY - currentY) * this.ZOOM_LERP_FACTOR;

    this.sceneContainer.scale.set(newScale);
    this.sceneContainer.x = newX;
    this.sceneContainer.y = newY;

    const scaleDiff = Math.abs(this.targetScale - newScale);
    const posDiff =
      Math.abs(this.targetX - newX) + Math.abs(this.targetY - newY);

    if (scaleDiff < 0.0001 && posDiff < 0.1) {
      this.sceneContainer.scale.set(this.targetScale);
      this.sceneContainer.x = this.targetX;
      this.sceneContainer.y = this.targetY;

      this.app.ticker.remove(this.animateZoom, this);
      this.isAnimating = false;
      debug("zoom animation complete");
    }
  }

  private screenToGrid(
    screenX: number,
    screenY: number
  ): { x: number; y: number } | null {
    const worldX =
      (screenX - this.sceneContainer.x) / this.sceneContainer.scale.x;
    const worldY =
      (screenY - this.sceneContainer.y) / this.sceneContainer.scale.y;

    const { offsetX, offsetY, cellSize, cols, rows } = this.currentGridInfo;

    const gridX = Math.floor((worldX - offsetX) / cellSize);
    const gridY = Math.floor((worldY - offsetY) / cellSize);

    debug(
      "screenToGrid: screen(%d,%d) -> world(%d,%d) -> grid(%d,%d) bounds(0-%d, 0-%d)",
      screenX,
      screenY,
      worldX,
      worldY,
      gridX,
      gridY,
      cols - 1,
      rows - 1
    );

    if (gridX < 0 || gridX >= cols || gridY < 0 || gridY >= rows) {
      return null;
    }

    return { x: gridX, y: gridY };
  }

  private paintAtPosition(screenX: number, screenY: number): void {
    if (!this.selectedBlockId) return;

    const gridPos = this.screenToGrid(screenX, screenY);
    if (!gridPos) return;

    this.fillCell(gridPos.x, gridPos.y, this.selectedBlockId);
  }

  private eraseAtPosition(screenX: number, screenY: number): void {
    const gridPos = this.screenToGrid(screenX, screenY);
    if (!gridPos) return;

    this.clearCell(gridPos.x, gridPos.y);
  }

  private pickBlockAtPosition(screenX: number, screenY: number): void {
    const gridPos = this.screenToGrid(screenX, screenY);
    if (!gridPos) return;

    const key = `${gridPos.x},${gridPos.y}`;
    const blockId = this.gridData.get(key) ?? "00";

    debug("picked block %s from cell %s", blockId, key);

    this.selectedBlockId = blockId;
    this.updateCursor();
    this.onBlockPicked?.(blockId);
  }

  fillCell(x: number, y: number, blockId: string): void {
    const key = `${x},${y}`;
    const texture = this.blockTextures.get(blockId);
    if (!texture) {
      debug("texture not found for block %s", blockId);
      return;
    }

    const existingSprite = this.cellSprites.get(key);
    if (existingSprite) {
      existingSprite.destroy();
    }

    const sprite = new Sprite(texture);
    const { offsetX, offsetY, cellSize } = this.currentGridInfo;

    sprite.x = offsetX + x * cellSize;
    sprite.y = offsetY + y * cellSize;
    sprite.width = cellSize;
    sprite.height = cellSize;

    this.blocksContainer.addChild(sprite);
    this.cellSprites.set(key, sprite);
    this.gridData.set(key, blockId);

    debug("filled cell %s with block %s", key, blockId);
  }

  clearCell(x: number, y: number): void {
    // Clearing a cell means setting it to the transparent "00" block
    this.fillCell(x, y, "00");
    debug("cleared cell %d,%d to 00", x, y);
  }

  setSelectedBlock(blockId: string | null): void {
    this.selectedBlockId = blockId;
    this.updateCursor();
    debug("selected block: %s", blockId);
  }

  getSelectedBlock(): string | null {
    return this.selectedBlockId;
  }

  setOnBlockPicked(callback: ((blockId: string) => void) | null): void {
    this.onBlockPicked = callback;
  }

  drawGrid(cols: number, rows: number): void {
    debug("drawGrid: %dx%d", cols, rows);

    if (this.gridGraphics) {
      this.gridGraphics.destroy();
    }

    this.gridGraphics = new Graphics();
    this.sceneContainer.addChildAt(this.gridGraphics, 0);

    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;

    const cellSize = Math.min(screenWidth / cols, screenHeight / rows);
    const gridWidth = cellSize * cols;
    const gridHeight = cellSize * rows;

    const offsetX = (screenWidth - gridWidth) / 2;
    const offsetY = (screenHeight - gridHeight) / 2;

    this.currentGridInfo = {
      width: gridWidth,
      height: gridHeight,
      cellSize,
      cols,
      rows,
      offsetX,
      offsetY,
    };

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

    this.repositionSprites();
  }

  private repositionSprites(): void {
    const { offsetX, offsetY, cellSize } = this.currentGridInfo;

    for (const [key, sprite] of this.cellSprites) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);

      sprite.x = offsetX + x * cellSize;
      sprite.y = offsetY + y * cellSize;
      sprite.width = cellSize;
      sprite.height = cellSize;
    }
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

    this.targetScale = scale;
    this.targetX = this.sceneContainer.x;
    this.targetY = this.sceneContainer.y;
  }

  exportGrid(): GridState {
    const cells: Record<string, string | null> = {};

    for (const [key, blockId] of this.gridData) {
      cells[key] = blockId;
    }

    return {
      cols: this.currentGridInfo.cols,
      rows: this.currentGridInfo.rows,
      cells,
    };
  }

  importGrid(state: GridState): void {
    for (const sprite of this.cellSprites.values()) {
      sprite.destroy();
    }
    this.cellSprites.clear();
    this.gridData.clear();

    if (
      state.cols !== this.currentGridInfo.cols ||
      state.rows !== this.currentGridInfo.rows
    ) {
      this.drawGrid(state.cols, state.rows);
      this.setInitialView();
    }

    for (const [key, blockId] of Object.entries(state.cells)) {
      if (blockId) {
        const [xStr, yStr] = key.split(",");
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);
        this.fillCell(x, y, blockId);
      }
    }

    debug(
      "imported grid: %dx%d with %d cells",
      state.cols,
      state.rows,
      Object.keys(state.cells).length
    );
  }

  destroy(): void {
    debug("destroying canvas");

    this.stopAnimation();

    this.app.canvas.removeEventListener("wheel", this.boundOnWheel);
    this.app.canvas.removeEventListener("contextmenu", this.boundOnContextMenu);
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
