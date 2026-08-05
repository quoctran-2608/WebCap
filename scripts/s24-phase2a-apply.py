from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one anchor in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new))


Path("src/background/capture-completion-policy.ts").write_text(
    r'''import type {
  CaptureCompletionPolicy,
  CaptureJob,
  CaptureMode,
  CaptureSettings,
  OutputFormat,
} from "@shared/contracts/domain";

function selectedImageOutput(settings: CaptureSettings): OutputFormat {
  return settings.outputFormat === "pdf" ? "png" : settings.outputFormat;
}

export function createCaptureCompletionPolicy(
  mode: CaptureMode,
  settings: CaptureSettings,
): CaptureCompletionPolicy {
  if (mode === "full-page" || mode === "scroll-area") {
    return {
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: mode === "scroll-area",
    };
  }
  if (mode === "region" || mode === "element") {
    return {
      primaryOutput: selectedImageOutput(settings),
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: true,
    };
  }
  return {
    primaryOutput: selectedImageOutput(settings),
    autoExport: false,
    openEditorAfterCapture: false,
    allowGuardedImageFallback: false,
  };
}

export function completionPolicyForJob(job: CaptureJob): CaptureCompletionPolicy {
  return job.completionPolicy ?? createCaptureCompletionPolicy(job.mode, job.settings);
}
'''
)

Path("src/background/capture-output.ts").write_text(
    r'''import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureOutput } from "@shared/contracts/domain";

export function captureOutputFromArtifact(artifact: ArtifactMetadata): CaptureOutput {
  return {
    artifactId: artifact.artifactId,
    sourceArtifactId: artifact.sourceArtifactId,
    format: artifact.format,
    mimeType: artifact.mimeType,
    filename: artifact.filename,
    byteLength: artifact.byteLength,
    width: artifact.width,
    height: artifact.height,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt,
    ...(artifact.pageCount === undefined ? {} : { pageCount: artifact.pageCount }),
  };
}
'''
)

