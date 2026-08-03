import type { ElementTargetDescriptor, Rect } from "@shared/contracts/domain";

import { CoordinateSpace } from "./coordinate-space";

export const ELEMENT_SELECTOR_ROOT_ATTRIBUTE = "data-webcap-element-selector" as const;

const INVALID_TAGS = new Set([
  "HTML",
  "BODY",
  "HEAD",
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "NOSCRIPT",
]);

export interface ElementSelection {
  element: Element;
  rect: Rect;
  descriptor: ElementTargetDescriptor;
}

export interface ElementSelectorController {
  readonly jobId: string;
  dispose(): void;
}

export interface OpenElementSelectorOptions {
  jobId: string;
  onCommit(selection: ElementSelection): Promise<void> | void;
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

function clampText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, maxLength);
}

export function summarizeElementDescriptor(options: {
  tagName: string;
  id?: string;
  classNames?: readonly string[];
}): string {
  const tagName = clampText(options.tagName.toLowerCase(), 40) || "element";
  const id = options.id === undefined ? "" : clampText(options.id, 60);
  const classes = (options.classNames ?? [])
    .map((className) => clampText(className, 40))
    .filter((className) => className.length > 0)
    .slice(0, 2);
  return `${tagName}${id.length > 0 ? `#${id}` : ""}${classes.map((name) => `.${name}`).join("")}`;
}

function isScrollable(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const style = getComputedStyle(element);
  const canScrollX =
    /auto|scroll/u.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
  const canScrollY =
    /auto|scroll/u.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
  return canScrollX || canScrollY;
}

function isSelectorNode(element: Element): boolean {
  return element.closest(`[${ELEMENT_SELECTOR_ROOT_ATTRIBUTE}]`) !== null;
}

