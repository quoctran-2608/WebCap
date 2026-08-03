import type { Rect } from "@shared/contracts/domain";

import {
  CoordinateSpace,
  edgeAutoScrollDelta,
  moveRectWithinBounds,
  resizeRectFromHandle,
  type Point,
  type ResizeHandle,
} from "./coordinate-space";

export const REGION_SELECTOR_ROOT_ATTRIBUTE = "data-webcap-region-selector" as const;
export const REGION_SELECTOR_MINIMUM_SIZE_CSS = 2;

const HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Gesture =
  | { kind: "create"; pointerId: number; start: Point }
  | { kind: "move"; pointerId: number; start: Point; initial: Rect }
  | {
      kind: "resize";
      pointerId: number;
      handle: ResizeHandle;
      initial: Rect;
    };

export interface RegionSelectorController {
  readonly jobId: string;
  getRect(): Rect | undefined;
  dispose(): void;
}

export interface OpenRegionSelectorOptions {
  jobId: string;
  minimumSizeCss?: number;
  onCommit(rect: Rect): Promise<void> | void;
  onCancel(reason: string): Promise<void> | void;
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await waitForFrame();
  }
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function isResizeHandle(value: string | undefined): value is ResizeHandle {
  return value !== undefined && HANDLES.includes(value as ResizeHandle);
}

function elementFromPath(path: EventTarget[], predicate: (element: HTMLElement) => boolean) {
  return path.find(
    (candidate): candidate is HTMLElement =>
      candidate instanceof HTMLElement && predicate(candidate),
  );
}

