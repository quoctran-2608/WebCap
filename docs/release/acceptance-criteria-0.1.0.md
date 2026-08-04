# WebCap 0.1.0 acceptance-criteria traceability

Status below is grounded in the final packaged release gate. Validation head `3fb083fc`, read-only CI run `30909732983`, and Release Candidate run `30909732939` all completed successfully. The verified 24-entry package is 1,097,035 bytes with SHA-256 `630c44c07e72da0d5edc1c82c013ecf6caf995e0542ee19679380081e7b0cb7a`.

| AC    | Requirement                                                   | Evidence route                                                                              | Release disposition |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------- |
| AC-01 | Visible capture matches viewport/DPR and excludes WebCap UI   | `visible-capture.spec.ts`, release DPR/zoom matrix, PNG signature/download assertions       | PASS                |
| AC-02 | 30k full page has complete non-duplicated tile coverage       | full-page/scroll fallback E2E plus planner/overlap tests                                    | PASS                |
| AC-03 | 100k page uses bounded tiled processing                       | PDF 100k benchmark, memory guard, decoded concurrency = 1                                   | PASS                |
| AC-04 | Lazy content settles or reports timeout honestly              | page-preparation and capture-hardening E2E                                                  | PASS                |
| AC-05 | Infinite scroll stops at policy and can retain partial output | infinite-growth E2E and partial-capture unit tests                                          | PASS                |
| AC-06 | Smart fixed header is not duplicated                          | scroll fallback smart-fixed E2E and overlap/fixed policy assertions                         | PASS                |
| AC-07 | Region beyond viewport stays within one device-pixel boundary | region E2E, coordinate matrix, DPR/zoom representative test                                 | PASS                |
| AC-08 | Element bounds match and overlay is absent                    | element normal/shadow/stale/cancel E2E                                                      | PASS                |
| AC-09 | Scroll container covers logical content and restores position | nested/wide/stale scroll-area E2E                                                           | PASS                |
| AC-10 | Cancel detaches/cleans/restores                               | integration/unit coordinator paths and cancellation E2E                                     | PASS                |
| AC-11 | Service-worker restart preserves valid job metadata           | persistent job/session router and repository tests                                          | PASS                |
| AC-12 | A4 PDF has continuous pages and valid streams                 | layout/intersection/integrity tests, PDF exporter/editor E2E                                | PASS                |
| AC-13 | Export retry reuses source tiles                              | PDF editor/export service integration tests                                                 | PASS                |
| AC-14 | Zoom 80/100/125/150% and DPR 1/1.5/2                          | release matrix visible capture; coordinate/unit matrix; region representative at DPR 2/125% | PASS                |
| AC-15 | No network request uploads image/page content                 | privacy audit and trust-UX browser network assertion                                        | PASS                |
| AC-16 | No global host grant; debugger lifecycle is bounded           | manifest/release audit, clean-install host permission assertion, debugger unit/E2E paths    | PASS                |
| AC-17 | Image/PDF outputs are non-empty and loadable                  | PNG/WebP/JPEG/PDF smoke, signatures, PDF load/integrity, packaged lifecycle                 | PASS                |
| AC-18 | Every required error has code, explanation, and action        | i18n/error unit tests, safe diagnostics, UX/manual copy review                              | PASS                |

## Non-functional release evidence

- Chrome minimum: PASS on Chrome for Testing 116.0.5845.96.
- Current compatibility: PASS on Chrome for Testing stable 151.0.7922.71.
- Operating systems: packaged install/update/storage/uninstall lifecycle PASS on Linux, Windows, and macOS.
- Reproducibility: PASS; two package runs from the same source produced the identical ZIP SHA-256 `630c44c…` and verified release metadata.
- Security: PASS; no critical dependency advisory, incompatible direct license, remote executable code, analytics SDK, unsafe diagnostics field, or default host permission.
- Defects: PASS; zero accepted/open P0/P1. Remaining P2 boundaries have workarounds in `docs/known-limitations.md`.
- Publication: not performed; Chrome Web Store dashboard and release-owner steps remain intentionally manual.
