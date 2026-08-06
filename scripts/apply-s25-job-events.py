from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing {label} marker: {old[:160]!r}")
    return text.replace(old, new, 1)


coordinator_path = Path("src/background/job-coordinator.ts")
coordinator = coordinator_path.read_text()
coordinator = replace_once(
    coordinator,
    'import { summarizeJob, type TabJobLock } from "@shared/contracts/job";',
    'import { summarizeJob, type JobSummary, type TabJobLock } from "@shared/contracts/job";',
    "coordinator job import",
)
coordinator = replace_once(
    coordinator,
    'import type { CaptureOwnedDataCleanupPort } from "./capture-data-cleanup-service";\n',
    'import type { CaptureOwnedDataCleanupPort } from "./capture-data-cleanup-service";\nimport type { JobSummaryEventPublisherPort } from "./job-event-publisher";\n',
    "coordinator event import",
)
coordinator = replace_once(
    coordinator,
    '  ownedDataCleanup?: CaptureOwnedDataCleanupPort;\n  now?: () => Date;\n',
    '  ownedDataCleanup?: CaptureOwnedDataCleanupPort;\n  events?: JobSummaryEventPublisherPort;\n  now?: () => Date;\n',
    "coordinator options",
)
coordinator = replace_once(
    coordinator,
    '  private readonly ownedDataCleanup: CaptureOwnedDataCleanupPort | undefined;\n  private readonly now: () => Date;\n',
    '  private readonly ownedDataCleanup: CaptureOwnedDataCleanupPort | undefined;\n  private readonly events: JobSummaryEventPublisherPort | undefined;\n  private readonly now: () => Date;\n',
    "coordinator property",
)
coordinator = replace_once(
    coordinator,
    '    this.ownedDataCleanup = options.ownedDataCleanup;\n    this.now = options.now ?? (() => new Date());\n',
    '    this.ownedDataCleanup = options.ownedDataCleanup;\n    this.events = options.events;\n    this.now = options.now ?? (() => new Date());\n',
    "coordinator constructor",
)
coordinator = replace_once(
    coordinator,
    '      await this.jobs.create(job);\n      await this.sessions.saveSummary(summarizeJob(job));\n      return job;\n',
    '      await this.jobs.create(job);\n      const summary = summarizeJob(job);\n      await this.sessions.saveSummary(summary);\n      await this.publishSummary(summary);\n      return job;\n',
    "coordinator create summary",
)
coordinator = replace_once(
    coordinator,
    '''  private async syncSession(job: CaptureJob): Promise<void> {
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

  private createLock''',
    '''  private async syncSession(job: CaptureJob): Promise<void> {
    const summary = summarizeJob(job);
    await this.sessions.saveSummary(summary);
    if (isTerminalJobState(job.state)) {
      await this.sessions.releaseTabLock(job.tabId, job.id);
      await this.publishSummary(summary);
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
    await this.publishSummary(summary);
  }

  private async publishSummary(summary: JobSummary): Promise<void> {
    try {
      await this.events?.publish(summary);
    } catch {
      // Durable session state remains authoritative when no popup listener exists.
    }
  }

  private createLock''',
    "coordinator sync session",
)
coordinator_path.write_text(coordinator)


router_path = Path("src/background/persistent-job-router.ts")
router = router_path.read_text()
router = replace_once(
    router,
    'import { FullPageCaptureCoordinator } from "@background/full-page-capture-coordinator";\n',
    'import { FullPageCaptureCoordinator } from "@background/full-page-capture-coordinator";\nimport { ChromeJobSummaryEventPublisher } from "@background/job-event-publisher";\n',
    "router publisher import",
)
router = replace_once(
    router,
    '    ownedDataCleanup,\n    cleanup: {\n',
    '    ownedDataCleanup,\n    events: new ChromeJobSummaryEventPublisher(),\n    cleanup: {\n',
    "router publisher injection",
)
router_path.write_text(router)


