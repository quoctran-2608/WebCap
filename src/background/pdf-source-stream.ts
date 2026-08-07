import { hasPdfHeader } from "./pdf-source-detection";
import { Sha256Stream } from "@shared/crypto/sha256-stream";
import type { PdfSourceSpoolWriter } from "@storage/pdf-source-spool";

const PDF_SIGNATURE_PREFIX_BYTES = 1_029;

export interface StreamedPdfSource {
  blob: Blob;
  byteLength: number;
  checksumSha256: string;
  signature: boolean;
}

export async function spoolPdfReadableStream(
  stream: ReadableStream<Uint8Array>,
  writer: PdfSourceSpoolWriter,
): Promise<StreamedPdfSource> {
  const reader = stream.getReader();
  const hash = new Sha256Stream();
  const prefix = new Uint8Array(PDF_SIGNATURE_PREFIX_BYTES);
  let prefixLength = 0;
  let byteLength = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (chunk.byteLength === 0) continue;
      byteLength += chunk.byteLength;
      hash.update(chunk);
      if (prefixLength < prefix.byteLength) {
        const take = Math.min(prefix.byteLength - prefixLength, chunk.byteLength);
        prefix.set(chunk.subarray(0, take), prefixLength);
        prefixLength += take;
      }
      await writer.write(chunk);
    }
    const blob = await writer.close("application/pdf");
    return {
      blob,
      byteLength,
      checksumSha256: hash.digestHex(),
      signature: hasPdfHeader(prefix.subarray(0, prefixLength)),
    };
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
