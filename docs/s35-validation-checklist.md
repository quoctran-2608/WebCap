# S35 validation checklist

- [x] Prettier
- [x] ESLint
- [x] strict TypeScript
- [x] privacy/dependency/release audits
- [x] critical dependency gate — one high advisory, no critical blocker
- [x] full unit suite — 444/444 across 127 files
- [x] S35 PDF UX/protocol/router focused tests
- [x] 4/4 PDF benchmarks
- [x] Manifest V3 build
- [x] reproducible package verification — 1,341,084 bytes, SHA-256 `8bade485ee0672a2b160abf59f45c1772062ffc00724889c5aaa39294e7edb34`
- [x] 56/56 Playwright extension E2E
- [x] S35 verified 3/3 page UX regression
- [x] S29 original-source regression
- [x] S30 virtualized viewer regression
- [x] S33 service-worker/offscreen recovery regressions
- [x] S34 difficult-viewer/adversarial regression
- [x] packaged clean install / 0.1.0 -> 0.2.0 update / uninstall

Evidence: clean read-only CI run `31258825875`.

Publication boundary: no tag, GitHub Release or Chrome Web Store action in S35 without separate explicit approval.
