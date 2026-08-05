import { describe, expect, it } from "vitest";

import { PdfEditorService } from "@background/pdf-editor-service";
import type { PersistentJobCoordinatorPort } from "@background/job-coordinator";
import type { CaptureJob, CaptureTile } from "@shared/contracts/domain";
import type { PdfEditManifest } from "@shared/contracts/pdf-editor";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";
import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";

const now = new Date("2026-08-03T13:40:00.000Z");

function tile(): CaptureTile {
  return {
    id: "job-1:0",
    jobId: "job-1",
    index: 0,
    row: 0,
    column: 0,
    sourceRectCss: { x: 0, y: 0, width: 900, height: 4_800 },
    outputRectCss: { x: 0, y: 0, width: 900, height: 4_800 },
    expectedPixelWidth: 900,
    expectedPixelHeight: 4_800,
    overlapTopCss: 0,
    overlapLeftCss: 0,
    overlapRightCss: 0,
    overlapBottomCss: 0,
    status: "stored",
    attempts: 1,
    byteLength: 2_000_000,
    mimeType: "image/png",
  };
}

function readyJob(): CaptureJob {
  const sourceTile = tile();
  return {
    schemaVersion: 1,
    id: "job-1",
    tabId: 7,
    windowId: 2,
    source: { title: "Quarterly report", createdAt: now.toISOString() },
    mode: "full-page",
    preferredEngine: "cdp",
    activeEngine: "cdp",
    state: "ready",
    stateRevision: 4,
    targetRect: { x: 0, y: 0, width: 900, height: 4_800 },
    tilePlan: [sourceTile],
    completedTiles: 1,
    totalTiles: 1,
    settings: DEFAULT_CAPTURE_SETTINGS,
    cleanup: { attempted: true, completed: true },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: "2026-08-03T14:30:00.000Z",
  };
}

function jobReader(job: CaptureJob): PersistentJobCoordinatorPort {
  return {
    get: () => Promise.resolve(structuredClone(job)),
  } as unknown as PersistentJobCoordinatorPort;
}

function manifestRepository(): PdfEditManifestRepositoryPort & {
  current: () => PdfEditManifest | undefined;
} {
  let manifest: PdfEditManifest | undefined;
  return {
    load: () => Promise.resolve(manifest === undefined ? undefined : structuredClone(manifest)),
    save: (next) => {
      manifest = structuredClone(next);
      return Promise.resolve();
    },
    delete: () => {
      manifest = undefined;
      return Promise.resolve();
    },
    current: () => (manifest === undefined ? undefined : structuredClone(manifest)),
  };
}

