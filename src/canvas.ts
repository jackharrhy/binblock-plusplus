import {
  Application,
  Container,
  Graphics,
  FederatedPointerEvent,
  Sprite,
  Texture,
} from "pixi.js";
import createDebug from "debug";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { blocks, DEFAULT_BLOCK_ID, type GridState } from "./blocks";
import { useGridStore } from "./store/gridStore";
import { useAppStore } from "./store/appStore";
const cursorModules = import.meta.glob<{ default: string }>(
  "./icons/cursors/*.png",
  { eager: true }
);
const cursorGrab = cursorModules["./icons/cursors/grab.png"].default;
const cursorPoint = cursorModules["./icons/cursors/point.png"].default;

const debug = createDebug("binblock:canvas");

const MIN_GRID_HEIGHT_RATIO = 0.45;
const MIN_VISIBLE_CELLS = 4;
const GRID_STROKE_WIDTH = 1.5;
const MIN_STROKE_WIDTH = 0.5;
const MAX_STROKE_WIDTH = 2;
const GRID_ALPHA = 0.15;
const IS_WEBKIT =
  /AppleWebKit/i.test(navigator.userAgent) &&
  !/Chrome|Chromium/i.test(navigator.userAgent);

export class CanvasController {
  private app: Application;
  private sceneContainer: Container;
  private gridGraphics: Graphics | null = null;
  private blocksContainer: Container;

  private isDragging = false;
  private isSpaceHeld = false;
  private isPainting = false;
  private isErasing = false;
  private isDrawingShape = false;
  private lastPointerPosition = { x: 0, y: 0 };
  private shapeStartCell: { x: number; y: number } | null = null;
  private previewContainer: Container | null = null;

  private fakeCursor: Sprite | null = null;
  private fakeCursorType: "grab" | "grabbing" | null = null;

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
  private cursorTextures: Map<string, Texture> = new Map();
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

    const cursors = [
      { id: "grab", url: cursorGrab },
      { id: "point", url: cursorPoint },
    ];

