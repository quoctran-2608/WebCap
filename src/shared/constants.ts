export const PROTOCOL_VERSION = 1 as const;
export const SETTINGS_SCHEMA_VERSION = 1 as const;
export const SETTINGS_STORAGE_KEY = "webcap.settings" as const;

export const TILE_TARGET_WIDTH_CSS = 8_192;
export const TILE_TARGET_HEIGHT_CSS = 8_192;
export const FALLBACK_OVERLAP_CSS = 64;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const VISIBLE_CAPTURE_MIN_INTERVAL_MS = 550;

export const DEFAULT_LAZY_LOAD_STEP_RATIO = 0.8;
export const DEFAULT_LAZY_LOAD_SETTLE_MS = 250;
export const DEFAULT_LAZY_LOAD_MAX_DURATION_MS = 15_000;

export const DEFAULT_MAX_CSS_HEIGHT = 100_000;
export const DEFAULT_MAX_CSS_WIDTH = 32_768;
export const DEFAULT_MAX_TILES = 256;
export const DEFAULT_MAX_ESTIMATED_BYTES = 512 * 1024 * 1024;

export const DEFAULT_IMAGE_QUALITY = 0.9;
export const DEFAULT_PDF_MARGIN_MM = 8;
export const DEFAULT_PDF_JPEG_QUALITY = 0.9;
