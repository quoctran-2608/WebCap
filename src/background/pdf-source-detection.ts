import { sanitizeFilenameSegment } from "./filename";

export const CHROME_PDF_VIEWER_EXTENSION_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";

export interface PdfSourceCandidate {
  url: URL;
  tabId: number;
  sourceLabel: string;
  filename: string;
  scheme: "http" | "https" | "file";
  permissionOrigin: string;
  urlExtensionSignal: boolean;
  chromePdfViewerSignal: boolean;
  canCaptureViewer: boolean;
}

function decodedViewerSource(url: URL): URL | undefined {
  if (url.protocol !== "chrome-extension:" || url.hostname !== CHROME_PDF_VIEWER_EXTENSION_ID) {
    return undefined;
  }
  const raw = url.searchParams.get("file");
  if (raw === null || raw.length === 0) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function supportedSourceUrl(url: URL): url is URL & { protocol: "http:" | "https:" | "file:" } {
  return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:";
}

export function looksLikePdfUrl(url: URL): boolean {
  return /\.pdf$/iu.test(url.pathname);
}

export function permissionOriginFor(url: URL): string {
  return url.protocol === "file:" ? "file:///*" : `${url.origin}/*`;
}

export function filenameFromPdfUrl(url: URL): string {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep the encoded path when it is malformed.
  }
  const lastSegment = pathname.split("/").filter(Boolean).at(-1) ?? "document.pdf";
  const sanitized = sanitizeFilenameSegment(lastSegment);
  const base = sanitized.length > 0 ? sanitized : "document.pdf";
  return /\.pdf$/iu.test(base) ? base.slice(0, 180) : `${base.slice(0, 176)}.pdf`;
}

export function sourceLabelFor(url: URL): string {
  if (url.protocol === "file:") return filenameFromPdfUrl(url);
  return url.hostname || "PDF source";
}

export function resolvePdfSourceCandidate(options: {
  tabId: number;
  tabUrl?: string;
}): PdfSourceCandidate | undefined {
  if (options.tabUrl === undefined) return undefined;
  let tabUrl: URL;
  try {
    tabUrl = new URL(options.tabUrl);
  } catch {
    return undefined;
  }

  const viewerSource = decodedViewerSource(tabUrl);
  const sourceUrl = viewerSource ?? tabUrl;
  if (!supportedSourceUrl(sourceUrl)) return undefined;

  const scheme = sourceUrl.protocol.slice(0, -1) as "http" | "https" | "file";
  return {
    url: sourceUrl,
    tabId: options.tabId,
    sourceLabel: sourceLabelFor(sourceUrl),
    filename: filenameFromPdfUrl(sourceUrl),
    scheme,
    permissionOrigin: permissionOriginFor(sourceUrl),
    urlExtensionSignal: looksLikePdfUrl(sourceUrl),
    chromePdfViewerSignal: viewerSource !== undefined,
    canCaptureViewer: true,
  };
}

export function contentTypeIsPdf(contentType: string | null): boolean {
  if (contentType === null) return false;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf";
}

export function contentDispositionFilename(value: string | null): string | undefined {
  if (value === null) return undefined;
  const star = /filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
  const plain = /filename=(?:"([^"]+)"|([^;]+))/iu.exec(value);
  const raw = star === undefined ? (plain?.[1] ?? plain?.[2]) : star;
  if (raw === undefined) return undefined;
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the server-provided value when percent decoding fails.
  }
  const sanitized = sanitizeFilenameSegment(decoded);
  if (sanitized.length === 0) return undefined;
  return /\.pdf$/iu.test(sanitized) ? sanitized.slice(0, 180) : `${sanitized.slice(0, 176)}.pdf`;
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(1024, bytes.byteLength - 4);
  for (let index = 0; index <= limit; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}