app_path = Path("src/popup/App.tsx")
app = app_path.read_text()
app = replace_once(
    app,
    'import { estimateOutputBytes, formatBytes } from "./formatting";\n',
    'import { estimateOutputBytes, formatBytes } from "./formatting";\nimport { subscribeToJobSummaryChanges } from "./job-events-client";\n',
    "App event import",
)
app = replace_once(
    app,
    'const SESSION_POLL_MS = 350;\n',
    'const RECONCILIATION_POLL_MS = 7_500;\n',
    "App reconciliation constant",
)
app = app.replace('    }, SESSION_POLL_MS);', '    }, RECONCILIATION_POLL_MS);')
old_tiled_effect = '''  useEffect(() => {
    if (!fullPageBusy || fullPageJob === undefined) {
      return;
    }

    const timer = globalThis.setInterval(() => {
      void syncFullPageJob(fullPageJob.id).catch((error: unknown) => {
        setUiError(genericErrorCopy(locale, error));
      });
    }, RECONCILIATION_POLL_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [fullPageBusy, fullPageJob, locale, syncFullPageJob]);
'''
new_tiled_effect = '''  useEffect(() => {
    if (
      workerStatus !== "connected" ||
      tabCapability.tabId === undefined ||
      fullPageJob === undefined
    ) {
      return;
    }

    let latestRevision = fullPageJob.stateRevision;
    return subscribeToJobSummaryChanges((summary) => {
      if (
        summary.tabId !== tabCapability.tabId ||
        summary.jobId !== fullPageJob.id ||
        summary.stateRevision <= latestRevision
      ) {
        return;
      }
      latestRevision = summary.stateRevision;
      void syncFullPageJob(summary.jobId).catch((error: unknown) => {
        setUiError(genericErrorCopy(locale, error));
      });
    });
  }, [fullPageJob, locale, syncFullPageJob, tabCapability.tabId, workerStatus]);

  useEffect(() => {
    if (!fullPageBusy || fullPageJob === undefined) {
      return;
    }

    const jobId = fullPageJob.id;
    const timer = globalThis.setInterval(() => {
      void syncFullPageJob(jobId).catch((error: unknown) => {
        setUiError(genericErrorCopy(locale, error));
      });
    }, RECONCILIATION_POLL_MS);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [fullPageBusy, fullPageJob?.id, locale, syncFullPageJob]);
'''
app = replace_once(app, old_tiled_effect, new_tiled_effect, "App tiled polling effect")
app_path.write_text(app)


test_path = Path("tests/unit/job-coordinator.test.ts")
test = test_path.read_text()
test = replace_once(
    test,
    'import { PersistentJobCoordinator, type JobCleanupPort } from "@background/job-coordinator";\n',
    'import { PersistentJobCoordinator, type JobCleanupPort } from "@background/job-coordinator";\nimport type { JobSummaryEventPublisherPort } from "@background/job-event-publisher";\n',
    "coordinator test import",
)
test = replace_once(
    test,
    '''    cleanup?: JobCleanupPort;
    id?: string;
  } = {},
) {''',
    '''    cleanup?: JobCleanupPort;
    events?: JobSummaryEventPublisherPort;
    id?: string;
  } = {},
) {''',
    "coordinator test options",
)
test = replace_once(
    test,
    '''  const artifacts = new MemoryArtifacts();
  const coordinator = new PersistentJobCoordinator({''',
    '''  const artifacts = new MemoryArtifacts();
  const published: JobSummary[] = [];
  const events: JobSummaryEventPublisherPort =
    options.events ?? {
      publish(summary) {
        published.push(structuredClone(summary));
        return Promise.resolve();
      },
    };
  const coordinator = new PersistentJobCoordinator({''',
    "coordinator test publisher",
)
test = replace_once(
    test,
    '    artifacts,\n    now: () => options.now ?? new Date("2026-08-02T16:02:00.000Z"),\n',
    '    artifacts,\n    events,\n    now: () => options.now ?? new Date("2026-08-02T16:02:00.000Z"),\n',
    "coordinator test injection",
)
test = replace_once(
    test,
    '  return { coordinator, jobs, sessions, tiles, artifacts };\n',
    '  return { coordinator, jobs, sessions, tiles, artifacts, published };\n',
    "coordinator test return",
)
test = replace_once(
    test,
    '    const { coordinator, sessions } = setup();\n',
    '    const { coordinator, sessions, published } = setup();\n',
    "coordinator create test destructure",
)
test = replace_once(
    test,
    '    expect(sessions.summaries.get(created.id)).toEqual(summarizeJob(created));\n    expect(sessions.locks.get(7)).toMatchObject({ jobId: created.id });\n',
    '    expect(sessions.summaries.get(created.id)).toEqual(summarizeJob(created));\n    expect(sessions.locks.get(7)).toMatchObject({ jobId: created.id });\n    expect(published).toEqual([summarizeJob(created)]);\n',
    "coordinator create event assertion",
)
insert_marker = '  it("prefers an active job and restores the latest durable terminal job for a tab", async () => {\n'
event_test = '''  it("keeps durable transitions successful when event delivery fails", async () => {
    let eventCalls = 0;
    const { coordinator, sessions } = setup({
      events: {
        publish() {
          eventCalls += 1;
          return Promise.reject(new Error("popup closed"));
        },
      },
    });
    const created = await coordinator.create({
      tabId: 7,
      windowId: 2,
      mode: "full-page",
      settings: DEFAULT_CAPTURE_SETTINGS,
    });

    const preparing = await coordinator.transition(created.id, "preparing");

    expect(preparing).toMatchObject({ state: "preparing", stateRevision: 1 });
    expect(sessions.summaries.get(created.id)).toEqual(summarizeJob(preparing));
    expect(eventCalls).toBe(2);
  });

'''
test = replace_once(test, insert_marker, event_test + insert_marker, "coordinator event test")
test_path.write_text(test)


