import type { Rect } from "@shared/contracts/domain";

export interface Point {
  x: number;
  y: number;
}

export interface CoordinateSpaceSnapshot {
  scrollX: number;
  scrollY: number;
  visualViewportOffsetLeft: number;
  visualViewportOffsetTop: number;
  visualViewportScale: number;
  devicePixelRatio: number;
  documentWidth: number;
  documentHeight: number;
}

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: number): number {
  return Math.max(0, finite(value));
}

function positive(value: number, fallback = 1): number {
  const candidate = finite(value, fallback);
  return candidate > 0 ? candidate : fallback;
}

export function normalizeRectFromPoints(start: Point, end: Point): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(0, Math.max(start.x, end.x) - x),
    height: Math.max(0, Math.max(start.y, end.y) - y),
  };
}

export function clampRectToBounds(rect: Rect, bounds: Rect): Rect {
  const left = Math.max(bounds.x, rect.x);
  const top = Math.max(bounds.y, rect.y);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height);
  return {
    x: Math.min(Math.max(bounds.x, left), bounds.x + bounds.width),
    y: Math.min(Math.max(bounds.y, top), bounds.y + bounds.height),
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function moveRectWithinBounds(rect: Rect, delta: Point, bounds: Rect): Rect {
  const maximumX = bounds.x + Math.max(0, bounds.width - rect.width);
  const maximumY = bounds.y + Math.max(0, bounds.height - rect.height);
  return {
    ...rect,
    x: Math.min(maximumX, Math.max(bounds.x, rect.x + delta.x)),
    y: Math.min(maximumY, Math.max(bounds.y, rect.y + delta.y)),
  };
}

export function resizeRectFromHandle(
  rect: Rect,
  handle: ResizeHandle,
  point: Point,
  bounds: Rect,
  minimumSize = 2,
): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  const minimum = Math.max(1, finite(minimumSize, 2));

  if (handle.includes("w")) {
    left = Math.min(point.x, right - minimum);
  }
  if (handle.includes("e")) {
    right = Math.max(point.x, left + minimum);
  }
  if (handle.includes("n")) {
    top = Math.min(point.y, bottom - minimum);
  }
  if (handle.includes("s")) {
    bottom = Math.max(point.y, top + minimum);
  }

  left = Math.max(bounds.x, left);
  top = Math.max(bounds.y, top);
  right = Math.min(bounds.x + bounds.width, right);
  bottom = Math.min(bounds.y + bounds.height, bottom);

  if (right - left < minimum) {
    if (handle.includes("w")) {
      left = Math.max(bounds.x, right - minimum);
    } else {
      right = Math.min(bounds.x + bounds.width, left + minimum);
    }
  }
  if (bottom - top < minimum) {
    if (handle.includes("n")) {
      top = Math.max(bounds.y, bottom - minimum);
    } else {
      bottom = Math.min(bounds.y + bounds.height, top + minimum);
    }
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function edgeAutoScrollDelta(
  clientPoint: Point,
  viewport: { width: number; height: number },
  threshold = 56,
  maximumStep = 30,
): Point {
  const safeThreshold = Math.max(1, finite(threshold, 56));
  const safeMaximum = Math.max(1, finite(maximumStep, 30));
  const axis = (position: number, size: number): number => {
    if (position < safeThreshold) {
      return -safeMaximum * (1 - Math.max(0, position) / safeThreshold);
    }
    if (position > size - safeThreshold) {
      return safeMaximum * (1 - Math.max(0, size - position) / safeThreshold);
    }
    return 0;
  };
  return {
    x: axis(clientPoint.x, Math.max(1, viewport.width)),
    y: axis(clientPoint.y, Math.max(1, viewport.height)),
  };
}

export class CoordinateSpace {
  readonly snapshot: CoordinateSpaceSnapshot;

  constructor(snapshot: CoordinateSpaceSnapshot) {
    this.snapshot = {
      scrollX: nonNegative(snapshot.scrollX),
      scrollY: nonNegative(snapshot.scrollY),
      visualViewportOffsetLeft: finite(snapshot.visualViewportOffsetLeft),
      visualViewportOffsetTop: finite(snapshot.visualViewportOffsetTop),
      visualViewportScale: positive(snapshot.visualViewportScale),
      devicePixelRatio: positive(snapshot.devicePixelRatio),
      documentWidth: positive(snapshot.documentWidth),
      documentHeight: positive(snapshot.documentHeight),
    };
  }

  static fromWindow(target: Window = window): CoordinateSpace {
    const root = target.document.documentElement;
    const body = target.document.body;
    const visual = target.visualViewport;
    return new CoordinateSpace({
      scrollX: target.scrollX,
      scrollY: target.scrollY,
      visualViewportOffsetLeft: visual?.offsetLeft ?? 0,
      visualViewportOffsetTop: visual?.offsetTop ?? 0,
      visualViewportScale: visual?.scale ?? 1,
      devicePixelRatio: target.devicePixelRatio,
      documentWidth: Math.max(
        root?.scrollWidth ?? 0,
        root?.clientWidth ?? 0,
        body?.scrollWidth ?? 0,
        body?.clientWidth ?? 0,
      ),
      documentHeight: Math.max(
        root?.scrollHeight ?? 0,
        root?.clientHeight ?? 0,
        body?.scrollHeight ?? 0,
        body?.clientHeight ?? 0,
      ),
    });
  }

  get documentBounds(): Rect {
    return {
      x: 0,
      y: 0,
      width: this.snapshot.documentWidth,
      height: this.snapshot.documentHeight,
    };
  }

  get devicePixelScale(): number {
    return this.snapshot.devicePixelRatio * this.snapshot.visualViewportScale;
  }

  clientPointToDocument(point: Point): Point {
    return {
      x: finite(point.x) + this.snapshot.scrollX + this.snapshot.visualViewportOffsetLeft,
      y: finite(point.y) + this.snapshot.scrollY + this.snapshot.visualViewportOffsetTop,
    };
  }

  documentPointToClient(point: Point): Point {
    return {
      x: finite(point.x) - this.snapshot.scrollX - this.snapshot.visualViewportOffsetLeft,
      y: finite(point.y) - this.snapshot.scrollY - this.snapshot.visualViewportOffsetTop,
    };
  }

  documentRectToClient(rect: Rect): Rect {
    const origin = this.documentPointToClient(rect);
    return { ...origin, width: rect.width, height: rect.height };
  }

  clientRectToDocument(rect: Rect): Rect {
    const origin = this.clientPointToDocument(rect);
    return { ...origin, width: rect.width, height: rect.height };
  }

  clampPoint(point: Point): Point {
    return {
      x: Math.min(this.snapshot.documentWidth, Math.max(0, finite(point.x))),
      y: Math.min(this.snapshot.documentHeight, Math.max(0, finite(point.y))),
    };
  }

  normalizeDocumentRect(start: Point, end: Point): Rect {
    return clampRectToBounds(
      normalizeRectFromPoints(this.clampPoint(start), this.clampPoint(end)),
      this.documentBounds,
    );
  }

  cssRectToDevice(rect: Rect): Rect {
    const scale = this.devicePixelScale;
    return {
      x: rect.x * scale,
      y: rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    };
  }
}