Path("src/background/tiled-image-export-service.ts").write_text(
    r'''import { buildCaptureFilename } from "@background/filename";
import type { ExportTiledImageOptions } from "@background/offscreen-service";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, ImageFormat } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import type { ArtifactRepositoryPort } from "@storage/artifact-repository";

import { captureOutputFromArtifact } from "./capture-output";
import type { PersistentJobCoordinatorPort } from "./job-coordinator";

export interface TiledImageOffscreenPort {
  exportTiledImage(options: ExportTiledImageOptions): Promise<ArtifactMetadata>;
}

export interface TiledImageExportServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  offscreen: TiledImageOffscreenPort;
  artifacts?: Pick<ArtifactRepositoryPort, "delete">;
  now?: () => Date;
  createId?: () => string;
  artifactTtlMs?: number;
}

const DEFAULT_ARTIFACT_TTL_MS = 30 * 60 * 1000;

function sourceError(jobId: string, causeCode: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The stored capture tiles required for image export are unavailable.",
      userMessageKey: "errors.storageRead",
      retryable: true,
      fallbackAllowed: false,
      causeCode,
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function jobNotReadyError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message: "The capture job is not ready for tiled image export.",
      userMessageKey: "errors.exportNotReady",
      retryable: job.state === "failed",
      fallbackAllowed: false,
      causeCode: "TiledImageExportJobNotReady",
      safeContext: { jobId: job.id.slice(0, 24), state: job.state },
    }),
  );
}

function domainFromOrigin(origin: string | undefined): string | undefined {
  if (origin === undefined) return undefined;
  try {
    return new URL(origin).hostname || undefined;
  } catch {
    return undefined;
  }
}

export class TiledImageExportService {
  private readonly jobs: PersistentJobCoordinatorPort;
  private readonly offscreen: TiledImageOffscreenPort;
  private readonly artifacts: Pick<ArtifactRepositoryPort, "delete"> | undefined;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly artifactTtlMs: number;
  private readonly operations = new Map<string, Promise<void>>();
  private readonly cancelledJobs = new Set<string>();

  constructor(options: TiledImageExportServiceOptions) {
    this.jobs = options.jobs;
    this.offscreen = options.offscreen;
    this.artifacts = options.artifacts;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
  }

  async start(jobId: string, format: ImageFormat, quality?: number): Promise<CaptureJob> {
    const current = await this.jobs.get(jobId);
    if (current === undefined) throw sourceError(jobId, "TiledImageExportJobMissing");
    if (current.state === "completed" && current.outputArtifactId !== undefined) return current;
    if (current.state === "exporting") return current;
    if (
      !["ready", "failed"].includes(current.state) ||
      current.targetRect === undefined ||
      current.tilePlan.length === 0
    ) {
      throw jobNotReadyError(current);
    }

    this.cancelledJobs.delete(jobId);
    const exporting = await this.jobs.transition(
      jobId,
      "exporting",
      {
        activeOutputFormat: format,
        error: undefined,
        output: undefined,
        outputArtifactId: undefined,
        exportProgress: { completedPages: 0, totalPages: 1 },
      },
      { sourceArtifactExists: true },
    );
    if (!this.operations.has(jobId)) {
      const operation = this.run(exporting, format, quality ?? current.settings.imageQuality).finally(
        () => {
          this.operations.delete(jobId);
          this.cancelledJobs.delete(jobId);
        },
      );
      this.operations.set(jobId, operation);
      void operation.catch(() => undefined);
    }
    return exporting;
  }

  async cancel(jobId: string): Promise<CaptureJob> {
    const job = await this.jobs.get(jobId);
    if (job === undefined) throw sourceError(jobId, "TiledImageExportJobMissing");
    if (job.state !== "exporting") return job;
    this.cancelledJobs.add(jobId);
    return this.jobs.transition(jobId, "ready", {
      exportProgress: job.exportProgress ?? { completedPages: 0, totalPages: 1 },
    });
  }

  async waitForIdle(jobId: string): Promise<void> {
    await this.operations.get(jobId)?.catch(() => undefined);
  }

  private async run(job: CaptureJob, format: ImageFormat, quality: number): Promise<void> {
    const targetRect = job.targetRect;
    if (targetRect === undefined) throw sourceError(job.id, "TiledImageExportTargetMissing");
    const createdAt = this.now();
    const sourceDomain = domainFromOrigin(job.source.origin);
    const outputArtifactId = this.createId();
    try {
      const artifact = await this.offscreen.exportTiledImage({
        jobId: job.id,
        outputArtifactId,
        targetRect,
        tiles: job.tilePlan,
        format,
        quality,
        filename: buildCaptureFilename({
          ...(job.source.title === undefined ? {} : { title: job.source.title }),
          ...(sourceDomain === undefined ? {} : { domain: sourceDomain }),
          createdAt,
          format,
        }),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + this.artifactTtlMs).toISOString(),
        ...(job.source.title === undefined ? {} : { sourceTitle: job.source.title }),
        ...(sourceDomain === undefined ? {} : { sourceDomain }),
      });
      const latest = await this.jobs.get(job.id);
      if (
        latest?.state !== "exporting" ||
        latest.activeOutputFormat !== format ||
        this.cancelledJobs.has(job.id)
      ) {
        await this.artifacts?.delete(artifact.artifactId).catch(() => false);
        return;
      }
      await this.jobs.transition(job.id, "completed", {
        activeOutputFormat: format,
        outputArtifactId: artifact.artifactId,
        output: captureOutputFromArtifact(artifact),
        exportProgress: { completedPages: 1, totalPages: 1 },
      });
    } catch (error) {
      const latest = await this.jobs.get(job.id);
      if (latest?.state !== "exporting" || this.cancelledJobs.has(job.id)) return;
      await this.jobs.transition(job.id, "failed", {
        activeOutputFormat: format,
        error: normalizeError(error, {
          code: "E_EXPORT_FAILED",
          stage: "export",
          userMessageKey: "errors.exportFailed",
          retryable: true,
          fallbackAllowed: false,
          safeContext: { jobId: job.id.slice(0, 24) },
        }),
      });
    }
  }
}
'''
)

