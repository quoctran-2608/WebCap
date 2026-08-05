# S23 adaptive recovery diagnostic

Exit status: 1

```text

Running 1 test using 1 worker

[1/1] [visible-smoke] › tests/e2e/adaptive-scroll.spec.ts:411:1 › @smoke resumes the persisted prefix after an extension service-worker restart
  1) [visible-smoke] › tests/e2e/adaptive-scroll.spec.ts:411:1 › @smoke resumes the persisted prefix after an extension service-worker restart 

    Error: Adaptive recovery failed: {"code":"E_PROTOCOL_MESSAGE","stage":"protocol","message":"The content script response request ID did not match.","userMessageKey":"errors.pagePreparationProtocol","retryable":false,"fallbackAllowed":false,"causeCode":"RequestIdMismatch"}

      217 |         const state = await readAdaptiveJobFromPage(page, jobId);
      218 |         if (state.state === "failed") {
    > 219 |           throw new Error(`Adaptive recovery failed: ${JSON.stringify(state.error)}`);
          |                 ^
      220 |         }
      221 |         return state.state;
      222 |       },
        at expect.poll.timeout.timeout (/home/runner/work/WebCap/WebCap/tests/e2e/adaptive-scroll.spec.ts:219:17)
        at waitForAdaptiveReadyFromPage (/home/runner/work/WebCap/WebCap/tests/e2e/adaptive-scroll.spec.ts:214:3)
        at /home/runner/work/WebCap/WebCap/tests/e2e/adaptive-scroll.spec.ts:435:17

    attachment #1: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/adaptive-scroll--smoke-res-2e226-sion-service-worker-restart-visible-smoke/test-failed-2.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/adaptive-scroll--smoke-res-2e226-sion-service-worker-restart-visible-smoke/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/adaptive-scroll--smoke-res-2e226-sion-service-worker-restart-visible-smoke/error-context.md

    attachment #4: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/adaptive-scroll--smoke-res-2e226-sion-service-worker-restart-visible-smoke/trace.zip
    Usage:

        pnpm exec playwright show-trace test-results/adaptive-scroll--smoke-res-2e226-sion-service-worker-restart-visible-smoke/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


  1 failed
    [visible-smoke] › tests/e2e/adaptive-scroll.spec.ts:411:1 › @smoke resumes the persisted prefix after an extension service-worker restart 
```
