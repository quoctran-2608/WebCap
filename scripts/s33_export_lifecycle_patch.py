from pathlib import Path


def patch(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


# Dedicated PDF manifest can pause/resume writing without resetting written-page progress.
patch(
    "src/background/pdf-capture-orchestrator.ts",
    '  recordFailure(jobId: string, error: WebCapErrorData): Promise<void>;\n  getManifest',
    '  recordPause?(jobId: string, error: WebCapErrorData): Promise<void>;\n  recordFailure(jobId: string, error: WebCapErrorData): Promise<void>;\n  getManifest',
)
patch(
    "src/background/pdf-capture-orchestrator.ts",
    '''    if (manifest.state === "completed") {\n      const now = this.now();''',
    '''    if (manifest.state === "paused") {\n      if (!sameOutputPlan(manifest.outputPlan, outputPlan)) {\n        throw pdfError(\n          "A paused PDF export cannot resume with a different verified output plan.",\n          "PdfOutputPlanChanged",\n          { jobId: job.id.slice(0, 24) },\n        );\n      }\n      const now = this.now();\n      const writing = transitionPdfManifest(manifest, "writing", now.toISOString(), {\n        outputState: "writing",\n        error: undefined,\n        expiresAt: addMilliseconds(now, this.manifestTtlMs),\n      });\n      if (!writing.ok) throw createWebCapRuntimeError(writing.error);\n      await this.manifests.save(writing.value, manifest.revision);\n      return writing.value;\n    }\n\n    if (manifest.state === "completed") {\n      const now = this.now();''',
)
patch(
    "src/background/pdf-capture-orchestrator.ts",
    '''  async recordFailure(jobId: string, error: WebCapErrorData): Promise<void> {''',
    '''  async recordPause(jobId: string, error: WebCapErrorData): Promise<void> {\n    const manifest = await this.manifests.get(jobId);\n    if (\n      manifest === undefined ||\n      manifest.state === "completed" ||\n      manifest.state === "cancelled" ||\n      manifest.state === "failed"\n    ) {\n      return;\n    }\n    if (manifest.state === "paused") {\n      const now = this.now();\n      const updated = updatePdfManifest(manifest, now.toISOString(), {\n        error,\n        expiresAt: addMilliseconds(now, this.manifestTtlMs),\n      });\n      if (!updated.ok) throw createWebCapRuntimeError(updated.error);\n      await this.manifests.save(updated.value, manifest.revision);\n      return;\n    }\n    const now = this.now();\n    const paused = transitionPdfManifest(manifest, "paused", now.toISOString(), {\n      error,\n      expiresAt: addMilliseconds(now, this.manifestTtlMs),\n    });\n    if (!paused.ok) throw createWebCapRuntimeError(paused.error);\n    await this.manifests.save(paused.value, manifest.revision);\n  }\n\n  async recordFailure(jobId: string, error: WebCapErrorData): Promise<void> {''',
)

# Stable output IDs and paused/exporting recovery in PdfExportService.
p = Path("src/background/pdf-export-service.ts")
text = p.read_text()
old = '''    if (current.state === "completed" && current.outputArtifactId !== undefined) return current;\n    if (current.state === "exporting") return current;\n    if (!["ready", "failed"].includes(current.state) || current.targetRect === undefined) {\n      throw jobNotReadyError(current);\n    }'''
new = '''    if (current.state === "completed" && current.outputArtifactId !== undefined) return current;\n    if (current.state === "exporting" && this.operations.has(jobId)) return current;\n    const resumablePaused =\n      current.state === "paused" &&\n      current.activeOutputFormat === "pdf" &&\n      current.exportProgress !== undefined;\n    if (\n      !["ready", "failed", "exporting"].includes(current.state) &&\n      !resumablePaused\n    ) {\n      throw jobNotReadyError(current);\n    }\n    if (current.targetRect === undefined) throw jobNotReadyError(current);'''
if old not in text:
    raise SystemExit("pdf export start-state marker missing")
text = text.replace(old, new, 1)
old = '''    this.cancelledJobs.delete(jobId);\n    const exporting = await this.jobs.transition(\n      jobId,\n      "exporting",\n      {\n        activeOutputFormat: "pdf",\n        error: undefined,\n        output: undefined,\n        outputArtifactId: undefined,\n        exportProgress: { completedPages: 0, totalPages },\n      },\n      { sourceArtifactExists: true },\n    );'''
new = '''    this.cancelledJobs.delete(jobId);\n    const outputArtifactId = current.outputArtifactId ?? this.createId();\n    const preservedProgress =\n      current.exportProgress?.totalPages === totalPages\n        ? current.exportProgress\n        : { completedPages: 0, totalPages };\n    let exporting: CaptureJob;\n    if (current.state === "exporting") {\n      exporting =\n        current.outputArtifactId === outputArtifactId\n          ? current\n          : await this.jobs.update(jobId, { outputArtifactId });\n    } else {\n      exporting = await this.jobs.transition(\n        jobId,\n        "exporting",\n        {\n          activeOutputFormat: "pdf",\n          error: undefined,\n          output: undefined,\n          outputArtifactId,\n          exportProgress: resumablePaused\n            ? preservedProgress\n            : { completedPages: 0, totalPages },\n        },\n        { sourceArtifactExists: true },\n      );\n    }'''
if old not in text:
    raise SystemExit("pdf export transition marker missing")
text = text.replace(old, new, 1)
text = text.replace(
    '    const outputArtifactId = this.createId();\n    try {',
    '    const outputArtifactId = job.outputArtifactId;\n    if (outputArtifactId === undefined) {\n      throw exportSourceError(job.id, "PdfOutputArtifactIdMissing");\n    }\n    try {',
    1,
)
old = '''      await this.pdfDocuments?.recordFailure(job.id, normalized).catch(() => undefined);\n      await this.jobs.transition(job.id, "failed", {\n        activeOutputFormat: "pdf",\n        error: normalized,\n      });'''
new = '''      const resumable =\n        normalized.retryable &&\n        (normalized.code === "E_STORAGE_QUOTA" ||\n          normalized.code === "E_STORAGE_WRITE" ||\n          normalized.code === "E_OFFSCREEN_UNAVAILABLE");\n      if (resumable) {\n        await this.pdfDocuments?.recordPause?.(job.id, normalized).catch(() => undefined);\n        await this.jobs.transition(job.id, "paused", {\n          activeOutputFormat: "pdf",\n          error: normalized,\n        });\n        return;\n      }\n      await this.pdfDocuments?.recordFailure(job.id, normalized).catch(() => undefined);\n      await this.jobs.transition(job.id, "failed", {\n        activeOutputFormat: "pdf",\n        error: normalized,\n      });'''
if old not in text:
    raise SystemExit("pdf export failure marker missing")
text = text.replace(old, new, 1)
p.write_text(text)

# Completion recovery reconciles existing output first, otherwise restarts paused/exporting PDF output.
p = Path("src/background/capture-completion-service.ts")
text = p.read_text()
text = text.replace(
    '    if (job.state === "ready") return this.startAuto(job.id);\n    if (job.state === "failed" && job.error?.causeCode === "ServiceWorkerRestart") {\n      return this.startAuto(job.id);\n    }',
    '    if (job.state === "ready") return this.startAuto(job.id);\n    if (\n      job.activeOutputFormat === "pdf" &&\n      (job.state === "exporting" || job.state === "paused")\n    ) {\n      return this.options.pdf.start(job.id);\n    }\n    if (job.state === "failed" && job.error?.causeCode === "ServiceWorkerRestart") {\n      return this.startAuto(job.id);\n    }',
    1,
)
text = text.replace(
    '    const candidates = jobs.filter((job) => job.state === "ready" || job.state === "failed");',
    '    const candidates = jobs.filter(\n      (job) =>\n        job.state === "ready" ||\n        job.state === "failed" ||\n        (job.activeOutputFormat === "pdf" &&\n          (job.state === "exporting" || job.state === "paused")),\n    );',
    1,
)
text = text.replace(
    '    if (!["ready", "failed", "exporting"].includes(job.state)) return undefined;',
    '    if (!["ready", "failed", "exporting", "paused"].includes(job.state)) return undefined;',
    1,
)
text = text.replace(
    '          activeOutputFormat: artifact.format,\n          exportProgress: { completedPages: 0, totalPages },',
    '          activeOutputFormat: artifact.format,\n          error: undefined,\n          exportProgress: { completedPages: 0, totalPages },',
    1,
)
p.write_text(text)
