import { JOB_ABANDONED_TTL_MS, JOB_LOCK_LEASE_MS } from "@shared/constants";
import type {
  CaptureEngineKind,
  CaptureJob,
  CaptureMode,
  CaptureSettings,
  JobState,
} from "@shared/contracts/domain";
import { summarizeJob, type TabJobLock } from "@shared/contracts/job";
import {
  createWebCapError,
  createWebCapRuntimeError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";
import type { JobArtifactCleanupPort } from "@storage/job-artifact-cleanup-repository";
import type { CaptureOwnedDataCleanupPort } from "./capture-data-cleanup-service";
import { createCaptureCompletionPolicy } from "./capture-completion-policy";
import type { JobRepositoryPort } from "@storage/job-repository";
import type { JobSessionRepositoryPort } from "@storage/job-session-repository";
import type { TileRepositoryPort } from "@storage/tile-repository";

import {
  isTerminalJobState,
  transitionJob,
  updateJob,
  type JobInvariantContext,
  type JobTransitionPatch,
} from "./job-state-machine";

export interface CreatePersistentJobOptions {
  tabId: number;
  windowId: number;
  mode: CaptureMode;
  settings: CaptureSettings;
  preferredEngine?: CaptureEngineKind;
  source?: {
    title?: string;
    origin?: string;
  };
}

export interface JobCleanupPort {
  cleanup(job: CaptureJob): Promise<void>;
}

export interface JobCleanupReport {
  deletedJobs: number;
  skippedLeasedJobs: number;
  failedJobs: number;
  deletedTiles: number;
  deletedArtifacts: number;
  deletedManifests: number;
  clearedSessions: number;
}

export interface PersistentJobCoordinatorPort {
  initialize(): Promise<void>;
  create(options: CreatePersistentJobOptions): Promise<CaptureJob>;
  get(jobId: string): Promise<CaptureJob | undefined>;
  listActive?(): Promise<CaptureJob[]>;
  getActiveForTab?(tabId: number): Promise<CaptureJob | undefined>;
  update(
    jobId: string,
    patch: JobTransitionPatch,
    context?: JobInvariantContext,
  ): Promise<CaptureJob>;
  transition(
    jobId: string,
    nextState: JobState,
    patch?: JobTransitionPatch,
    context?: JobInvariantContext,
  ): Promise<CaptureJob>;
  cancel(jobId: string, reason?: string): Promise<CaptureJob>;
  cleanupExpired(): Promise<JobCleanupReport>;
}

export interface PersistentJobCoordinatorOptions {
  jobs: JobRepositoryPort;
  sessions: JobSessionRepositoryPort;
  tiles: TileRepositoryPort;
  artifacts: JobArtifactCleanupPort;
  cleanup?: JobCleanupPort;
  ownedDataCleanup?: CaptureOwnedDataCleanupPort;
  now?: () => Date;
  idFactory?: () => string;
}

const noOpCleanup: JobCleanupPort = {
  cleanup: () => Promise.resolve(),
};

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function preferredEngineFor(mode: CaptureMode): CaptureEngineKind {
  return mode === "visible" ? "scroll" : "cdp";
}

function jobNotFound(jobId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_STORAGE_READ",
      stage: "storage",
      message: "The requested capture job does not exist.",
      userMessageKey: "errors.jobNotFound",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "JobNotFound",
      safeContext: { jobId },
    }),
  );
}

function activeJobConflict(tabId: number, jobId?: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_CAPTURE_RATE_LIMIT",
      stage: "capture",
      message: "This tab already has an active capture job.",
      userMessageKey: "errors.activeJobConflict",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "ActiveJobConflict",
      safeContext: {
        tabId,
        ...(jobId === undefined ? {} : { jobId }),
      },
    }),
  );
}

function recoveryError(job: CaptureJob): WebCapErrorData {
  return createWebCapError({
    code: "E_UNKNOWN",
    stage: "storage",
    message: "The capture job was interrupted when the extension service worker restarted.",
    userMessageKey: "errors.jobInterrupted",
    retryable: true,
    fallbackAllowed: false,
    causeCode: "ServiceWorkerRestart",
    safeContext: { jobId: job.id, previousState: job.state },
  });
}

