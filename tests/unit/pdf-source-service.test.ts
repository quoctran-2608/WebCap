import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import type { PdfSourceCdpRecoveryPort } from "@background/pdf-source-cdp-recovery";
import type { PdfSourceDiscoveryPort } from "@background/pdf-source-discovery";
import {
  PdfSourceService,
  type PdfSourceFetchPort,
  type PdfSourcePermissionPort,
} from "@background/pdf-source-service";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";
import type { PdfSourceSpoolPort } from "@storage/pdf-source-spool";

async function samplePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([320, 480]);
  return document.save({ useObjectStreams: false });
}

function repository(): {
  port: ArtifactRepositoryPort;
  records: ArtifactRecord[];
} {
  const records: ArtifactRecord[] = [];
  return {
    records,
    port: {
      put: (record) => {
        records.push(record);
        return Promise.resolve();
      },
      get: (artifactId) =>
        Promise.resolve(records.find((record) => record.artifactId === artifactId)),
      delete: () => Promise.resolve(false),
      deleteExpired: () => Promise.resolve(0),
    },
  };
}

function permissions(granted = true): PdfSourcePermissionPort {
  return {
    containsOrigin: () => Promise.resolve(granted),
    isFileAccessAllowed: () => Promise.resolve(granted),
  };
}

function memorySpool(): PdfSourceSpoolPort {
  return {
    availableBytes: () => Promise.resolve(Number.MAX_SAFE_INTEGER),
    create: () => {
      const chunks: Uint8Array[] = [];
      return Promise.resolve({
        write: (chunk) => {
          chunks.push(Uint8Array.from(chunk));
          return Promise.resolve();
        },
        close: (mimeType) => {
          return Promise.resolve(new Blob(chunks, { type: mimeType }));
        },
        abort: () => {
          chunks.length = 0;
          return Promise.resolve();
        },
        cleanup: () => {
          return Promise.resolve();
        },
      });
    },
  };
}

function service(options: {
  url?: string;
  permissionGranted?: boolean;
  fetcher: PdfSourceFetchPort;
  discovery?: PdfSourceDiscoveryPort;
  cdpRecovery?: PdfSourceCdpRecoveryPort;
  spool?: PdfSourceSpoolPort;
}) {
  const artifacts = repository();
  const download = vi.fn(() => Promise.resolve(91));
  return {
    artifacts,
    download,
    instance: new PdfSourceService({
      tabs: {
        queryActiveTab: () =>
          Promise.resolve({
            id: 7,
            windowId: 9,
            active: true,
            url: options.url ?? "https://example.test/report.pdf",
            title: "Quarterly report",
          }),
      },
      permissions: permissions(options.permissionGranted ?? true),
      fetcher: options.fetcher,
      discovery: options.discovery,
      cdpRecovery: options.cdpRecovery,
      spool: options.spool ?? memorySpool(),
      artifacts: artifacts.port,
      downloads: { download },
      now: () => new Date("2026-08-04T05:00:00.000Z"),
      createId: () => "original-pdf-1",
    }),
  };
}

