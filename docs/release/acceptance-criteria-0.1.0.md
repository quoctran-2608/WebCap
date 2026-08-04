# WebCap 0.1.0 acceptance-criteria traceability

Status is determined from the final packaged release gate, not from source-only tests. Run identifiers, artifact SHA-256, and any manual evidence are recorded in the S20 PR/release manifest after validation.

| AC    | Requirement                                                   | Evidence route                                                                              | Release disposition |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------- |
| AC-01 | Visible capture matches viewport/DPR and excludes WebCap UI   | `visible-capture.spec.ts`, release DPR/zoom matrix, PNG signature/download assertions       | Required pass       |
| AC-02 | 30k full page has complete non-duplicated tile coverage       | full-page/scroll fallback E2E plus planner/overlap tests                                    | Required pass       |
| AC-03 | 100k page uses bounded tiled processing                       | PDF 100k benchmark, memory guard, decoded concurrency = 1                                   | Required pass       |
| AC-04 | Lazy content settles or reports timeout honestly              | page-preparation and capture-hardening E2E                                                  | Required pass       |
| AC-05 | Infinite scroll stops at policy and can retain partial output | infinite-growth E2E and partial-capture unit tests                                          | Required pass       |
| AC-06 | Smart fixed header is not duplicated                          | scroll fallback smart-fixed E2E and overlap/fixed policy assertions                         | Required pass       |
| AC-07 | Region beyond viewport stays within one device-pixel boundary | region E2E, coordinate matrix, DPR/zoom representative test                                 | Required pass       |
| AC-08 | Element bounds match and overlay is absent                    | element normal/shadow/stale/cancel E2E                                                      | Required pass       |
| AC-09 | Scroll container covers logical content and restores position | nested/wide/stale scroll-area E2E                                                           | Required pass       |
| AC-10 | Cancel detaches/cleans/restores                               | integration/unit coordinator paths and cancellation E2E                                     | Required pass       |
| AC-11 | Service-worker restart preserves valid job metadata           | persistent job/session router and repository tests                                          | Required pass       |
| AC-12 | A4 PDF has continuous pages and valid streams                 | layout/intersection/integrity tests, PDF exporter/editor E2E                                | Required pass       |
| AC-13 | Export retry reuses source tiles                              | PDF editor/export service integration tests                                                 | Required pass       |
| AC-14 | Zoom 80/100/125/150% and DPR 1/1.5/2                          | release matrix visible capture; coordinate/unit matrix; region representative at DPR 2/125% | Required pass       |
| AC-15 | No network request uploads image/page content                 | privacy audit and trust-UX browser network assertion                                        | Required pass       |
| AC-16 | No global host grant; debugger lifecycle is bounded           | manifest/release audit, clean-install host permission assertion, debugger unit/E2E paths    | Required pass       |
| AC-17 | Image/PDF outputs are non-empty and loadable                  | PNG/WebP/JPEG/PDF smoke, signatures, PDF load/integrity, packaged lifecycle                 | Required pass       |
| AC-18 | Every required error has code, explanation, and action        | i18n/error unit tests, safe diagnostics, UX/manual copy review                              | Required pass       |

## Non-functional release evidence

- Chrome minimum: packaged smoke on official Chrome for Testing 116.
- Current compatibility: packaged smoke on the current stable Chrome for Testing build resolved during CI.
- Reproducibility: two package runs from the same commit must have identical ZIP and release-manifest bytes.
- Security: no critical dependency advisory, incompatible direct license, remote executable code, analytics SDK, unsafe diagnostics field, or default host permission.
- Defects: zero accepted P0/P1; P2 items require a documented workaround in `docs/known-limitations.md`.
