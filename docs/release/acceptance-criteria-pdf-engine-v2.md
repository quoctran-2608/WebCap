# PDF Engine V2 acceptance criteria — AC-41–AC-60

Status: PASS  
Final S35 evidence: clean read-only CI run `31258825875` on the S35 candidate.

| AC    | Requirement                                                                   | Disposition | Primary evidence                                                        |
| ----- | ----------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| AC-41 | Dedicated PDF orchestrator and page-oriented state model                      | PASS        | S28 `PdfCaptureOrchestrator` + durable `PdfDocumentManifest`            |
| AC-42 | Preserve original PDF bytes when safely accessible                            | PASS        | S29 source acquisition + byte-identical browser regression              |
| AC-43 | Stream large original source without whole-file RAM buffering                 | PASS        | S29 OPFS streamed acquisition + incremental signature/hash verification |
| AC-44 | No normal document-wide tile-count completion limit for PDF viewer capture    | PASS        | S31 page-native planning/batching                                       |
| AC-45 | Incremental discovery for virtualized/recycled viewers                        | PASS        | S30 500-page virtualized Chromium regression                            |
| AC-46 | One source page produces exactly one output page                              | PASS        | S27–S32 page map/orchestrator/writer invariants + mixed-orientation E2E |
| AC-47 | Preserve mixed page sizes and orientation independently                       | PASS        | S30 discovery, S31 capture and S32 writer coverage                      |
| AC-48 | One giant page can tile internally without a full-document canvas             | PASS        | S31 page-local tile planner and safety budget                           |
| AC-49 | Raster memory bounded by current page/batch, not document length              | PASS        | S31 page-native capture + S32 sequential OPFS writer                    |
| AC-50 | Storage pressure shrinks/pauses work without corrupt completion               | PASS        | S33 storage-pressure controller and pause semantics                     |
| AC-51 | Service-worker restart resumes without recapturing verified pages             | PASS        | S33 forced service-worker recovery browser regression                   |
| AC-52 | Offscreen/output restart resumes from durable writer checkpoint               | PASS        | S33 forced offscreen recovery browser regression                        |
| AC-53 | Auth/encrypted/unavailable source safely falls back to visible viewer capture | PASS        | S29 acquisition fallback + S34 compatibility revalidation               |
| AC-54 | Blank and duplicate-looking adjacent pages remain distinct                    | PASS        | S34 adversarial browser fixture                                         |
| AC-55 | Viewer chrome, gutters and inter-page gaps are excluded                       | PASS        | S27 page rectangle cropping + page-aware output regression              |
| AC-56 | Stop/partial output ends on complete source-page boundaries                   | PASS        | S31 page-boundary stop + S33 recovery semantics                         |
| AC-57 | Multipart fallback splits only between source pages                           | PASS        | S33 multipart contract/planner/byte regression                          |
| AC-58 | Completed/100% requires strict discovered/captured/verified/output agreement  | PASS        | S28 completion evidence + S35 verified UX tied to durable manifest      |
| AC-59 | Diagnostics expose bounded content-free PDF metadata only                     | PASS        | S35 safe diagnostics allowlist and redaction tests                      |
| AC-60 | No new required permission/backend/telemetry/cloud dependency                 | PASS        | Manifest/privacy/release audits through S35                             |

## Final gate

- Unit: **444/444** across **127/127** files.
- PDF benchmarks: **4/4 PASS**.
- Playwright: **56/56 PASS** on Chrome for Testing `151.0.7922.34`.
- Reproducible package: `webcap-0.2.0.zip`, **1,341,084 bytes**, 25 entries, SHA-256 `8bade485ee0672a2b160abf59f45c1772062ffc00724889c5aaa39294e7edb34`.
- Packaged lifecycle: clean install, stable ID, `0.1.0 → 0.2.0` state preservation and uninstall PASS.
- Security threshold: PASS; one high-severity dependency advisory remains and no critical finding blocks CI.

No tag, GitHub Release or Chrome Web Store submission/publication has been performed.