Path("src/background/capture-completion-service.ts").write_text(
    r'''import type { ArtifactRecord } from "@shared/contracts/artifact";
import type {
  CaptureJob,
  CaptureSettings,
  ImageFormat,
  OutputFormat,
} from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import type { JobArtifactLookupPort } from "@storage/artifact-repository";

import { completionPolicyForJob } from "./capture-completion-policy";
import { captureOutputFromArtifact } from "./capture-output";
import type { PersistentJobCoordinatorPort } from "./job-coordinator";

export interface CompletionPdfExportPort {
  start(jobId: string, settings?: CaptureSettings["pdf"]): Promise<CaptureJob>;
  cancel(jobId: string): Promise<CaptureJob>;
  waitForIdle(jobId: string): Promise<void>;
}

export interface CompletionImageExportPort {
  start(jobId: string, format: ImageFormat, quality?: number): Promise<CaptureJob>;
  cancel(jobId: string): Promise<CaptureJob>;
  waitForIdle(jobId: string): Promise<void>;
}

export interface CaptureOutputStartOptions {
  format?: OutputFormat;
  pdfSettings?: CaptureSettings["pdf"];
  allowPartial?: boolean;
  automatic?: boolean;
}

export interface CaptureCompletionServiceOptions {
  jobs: PersistentJobCoordinatorPort;
  pdf: CompletionPdfExportPort;
  images: CompletionImageExportPort;
  artifacts: JobArtifactLookupPort;
}

function jobMissingError(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The capture job required for output no longer exists.",
      userMessageKey: "errors.jobNotFound",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "CaptureOutputJobMissing",
      safeContext: { jobId: jobId.slice(0, 24) },
    }),
  );
}

function partialConfirmationError(job: CaptureJob): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_EXPORT_FAILED",
      stage: "export",
      message: "Partial capture output requires explicit user confirmation.",
      userMessageKey: "errors.partialOutputConfirmation",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PartialOutputConfirmationRequired",
      safeContext: {
        jobId: job.id.slice(0, 24),
        reason: job.partialCapture?.reason ?? "unknown",
      },
    }),
  );
}

function newestOutput(records: ArtifactRecord[]): ArtifactRecord | undefined {
  return records
    .filter((record) => record.role === "output")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export class CaptureCompletionService {
  constructor(private readonly options: CaptureCompletionServiceOptions) {}

  async startAuto(jobId: string): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const policy = completionPolicyForJob(job);
    if (!policy.autoExport) return job;
    if (job.partialCapture !== undefined && job.partialCapture.reason !== "user-stop") return job;
    return this.start(jobId, { format: policy.primaryOutput, automatic: true });
  }

  async start(jobId: string, options: CaptureOutputStartOptions = {}): Promise<CaptureJob> {
    let job = await this.requireJob(jobId);
    if (job.state === "completed") return job;

    const reconciled = await this.reconcileExistingOutput(job);
    if (reconciled !== undefined) return reconciled;
    job = await this.requireJob(jobId);

    const automatic = options.automatic ?? false;
    if (
      automatic &&
      job.state === "failed" &&
      job.error?.causeCode !== "ServiceWorkerRestart"
    ) {
      return job;
    }
    if (
      job.partialCapture !== undefined &&
      job.partialCapture.reason !== "user-stop" &&
      options.allowPartial !== true
    ) {
      throw partialConfirmationError(job);
    }

    const format = options.format ?? completionPolicyForJob(job).primaryOutput;
    if (format === "pdf") {
      return this.options.pdf.start(jobId, options.pdfSettings);
    }
    return this.options.images.start(jobId, format, job.settings.imageQuality);
  }

  async recover(jobId: string): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const reconciled = await this.reconcileExistingOutput(job);
    if (reconciled !== undefined) return reconciled;
    if (job.state === "ready") return this.startAuto(job.id);
    if (job.state === "failed" && job.error?.causeCode === "ServiceWorkerRestart") {
      return this.startAuto(job.id);
    }
    return job;
  }

  async recoverAll(): Promise<CaptureJob[]> {
    const jobs = (await this.options.jobs.listActive?.()) ?? [];
    const candidates = jobs.filter((job) => job.state === "ready" || job.state === "failed");
    const settled = await Promise.allSettled(candidates.map((job) => this.recover(job.id)));
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }

  async cancel(jobId: string): Promise<CaptureJob> {
    const job = await this.requireJob(jobId);
    const format = job.activeOutputFormat ?? completionPolicyForJob(job).primaryOutput;
    return format === "pdf"
      ? this.options.pdf.cancel(jobId)
      : this.options.images.cancel(jobId);
  }

  async waitForIdle(jobId: string): Promise<void> {
    await Promise.all([
      this.options.pdf.waitForIdle(jobId),
      this.options.images.waitForIdle(jobId),
    ]);
  }

  private async requireJob(jobId: string): Promise<CaptureJob> {
    const job = await this.options.jobs.get(jobId);
    if (job === undefined) throw jobMissingError(jobId);
    return job;
  }

  private async reconcileExistingOutput(job: CaptureJob): Promise<CaptureJob | undefined> {
    if (!["ready", "failed", "exporting"].includes(job.state)) return undefined;
    const artifact = newestOutput(await this.options.artifacts.listByJob(job.id));
    if (artifact === undefined) return undefined;
    const totalPages = artifact.format === "pdf" ? (artifact.pageCount ?? 1) : 1;
    let exporting = job;
    if (job.state !== "exporting") {
      exporting = await this.options.jobs.transition(
        job.id,
        "exporting",
        {
          activeOutputFormat: artifact.format,
          exportProgress: { completedPages: 0, totalPages },
        },
        { sourceArtifactExists: true },
      );
    }
    return this.options.jobs.transition(exporting.id, "completed", {
      activeOutputFormat: artifact.format,
      outputArtifactId: artifact.artifactId,
      output: captureOutputFromArtifact(artifact),
      exportProgress: { completedPages: totalPages, totalPages },
    });
  }
}
'''
)

