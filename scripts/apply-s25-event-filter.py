from pathlib import Path

path = Path("src/popup/App.tsx")
text = path.read_text()

old_import = 'import { subscribeToJobSummaryChanges } from "./job-events-client";'
new_import = '''import {
  shouldRefreshJobFromSummary,
  subscribeToJobSummaryChanges,
} from "./job-events-client";'''
if old_import not in text:
    raise SystemExit("Missing job event client import")
text = text.replace(old_import, new_import, 1)

old_condition = '''    let latestRevision = fullPageJob.stateRevision;
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
'''
new_condition = '''    const tabId = tabCapability.tabId;
    const jobId = fullPageJob.id;
    let latestRevision = fullPageJob.stateRevision;
    return subscribeToJobSummaryChanges((summary) => {
      if (
        !shouldRefreshJobFromSummary(summary, {
          tabId,
          jobId,
          stateRevision: latestRevision,
        })
      ) {
        return;
      }
      latestRevision = summary.stateRevision;
      void syncFullPageJob(jobId).catch((error: unknown) => {
'''
if old_condition not in text:
    raise SystemExit("Missing inline job event revision filter")
text = text.replace(old_condition, new_condition, 1)
path.write_text(text)
