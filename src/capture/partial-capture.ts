import type { CaptureTile, Rect } from "@shared/contracts/domain";

function tileRect(tile: CaptureTile): Rect {
  return tile.outputRectCss ?? tile.sourceRectCss;
}

export function rectCoveringTiles(tiles: readonly CaptureTile[]): Rect | undefined {
  if (tiles.length === 0) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const tile of tiles) {
    const rect = tileRect(tile);
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function contiguousStoredPrefix(tiles: readonly CaptureTile[]): CaptureTile[] {
  const stored = tiles
    .filter((tile) => tile.status === "stored")
    .sort((left, right) => left.index - right.index);
  if (stored.length === 0) return [];
  const columnCount = Math.max(...tiles.map((tile) => tile.column)) + 1;
  const fullRowCount = Math.floor(stored.length / columnCount);
  const keepCount = fullRowCount > 0 ? fullRowCount * columnCount : stored.length;
  return stored.slice(0, keepCount);
}