Path("tests/unit/capture-completion-policy.test.ts").write_text(
    r'''import { describe, expect, it } from "vitest";

import { createCaptureCompletionPolicy } from "@background/capture-completion-policy";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

describe("capture completion policy", () => {
  it("defaults full-page and scroll-area captures to automatic PDF", () => {
    expect(createCaptureCompletionPolicy("full-page", DEFAULT_CAPTURE_SETTINGS)).toMatchObject({
      primaryOutput: "pdf",
      autoExport: true,
      openEditorAfterCapture: false,
    });
    expect(createCaptureCompletionPolicy("scroll-area", DEFAULT_CAPTURE_SETTINGS)).toMatchObject({
      primaryOutput: "pdf",
      autoExport: true,
    });
  });

  it("uses the selected safe image format for region and element captures", () => {
    const settings = { ...DEFAULT_CAPTURE_SETTINGS, outputFormat: "webp" as const };
    expect(createCaptureCompletionPolicy("region", settings)).toEqual({
      primaryOutput: "webp",
      autoExport: true,
      openEditorAfterCapture: false,
      allowGuardedImageFallback: true,
    });
    expect(createCaptureCompletionPolicy("element", settings).primaryOutput).toBe("webp");
  });
});
'''
)

Path("tests/unit/tiled-image-export-service.test.ts").write_text(
    r'''import { describe, expect, it, vi } from "vitest";

import { TiledImageExportService } from "@background/tiled-image-export-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { CaptureJob, CaptureTile, JobState } from "@shared/contracts/domain";
import { createWebCapError, createWebCapRuntimeError } from "@shared/errors/error";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const NOW = new Date("2026-08-05T09:00:00.000Z");

function tile(): CaptureTile {
  return {
    id: "job:0",
    jobId: "job",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
    outputRectCss: { x: 0, y: 0, width: 100, height: 100 },
    expectedPixelWidth: 100,
    expectedPixelHeight: 100,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    status: "stored",
    attempts: 1,
  };
}

function readyJob(): CaptureJob {
  const planned = tile();
  return {
    schemaVersion: 1,
    id: "job",
    tabId: 1,
    windowId: 2,
    source: { createdAt: NOW.toISOString(), title: "Region" },
    mode: "region",
    preferredEngine: "cdp",
    state: "ready",
    stateRevision: 4,
    targetRect: { x: 0, y: 0, width: 100, height: 100 },
    tilePlan: [planned],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: true, completed: true },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: "2026-08-05T09:30:00.000Z",
  };
}

function harness(initial = readyJob()): {
  jobs: PersistentJobCoordinatorPort;
  current(): CaptureJob;
  transitions: JobState[];
} {
  let current = structuredClone(initial);
  const transitions: JobState[] = [];
  return {
    jobs: {
      get: () => Promise.resolve(structuredClone(current)),
      transition: (_id, state, patch = {}) => {
        transitions.push(state);
        current = {
          ...current,
          ...patch,
          state,
          stateRevision: current.stateRevision + 1,
          updatedAt: NOW.toISOString(),
        };
        return Promise.resolve(structuredClone(current));
      },
    } as PersistentJobCoordinatorPort,
    current: () => structuredClone(current),
    transitions,
  };
}

function artifact(): ArtifactMetadata {
  return {
    artifactId: "output",
    sourceArtifactId: "job",
    format: "png",
    mimeType: "image/png",
    filename: "region.png",
    byteLength: 3,
    width: 100,
    height: 100,
    createdAt: NOW.toISOString(),
    expiresAt: "2026-08-05T09:30:00.000Z",
  };
}

describe("TiledImageExportService", () => {
  it("transitions through exporting and stores durable output metadata", async () => {
    const state = harness();
    const service = new TiledImageExportService({
      jobs: state.jobs,
      offscreen: { exportTiledImage: () => Promise.resolve(artifact()) },
      now: () => NOW,
      createId: () => "output",
    });

    const started = await service.start("job", "png");
    expect(started).toMatchObject({ state: "exporting", activeOutputFormat: "png" });
    await vi.waitFor(() => expect(state.current().state).toBe("completed"));
    expect(state.current()).toMatchObject({
      outputArtifactId: "output",
      output: { artifactId: "output", format: "png", byteLength: 3 },
      exportProgress: { completedPages: 1, totalPages: 1 },
    });
    expect(state.transitions).toEqual(["exporting", "completed"]);
  });

  it("preserves a typed safe-canvas fallback failure", async () => {
    const state = harness();
    const service = new TiledImageExportService({
      jobs: state.jobs,
      offscreen: {
        exportTiledImage: () =>
          Promise.reject(
            createWebCapRuntimeError(
              createWebCapError({
                code: "E_IMAGE_OUTPUT_TOO_LARGE",
                stage: "export",
                message: "too large",
                userMessageKey: "errors.imageOutputTooLarge",
                retryable: true,
                fallbackAllowed: true,
                causeCode: "ImageCanvasDimensionGuard",
              }),
            ),
      },
      now: () => NOW,
    });

    await service.start("job", "png");
    await vi.waitFor(() => expect(state.current().state).toBe("failed"));
    expect(state.current().error).toMatchObject({
      code: "E_IMAGE_OUTPUT_TOO_LARGE",
      fallbackAllowed: true,
      causeCode: "ImageCanvasDimensionGuard",
    });
  });
});
'''
)

