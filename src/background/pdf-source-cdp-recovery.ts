import type { DebuggerClient, DebuggerSession } from "./debugger-client";
import { spoolPdfReadableStream, type StreamedPdfSource } from "./pdf-source-stream";
import type { PdfSourceSpoolPort } from "@storage/pdf-source-spool";

const CDP_READ_CHUNK_BYTES = 64 * 1024;

interface FrameTreeResult {
  frameTree?: { frame?: { id?: string } };
}

interface NetworkLoadResult {
  resource?: {
    success?: boolean;
    httpStatusCode?: number;
    stream?: string;
  };
}

interface IoReadResult {
  data?: string;
  base64Encoded?: boolean;
  eof?: boolean;
}

export interface RecoveredPdfSource extends StreamedPdfSource {
  cleanup(): Promise<void>;
}

export interface PdfSourceCdpRecoveryPort {
  recover(tabId: number, url: string, spoolId: string): Promise<RecoveredPdfSource | undefined>;
}

function bytesFromIoRead(result: IoReadResult): Uint8Array {
  const data = result.data ?? "";
  if (data.length === 0) return new Uint8Array();
  if (result.base64Encoded === true) {
    const decoded = atob(data);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  }
  return new TextEncoder().encode(data);
}

function cdpReadableStream(session: DebuggerSession, handle: string): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) {
        controller.close();
        return;
      }
      const result = await session.sendCommand<IoReadResult>(
        "IO.read",
        { handle, size: CDP_READ_CHUNK_BYTES },
        { stage: "export", retryable: true, fallbackAllowed: true },
      );
      const bytes = bytesFromIoRead(result);
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      if (result.eof === true) {
        closed = true;
        controller.close();
      }
    },
    async cancel() {
      closed = true;
      await session
        .sendCommand("IO.close", { handle }, { stage: "cleanup", fallbackAllowed: true })
        .catch(() => undefined);
    },
  });
}

export class CdpPdfSourceRecovery implements PdfSourceCdpRecoveryPort {
  constructor(
    private readonly debuggerClient: Pick<DebuggerClient, "withSession">,
    private readonly spool: PdfSourceSpoolPort,
  ) {}

  recover(tabId: number, url: string, spoolId: string): Promise<RecoveredPdfSource | undefined> {
    return this.debuggerClient.withSession(tabId, async (session) => {
      const frameTree = await session.sendCommand<FrameTreeResult>(
        "Page.getFrameTree",
        undefined,
        { stage: "export", retryable: true, fallbackAllowed: true },
      );
      const frameId = frameTree.frameTree?.frame?.id;
      if (frameId === undefined) return undefined;

      const loaded = await session.sendCommand<NetworkLoadResult>(
        "Network.loadNetworkResource",
        {
          frameId,
          url,
          options: { disableCache: true, includeCredentials: true },
        },
        { stage: "export", retryable: true, fallbackAllowed: true },
      );
      const resource = loaded.resource;
      if (
        resource?.success !== true ||
        resource.stream === undefined ||
        resource.httpStatusCode === 401 ||
        resource.httpStatusCode === 403
      ) {
        return undefined;
      }

      const handle = resource.stream;
      const writer = await this.spool.create(spoolId);
      try {
        const streamed = await spoolPdfReadableStream(cdpReadableStream(session, handle), writer);
        return { ...streamed, cleanup: () => writer.cleanup() };
      } finally {
        await session
          .sendCommand("IO.close", { handle }, { stage: "cleanup", fallbackAllowed: true })
          .catch(() => undefined);
      }
    });
  }
}
