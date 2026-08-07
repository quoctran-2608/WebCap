import { sanitizeFilenameSegment } from "./filename";

export const CHROME_PDF_VIEWER_EXTENSION_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";

export interface PdfSourceCandidate {
  url: URL;
  tabId: number;
  sourceLabel: string;
  filename: string;
  scheme: "http" | "https" | "file" | "blob";
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

function supportedSourceUrl(
  url: URL,
): url is URL & { protocol: "http:" | "https:" | "file:" | "blob:" } {
  return (
    url.protocol === "http:" ||
    url.protocol === "https:" ||
    url.protocol === "file:" ||
    url.protocol === "blob:"
  );
}

export function looksLikePdfUrl(url: URL): boolean {
  return /\.pdf$/iu.test(url.pathname);
}

function blobOrigin(url: URL): string | undefined {
  if (url.protocol !== "blob:") return undefined;
  if (url.origin !== "null" && url.origin.length > 0) return url.origin;
  try {
    const inner = new URL(url.pathname);
    return inner.origin === "null" ? undefined : inner.origin;
  } catch {
    return undefined;
  }
}

export function permissionOriginFor(url: URL): string {
  if (url.protocol === "file:") return "file:///*";
  if (url.protocol === "blob:") {
    const origin = blobOrigin(url);
    return origin === undefined ? "blob:*" : `${origin}/*`;
  }
  return `${url.origin}/*`;
}

export function filenameFromPdfUrl(url: URL): string {
  if (url.protocol === "blob:") return "document.pdf";
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
  if (url.protocol === "blob:") {
    const origin = blobOrigin(url);
    if (origin !== undefined) {
      try {
        return new URL(origin).hostname || "PDF source";
      } catch {
        return "PDF source";
      }
    }
    return "PDF source";
  }
  return url.hostname || "PDF source";
}

function candidateFromUrl(
  tabId: number,
  url: URL,
  chromePdfViewerSignal: boolean,
): PdfSourceCandidate | undefined {
  if (!supportedSourceUrl(url)) return undefined;
  if (url.protocol === "blob:" && permissionOriginFor(url) === "blob:*") return undefined;
  const scheme = url.protocol.slice(0, -1) as PdfSourceCandidate["scheme"];
  return {
    url,
    tabId,
    sourceLabel: sourceLabelFor(url),
    filename: filenameFromPdfUrl(url),
    scheme,
    permissionOrigin: permissionOriginFor(url),
    urlExtensionSignal: looksLikePdfUrl(url),
    chromePdfViewerSignal,
    canCaptureViewer: true,
  };
}

export function resolvePdfSourceCandidates(options: {
  tabId: number;
  tabUrl?: string;
  discoveredUrls?: readonly string[];
}): PdfSourceCandidate[] {
  const candidates: PdfSourceCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: URL, chromePdfViewerSignal = false): void => {
    if (seen.has(url.href)) return;
    const candidate = candidateFromUrl(options.tabId, url, chromePdfViewerSignal);
    if (candidate === undefined) return;
    seen.add(url.href);
    candidates.push(candidate);
  };

  let tabUrl: URL | undefined;
  if (options.tabUrl !== undefined) {
    try {
      tabUrl = new URL(options.tabUrl);
    } catch {
      tabUrl = undefined;
    }
  }

  if (tabUrl !== undefined) {
    const viewerSource = decodedViewerSource(tabUrl);
    if (viewerSource !== undefined) add(viewerSource, true);
    else add(tabUrl);
  }

  for (const raw of options.discoveredUrls ?? []) {
    try {
      add(new URL(raw, tabUrl));
    } catch {
      // Ignore malformed discovery candidates.
    }
  }

  return candidates;
}

export function resolvePdfSourceCandidate(options: {
  tabId: number;
  tabUrl?: string;
}): PdfSourceCandidate | undefined {
  return resolvePdfSourceCandidates(options)[0];
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