Path("tests/unit/capture-completion-service.test.ts").write_text(
    r'''import { describe, expect, it, vi } from "vitest";

import { CaptureCompletionService } from "@background/capture-completion-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { ArtifactRecord } from "@shared/contracts/artifact";
import type { CaptureJob, JobState } from "@shared/contracts/domain";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const NOW = "2026-08-05T10:00:00.000Z";

function readyJob(mode: CaptureJob["mode"] = "full-page"): CaptureJob {
  return {
    schemaVersion: 1,
    id: "job",
    tabId: 1,
    windowId: 2,
    source: { createdAt: NOW },
    mode,
    preferredEngine: "scroll",
    state: "ready",
    stateRevision: 4,
    targetRect: { x: 0, y: 0, width: 100, height: 100 },
    tilePlan: [
      {
        id: "job:0",
        jobId: "job",
        index: 0,
        row: 0,
        column: 0,
        sourceRectCss: { x: 0, y: 0, width: 100, height: 100 },
        expectedPixelWidth: 100,
        expectedPixelHeight: 100,
        overlapTopCss: 0,
        overlapLeftCss: 0,
        status: "stored",
        attempts: 1,
      },
    ],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: true, completed: true },
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: "2026-08-05T10:30:00.000Z",
  };
}

function harness(initial: CaptureJob): {
  jobs: PersistentJobCoordinatorPort;
  current(): CaptureJob;
  transitions: JobState[];
} {
  let current = structuredClone(initial);
  const transitions: JobState[] = [];
  return {
    jobs: {
      get: () => Promise.resolve(structuredClone(current)),
      listActive: () => Promise.resolve([structuredClone(current)]),
      transition: (_id, state, patch = {}) => {
        transitions.push(state);
        current = {
          ...current,
          ...patch,
          state,
          stateRevision: current.stateRevision + 1,
          updatedAt: NOW,
        };
        return Promise.resolve(structuredClone(current));
      },
    } as PersistentJobCoordinatorPort,
    current: () => structuredClone(current),
    transitions,
  };
}

function outputRecord(): ArtifactRecord {
  return {
    artifactId: "output",
    sourceArtifactId: "job",
    jobId: "job",
    role: "output",
    format: "pdf",
    mimeType: "application/pdf",
    filename: "capture.pdf",
    byteLength: 100,
    width: 595,
    height: 842,
    pageCount: 2,
    createdAt: NOW,
    expiresAt: "2026-08-05T10:30:00.000Z",
    blob: new Blob([new Uint8Array([1])], { type: "application/pdf" }),
  };
}

function service(initial: CaptureJob, records: ArtifactRecord[] = []) {
  const state = harness(initial);
  const pdfStart = vi.fn(() => Promise.resolve(state.current()));
  const imageStart = vi.fn(() => Promise.resolve(state.current()));
  const completion = new CaptureCompletionService({
    jobs: state.jobs,
    pdf: {
      start: pdfStart,
      cancel: () => Promise.resolve(state.current()),
      waitForIdle: () => Promise.resolve(),
    },
    images: {
      start: imageStart,
      cancel: () => Promise.resolve(state.current()),
      waitForIdle: () => Promise.resolve(),
    },
    artifacts: { listByJob: () => Promise.resolve(records) },
  });
  return { completion, state, pdfStart, imageStart };
}

describe("CaptureCompletionService", () => {
  it("routes complete full-page output to automatic PDF", async () => {
    const value = service(readyJob());
    await value.completion.startAuto("job");
    expect(value.pdfStart).toHaveBeenCalledWith("job", undefined);
    expect(value.imageStart).not.toHaveBeenCalled();
  });

  it("routes region output to the selected guarded image format", async () => {
    const job = readyJob("region");
    job.settings = { ...job.settings, outputFormat: "webp" };
    const value = service(job);
    await value.completion.startAuto("job");
    expect(value.imageStart).toHaveBeenCalledWith("job", "webp", job.settings.imageQuality);
  });

  it("does not auto-export a guard-limited partial capture", async () => {
    const job = readyJob();
    job.partialCapture = {
      reason: "max-tiles",
      capturedRect: { x: 0, y: 0, width: 100, height: 100 },
      limitValue: 1,
    };
    const value = service(job);
    await expect(value.completion.startAuto("job")).resolves.toMatchObject({ state: "ready" });
    expect(value.pdfStart).not.toHaveBeenCalled();
  });

  it("reconciles an already persisted output without exporting twice", async () => {
    const value = service(readyJob(), [outputRecord()]);
    await expect(value.completion.recover("job")).resolves.toMatchObject({
      state: "completed",
      outputArtifactId: "output",
      output: { format: "pdf", pageCount: 2 },
    });
    expect(value.state.transitions).toEqual(["exporting", "completed"]);
    expect(value.pdfStart).not.toHaveBeenCalled();
    expect(value.imageStart).not.toHaveBeenCalled();
  });
});
'''
)

