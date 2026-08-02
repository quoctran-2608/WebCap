import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/u;

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (match === null) {
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_CAPTURE_EMPTY",
        stage: "process",
        message: "Captured image data is not a supported base64 data URL.",
        userMessageKey: "errors.captureEmpty",
        retryable: true,
        fallbackAllowed: false,
      }),
    );
  }

  const mimeType = match[1];
  const encoded = match[2];
  if (mimeType === undefined || encoded === undefined) {
    throw new TypeError("Data URL parser returned an incomplete match.");
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch (error) {
    throw createWebCapRuntimeError(
      createWebCapError({
        code: "E_CAPTURE_EMPTY",
        stage: "process",
        message: "Captured image base64 data could not be decoded.",
        userMessageKey: "errors.captureEmpty",
        retryable: true,
        fallbackAllowed: false,
        causeCode: error instanceof Error ? error.name : "InvalidCharacterError",
      }),
    );
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
