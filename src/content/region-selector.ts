import type { Rect } from "@shared/contracts/domain";
import { DEFAULT_UI_LOCALE, t, type UiLocale } from "@shared/i18n";

import {
  CoordinateSpace,
  clampRectToBounds,
  edgeAutoScrollDelta,
  moveRectWithinBounds,
  resizeRectFromHandle,
  type Point,
  type ResizeHandle,
} from "./coordinate-space";

export const REGION_SELECTOR_ROOT_ATTRIBUTE = "data-webcap-region-selector" as const;
export const REGION_SELECTOR_MINIMUM_SIZE_CSS = 2;
export const REGION_SELECTOR_HANDLE_HIT_SIZE_CSS = 24;

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

export interface RegionSelectorReadyState {
  selectorInstanceId: string;
  readyAt: string;
  capabilities: {
    pointerCreate: true;
    keyboardCreate: true;
    autoScroll: true;
    resizeHandles: 8;
  };
}

export interface RegionSelectorController {
  readonly jobId: string;
  readonly selectorInstanceId: string;
  readonly ready: Promise<RegionSelectorReadyState>;
  getRect(): Rect | undefined;
  dispose(): void;
}

export interface OpenRegionSelectorOptions {
  jobId: string;
  selectorInstanceId?: string;
  minimumSizeCss?: number;
  locale?: UiLocale;
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

export function createCenteredKeyboardRect(documentBounds: Rect, visibleDocumentRect: Rect): Rect {
  const width = Math.min(480, visibleDocumentRect.width * 0.5, documentBounds.width);
  const height = Math.min(320, visibleDocumentRect.height * 0.4, documentBounds.height);
  return clampRectToBounds(
    {
      x: visibleDocumentRect.x + Math.max(0, (visibleDocumentRect.width - width) / 2),
      y: visibleDocumentRect.y + Math.max(0, (visibleDocumentRect.height - height) / 2),
      width: Math.max(REGION_SELECTOR_MINIMUM_SIZE_CSS, width),
      height: Math.max(REGION_SELECTOR_MINIMUM_SIZE_CSS, height),
    },
    documentBounds,
  );
}

export function resizeRectWithKeyboard(
  rect: Rect,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  step: number,
  bounds: Rect,
  minimumSize = REGION_SELECTOR_MINIMUM_SIZE_CSS,
): Rect {
  const safeStep = Math.max(1, Math.abs(step));
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const right = rect.x + rect.width + (key === "ArrowLeft" ? -safeStep : safeStep);
    return resizeRectFromHandle(
      rect,
      "e",
      { x: right, y: rect.y + rect.height },
      bounds,
      minimumSize,
    );
  }
  const bottom = rect.y + rect.height + (key === "ArrowUp" ? -safeStep : safeStep);
  return resizeRectFromHandle(
    rect,
    "s",
    { x: rect.x + rect.width, y: bottom },
    bounds,
    minimumSize,
  );
}