export function isSelectableElement(element: Element): boolean {
  if (!element.isConnected || INVALID_TAGS.has(element.tagName) || isSelectorNode(element)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 1 ||
    rect.height < 1
  ) {
    return false;
  }
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function candidateFromComposedPath(path: readonly EventTarget[]): Element | undefined {
  return path.find(
    (candidate): candidate is Element =>
      candidate instanceof Element && isSelectableElement(candidate),
  );
}

function candidateFromPoint(clientX: number, clientY: number): Element | undefined {
  return document
    .elementsFromPoint(clientX, clientY)
    .find((candidate) => isSelectableElement(candidate));
}

function parentCandidate(element: Element): Element | undefined {
  let candidate: Element | null = element.parentElement;
  if (candidate === null) {
    const root = element.getRootNode();
    candidate = root instanceof ShadowRoot ? root.host : null;
  }
  while (candidate !== null && !isSelectableElement(candidate)) {
    const root = candidate.getRootNode();
    candidate = candidate.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return candidate ?? undefined;
}

export function readElementDocumentRect(element: Element): Rect {
  const clientRect = element.getBoundingClientRect();
  return CoordinateSpace.fromWindow().clampRect({
    x: clientRect.left + window.scrollX,
    y: clientRect.top + window.scrollY,
    width: clientRect.width,
    height: clientRect.height,
  });
}

function descriptorFor(element: Element): ElementTargetDescriptor {
  const classNames = Array.from(element.classList)
    .map((className) => clampText(className, 40))
    .filter((className) => className.length > 0)
    .slice(0, 3);
  const id = clampText(element.id, 60);
  return {
    schemaVersion: 1,
    selectionId: crypto.randomUUID(),
    tagName: clampText(element.tagName.toLowerCase(), 40) || "element",
    ...(id.length === 0 ? {} : { id }),
    classNames,
    scrollable: isScrollable(element),
    captureKind: "visible-bounds",
  };
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

export function openElementSelector(
  options: OpenElementSelectorOptions,
): ElementSelectorController {
  document.querySelector<HTMLElement>(`[${ELEMENT_SELECTOR_ROOT_ATTRIBUTE}]`)?.remove();

  const originalScroll = { x: window.scrollX, y: window.scrollY };
  const originalFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const root = document.createElement("div");
  root.setAttribute(ELEMENT_SELECTOR_ROOT_ATTRIBUTE, options.jobId);
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.zIndex = "2147483647";
  root.style.pointerEvents = "none";
  root.style.contain = "layout style paint";

  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .highlight {
        position: fixed;
        display: none;
        border: 2px solid #38bdf8;
        border-radius: 3px;
        background: rgba(56, 189, 248, .10);
        box-shadow: 0 0 0 1px rgba(15, 23, 42, .9), 0 8px 30px rgba(15, 23, 42, .22);
        pointer-events: none;
      }
      .label {
        position: absolute;
        left: -1px;
        bottom: calc(100% + 7px);
        max-width: min(520px, calc(100vw - 24px));
        padding: 6px 8px;
        border-radius: 7px;
        background: rgba(15, 23, 42, .97);
        color: #f8fafc;
        font: 700 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 5px 16px rgba(0,0,0,.24);
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
        background: rgba(15, 23, 42, .95);
        color: #f8fafc;
        box-shadow: 0 12px 36px rgba(0,0,0,.28);
        font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
      }
      .instructions { margin: 0; white-space: nowrap; }
      .selection-copy { color: #bae6fd; font-weight: 700; }
      .actions { display: flex; gap: 6px; }
      button {
        border: 1px solid rgba(255,255,255,.25);
        border-radius: 8px;
        padding: 7px 10px;
        background: rgba(255,255,255,.08);
        color: inherit;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      button:hover { background: rgba(255,255,255,.16); }
      button:focus-visible { outline: 2px solid #fde68a; outline-offset: 2px; }
      button[data-confirm] { background: #0284c7; border-color: #38bdf8; }
      button:disabled { opacity: .45; cursor: not-allowed; }
      @media (max-width: 680px) {
        .toolbar { align-items: flex-start; width: calc(100vw - 20px); }
        .instructions { white-space: normal; }
      }
    </style>
    <div class="highlight" data-highlight aria-hidden="true">
      <span class="label" data-label></span>
    </div>
    <div class="toolbar" role="dialog" aria-label="Chọn phần tử cần chụp" data-toolbar>
      <p class="instructions">Di chuột để xem · nhấp để chọn · ↑ cha · ↓ phần tử con trước · Enter xác nhận · Esc hủy <span class="selection-copy" data-selection-copy></span></p>
      <div class="actions">
        <button type="button" data-cancel>Hủy</button>
        <button type="button" data-confirm disabled>Chụp phần tử</button>
      </div>
    </div>
  `;

  const highlight = shadow.querySelector<HTMLElement>("[data-highlight]");
  const label = shadow.querySelector<HTMLElement>("[data-label]");
  const selectionCopy = shadow.querySelector<HTMLElement>("[data-selection-copy]");
  const toolbar = shadow.querySelector<HTMLElement>("[data-toolbar]");
  const confirmButton = shadow.querySelector<HTMLButtonElement>("[data-confirm]");
  const cancelButton = shadow.querySelector<HTMLButtonElement>("[data-cancel]");
  if (
    highlight === null ||
    label === null ||
    selectionCopy === null ||
    toolbar === null ||
    confirmButton === null ||
    cancelButton === null
  ) {
    throw new Error("Element selector overlay could not be created.");
  }

  let hovered: Element | undefined;
  let selected: Element | undefined;
  let disposed = false;
  let finishing = false;
  const rememberedChildren = new Map<Element, Element>();

  const activeElement = () => selected ?? hovered;

  const render = () => {
    const element = activeElement();
    if (element === undefined || !element.isConnected || !isSelectableElement(element)) {
      highlight.style.display = "none";
      confirmButton.disabled = true;
      selectionCopy.textContent = selected === undefined ? "" : " · mục đã chọn không còn tồn tại";
      return;
    }
    const rect = element.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = px(rect.left);
    highlight.style.top = px(rect.top);
    highlight.style.width = px(rect.width);
    highlight.style.height = px(rect.height);
    const summary = summarizeElementDescriptor({
      tagName: element.tagName,
      ...(element.id.length === 0 ? {} : { id: element.id }),
      classNames: Array.from(element.classList),
    });
    label.textContent = `${summary} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    selectionCopy.textContent = selected === undefined ? "" : ` · đã chọn ${summary}`;
    confirmButton.disabled = selected === undefined;
  };

  const restorePage = () => {
    window.scrollTo({ left: originalScroll.x, top: originalScroll.y, behavior: "auto" });
    if (originalFocus?.isConnected) {
      originalFocus.focus({ preventScroll: true });
    }
  };

  const removeListeners = () => {
    window.removeEventListener("pointermove", handlePointerMove, true);
    window.removeEventListener("click", handleClick, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", render, true);
    window.removeEventListener("resize", render, true);
    window.visualViewport?.removeEventListener("scroll", render);
    window.visualViewport?.removeEventListener("resize", render);
  };

  const disposeInternal = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    removeListeners();
    root.remove();
    restorePage();
  };

  const finish = async (kind: "commit" | "cancel", reason = "user cancellation") => {
    if (finishing || disposed) {
      return;
    }
    const target = selected;
    if (kind === "commit" && target === undefined) {
      return;
    }
    finishing = true;
    const snapshot =
      target === undefined
        ? undefined
        : {
            element: target,
            rect: readElementDocumentRect(target),
            descriptor: descriptorFor(target),
          };
    disposeInternal();
    await waitForFrames(2);
    if (kind === "commit" && snapshot !== undefined) {
      await options.onCommit(snapshot);
    } else {
      await options.onCancel(reason);
    }
  };

  function eventTargetsToolbar(event: Event): boolean {
    return event.composedPath().some((candidate) => candidate === root || candidate === toolbar);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (disposed || eventTargetsToolbar(event)) {
      return;
    }
    const candidate =
      candidateFromComposedPath(event.composedPath()) ??
      candidateFromPoint(event.clientX, event.clientY);
    if (selected === undefined && candidate !== hovered) {
      hovered = candidate;
      render();
    }
  }

  function handleClick(event: MouseEvent): void {
    if (disposed || eventTargetsToolbar(event)) {
      return;
    }
    const candidate =
      candidateFromComposedPath(event.composedPath()) ??
      candidateFromPoint(event.clientX, event.clientY);
    if (candidate === undefined) {
      return;
    }
    selected = candidate;
    hovered = candidate;
    render();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (disposed) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void finish("cancel", "keyboard cancellation");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void finish("commit");
      return;
    }
    if (event.key === "ArrowUp") {
      const current = activeElement();
      const parent = current === undefined ? undefined : parentCandidate(current);
      if (current !== undefined && parent !== undefined) {
        rememberedChildren.set(parent, current);
        selected = parent;
        hovered = parent;
        render();
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key === "ArrowDown") {
      const current = activeElement();
      const child = current === undefined ? undefined : rememberedChildren.get(current);
      if (child?.isConnected && isSelectableElement(child)) {
        selected = child;
        hovered = child;
        render();
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  confirmButton.addEventListener("click", () => void finish("commit"));
  cancelButton.addEventListener("click", () => void finish("cancel", "button cancellation"));
  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("click", handleClick, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scroll", render, true);
  window.addEventListener("resize", render, true);
  window.visualViewport?.addEventListener("scroll", render);
  window.visualViewport?.addEventListener("resize", render);
  document.documentElement.append(root);
  toolbar.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });

  return {
    jobId: options.jobId,
    dispose: disposeInternal,
  };
}
