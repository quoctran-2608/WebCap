from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


replace(
    "src/background/capture-completion-service.ts",
    '''export class CaptureCompletionService {\n  private readonly pdfDocuments: PdfCaptureOrchestratorPort | undefined;''',
    '''export class CaptureCompletionService {\n  private readonly pdfDocuments: PdfCaptureOrchestratorPort | undefined;\n  private readonly recoveredPdfJobs = new Set<string>();''',
)
replace(
    "src/background/capture-completion-service.ts",
    '''    if (job.activeOutputFormat === "pdf" && (job.state === "exporting" || job.state === "paused")) {\n      return this.options.pdf.start(job.id);\n    }\n    if (job.state === "failed" && job.error?.causeCode === "ServiceWorkerRestart") {\n      return this.startAuto(job.id);\n    }''',
    '''    if (job.activeOutputFormat === "pdf" && (job.state === "exporting" || job.state === "paused")) {\n      if (job.state === "exporting" && this.recoveredPdfJobs.has(job.id)) return job;\n      this.recoveredPdfJobs.add(job.id);\n      try {\n        return await this.options.pdf.start(job.id);\n      } catch (error) {\n        this.recoveredPdfJobs.delete(job.id);\n        throw error;\n      }\n    }\n    if (job.state === "failed" && job.error?.causeCode === "ServiceWorkerRestart") {\n      if (this.recoveredPdfJobs.has(job.id)) return job;\n      this.recoveredPdfJobs.add(job.id);\n      try {\n        return await this.startAuto(job.id);\n      } catch (error) {\n        this.recoveredPdfJobs.delete(job.id);\n        throw error;\n      }\n    }''',
)

replace(
    "src/background/pdf-export-service.ts",
    '''    this.cancelledJobs.add(jobId);\n    return this.jobs.transition(jobId, "ready", {\n      exportProgress: job.exportProgress ?? { completedPages: 0, totalPages: 1 },\n    });''',
    '''    this.cancelledJobs.add(jobId);\n    return this.jobs.transition(jobId, "ready", {\n      activeOutputFormat: undefined,\n      outputArtifactId: undefined,\n      output: undefined,\n      error: undefined,\n      exportProgress: job.exportProgress ?? { completedPages: 0, totalPages: 1 },\n    });''',
)