replace_once(
    "src/shared/contracts/domain.ts",
    'export const OutputFormatSchema = z.enum(["png", "jpeg", "webp", "pdf"]);\nexport const ExportProgressSchema',
    '''export const OutputFormatSchema = z.enum(["png", "jpeg", "webp", "pdf"]);
export const CaptureCompletionPolicySchema = z
  .object({
    primaryOutput: OutputFormatSchema,
    autoExport: z.boolean(),
    openEditorAfterCapture: z.boolean(),
    allowGuardedImageFallback: z.boolean(),
  })
  .strict();
export const CaptureOutputSchema = z
  .object({
    artifactId: z.string().min(1).max(160),
    sourceArtifactId: z.string().min(1).max(160),
    format: OutputFormatSchema,
    mimeType: z.string().min(1).max(120),
    filename: z.string().min(1).max(180),
    byteLength: NonNegativeIntegerSchema,
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
    pageCount: PositiveIntegerSchema.optional(),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();
export const ExportProgressSchema''',
)
replace_once(
    "src/shared/contracts/domain.ts",
    '    settings: CaptureSettingsSchema,\n    cleanup: CleanupStateSchema,',
    '    settings: CaptureSettingsSchema,\n    completionPolicy: CaptureCompletionPolicySchema.optional(),\n    activeOutputFormat: OutputFormatSchema.optional(),\n    output: CaptureOutputSchema.optional(),\n    cleanup: CleanupStateSchema,',
)
replace_once(
    "src/shared/contracts/domain.ts",
    'export type OutputFormat = z.infer<typeof OutputFormatSchema>;\nexport type ExportProgress',
    'export type OutputFormat = z.infer<typeof OutputFormatSchema>;\nexport type CaptureCompletionPolicy = z.infer<typeof CaptureCompletionPolicySchema>;\nexport type CaptureOutput = z.infer<typeof CaptureOutputSchema>;\nexport type ExportProgress',
)