    const cursorPromises = cursors.map(async (cursor) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () =>
          reject(new Error(`Failed to load cursor: ${cursor.url}`));
        img.src = cursor.url;
      });

      const texture = Texture.from(img);
      this.cursorTextures.set(cursor.id, texture);
    });

    await Promise.all(cursorPromises);
    debug("loaded %d cursor textures", this.cursorTextures.size);
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
    if (event.key === " ") {
      event.preventDefault();
      if (!this.isSpaceHeld) {
        this.isSpaceHeld = true;
        this.updateCursor();
      }
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.key === " ") {
      this.isSpaceHeld = false;
      this.isDragging = false;
      this.updateCursor();
    }
  }

  private updateCursor(): void {
    let cursor: string;
    if (this.isSpaceHeld) {
      cursor = this.isDragging ? "grabbing" : "grab";
    } else if (this.selectedBlockId) {
      cursor = "crosshair";
    } else {
      cursor = "default";
    }
    debug(
      "updateCursor: %s (space=%s, selected=%s)",
      cursor,
      this.isSpaceHeld,
      this.selectedBlockId
    );

    if (IS_WEBKIT && (cursor === "grab" || cursor === "grabbing")) {
      this.app.canvas.style.cursor = "none";
      this.showFakeCursor(cursor);
    } else {
      const wasShowingFakeCursor = this.fakeCursor !== null;
      this.hideFakeCursor();
      this.app.canvas.style.cursor = cursor;

      if (wasShowingFakeCursor && IS_WEBKIT) {
        const evt = new MouseEvent("mousemove", {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: this.lastPointerPosition.x,
          clientY: this.lastPointerPosition.y,
        });
        this.app.canvas.dispatchEvent(evt);
      }
    }
  }

  private showFakeCursor(type: "grab" | "grabbing"): void {
    if (this.fakeCursorType === type && this.fakeCursor) {
      return;
    }

    this.hideFakeCursor();

    const textureId = type === "grabbing" ? "grab" : "point";
    const texture = this.cursorTextures.get(textureId);
    if (!texture) return;

    const sprite = new Sprite(texture);

    sprite.anchor.set(0, 0);
    sprite.scale.set(0.3);
    sprite.x = this.lastPointerPosition.x;
    sprite.y = this.lastPointerPosition.y;

    this.fakeCursor = sprite;
    this.fakeCursorType = type;
    this.app.stage.addChild(sprite);
  }

  private hideFakeCursor(): void {
    if (this.fakeCursor) {
      this.fakeCursor.destroy();
      this.fakeCursor = null;
      this.fakeCursorType = null;
    }
  }

  private updateFakeCursorPosition(x: number, y: number): void {
    if (this.fakeCursor) {
      this.fakeCursor.x = x;
      this.fakeCursor.y = y;
    }
  }

  private onDragStart(event: FederatedPointerEvent): void {
    const tool = useAppStore.getState().currentTool;
    debug(
      "onDragStart: shift=%s, button=%d, tool=%s, selectedBlock=%s, pos=(%d,%d)",
      this.isSpaceHeld,
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
      useGridStore.getState().pushHistory();
      this.isErasing = true;
      this.eraseAtPosition(event.global.x, event.global.y);
      return;
    }

    if (this.isSpaceHeld) {
      this.isDragging = true;
      this.lastPointerPosition = { x: event.global.x, y: event.global.y };
      this.stopAnimation();
      this.updateCursor();
    } else if (this.selectedBlockId) {
      const gridPos = this.screenToGrid(event.global.x, event.global.y);

      useGridStore.getState().pushHistory();

      if (tool === "pencil") {
        this.isPainting = true;
        this.paintAtPosition(event.global.x, event.global.y);
      } else if (tool === "fill") {
        if (gridPos) {
          this.floodFill(gridPos.x, gridPos.y, this.selectedBlockId);
        }
      } else {
        if (gridPos) {
          this.isDrawingShape = true;
          this.shapeStartCell = gridPos;
          this.createPreviewContainer();
        }
      }
    }
  }

  private onDragMove(event: FederatedPointerEvent): void {
    const mouseX = event.global.x;
    const mouseY = event.global.y;

    if (this.isDragging) {
      const dx = mouseX - this.lastPointerPosition.x;
      const dy = mouseY - this.lastPointerPosition.y;

      this.sceneContainer.x += dx;
      this.sceneContainer.y += dy;

      this.targetX = this.sceneContainer.x;
      this.targetY = this.sceneContainer.y;
      this.hasMovedView = true;
    } else if (this.isErasing) {
      this.eraseAtPosition(mouseX, mouseY);
    } else if (this.isPainting && this.selectedBlockId) {
      this.paintAtPosition(mouseX, mouseY);
    } else if (this.isDrawingShape && this.shapeStartCell) {
      const gridPos = this.screenToGrid(mouseX, mouseY);
      if (gridPos) {
        this.updateShapePreview(this.shapeStartCell, gridPos);
      }
    }

    this.lastPointerPosition = { x: mouseX, y: mouseY };
    this.updateFakeCursorPosition(mouseX, mouseY);
  }

  private onDragEnd(): void {
    if (this.isDrawingShape && this.shapeStartCell && this.selectedBlockId) {
      this.finalizeShape();
    }

    this.isDragging = false;
    this.isPainting = false;
    this.isErasing = false;
    this.isDrawingShape = false;
    this.shapeStartCell = null;
    this.clearPreviewContainer();
    this.updateCursor();
  }

  private onWheel(event: WheelEvent): void {
    if (!this.isSpaceHeld) return;
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

    this.updateGridStroke();

    const scaleDiff = Math.abs(this.targetScale - newScale);
    const posDiff =
      Math.abs(this.targetX - newX) + Math.abs(this.targetY - newY);

    if (scaleDiff < 0.0001 && posDiff < 0.1) {
      this.sceneContainer.scale.set(this.targetScale);
      this.sceneContainer.x = this.targetX;
      this.sceneContainer.y = this.targetY;

      this.updateGridStroke();
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
    const blockId = this.gridData.get(key) ?? DEFAULT_BLOCK_ID;

    debug("picked block %s from cell %s", blockId, key);

    this.selectedBlockId = blockId;
    this.updateCursor();
    this.onBlockPicked?.(blockId);
  }

  private lastPreviewEnd: { x: number; y: number } | null = null;

  private createPreviewContainer(): void {
    this.clearPreviewContainer();
    this.previewContainer = new Container();
    this.sceneContainer.addChild(this.previewContainer);
  }

  private clearPreviewContainer(): void {
    if (this.previewContainer) {
      this.previewContainer.destroy({ children: true });
      this.previewContainer = null;
    }
    this.lastPreviewEnd = null;
  }

  private updateShapePreview(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): void {
    if (!this.previewContainer || !this.selectedBlockId) return;
    this.lastPreviewEnd = end;

    this.previewContainer.removeChildren();

    const texture = this.blockTextures.get(this.selectedBlockId);
    if (!texture) return;

    const cells = this.getShapeCells(start, end);
    const { offsetX, offsetY, cellSize } = this.currentGridInfo;

    for (const cell of cells) {
      const sprite = new Sprite(texture);
      sprite.x = offsetX + cell.x * cellSize;
      sprite.y = offsetY + cell.y * cellSize;
      sprite.width = cellSize;
      sprite.height = cellSize;
      sprite.alpha = 0.5;
      this.previewContainer.addChild(sprite);
    }
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

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const a = (maxX - minX) / 2 + 0.5;
    const b = (maxY - minY) / 2 + 0.5;

    const cells: { x: number; y: number }[] = [];

    const isInside = (x: number, y: number): boolean => {
      const dx = x - cx;
      const dy = y - cy;
      return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1;
    };

    const isOnBoundary = (x: number, y: number): boolean => {
      if (!isInside(x, y)) return false;
      return (
        !isInside(x - 1, y) ||
        !isInside(x + 1, y) ||
        !isInside(x, y - 1) ||
        !isInside(x, y + 1)
      );
    };

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!this.isInGrid(x, y)) continue;

        if (filled) {
          if (isInside(x, y)) {
            cells.push({ x, y });
          }
        } else {
          if (isOnBoundary(x, y)) {
            cells.push({ x, y });
          }
        }
      }
    }

    return cells;
  }

  private floodFill(startX: number, startY: number, fillBlockId: string): void {
    const targetBlockId =
      this.gridData.get(`${startX},${startY}`) ?? DEFAULT_BLOCK_ID;

    if (targetBlockId === fillBlockId) return;

    const stack: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key) || !this.isInGrid(x, y)) continue;
      visited.add(key);

      const currentBlockId = this.gridData.get(key) ?? DEFAULT_BLOCK_ID;
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
    this.fillCell(x, y, DEFAULT_BLOCK_ID);
    debug("cleared cell %d,%d to %s", x, y, DEFAULT_BLOCK_ID);
  }

  private fillEmptyCells(): void {
    const { cols, rows, offsetX, offsetY, cellSize } = this.currentGridInfo;
    const texture = this.blockTextures.get(DEFAULT_BLOCK_ID);
    if (!texture) return;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const key = `${x},${y}`;
        if (this.cellSprites.has(key)) continue;

        const sprite = new Sprite(texture);
        sprite.x = offsetX + x * cellSize;
        sprite.y = offsetY + y * cellSize;
        sprite.width = cellSize;
        sprite.height = cellSize;

        this.blocksContainer.addChild(sprite);
        this.cellSprites.set(key, sprite);
        this.gridData.set(key, DEFAULT_BLOCK_ID);
      }
    }

    debug("filled empty cells with default block");
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

    this.updateGridStroke();
    this.repositionSprites();
    this.fillEmptyCells();
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

  private updateGridStroke(): void {
    if (!this.gridGraphics) return;

    const scale = this.sceneContainer.scale.x;
    const adjustedWidth = Math.min(
      MAX_STROKE_WIDTH,
      Math.max(MIN_STROKE_WIDTH, GRID_STROKE_WIDTH / scale)
    );

    this.gridGraphics.clear();

    const { offsetX, offsetY, cellSize, cols, rows } = this.currentGridInfo;
    const gridWidth = cellSize * cols;
    const gridHeight = cellSize * rows;

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

    this.gridGraphics.stroke({
      width: adjustedWidth,
      color: 0x000000,
      alpha: 1,
    });
    this.gridGraphics.alpha = GRID_ALPHA;
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

    this.updateGridStroke();
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

    this.fillEmptyCells();

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
    this.hideFakeCursor();

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

    if (newCols === oldCols && newRows === oldRows) return;

    useGridStore.getState().pushHistory();
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
          if (blockId && blockId !== DEFAULT_BLOCK_ID) {
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
          if (blockId && blockId !== DEFAULT_BLOCK_ID) {
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

    this.fillEmptyCells();
    debug("cleared all cells");
  }

  syncFromStore(): void {
    debug("syncFromStore");

    const { cols, rows, cells } = useGridStore.getState();

    const dimensionsChanged =
      cols !== this.currentGridInfo.cols || rows !== this.currentGridInfo.rows;

    if (dimensionsChanged) {
      this.drawGrid(cols, rows);
      this.setInitialView();
      this.hasMovedView = false;
    }

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

    this.fillEmptyCells();
    debug("syncFromStore complete, %d cells", this.cellSprites.size);
  }

  async exportAsPng(): Promise<void> {
    const EXPORT_CELL_SIZE = 100;
    const { cols, rows } = this.currentGridInfo;

    debug(
      "exportAsPng: %dx%d grid, %dpx per cell",
      cols,
      rows,
      EXPORT_CELL_SIZE
    );

    const canvas = document.createElement("canvas");
    canvas.width = cols * EXPORT_CELL_SIZE;
    canvas.height = rows * EXPORT_CELL_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create 2D context for export");
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const key = `${x},${y}`;
        const blockId = this.gridData.get(key) ?? DEFAULT_BLOCK_ID;
        const texture = this.blockTextures.get(blockId);

        if (texture && texture.source?.resource) {
          const resource = texture.source.resource;

          if (
            resource instanceof HTMLImageElement ||
            resource instanceof ImageBitmap
          ) {
            ctx.drawImage(
              resource,
              x * EXPORT_CELL_SIZE,
              y * EXPORT_CELL_SIZE,
              EXPORT_CELL_SIZE,
              EXPORT_CELL_SIZE
            );
          }
        }
      }
    }

    const dataUrl = canvas.toDataURL("image/png");
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const filePath = await save({
      defaultPath: `binblock-${cols}x${rows}.png`,
      filters: [
        {
          name: "PNG Image",
          extensions: ["png"],
        },
      ],
    });

    if (!filePath) {
      debug("exportAsPng: user cancelled save dialog");
      return;
    }

    await writeFile(filePath, bytes);
    debug("exportAsPng: saved to %s", filePath);
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