describe("PdfSourceService", () => {
  it("detects a PDF by response content type even without a .pdf suffix", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      ),
    );
    const { instance } = service({
      url: "https://example.test/download?id=42",
      fetcher: { fetch },
    });

    await expect(instance.inspect()).resolves.toMatchObject({
      status: "original-passthrough",
      permission: "granted",
      reason: "content-type",
      signals: { contentType: true },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/download?id=42",
      expect.objectContaining({ method: "HEAD", credentials: "include" }),
    );
  });

  it("does not fetch before the user grants the exact host permission", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("must not run")));
    const { instance } = service({
      permissionGranted: false,
      fetcher: { fetch },
    });

    await expect(instance.inspect()).resolves.toMatchObject({
      status: "original-passthrough",
      permission: "host-required",
      reason: "permission-missing",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores and downloads byte-identical streamed PDF data with SHA-256 metadata", async () => {
    const bytes = await samplePdf();
    const { instance, artifacts, download } = service({
      fetcher: {
        fetch: () =>
          Promise.resolve(
            new Response(Uint8Array.from(bytes).buffer, {
              status: 200,
              headers: {
                "content-type": "application/pdf",
                "content-disposition": 'attachment; filename="original report.pdf"',
                "content-length": String(bytes.byteLength),
              },
            }),
          ),
      },
    });

    const result = await instance.downloadOriginal("request-1", 7);
    expect("artifact" in result).toBe(true);
    if (!("artifact" in result)) throw new Error("Expected an original PDF download.");
    expect(result).toMatchObject({
      downloadId: 91,
      originalByteLength: bytes.byteLength,
      artifact: {
        artifactId: "original-pdf-1",
        filename: "original-report.pdf",
        mimeType: "application/pdf",
        pageCount: 1,
        width: 320,
        height: 480,
      },
      capability: {
        status: "original-passthrough",
        reason: "downloaded-original",
        signals: { signature: true, contentType: true },
      },
    });
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(download).toHaveBeenCalledWith("original-pdf-1");
    expect(artifacts.records).toHaveLength(1);
    const stored = artifacts.records[0];
    if (stored === undefined) throw new Error("Original PDF artifact was not stored.");
    expect(new Uint8Array(await stored.blob.arrayBuffer())).toEqual(bytes);
  });

  it("does not reject a streamed source because Content-Length exceeds the legacy 128 MiB cap", async () => {
    const bytes = await samplePdf();
    const { instance } = service({
      fetcher: {
        fetch: () =>
          Promise.resolve(
            new Response(Uint8Array.from(bytes).buffer, {
              status: 200,
              headers: {
                "content-type": "application/pdf",
                "content-length": String(256 * 1024 * 1024),
              },
            }),
          ),
      },
    });

    await expect(instance.downloadOriginal("request-large-header", 7)).resolves.toMatchObject({
      originalByteLength: bytes.byteLength,
      capability: { status: "original-passthrough" },
    });
  });

  it("discovers a PDF embedded inside a normal HTML viewer page", async () => {
    const fetch = vi.fn((input: string) =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {
            "content-type": input.includes("embedded.pdf") ? "application/pdf" : "text/html",
          },
        }),
      ),
    );
    const { instance } = service({
      url: "https://example.test/viewer",
      discovery: { discover: () => Promise.resolve(["https://cdn.test/embedded.pdf"]) },
      fetcher: { fetch },
    });

    await expect(instance.inspect()).resolves.toMatchObject({
      status: "original-passthrough",
      filename: "embedded.pdf",
      sourceLabel: "cdn.test",
    });
  });

  it("supports a local file source only after Chrome file access is enabled", async () => {
    const bytes = await samplePdf();
    const { instance } = service({
      url: "file:///Users/example/Documents/local-report.pdf",
      fetcher: {
        fetch: () =>
          Promise.resolve(
            new Response(Uint8Array.from(bytes).buffer, {
              status: 200,
              headers: { "content-type": "application/pdf" },
            }),
          ),
      },
    });

    await expect(instance.inspect()).resolves.toMatchObject({
      status: "original-passthrough",
      permission: "granted",
      scheme: "file",
      filename: "local-report.pdf",
    });
    await expect(instance.downloadOriginal("request-file", 7)).resolves.toMatchObject({
      originalByteLength: bytes.byteLength,
      capability: { status: "original-passthrough", scheme: "file" },
    });
  });

  it("returns auth-required without storing when no CDP recovery is available", async () => {
    const { instance, artifacts, download } = service({
      fetcher: {
        fetch: () => Promise.resolve(new Response("Sign in", { status: 401 })),
      },
    });

    await expect(instance.downloadOriginal("request-auth", 7)).resolves.toMatchObject({
      status: "auth-required",
      reason: "auth-required",
      canCaptureViewer: true,
    });
    expect(artifacts.records).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });

  it("recovers an authenticated source through CDP after direct fetch is denied", async () => {
    const bytes = await samplePdf();
    const cleanup = vi.fn(() => Promise.resolve());
    const recover = vi.fn(() =>
      Promise.resolve({
        blob: new Blob([bytes], { type: "application/pdf" }),
        byteLength: bytes.byteLength,
        checksumSha256: "a".repeat(64),
        signature: true,
        cleanup,
      }),
    );
    const { instance } = service({
      fetcher: { fetch: () => Promise.resolve(new Response("Sign in", { status: 401 })) },
      cdpRecovery: { recover },
    });

    await expect(instance.downloadOriginal("request-cdp", 7)).resolves.toMatchObject({
      capability: { status: "original-passthrough", reason: "downloaded-original" },
      originalByteLength: bytes.byteLength,
    });
    expect(recover).toHaveBeenCalledWith(
      7,
      "https://example.test/report.pdf",
      "original-pdf-1-cdp",
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("preserves a signature-valid but geometry-uninspectable original", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nnot-parseable-but-preservable");
    const { instance } = service({
      fetcher: {
        fetch: () =>
          Promise.resolve(
            new Response(bytes, {
              status: 200,
              headers: { "content-type": "application/pdf" },
            }),
          ),
      },
    });

    await expect(instance.downloadOriginal("request-encrypted-like", 7)).resolves.toMatchObject({
      artifact: { width: 1, height: 1 },
      capability: { status: "original-passthrough" },
    });
  });

  it("rejects a response that claims PDF but has no PDF signature", async () => {
    const { instance, artifacts } = service({
      fetcher: {
        fetch: () =>
          Promise.resolve(
            new Response("<html>not a pdf</html>", {
              status: 200,
              headers: { "content-type": "application/pdf" },
            }),
          ),
      },
    });

    await expect(instance.downloadOriginal("request-invalid", 7)).resolves.toMatchObject({
      status: "unsupported",
      reason: "pdf-invalid",
      signals: { contentType: true, signature: false },
    });
    expect(artifacts.records).toHaveLength(0);
  });

  it("rejects a stale active tab before any network request", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("must not run")));
    const { instance } = service({ fetcher: { fetch } });
    await expect(instance.downloadOriginal("request-stale", 99)).rejects.toMatchObject({
      code: "E_TARGET_STALE",
      fallbackAllowed: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