function cancellationError(jobId: string, reason?: string): WebCapErrorData {
  return createWebCapError({
    code: "E_CANCELLED",
    stage: "cleanup",
    message: "The capture job was cancelled.",
    userMessageKey: "errors.cancelled",
    retryable: true,
    fallbackAllowed: false,
    causeCode: "UserCancellation",
    safeContext: {
      jobId,
      ...(reason === undefined ? {} : { reason: reason.slice(0, 200) }),
    },
  });
}

export class PersistentJobCoordinator implements PersistentJobCoordinatorPort {
  private readonly jobs: JobRepositoryPort;
  private readonly sessions: JobSessionRepositoryPort;
  private readonly tiles: TileRepositoryPort;
  private readonly artifacts: JobArtifactCleanupPort;
  private readonly cleanup: JobCleanupPort;
  private readonly ownedDataCleanup: CaptureOwnedDataCleanupPort | undefined;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private initializationPromise: Promise<void> | undefined;

  constructor(options: PersistentJobCoordinatorOptions) {
    this.jobs = options.jobs;
    this.sessions = options.sessions;
    this.tiles = options.tiles;
    this.artifacts = options.artifacts;
    this.cleanup = options.cleanup ?? noOpCleanup;
    this.ownedDataCleanup = options.ownedDataCleanup;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  initialize(): Promise<void> {
    this.initializationPromise ??= this.initializeInternal();
    return this.initializationPromise;
  }

  async create(options: CreatePersistentJobOptions): Promise<CaptureJob> {
    await this.initialize();
    const activeJobs = await this.jobs.listActive();
    const existing = activeJobs.find((job) => job.tabId === options.tabId);
    if (existing !== undefined) {
      throw activeJobConflict(options.tabId, existing.id);
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const jobId = this.idFactory();
    const lock = this.createLock(options.tabId, jobId, now);
    const acquired = await this.sessions.acquireTabLock(lock, nowIso);
    if (!acquired) {
      throw activeJobConflict(options.tabId);
    }

    const job: CaptureJob = {
      schemaVersion: 1,
      id: jobId,
      tabId: options.tabId,
      windowId: options.windowId,
      source: {
        createdAt: nowIso,
        ...(options.source?.title === undefined ? {} : { title: options.source.title }),
        ...(options.source?.origin === undefined ? {} : { origin: options.source.origin }),
      },
      mode: options.mode,
      preferredEngine: options.preferredEngine ?? preferredEngineFor(options.mode),
      state: "created",
      stateRevision: 0,
      tilePlan: [],
      completedTiles: 0,
      totalTiles: 0,
      settings: options.settings,
      completionPolicy: createCaptureCompletionPolicy(options.mode, options.settings),
      cleanup: { attempted: false, completed: false },
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: addMilliseconds(now, JOB_ABANDONED_TTL_MS),
    };

    try {
      await this.jobs.create(job);
      await this.sessions.saveSummary(summarizeJob(job));
      return job;
    } catch (error) {
      await Promise.allSettled([
        this.jobs.delete(job.id),
        this.sessions.releaseTabLock(job.tabId, job.id),
      ]);
      throw error;
    }
  }

  async get(jobId: string): Promise<CaptureJob | undefined> {
    await this.initialize();
    return this.jobs.get(jobId);
  }

  async listActive(): Promise<CaptureJob[]> {
    await this.initialize();
    return this.jobs.listActive();
  }

  async getActiveForTab(tabId: number): Promise<CaptureJob | undefined> {
    await this.initialize();
    const active = (await this.jobs.listActive())
      .filter((job) => job.tabId === tabId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (active !== undefined) {
      return active;
    }

    // The popup uses this lookup to restore its current capture surface. Once output reaches
    // completed, it is no longer active, but the durable result must remain discoverable across
    // popup close/reopen cycles until reset or expiry removes the job and its summary.
    const summaries = (await this.sessions.listSummaries())
      .filter((summary) => summary.tabId === tabId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const summary of summaries) {
      const job = await this.jobs.get(summary.jobId);
      if (job !== undefined) {
        return job;
      }
    }
    return undefined;
  }

  async update(
    jobId: string,
    patch: JobTransitionPatch,
    context: JobInvariantContext = {},
  ): Promise<CaptureJob> {
    await this.initialize();
    const job = await this.jobs.get(jobId);
    if (job === undefined) {
      throw jobNotFound(jobId);
    }
    const now = this.now();
    const result = updateJob(
      job,
      now.toISOString(),
      {
        ...patch,
        expiresAt: patch.expiresAt ?? addMilliseconds(now, JOB_ABANDONED_TTL_MS),
      },
      context,
    );
    if (!result.ok) {
      throw createWebCapRuntimeError(result.error);
    }
    await this.jobs.save(result.value, job.stateRevision);
    await this.syncSession(result.value);
    return result.value;
  }

  async transition(
    jobId: string,
    nextState: JobState,
    patch: JobTransitionPatch = {},
    context: JobInvariantContext = {},
  ): Promise<CaptureJob> {
    await this.initialize();
    const job = await this.jobs.get(jobId);
    if (job === undefined) {
      throw jobNotFound(jobId);
    }
    return this.applyTransition(job, nextState, patch, context, true);
  }

  async cancel(jobId: string, reason?: string): Promise<CaptureJob> {
    await this.initialize();
    const job = await this.jobs.get(jobId);
    if (job === undefined) {
      throw jobNotFound(jobId);
    }
    return this.cancelExisting(job, reason, true);
  }

  async cleanupExpired(): Promise<JobCleanupReport> {
    await this.initialize();
    return this.cleanupExpiredInternal();
  }

  private async initializeInternal(): Promise<void> {
    await this.cleanupExpiredInternal();
    await this.recoverJobs(this.now().toISOString());
  }

  private async recoverJobs(nowIso: string): Promise<void> {
    const activeJobs = await this.jobs.listActive();
    const jobsByTab = new Map<number, CaptureJob[]>();
    for (const job of activeJobs) {
      const group = jobsByTab.get(job.tabId) ?? [];
      group.push(job);
      jobsByTab.set(job.tabId, group);
    }

    for (const [tabId, group] of jobsByTab) {
      group.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const existingLock = await this.sessions.getTabLock(tabId);
      const winner =
        group.find(
          (job) => existingLock?.jobId === job.id && existingLock.leaseExpiresAt > nowIso,
        ) ?? group[0];
      if (winner === undefined) {
        continue;
      }

      for (const duplicate of group) {
        if (duplicate.id !== winner.id) {
          await this.cancelExisting(duplicate, "duplicate active job recovered", false);
          await this.sessions.deleteJob(duplicate.id);
        }
      }

      const recovered = await this.recoverJob(winner);
      if (!isTerminalJobState(recovered.state)) {
        await this.syncSession(recovered);
      }
    }
  }

  private async recoverJob(job: CaptureJob): Promise<CaptureJob> {
    if (["created", "ready", "failed"].includes(job.state)) {
      return job;
    }

    const resumableAdaptiveJob =
      job.mode === "full-page" &&
      job.preferredEngine === "scroll" &&
      (job.state === "preparing" ||
        (job.state === "capturing" && job.adaptiveFrontier !== undefined));
    if (resumableAdaptiveJob) {
      return job;
    }

    if (job.state === "cancelling") {
      return this.finishCancellation(job, "service worker restart", true);
    }

    if (["preparing", "capturing", "processing", "exporting"].includes(job.state)) {
      const cleanup = await this.runCleanup(job);
      return this.applyTransition(
        job,
        "failed",
        {
          cleanup: cleanup.state,
          error: recoveryError(job),
        },
        {},
        true,
      );
    }

    return job;
  }

  private async cancelExisting(
    original: CaptureJob,
    reason: string | undefined,
    syncSession: boolean,
  ): Promise<CaptureJob> {
    if (isTerminalJobState(original.state)) {
      return original;
    }

    let job = original;
    if (job.state === "created") {
      job = await this.applyTransition(job, "preparing", {}, {}, syncSession);
    }

    if (job.state === "failed") {
      return this.finishCancellation(job, reason, syncSession);
    }

    if (job.state !== "cancelling") {
      job = await this.applyTransition(job, "cancelling", {}, {}, syncSession);
    }
    return this.finishCancellation(job, reason, syncSession);
  }

  private async finishCancellation(
    job: CaptureJob,
    reason: string | undefined,
    syncSession: boolean,
  ): Promise<CaptureJob> {
    const cleanup = await this.runCleanup(job);
    return this.applyTransition(
      job,
      "cancelled",
      {
        cleanup: cleanup.state,
        error: cleanup.error ?? cancellationError(job.id, reason),
      },
      {},
      syncSession,
    );
  }

  private async runCleanup(job: CaptureJob): Promise<{
    state: CaptureJob["cleanup"];
    error?: WebCapErrorData;
  }> {
    try {
      await this.cleanup.cleanup(job);
      return { state: { attempted: true, completed: true } };
    } catch (error) {
      const normalized = normalizeError(error, {
        stage: "cleanup",
        userMessageKey: "errors.cleanupPartial",
        retryable: true,
        fallbackAllowed: false,
      });
      return {
        state: { attempted: true, completed: false, error: normalized },
        error: normalized,
      };
    }
  }

  private async applyTransition(
    job: CaptureJob,
    nextState: JobState,
    patch: JobTransitionPatch,
    context: JobInvariantContext,
    syncSession: boolean,
  ): Promise<CaptureJob> {
    const now = this.now();
    const result = transitionJob(
      job,
      nextState,
      now.toISOString(),
      {
        ...patch,
        expiresAt: patch.expiresAt ?? addMilliseconds(now, JOB_ABANDONED_TTL_MS),
      },
      context,
    );
    if (!result.ok) {
      throw createWebCapRuntimeError(result.error);
    }

    await this.jobs.save(result.value, job.stateRevision);
    if (syncSession) {
      await this.syncSession(result.value);
    }
    return result.value;
  }

  private async syncSession(job: CaptureJob): Promise<void> {
    await this.sessions.saveSummary(summarizeJob(job));
    if (isTerminalJobState(job.state)) {
      await this.sessions.releaseTabLock(job.tabId, job.id);
      return;
    }

    const now = this.now();
    const acquired = await this.sessions.acquireTabLock(
      this.createLock(job.tabId, job.id, now),
      now.toISOString(),
    );
    if (!acquired) {
      throw activeJobConflict(job.tabId, job.id);
    }
  }

  private createLock(tabId: number, jobId: string, now: Date): TabJobLock {
    return {
      schemaVersion: 1,
      tabId,
      jobId,
      acquiredAt: now.toISOString(),
      leaseExpiresAt: addMilliseconds(now, JOB_LOCK_LEASE_MS),
    };
  }

  private async cleanupExpiredInternal(): Promise<JobCleanupReport> {
    const nowIso = this.now().toISOString();
    await this.sessions.clearExpiredLocks(nowIso);
    const expired = await this.jobs.listExpired(nowIso);
    const report: JobCleanupReport = {
      deletedJobs: 0,
      skippedLeasedJobs: 0,
      failedJobs: 0,
      deletedTiles: 0,
      deletedArtifacts: 0,
      deletedManifests: 0,
      clearedSessions: 0,
    };

    for (const job of expired) {
      const lock = await this.sessions.getTabLock(job.tabId);
      if (lock?.jobId === job.id && lock.leaseExpiresAt > nowIso) {
        report.skippedLeasedJobs += 1;
        continue;
      }

      try {
        if (this.ownedDataCleanup !== undefined) {
          const cleanup = await this.ownedDataCleanup.cleanupJob(job.id, job.tabId);
          report.deletedJobs += cleanup.deletedJobs;
          report.deletedTiles += cleanup.deletedTiles;
          report.deletedArtifacts += cleanup.deletedArtifacts;
          report.deletedManifests += cleanup.deletedManifests;
          report.clearedSessions += cleanup.clearedSessions;
          if (cleanup.warning !== undefined) report.failedJobs += 1;
        } else {
          report.deletedTiles += await this.tiles.deleteByJob(job.id);
          report.deletedArtifacts += await this.artifacts.deleteByJob(job.id);
          await this.jobs.delete(job.id);
          await this.sessions.deleteJob(job.id);
          report.deletedJobs += 1;
          report.clearedSessions += 1;
        }
      } catch {
        report.failedJobs += 1;
      }
    }

    return report;
  }
}