function readViewport(): { width: number; height: number } {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

export function openRegionSelector(options: OpenRegionSelectorOptions): RegionSelectorController {
  const existing = document.querySelector<HTMLElement>(`[${REGION_SELECTOR_ROOT_ATTRIBUTE}]`);
  existing?.remove();

  const minimumSize = Math.max(
    REGION_SELECTOR_MINIMUM_SIZE_CSS,
    options.minimumSizeCss ?? REGION_SELECTOR_MINIMUM_SIZE_CSS,
  );
  const originalScroll = { x: window.scrollX, y: window.scrollY };
  const originalFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const root = document.createElement("div");
  root.setAttribute(REGION_SELECTOR_ROOT_ATTRIBUTE, options.jobId);
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.zIndex = "2147483647";
  root.style.pointerEvents = "auto";
  root.style.contain = "layout style paint";

  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .stage {
        position: fixed;
        inset: 0;
        cursor: crosshair;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f8fafc;
        outline: none;
        user-select: none;
        touch-action: none;
      }
      .toolbar {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: calc(100vw - 24px);
        padding: 10px 12px;
        border: 1px solid rgba(255,255,255,.22);
        border-radius: 12px;
        background: rgba(15, 23, 42, .94);
        box-shadow: 0 12px 36px rgba(0,0,0,.28);
        cursor: default;
        pointer-events: auto;
      }
      .instructions { margin: 0; font-size: 12px; line-height: 1.45; white-space: nowrap; }
      .actions { display: flex; gap: 6px; }
      button {
        border: 1px solid rgba(255,255,255,.25);
        border-radius: 8px;
        padding: 7px 10px;
        background: rgba(255,255,255,.08);
        color: inherit;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      button:hover { background: rgba(255,255,255,.16); }
      button:focus-visible { outline: 2px solid #fde68a; outline-offset: 2px; }
      button[data-confirm] { background: #16a34a; border-color: #22c55e; }
      button:disabled { opacity: .45; cursor: not-allowed; }
      .selection {
        position: fixed;
        display: none;
        border: 2px solid #facc15;
        border-radius: 2px;
        background: rgba(250, 204, 21, .08);
        box-shadow: 0 0 0 99999px rgba(2, 6, 23, .58);
        cursor: move;
        pointer-events: auto;
      }
      .dimensions {
        position: absolute;
        left: 0;
        bottom: calc(100% + 8px);
        min-width: max-content;
        padding: 5px 8px;
        border-radius: 7px;
        background: rgba(15, 23, 42, .96);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 5px 16px rgba(0,0,0,.24);
        pointer-events: none;
      }
      .handle {
        position: absolute;
        width: 12px;
        height: 12px;
        padding: 0;
        border: 2px solid #0f172a;
        border-radius: 50%;
        background: #facc15;
      }
      .handle[data-handle="nw"] { left: -7px; top: -7px; cursor: nwse-resize; }
      .handle[data-handle="n"] { left: 50%; top: -7px; transform: translateX(-50%); cursor: ns-resize; }
      .handle[data-handle="ne"] { right: -7px; top: -7px; cursor: nesw-resize; }
      .handle[data-handle="e"] { right: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      .handle[data-handle="se"] { right: -7px; bottom: -7px; cursor: nwse-resize; }
      .handle[data-handle="s"] { left: 50%; bottom: -7px; transform: translateX(-50%); cursor: ns-resize; }
      .handle[data-handle="sw"] { left: -7px; bottom: -7px; cursor: nesw-resize; }
      .handle[data-handle="w"] { left: -7px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      @media (max-width: 560px) {
        .toolbar { align-items: flex-start; width: calc(100vw - 20px); }
        .instructions { white-space: normal; }
      }
    </style>
    <div class="stage" tabindex="0" role="dialog" aria-label="Chọn vùng cần chụp">
      <div class="toolbar" data-toolbar>
        <p class="instructions">Kéo để chọn · kéo khung để di chuyển · phím mũi tên để tinh chỉnh · Enter xác nhận · Esc hủy</p>
        <div class="actions">
          <button type="button" data-cancel>Hủy</button>
          <button type="button" data-confirm disabled>Chụp vùng</button>
        </div>
      </div>
      <div class="selection" data-selection>
        <span class="dimensions" data-dimensions>0 × 0</span>
        ${HANDLES.map(
          (handle) =>
            `<button class="handle" type="button" tabindex="-1" aria-label="Resize ${handle}" data-handle="${handle}"></button>`,
        ).join("")}
      </div>
    </div>
  `;

  const stage = shadow.querySelector<HTMLElement>("[role=dialog]");
  const selection = shadow.querySelector<HTMLElement>("[data-selection]");
  const dimensions = shadow.querySelector<HTMLElement>("[data-dimensions]");
  const confirmButton = shadow.querySelector<HTMLButtonElement>("[data-confirm]");
  const cancelButton = shadow.querySelector<HTMLButtonElement>("[data-cancel]");
  if (
    stage === null ||
    selection === null ||
    dimensions === null ||
    confirmButton === null ||
    cancelButton === null
  ) {
    throw new Error("Region selector overlay could not be created.");
  }

  let rect: Rect | undefined;
  let gesture: Gesture | undefined;
  let lastPointer: Point | undefined;
  let animationFrame = 0;
  let disposed = false;
  let finishing = false;

  const render = () => {
    if (rect === undefined) {
      selection.style.display = "none";
      confirmButton.disabled = true;
      return;
    }
    const client = CoordinateSpace.fromWindow().documentRectToClient(rect);
    selection.style.display = "block";
    selection.style.left = px(client.x);
    selection.style.top = px(client.y);
    selection.style.width = px(rect.width);
    selection.style.height = px(rect.height);
    dimensions.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    confirmButton.disabled = rect.width < minimumSize || rect.height < minimumSize;
  };

  const applyPointer = (clientPoint: Point) => {
    if (gesture === undefined) {
      return;
    }
    const space = CoordinateSpace.fromWindow();
    const documentPoint = space.clampPoint(space.clientPointToDocument(clientPoint));
    if (gesture.kind === "create") {
      rect = space.normalizeDocumentRect(gesture.start, documentPoint);
    } else if (gesture.kind === "move") {
      rect = moveRectWithinBounds(
        gesture.initial,
        {
          x: documentPoint.x - gesture.start.x,
          y: documentPoint.y - gesture.start.y,
        },
        space.documentBounds,
      );
    } else {
      rect = resizeRectFromHandle(
        gesture.initial,
        gesture.handle,
        documentPoint,
        space.documentBounds,
        minimumSize,
      );
    }
    render();
  };

  const autoScrollLoop = () => {
    animationFrame = 0;
    if (disposed || gesture === undefined || lastPointer === undefined) {
      return;
    }
    const viewport = readViewport();
    const delta = edgeAutoScrollDelta(lastPointer, viewport);
    if (Math.abs(delta.x) > 0.1 || Math.abs(delta.y) > 0.1) {
      window.scrollBy({ left: delta.x, top: delta.y, behavior: "auto" });
      applyPointer(lastPointer);
    }
    animationFrame = requestAnimationFrame(autoScrollLoop);
  };

  const ensureAutoScroll = () => {
    if (animationFrame === 0) {
      animationFrame = requestAnimationFrame(autoScrollLoop);
    }
  };

  const stopGesture = () => {
    gesture = undefined;
    lastPointer = undefined;
    if (animationFrame !== 0) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  };

  const restorePage = () => {
    window.scrollTo({ left: originalScroll.x, top: originalScroll.y, behavior: "auto" });
    if (originalFocus?.isConnected) {
      originalFocus.focus({ preventScroll: true });
    }
  };

  const disposeInternal = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    stopGesture();
    window.removeEventListener("scroll", render, true);
    window.removeEventListener("resize", render, true);
    window.visualViewport?.removeEventListener("resize", render);
    window.visualViewport?.removeEventListener("scroll", render);
    root.remove();
    restorePage();
  };

  const finish = async (kind: "commit" | "cancel", reason = "user cancellation") => {
    if (finishing || disposed) {
      return;
    }
    if (kind === "commit" && (rect === undefined || confirmButton.disabled)) {
      return;
    }
    finishing = true;
    const selected = rect;
    disposeInternal();
    await waitForFrames(2);
    if (kind === "commit" && selected !== undefined) {
      await options.onCommit(selected);
    } else {
      await options.onCancel(reason);
    }
  };

  stage.addEventListener("pointerdown", (event) => {
    if (disposed || event.button !== 0) {
      return;
    }
    const path = event.composedPath();
    if (elementFromPath(path, (element) => element.hasAttribute("data-toolbar")) !== undefined) {
      return;
    }
    const handleElement = elementFromPath(path, (element) => element.hasAttribute("data-handle"));
    const space = CoordinateSpace.fromWindow();
    const point = space.clampPoint(
      space.clientPointToDocument({ x: event.clientX, y: event.clientY }),
    );
    const handle = handleElement?.dataset.handle;
    if (rect !== undefined && isResizeHandle(handle)) {
      gesture = { kind: "resize", pointerId: event.pointerId, handle, initial: rect };
    } else if (
      rect !== undefined &&
      elementFromPath(path, (element) => element.hasAttribute("data-selection")) !== undefined
    ) {
      gesture = { kind: "move", pointerId: event.pointerId, start: point, initial: rect };
    } else {
      gesture = { kind: "create", pointerId: event.pointerId, start: point };
      rect = { x: point.x, y: point.y, width: 0, height: 0 };
      render();
    }
    lastPointer = { x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    ensureAutoScroll();
    event.preventDefault();
  });

  stage.addEventListener("pointermove", (event) => {
    if (gesture?.pointerId !== event.pointerId) {
      return;
    }
    lastPointer = { x: event.clientX, y: event.clientY };
    applyPointer(lastPointer);
    ensureAutoScroll();
    event.preventDefault();
  });

  const endPointer = (event: PointerEvent) => {
    if (gesture?.pointerId !== event.pointerId) {
      return;
    }
    applyPointer({ x: event.clientX, y: event.clientY });
    if (stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
    stopGesture();
    event.preventDefault();
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  stage.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void finish("cancel", "keyboard cancellation");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void finish("commit");
      return;
    }
    if (
      rect === undefined ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const delta = {
      x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
      y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
    };
    rect = moveRectWithinBounds(rect, delta, CoordinateSpace.fromWindow().documentBounds);
    render();
    event.preventDefault();
  });

  confirmButton.addEventListener("click", () => void finish("commit"));
  cancelButton.addEventListener("click", () => void finish("cancel"));
  window.addEventListener("scroll", render, true);
  window.addEventListener("resize", render, true);
  window.visualViewport?.addEventListener("resize", render);
  window.visualViewport?.addEventListener("scroll", render);

  (document.documentElement ?? document.body).append(root);
  stage.focus({ preventScroll: true });
  render();

  return {
    jobId: options.jobId,
    getRect: () => rect,
    dispose: disposeInternal,
  };
}
