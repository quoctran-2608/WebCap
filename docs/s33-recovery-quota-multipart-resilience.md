# S33 — Recovery, quota and multipart resilience

Status: IN PROGRESS

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

## Non-goals

S34 owns difficult-viewer compatibility/adversarial heuristics. S35 owns the dedicated PDF UX and release-candidate polish. S33 does not introduce a backend, telemetry, account/cloud dependency, remote executable code, new required permission, tag, GitHub Release, or Chrome Web Store publication.