export function openRegionSelector(options: OpenRegionSelectorOptions): RegionSelectorController {
  const existing = document.querySelector<HTMLElement>(`[${REGION_SELECTOR_ROOT_ATTRIBUTE}]`);
  existing?.remove();

  const selectorInstanceId = options.selectorInstanceId ?? crypto.randomUUID();
  const minimumSize = Math.max(
    REGION_SELECTOR_MINIMUM_SIZE_CSS,
    options.minimumSizeCss ?? REGION_SELECTOR_MINIMUM_SIZE_CSS,
  );
  const locale = options.locale ?? DEFAULT_UI_LOCALE;
  const originalScroll = { x: window.scrollX, y: window.scrollY };
  const originalFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const root = document.createElement("div");
  root.setAttribute(REGION_SELECTOR_ROOT_ATTRIBUTE, options.jobId);
  root.setAttribute("data-webcap-selector-instance", selectorInstanceId);
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
      .stage::before {
        content: "";
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, .46);
        pointer-events: none;
      }
      .toolbar {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 10px;
        max-width: calc(100vw - 24px);
        padding: 10px 12px;
        border: 1px solid rgba(255,255,255,.22);
        border-radius: 12px;
        background: rgba(15, 23, 42, .96);
        box-shadow: 0 12px 36px rgba(0,0,0,.32);
        cursor: default;
        pointer-events: auto;
      }
      .instructions { margin: 0; font-size: 12px; line-height: 1.45; }
      .actions, .keyboard-actions { display: flex; align-items: center; gap: 6px; }
      button {
        min-height: 32px;
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
        border-radius: 3px;
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
        background: rgba(15, 23, 42, .98);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 5px 16px rgba(0,0,0,.24);
        pointer-events: none;
      }
      .handle {
        position: absolute;
        width: ${REGION_SELECTOR_HANDLE_HIT_SIZE_CSS}px;
        height: ${REGION_SELECTOR_HANDLE_HIT_SIZE_CSS}px;
        min-height: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
      }
      .handle::after {
        content: "";
        position: absolute;
        left: 6px;
        top: 6px;
        width: 12px;
        height: 12px;
        border: 2px solid #0f172a;
        border-radius: 50%;
        background: #facc15;
      }
      .handle[data-handle="nw"] { left: -13px; top: -13px; cursor: nwse-resize; }
      .handle[data-handle="n"] { left: 50%; top: -13px; transform: translateX(-50%); cursor: ns-resize; }
      .handle[data-handle="ne"] { right: -13px; top: -13px; cursor: nesw-resize; }
      .handle[data-handle="e"] { right: -13px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      .handle[data-handle="se"] { right: -13px; bottom: -13px; cursor: nwse-resize; }
      .handle[data-handle="s"] { left: 50%; bottom: -13px; transform: translateX(-50%); cursor: ns-resize; }
      .handle[data-handle="sw"] { left: -13px; bottom: -13px; cursor: nesw-resize; }
      .handle[data-handle="w"] { left: -13px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      .crosshair {
        position: fixed;
        z-index: 1;
        display: none;
        background: rgba(250, 204, 21, .82);
        pointer-events: none;
      }
      .crosshair[data-axis="x"] { left: 0; right: 0; height: 1px; }
      .crosshair[data-axis="y"] { top: 0; bottom: 0; width: 1px; }
      @media (max-width: 680px) {
        .toolbar { align-items: flex-start; width: calc(100vw - 20px); }
        .instructions { width: 100%; text-align: center; }
      }
    </style>
    <div class="stage" tabindex="0" role="dialog" aria-modal="true" aria-label="${t(locale, "selector.region.dialog")}">
      <div class="crosshair" data-crosshair data-axis="x"></div>
      <div class="crosshair" data-crosshair data-axis="y"></div>
      <div class="toolbar" data-toolbar>
        <p class="instructions">${t(locale, "selector.region.instructions")}</p>
        <div class="keyboard-actions" aria-label="${t(locale, "selector.region.keyboardControls")}">
          <button type="button" data-keyboard-create>${t(locale, "selector.region.keyboardCreate")}</button>
          <button type="button" data-resize="width-decrease" aria-label="${t(locale, "selector.region.widthDecrease")}">W−</button>
          <button type="button" data-resize="width-increase" aria-label="${t(locale, "selector.region.widthIncrease")}">W+</button>
          <button type="button" data-resize="height-decrease" aria-label="${t(locale, "selector.region.heightDecrease")}">H−</button>
          <button type="button" data-resize="height-increase" aria-label="${t(locale, "selector.region.heightIncrease")}">H+</button>
        </div>
        <div class="actions">
          <button type="button" data-cancel>${t(locale, "common.cancel")}</button>
          <button type="button" data-confirm disabled>${t(locale, "selector.region.confirm")}</button>
        </div>
      </div>
      <div class="selection" data-selection>
        <span class="dimensions" data-dimensions aria-live="polite">0 × 0</span>
        ${HANDLES.map(
          (handle) =>
            `<button class="handle" type="button" tabindex="-1" aria-label="${t(locale, "selector.resizeHandle", { handle })}" data-handle="${handle}"></button>`,
        ).join("")}
      </div>
    </div>
  `;

  const stage = shadow.querySelector<HTMLElement>("[role=dialog]");
  const selection = shadow.querySelector<HTMLElement>("[data-selection]");
  const dimensions = shadow.querySelector<HTMLElement>("[data-dimensions]");
  const confirmButton = shadow.querySelector<HTMLButtonElement>("[data-confirm]");
  const cancelButton = shadow.querySelector<HTMLButtonElement>("[data-cancel]");
  const keyboardCreateButton = shadow.querySelector<HTMLButtonElement>("[data-keyboard-create]");
  const resizeButtons = [...shadow.querySelectorAll<HTMLButtonElement>("[data-resize]")];
  const crosshairs = [...shadow.querySelectorAll<HTMLElement>("[data-crosshair]")];
  if (
    stage === null ||
    selection === null ||
    dimensions === null ||
    confirmButton === null ||
    cancelButton === null ||
    keyboardCreateButton === null ||
    resizeButtons.length !== 4 ||
    crosshairs.length !== 2
  ) {
    throw new Error("Region selector overlay could not be created.");
  }

  let rect: Rect | undefined;
  let gesture: Gesture | undefined;
  let lastPointer: Point | undefined;
  let animationFrame = 0;
  let disposed = false;
  let finishing = false;
  let listenersAttached = false;

  const setCrosshair = (clientPoint: Point | undefined) => {
    for (const line of crosshairs) {
      if (clientPoint === undefined || disposed) {
        line.style.display = "none";
        continue;
      }
      line.style.display = "block";
      if (line.dataset.axis === "x") {
        line.style.top = px(clientPoint.y);
      } else {
        line.style.left = px(clientPoint.x);
      }
    }
  };

  const render = () => {
    const hasRect = rect !== undefined;
    for (const button of resizeButtons) {
      button.disabled = !hasRect;
    }
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

  const createKeyboardRect = () => {
    const space = CoordinateSpace.fromWindow();
    const viewport = readViewport();
    const origin = space.clientPointToDocument({ x: 0, y: 0 });
    rect = createCenteredKeyboardRect(space.documentBounds, {
      x: origin.x,
      y: origin.y,
      width: viewport.width,
      height: viewport.height,
    });
    render();
  };

  const resizeKeyboard = (
    key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
    step: number,
  ) => {
    if (rect === undefined) return;
    rect = resizeRectWithKeyboard(
      rect,
      key,
      step,
      CoordinateSpace.fromWindow().documentBounds,
      minimumSize,
    );
    render();
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
    setCrosshair(undefined);
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

  stage.addEventListener("pointerenter", (event) => {
    setCrosshair({ x: event.clientX, y: event.clientY });
  });
  stage.addEventListener("pointerleave", () => {
    if (gesture === undefined) setCrosshair(undefined);
  });
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
    setCrosshair(lastPointer);
    stage.setPointerCapture(event.pointerId);
    ensureAutoScroll();
    event.preventDefault();
  });

  stage.addEventListener("pointermove", (event) => {
    const clientPoint = { x: event.clientX, y: event.clientY };
    setCrosshair(clientPoint);
    if (gesture?.pointerId !== event.pointerId) {
      return;
    }
    lastPointer = clientPoint;
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
    if (event.key === " " && rect === undefined) {
      event.preventDefault();
      createKeyboardRect();
      return;
    }
    if (
      rect === undefined ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    const key = event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
    const step = event.shiftKey ? 10 : 1;
    if (event.altKey) {
      resizeKeyboard(key, step);
    } else {
      const delta = {
        x: key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0,
        y: key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0,
      };
      rect = moveRectWithinBounds(rect, delta, CoordinateSpace.fromWindow().documentBounds);
      render();
    }
    event.preventDefault();
  });

  keyboardCreateButton.addEventListener("click", () => {
    createKeyboardRect();
    stage.focus({ preventScroll: true });
  });
  for (const button of resizeButtons) {
    button.addEventListener("click", () => {
      const action = button.dataset.resize;
      if (action === "width-decrease") resizeKeyboard("ArrowLeft", 10);
      if (action === "width-increase") resizeKeyboard("ArrowRight", 10);
      if (action === "height-decrease") resizeKeyboard("ArrowUp", 10);
      if (action === "height-increase") resizeKeyboard("ArrowDown", 10);
      stage.focus({ preventScroll: true });
    });
  }
  confirmButton.addEventListener("click", () => void finish("commit"));
  cancelButton.addEventListener("click", () => void finish("cancel"));
  window.addEventListener("scroll", render, true);
  window.addEventListener("resize", render, true);
  window.visualViewport?.addEventListener("resize", render);
  window.visualViewport?.addEventListener("scroll", render);
  listenersAttached = true;

  (document.documentElement ?? document.body).append(root);
  stage.focus({ preventScroll: true });
  render();

  const ready = (async (): Promise<RegionSelectorReadyState> => {
    await waitForFrame();
    if (disposed || !root.isConnected || shadow.activeElement !== stage || !listenersAttached) {
      throw new Error("Region selector did not reach a focused rendered state.");
    }
    return {
      selectorInstanceId,
      readyAt: new Date().toISOString(),
      capabilities: {
        pointerCreate: true,
        keyboardCreate: true,
        autoScroll: true,
        resizeHandles: 8,
      },
    };
  })();

  return {
    jobId: options.jobId,
    selectorInstanceId,
    ready,
    getRect: () => rect,
    dispose: disposeInternal,
  };
}
