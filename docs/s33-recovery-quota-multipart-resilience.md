# S33 — Recovery, quota and multipart resilience

Status: FINAL VALIDATION

S33 builds on the S31 page-native capture engine and the S32 OPFS streaming writer. The milestone makes verified page progress durable across extension/offscreen restarts, turns storage pressure into bounded backpressure instead of false completion, and introduces page-aligned multipart output as a last-resort local fallback.

## Scope

- page-native viewer capture restart recovery from complete verified-page boundaries;
- streaming writer recovery from durable OPFS/checkpoint boundaries;
- storage quota/backpressure assessment before capture batches and output pages;
- automatic adaptive batch shrink under pressure;
- durable paused/resumable PDF jobs;
- page-aligned multipart planning/output fallback;
- OPFS + writer-checkpoint cleanup/expiry ownership;
- forced-restart and quota regressions.

The capture-side recovery implementation reuses the existing durable-job pattern from adaptive full-page capture: only fully covered logical PDF pages survive a restart; any stored/planned suffix belonging to an incomplete page is discarded before capture resumes. Recovery rebuilds its trusted prefix from tile records that still exist in IndexedDB, so a crash between suffix cleanup and the next plan checkpoint cannot resurrect stale tile metadata.

The output-side recovery boundary is ordered deliberately: finish one logical page, commit the OPFS writable so those bytes are durable, then persist the IndexedDB writer checkpoint. Recovery reads only through that checkpoint byte length, reconstructs PDF object offsets with bounded parsing, truncates any newer uncheckpointed suffix, and continues at the next page.

A retryable storage/offscreen interruption keeps the stable output artifact identity and monotonic output progress, moves both the generic job and dedicated PDF manifest to `paused`, and can be resumed by the existing completion recovery path after a service-worker restart. A closed Chrome message channel is classified at the offscreen transport boundary as retryable `E_OFFSCREEN_UNAVAILABLE` rather than a generic export failure.

Multipart output is represented as a real set of contiguous logical-page artifacts. Each part keeps an honest part-local page count plus its document page range; completion is allowed only when the complete part set covers the source document exactly once with no gap or duplicate range. The byte-level regression forces a three-page document into three separate parts and verifies that every part is independently loadable and preserves the source page orientation.

## Non-goals

S34 owns difficult-viewer compatibility/adversarial heuristics. S35 owns the dedicated PDF UX and release-candidate polish. S33 does not introduce a backend, telemetry, account/cloud dependency, remote executable code, new required permission, tag, GitHub Release, or Chrome Web Store publication.
