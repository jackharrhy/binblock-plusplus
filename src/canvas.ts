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
import { useGridStore } from "./store/gridStore";
import { useAppStore } from "./store/appStore";

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
  private isDrawingShape = false;
  private lastPointerPosition = { x: 0, y: 0 };
  private shapeStartCell: { x: number; y: number } | null = null;
  private previewGraphics: Graphics | null = null;

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
    const tool = useAppStore.getState().currentTool;
    debug(
      "onDragStart: shift=%s, button=%d, tool=%s, selectedBlock=%s, pos=(%d,%d)",
      this.isShiftHeld,
      event.button,
      tool,
      this.selectedBlockId,
      event.global.x,
      event.global.y
    );

    if (event.button === 1) {
      this.pickBlockAtPosition(event.global.x, event.global.y);
      return;
    }

    if (event.button === 2) {
      // Push history before erasing
      useGridStore.getState().pushHistory();
      this.isErasing = true;
      this.eraseAtPosition(event.global.x, event.global.y);
      return;
    }

    if (this.isShiftHeld) {
      this.isDragging = true;
      this.lastPointerPosition = { x: event.global.x, y: event.global.y };
      this.stopAnimation();
      this.updateCursor();
    } else if (this.selectedBlockId) {
      const gridPos = this.screenToGrid(event.global.x, event.global.y);

      // Push history before any drawing operation
      useGridStore.getState().pushHistory();

      if (tool === "pencil") {
        this.isPainting = true;
        this.paintAtPosition(event.global.x, event.global.y);
      } else if (tool === "fill") {
        if (gridPos) {
          this.floodFill(gridPos.x, gridPos.y, this.selectedBlockId);
        }
      } else {
        // Shape tools: line, rect, circle
        if (gridPos) {
          this.isDrawingShape = true;
          this.shapeStartCell = gridPos;
          this.createPreviewGraphics();
        }
      }
    }
  }

  private onDragMove(event: FederatedPointerEvent): void {
    if (this.isDragging) {
      const dx = event.global.x - this.lastPointerPosition.x;
      const dy = event.global.y - this.lastPointerPosition.y;

      this.sceneContainer.x += dx;
      this.sceneContainer.y += dy;

      this.targetX = this.sceneContainer.x;
      this.targetY = this.sceneContainer.y;

      this.lastPointerPosition = { x: event.global.x, y: event.global.y };
      this.hasMovedView = true;
    } else if (this.isErasing) {
      this.eraseAtPosition(event.global.x, event.global.y);
    } else if (this.isPainting && this.selectedBlockId) {
      this.paintAtPosition(event.global.x, event.global.y);
    } else if (this.isDrawingShape && this.shapeStartCell) {
      const gridPos = this.screenToGrid(event.global.x, event.global.y);
      if (gridPos) {
        this.updateShapePreview(this.shapeStartCell, gridPos);
      }
    }
  }

  private onDragEnd(): void {
    if (this.isDrawingShape && this.shapeStartCell && this.selectedBlockId) {
      // Finalize the shape by getting the last preview position
      this.finalizeShape();
    }

    this.isDragging = false;
    this.isPainting = false;
    this.isErasing = false;
    this.isDrawingShape = false;
    this.shapeStartCell = null;
    this.clearPreviewGraphics();
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

  // ===== Shape Tool Helpers =====

  private lastPreviewEnd: { x: number; y: number } | null = null;

  private createPreviewGraphics(): void {
    this.clearPreviewGraphics();
    this.previewGraphics = new Graphics();
    this.sceneContainer.addChild(this.previewGraphics);
  }

  private clearPreviewGraphics(): void {
    if (this.previewGraphics) {
      this.previewGraphics.destroy();
      this.previewGraphics = null;
    }
    this.lastPreviewEnd = null;
  }

  private updateShapePreview(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): void {
    if (!this.previewGraphics) return;
    this.lastPreviewEnd = end;

    this.previewGraphics.clear();
    const cells = this.getShapeCells(start, end);
    const { offsetX, offsetY, cellSize } = this.currentGridInfo;

    for (const cell of cells) {
      this.previewGraphics.rect(
        offsetX + cell.x * cellSize + 2,
        offsetY + cell.y * cellSize + 2,
        cellSize - 4,
        cellSize - 4
      );
    }
    this.previewGraphics.fill({ color: 0x000000, alpha: 0.2 });
  }

  private finalizeShape(): void {
    if (!this.shapeStartCell || !this.lastPreviewEnd || !this.selectedBlockId)
      return;

    const cells = this.getShapeCells(this.shapeStartCell, this.lastPreviewEnd);
    for (const cell of cells) {
      this.fillCell(cell.x, cell.y, this.selectedBlockId);
    }
  }

  private getShapeCells(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): { x: number; y: number }[] {
    const tool = useAppStore.getState().currentTool;

    switch (tool) {
      case "line":
        return this.getLineCells(start.x, start.y, end.x, end.y);
      case "rect":
        return this.getRectCells(start.x, start.y, end.x, end.y, false);
      case "rect-filled":
        return this.getRectCells(start.x, start.y, end.x, end.y, true);
      case "circle":
        return this.getCircleCells(start.x, start.y, end.x, end.y, false);
      case "circle-filled":
        return this.getCircleCells(start.x, start.y, end.x, end.y, true);
      default:
        return [];
    }
  }

  private getLineCells(
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): { x: number; y: number }[] {
    // Bresenham's line algorithm
    const cells: { x: number; y: number }[] = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;

    while (true) {
      if (this.isInGrid(x, y)) {
        cells.push({ x, y });
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return cells;
  }

  private getRectCells(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    filled: boolean
  ): { x: number; y: number }[] {
    const cells: { x: number; y: number }[] = [];
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!this.isInGrid(x, y)) continue;
        if (filled || x === minX || x === maxX || y === minY || y === maxY) {
          cells.push({ x, y });
        }
      }
    }
    return cells;
  }

  private getCircleCells(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    filled: boolean
  ): { x: number; y: number }[] {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    const width = maxX - minX;
    const height = maxY - minY;

    const cx = minX + width / 2;
    const cy = minY + height / 2;

    const a = Math.floor(width / 2);
    const b = Math.floor(height / 2);

    if (a === 0 && b === 0) {
      const cellX = Math.round(cx);
      const cellY = Math.round(cy);
      return this.isInGrid(cellX, cellY) ? [{ x: cellX, y: cellY }] : [];
    }

    const cells: { x: number; y: number }[] = [];
    const seen = new Set<string>();

    const addCell = (x: number, y: number) => {
      const key = `${x},${y}`;
      if (!seen.has(key) && this.isInGrid(x, y)) {
        seen.add(key);
        cells.push({ x, y });
      }
    };

    const plotEllipsePoints = (
      xcenter: number,
      ycenter: number,
      x: number,
      y: number
    ) => {
      if (filled) {
        for (
          let px = Math.round(xcenter - x);
          px <= Math.round(xcenter + x);
          px++
        ) {
          addCell(px, Math.round(ycenter + y));
          addCell(px, Math.round(ycenter - y));
        }
      } else {
        addCell(Math.round(xcenter + x), Math.round(ycenter + y));
        addCell(Math.round(xcenter - x), Math.round(ycenter + y));
        addCell(Math.round(xcenter + x), Math.round(ycenter - y));
        addCell(Math.round(xcenter - x), Math.round(ycenter - y));
      }
    };

    const a2 = a * a;
    const b2 = b * b;
    const twoA2 = 2 * a2;
    const twoB2 = 2 * b2;

    let x = 0;
    let y = b;
    let px = 0;
    let py = twoA2 * y;

    let p1 = b2 - a2 * b + 0.25 * a2;
    while (px < py) {
      plotEllipsePoints(cx, cy, x, y);
      x++;
      px += twoB2;
      if (p1 < 0) {
        p1 += b2 + px;
      } else {
        y--;
        py -= twoA2;
        p1 += b2 + px - py;
      }
    }

    let p2 = b2 * (x + 0.5) * (x + 0.5) + a2 * (y - 1) * (y - 1) - a2 * b2;
    while (y >= 0) {
      plotEllipsePoints(cx, cy, x, y);
      y--;
      py -= twoA2;
      if (p2 > 0) {
        p2 += a2 - py;
      } else {
        x++;
        px += twoB2;
        p2 += a2 - py + px;
      }
    }

    return cells;
  }

  private floodFill(startX: number, startY: number, fillBlockId: string): void {
    const targetBlockId = this.gridData.get(`${startX},${startY}`) ?? "00";

    if (targetBlockId === fillBlockId) return;

    const stack: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key) || !this.isInGrid(x, y)) continue;
      visited.add(key);

      const currentBlockId = this.gridData.get(key) ?? "00";
      if (currentBlockId !== targetBlockId) continue;

      this.fillCell(x, y, fillBlockId);

      stack.push({ x: x + 1, y });
      stack.push({ x: x - 1, y });
      stack.push({ x, y: y + 1 });
      stack.push({ x, y: y - 1 });
    }
  }

  private isInGrid(x: number, y: number): boolean {
    return (
      x >= 0 &&
      x < this.currentGridInfo.cols &&
      y >= 0 &&
      y < this.currentGridInfo.rows
    );
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

    useGridStore.getState().setCell(x, y, blockId);

    debug("filled cell %s with block %s", key, blockId);
  }

  clearCell(x: number, y: number): void {
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

    const dimensionsChanged =
      cols !== this.currentGridInfo.cols || rows !== this.currentGridInfo.rows;

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

    if (dimensionsChanged) {
      useGridStore.getState().clearGrid(cols, rows);
    }

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
    } else {
      useGridStore.getState().clearGrid(state.cols, state.rows);
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

  resizeGrid(newCols: number, newRows: number): void {
    const oldCols = this.currentGridInfo.cols;
    const oldRows = this.currentGridInfo.rows;

    debug("resizeGrid: %dx%d -> %dx%d", oldCols, oldRows, newCols, newRows);

    const savedCells = new Map(this.gridData);

    const colsToRemove = Math.max(0, oldCols - newCols);
    const rowsToRemove = Math.max(0, oldRows - newRows);

    let offsetX = 0;
    let offsetY = 0;

    if (rowsToRemove > 0) {
      let emptyTopRows = 0;
      for (let y = 0; y < oldRows && emptyTopRows < rowsToRemove; y++) {
        let rowEmpty = true;
        for (let x = 0; x < oldCols; x++) {
          const blockId = savedCells.get(`${x},${y}`);
          if (blockId && blockId !== "00") {
            rowEmpty = false;
            break;
          }
        }
        if (rowEmpty) {
          emptyTopRows++;
        } else {
          break;
        }
      }
      offsetY = Math.min(emptyTopRows, rowsToRemove);
    }

    if (colsToRemove > 0) {
      let emptyLeftCols = 0;
      for (let x = 0; x < oldCols && emptyLeftCols < colsToRemove; x++) {
        let colEmpty = true;
        for (let y = 0; y < oldRows; y++) {
          const blockId = savedCells.get(`${x},${y}`);
          if (blockId && blockId !== "00") {
            colEmpty = false;
            break;
          }
        }
        if (colEmpty) {
          emptyLeftCols++;
        } else {
          break;
        }
      }
      offsetX = Math.min(emptyLeftCols, colsToRemove);
    }

    debug("resizeGrid: sliding by offset (%d, %d)", offsetX, offsetY);

    for (const sprite of this.cellSprites.values()) {
      sprite.destroy();
    }
    this.cellSprites.clear();
    this.gridData.clear();

    this.drawGrid(newCols, newRows);
    this.setInitialView();
    this.hasMovedView = false;

    for (const [key, blockId] of savedCells) {
      const [xStr, yStr] = key.split(",");
      const oldX = parseInt(xStr, 10);
      const oldY = parseInt(yStr, 10);

      const newX = oldX - offsetX;
      const newY = oldY - offsetY;

      if (newX >= 0 && newX < newCols && newY >= 0 && newY < newRows) {
        this.fillCell(newX, newY, blockId);
      }
    }

    debug("resizeGrid complete, preserved %d cells", this.gridData.size);
  }

  clearAllCells(): void {
    debug("clearAllCells");

    for (const sprite of this.cellSprites.values()) {
      sprite.destroy();
    }
    this.cellSprites.clear();
    this.gridData.clear();

    useGridStore
      .getState()
      .clearGrid(this.currentGridInfo.cols, this.currentGridInfo.rows);

    debug("cleared all cells");
  }

  syncFromStore(): void {
    debug("syncFromStore");

    const { cells } = useGridStore.getState();

    for (const sprite of this.cellSprites.values()) {
      sprite.destroy();
    }
    this.cellSprites.clear();
    this.gridData.clear();

    for (const [key, blockId] of Object.entries(cells)) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);

      const texture = this.blockTextures.get(blockId);
      if (!texture) continue;

      const sprite = new Sprite(texture);
      const { offsetX, offsetY, cellSize } = this.currentGridInfo;

      sprite.x = offsetX + x * cellSize;
      sprite.y = offsetY + y * cellSize;
      sprite.width = cellSize;
      sprite.height = cellSize;

      this.blocksContainer.addChild(sprite);
      this.cellSprites.set(key, sprite);
      this.gridData.set(key, blockId);
    }

    debug("syncFromStore complete, %d cells", this.cellSprites.size);
  }
}