describe("PdfEditorService", () => {
  it("creates and restores a persistent manifest with an explicitly approximate estimate", async () => {
    const job = readyJob();
    const manifests = manifestRepository();
    const service = new PdfEditorService({ jobs: jobReader(job), manifests, now: () => now });

    const first = await service.get(job.id);
    const second = await service.get(job.id);

    expect(first.manifest.pages.length).toBeGreaterThan(1);
    expect(first.manifest.revision).toBe(0);
    expect(second.manifest).toEqual(first.manifest);
    expect(first.estimate).toMatchObject({
      approximate: true,
      sourceBytes: 2_000_000,
    });
    expect(first.estimate.estimatedBytes).toBeGreaterThan(0);
  });

  it("recomputes pages for settings and persists non-destructive remove/reorder edits", async () => {
    const job = readyJob();
    const manifests = manifestRepository();
    const service = new PdfEditorService({ jobs: jobReader(job), manifests, now: () => now });
    const initial = await service.get(job.id);

    const settings = await service.update(job.id, initial.manifest.revision, {
      kind: "settings",
      settings: {
        pageSize: "letter",
        orientation: "landscape",
        marginMm: 12,
        jpegQuality: 0.75,
      },
    });
    const selected = [settings.manifest.pages.at(-1)?.id, settings.manifest.pages[0]?.id].filter(
      (value): value is string => value !== undefined,
    );
    const edited = await service.update(job.id, settings.manifest.revision, {
      kind: "pages",
      pageIds: selected,
    });

    expect(settings.manifest.revision).toBe(1);
    expect(settings.manifest.settings).toMatchObject({
      pageSize: "letter",
      orientation: "landscape",
      marginMm: 12,
      jpegQuality: 0.75,
    });
    expect(edited.manifest.revision).toBe(2);
    expect(edited.manifest.pages.map((page) => page.id)).toEqual(selected);
    expect(job.tilePlan).toHaveLength(1);
    expect(job.tilePlan[0]?.status).toBe("stored");
    expect(manifests.current()?.pages.map((page) => page.id)).toEqual(selected);
  });

  it("reopens a completed auto-PDF on the first edit and removes the stale artifact", async () => {
    const base = readyJob();
    let current: CaptureJob = {
      ...base,
      state: "completed",
      stateRevision: 6,
      activeOutputFormat: "pdf",
      outputArtifactId: "auto-pdf",
      output: {
        artifactId: "auto-pdf",
        sourceArtifactId: base.id,
        format: "pdf",
        mimeType: "application/pdf",
        filename: "auto.pdf",
        byteLength: 4_096,
        width: 595,
        height: 842,
        pageCount: 3,
        createdAt: now.toISOString(),
        expiresAt: base.expiresAt,
      },
      exportProgress: { completedPages: 3, totalPages: 3 },
    };
    const deleted: string[] = [];
    const jobs = {
      get: () => Promise.resolve(structuredClone(current)),
      transition: (_jobId: string, state: CaptureJob["state"], patch = {}) => {
        current = {
          ...current,
          ...patch,
          state,
          stateRevision: current.stateRevision + 1,
          updatedAt: now.toISOString(),
        };
        return Promise.resolve(structuredClone(current));
      },
    } as unknown as PersistentJobCoordinatorPort;
    const manifests = manifestRepository();
    const service = new PdfEditorService({
      jobs,
      manifests,
      artifacts: {
        delete: (artifactId) => {
          deleted.push(artifactId);
          return Promise.resolve(true);
        },
      },
      now: () => now,
    });
    const initial = await service.get(current.id);

    const edited = await service.update(current.id, initial.manifest.revision, {
      kind: "settings",
      settings: { ...initial.manifest.settings, pageSize: "letter" },
    });

    expect(edited.job).toMatchObject({
      state: "ready",
      outputArtifactId: undefined,
      output: undefined,
      exportProgress: undefined,
    });
    expect(edited.manifest.revision).toBe(1);
    expect(deleted).toEqual(["auto-pdf"]);
    expect(current.tilePlan).toEqual(base.tilePlan);
  });

  it("rejects stale revisions and page identifiers outside the current manifest", async () => {
    const job = readyJob();
    const manifests = manifestRepository();
    const service = new PdfEditorService({ jobs: jobReader(job), manifests, now: () => now });
    const initial = await service.get(job.id);

    await service.update(job.id, initial.manifest.revision, {
      kind: "pages",
      pageIds: initial.manifest.pages.map((page) => page.id).reverse(),
    });
    await expect(
      service.update(job.id, initial.manifest.revision, {
        kind: "pages",
        pageIds: ["page-missing"],
      }),
    ).rejects.toMatchObject({
      name: "E_PROTOCOL_MESSAGE",
      data: { causeCode: "PdfEditRevisionConflict" },
    });

    const current = manifests.current();
    expect(current).toBeDefined();
    await expect(
      service.update(job.id, current?.revision ?? 0, {
        kind: "pages",
        pageIds: ["page-missing"],
      }),
    ).rejects.toMatchObject({
      name: "E_PROTOCOL_MESSAGE",
      data: { causeCode: "PdfEditPageMissing" },
    });
  });
});