replace_once(
    "src/background/job-coordinator.ts",
    'import type { CaptureOwnedDataCleanupPort } from "./capture-data-cleanup-service";',
    'import type { CaptureOwnedDataCleanupPort } from "./capture-data-cleanup-service";\nimport { createCaptureCompletionPolicy } from "./capture-completion-policy";',
)
replace_once(
    "src/background/job-coordinator.ts",
    '      settings: options.settings,\n      cleanup: { attempted: false, completed: false },',
    '      settings: options.settings,\n      completionPolicy: createCaptureCompletionPolicy(options.mode, options.settings),\n      cleanup: { attempted: false, completed: false },',
)

replace_once(
    "src/background/job-state-machine.ts",
    '    | "exportProgress"\n    | "outputArtifactId"',
    '    | "exportProgress"\n    | "activeOutputFormat"\n    | "output"\n    | "outputArtifactId"',
)
replace_once(
    "src/background/job-state-machine.ts",
    '  if (job.cleanup.completed && !job.cleanup.attempted) {',
    '''  if (
    job.output !== undefined &&
    job.outputArtifactId !== undefined &&
    job.output.artifactId !== job.outputArtifactId
  ) {
    return err(
      stateError("Output metadata must match the persisted artifact ID.", "OutputArtifactMismatch", {
        outputArtifactId: job.outputArtifactId,
        metadataArtifactId: job.output.artifactId,
      }),
    );
  }

  if (job.cleanup.completed && !job.cleanup.attempted) {''',
)

replace_once(
    "src/storage/artifact-repository.ts",
    'export interface IndexedDbArtifactRepositoryOptions {',
    '''export interface JobArtifactLookupPort {
  listByJob(jobId: string): Promise<ArtifactRecord[]>;
}

export interface IndexedDbArtifactRepositoryOptions {''',
)
replace_once(
    "src/storage/artifact-repository.ts",
    'export class IndexedDbArtifactRepository implements ArtifactRepositoryPort {',
    'export class IndexedDbArtifactRepository implements ArtifactRepositoryPort, JobArtifactLookupPort {',
)
replace_once(
    "src/storage/artifact-repository.ts",
    '  async delete(artifactId: string): Promise<boolean> {',
    '''  async listByJob(jobId: string): Promise<ArtifactRecord[]> {
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(WEBCAP_STORES.artifacts, "readonly");
      const records = (await requestResult(
        transaction.objectStore(WEBCAP_STORES.artifacts).index("byJobId").getAll(jobId),
      )) as ArtifactRecord[];
      return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    } catch (error) {
      throw storageError("read", error);
    }
  }

  async delete(artifactId: string): Promise<boolean> {''',
)

replace_once(
    "src/background/pdf-export-service.ts",
    'import type { PersistentJobCoordinatorPort } from "./job-coordinator";',
    'import { captureOutputFromArtifact } from "./capture-output";\nimport type { PersistentJobCoordinatorPort } from "./job-coordinator";',
)
replace_once(
    "src/background/pdf-export-service.ts",
    '      {\n        error: undefined,\n        outputArtifactId: undefined,',
    '      {\n        activeOutputFormat: "pdf",\n        error: undefined,\n        output: undefined,\n        outputArtifactId: undefined,',
)
replace_once(
    "src/background/pdf-export-service.ts",
    '      await this.jobs.transition(job.id, "completed", {\n        outputArtifactId: artifact.artifactId,',
    '      await this.jobs.transition(job.id, "completed", {\n        activeOutputFormat: "pdf",\n        outputArtifactId: artifact.artifactId,\n        output: captureOutputFromArtifact(artifact),',
)