e2e_path = Path("tests/e2e/popup-settings.spec.ts")
e2e = e2e_path.read_text()
e2e = replace_once(
    e2e,
    '  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();\n',
    '''  await popup.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __webcapJobEvents?: Array<{
        jobId: string;
        state: string;
        stateRevision: number;
      }>;
    };
    scope.__webcapJobEvents = [];
    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "JOB_SUMMARY_CHANGED" &&
        "payload" in message
      ) {
        const payload = message.payload as {
          summary?: { jobId?: string; state?: string; stateRevision?: number };
        };
        if (
          typeof payload.summary?.jobId === "string" &&
          typeof payload.summary.state === "string" &&
          typeof payload.summary.stateRevision === "number"
        ) {
          scope.__webcapJobEvents?.push({
            jobId: payload.summary.jobId,
            state: payload.summary.state,
            stateRevision: payload.summary.stateRevision,
          });
        }
      }
    });
  });

  await popup.getByRole("button", { name: /^Toàn bộ trang/ }).click();
''',
    "settings E2E listener",
)
e2e = replace_once(
    e2e,
    '''  expect(completedJob).toMatchObject({
    state: "completed",
    outputArtifactId: expect.any(String),''',
    '''  expect(completedJob).toMatchObject({
    state: "completed",
    outputArtifactId: expect.any(String),''',
    "settings E2E job assertion marker",
)
event_assertion_marker = '''  await openAdvancedSettings(popup);
  await popup.getByTestId("reset-settings").click();
'''
event_assertions = '''  const progressEvents = await popup.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __webcapJobEvents?: Array<{
        jobId: string;
        state: string;
        stateRevision: number;
      }>;
    };
    return scope.__webcapJobEvents ?? [];
  });
  const jobEvents = progressEvents.filter((event) => event.jobId === completedJob?.id);
  expect(jobEvents.length).toBeGreaterThan(2);
  expect(jobEvents.map((event) => event.state)).toContain("capturing");
  expect(jobEvents.at(-1)).toMatchObject({ state: "completed" });
  for (let index = 1; index < jobEvents.length; index += 1) {
    expect(jobEvents[index]?.stateRevision).toBeGreaterThan(
      jobEvents[index - 1]?.stateRevision ?? -1,
    );
  }

'''
e2e = replace_once(
    e2e,
    event_assertion_marker,
    event_assertions + event_assertion_marker,
    "settings E2E event assertions",
)
e2e_path.write_text(e2e)
