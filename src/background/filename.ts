import type { ImageFormat } from "@shared/contracts/domain";

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/gu;
const ILLEGAL_FILENAME_CHARACTERS = /[<>:"/\\|?*]/gu;
const REPEATED_SEPARATOR = /[\s-]+/gu;
const TRAILING_DOT_OR_SPACE = /[. ]+$/gu;
const MAX_BASE_NAME_LENGTH = 120;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function timestamp(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(
    date.getUTCHours(),
  )}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`;
}

function extensionFor(format: ImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function sanitizeFilenameSegment(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, "")
    .replace(ILLEGAL_FILENAME_CHARACTERS, "-")
    .replace(/\.\.+/gu, "-")
    .replace(REPEATED_SEPARATOR, "-")
    .replace(/^[-. ]+|[-. ]+$/gu, "")
    .replace(TRAILING_DOT_OR_SPACE, "");
}

export interface BuildCaptureFilenameOptions {
  title?: string;
  domain?: string;
  createdAt: Date;
  format: ImageFormat;
}

export function buildCaptureFilename(options: BuildCaptureFilenameOptions): string {
  const title = sanitizeFilenameSegment(options.title ?? "");
  const domain = sanitizeFilenameSegment(options.domain ?? "");
  const parts = [title, domain, timestamp(options.createdAt)].filter((part) => part.length > 0);
  let baseName = sanitizeFilenameSegment(parts.join("_"));

  if (baseName.length === 0) {
    baseName = "webcap-capture";
  }

  baseName = baseName.slice(0, MAX_BASE_NAME_LENGTH).replace(TRAILING_DOT_OR_SPACE, "");
  if (baseName.length === 0 || baseName.includes("..")) {
    baseName = "webcap-capture";
  }

  return `${baseName}.${extensionFor(options.format)}`;
}
