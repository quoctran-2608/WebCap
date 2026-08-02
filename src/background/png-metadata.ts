import { createWebCapError, type WebCapErrorData } from "@shared/errors/error";
import { err, ok, type Result } from "@shared/result";

export interface PngMetadata {
  mimeType: "image/png";
  byteLength: number;
  width: number;
  height: number;
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function invalidPng(message: string): WebCapErrorData {
  return createWebCapError({
    code: "E_CAPTURE_EMPTY",
    stage: "capture",
    message,
    userMessageKey: "errors.captureEmpty",
    retryable: true,
    fallbackAllowed: false,
  });
}

function decodeHeader(encoded: string): Uint8Array {
  const headerLength = Math.min(encoded.length, 44);
  const decoded = globalThis.atob(encoded.slice(0, headerLength));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function byteLengthOfBase64(encoded: string): number {
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      (bytes[offset + 1] ?? 0) * 0x10000 +
      (bytes[offset + 2] ?? 0) * 0x100 +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

export function parsePngDataUrl(dataUrl: string): Result<PngMetadata, WebCapErrorData> {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return err(invalidPng("Capture did not return a PNG data URL."));
  }

  const encoded = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (encoded.length === 0) {
    return err(invalidPng("Capture returned an empty PNG payload."));
  }

  let header: Uint8Array;
  try {
    header = decodeHeader(encoded);
  } catch {
    return err(invalidPng("Capture returned invalid PNG base64 data."));
  }

  if (
    header.length < 24 ||
    PNG_SIGNATURE.some((value, index) => header[index] !== value) ||
    String.fromCharCode(...header.slice(12, 16)) !== "IHDR"
  ) {
    return err(invalidPng("Capture returned an invalid PNG header."));
  }

  const width = readUint32BigEndian(header, 16);
  const height = readUint32BigEndian(header, 20);
  const byteLength = byteLengthOfBase64(encoded);
  if (width === 0 || height === 0 || byteLength <= 0) {
    return err(invalidPng("Capture returned invalid PNG dimensions or size."));
  }

  return ok({ mimeType: "image/png", byteLength, width, height });
}
