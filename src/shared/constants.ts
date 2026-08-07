export const PROTOCOL_VERSION = 1 as const;
export const SETTINGS_SCHEMA_VERSION = 1 as const;
export const SETTINGS_STORAGE_KEY = "webcap.settings" as const;
export const POPUP_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const POPUP_PREFERENCES_STORAGE_KEY = "webcap.popup-preferences" as const;
export const VISIBLE_SESSION_STORAGE_KEY = "webcap.visible-session" as const;
export const JOB_SESSION_STORAGE_KEY = "webcap.jobs.session" as const;

export const JOB_SCHEMA_VERSION = 1 as const;
export const JOB_SESSION_SCHEMA_VERSION = 1 as const;
export const TILE_RECORD_SCHEMA_VERSION = 1 as const;
export const DEDUPE_RECORD_SCHEMA_VERSION = 1 as const;

export const CDP_PROTOCOL_VERSION = "1.3" as const;
export const DEBUGGER_ATTACH_TIMEOUT_MS = 5_000;
export const DEBUGGER_COMMAND_TIMEOUT_MS = 10_000;
export const CDP_TILE_MAX_ATTEMPTS = 3;
export const CDP_TILE_RETRY_DELAYS_MS = Object.freeze([250, 750] as const);
export const TILE_TARGET_WIDTH_CSS = 8_192;
export const TILE_TARGET_HEIGHT_CSS = 8_192;
export const TILE_MAX_PIXEL_AREA = 8_192 * 8_192;
export const TILE_COVERAGE_EPSILON_CSS = 0.01;
export const FALLBACK_OVERLAP_CSS = 64;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const VISIBLE_CAPTURE_MIN_INTERVAL_MS = 550;
export const JOB_PROGRESS_THROTTLE_MS = 250;
export const ADAPTIVE_CAPTURE_MAX_DURATION_MS = 10 * 60 * 1_000;

export const JOB_ABANDONED_TTL_MS = 30 * 60 * 1_000;
export const JOB_LOCK_LEASE_MS = 2 * 60 * 1_000;
export const DEDUPE_TTL_MS = 10 * 60 * 1_000;

export const DEFAULT_LAZY_LOAD_STEP_RATIO = 0.8;
export const DEFAULT_LAZY_LOAD_SETTLE_MS = 250;
export const DEFAULT_LAZY_LOAD_MAX_DURATION_MS = 15_000;

export const DEFAULT_MAX_CSS_HEIGHT = 100_000;
export const DEFAULT_MAX_CSS_WIDTH = 32_768;
export const DEFAULT_MAX_TILES = 256;
export const PDF_VIEWER_MAX_DOCUMENT_TILES = 4_096;
export const DEFAULT_MAX_ESTIMATED_BYTES = 512 * 1024 * 1024;
export const ORIGINAL_PDF_MAX_BYTES = 128 * 1024 * 1024;
export const PDF_SOURCE_PROBE_TIMEOUT_MS = 5_000;
export const PDF_SOURCE_DOWNLOAD_TIMEOUT_MS = 30_000;

export const DEFAULT_IMAGE_QUALITY = 0.9;
export const DEFAULT_PDF_MARGIN_MM = 8;
export const DEFAULT_PDF_JPEG_QUALITY = 0.9;
