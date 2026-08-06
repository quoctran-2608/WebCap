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

old_condition = '''      if (
        summary.tabId !== tabCapability.tabId ||
        summary.jobId !== fullPageJob.id ||
        summary.stateRevision <= latestRevision
      ) {
        return;
      }
'''
new_condition = '''      if (
        !shouldRefreshJobFromSummary(summary, {
          tabId: tabCapability.tabId,
          jobId: fullPageJob.id,
          stateRevision: latestRevision,
        })
      ) {
        return;
      }
'''
if old_condition not in text:
    raise SystemExit("Missing inline job event revision filter")
text = text.replace(old_condition, new_condition, 1)
path.write_text(text)
