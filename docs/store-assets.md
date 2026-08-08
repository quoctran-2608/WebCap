# Chrome Web Store asset handoff

This handoff targets the approved WebCap 0.2.0 release candidate after PDF Engine V2 S35.

## Required and prepared inputs

### Extension/store icon

Store requirement: 128x128 PNG.

`icons/icon-128.png` is verified inside the release ZIP. Final visual and padding review remains a human approval item.

### Screenshots

Store requirement: at least one screenshot, preferably up to five, at 1280x800 or 640x400 full bleed.

Capture the exact packaged 0.2.0 UI after the final release gate. Recommended set: Vietnamese capture-mode picker, full-page/PDF page-first progress, verified PDF result, region selector/result, and English privacy/diagnostics.

### Small promo tile

Store requirement: 440x280 PNG/JPEG.

Produce it from approved WebCap branding. Avoid unsupported performance, unlimited-capture, OCR, annotation or cloud claims.

### Marquee image

Store requirement: optional 1400x560 PNG/JPEG.

Create it only after brand review.

## Source build for store media

Use the exact approved candidate:

- package: `webcap-0.2.0.zip`
- size: 1,341,084 bytes
- entries: 25
- SHA-256: `8bade485ee0672a2b160abf59f45c1772062ffc00724889c5aaa39294e7edb34`
- validated S35 PR head: `88b60c29e793c07e6ed6d0790ad4c16d324d6866`
- S35 merge commit on `main`: `0f4b6bb4a55a9d8bbaf1a628fdb49fcf570a1d62`

Do not produce final listing screenshots from an arbitrary dev build or from the older 0.1.0 package.

## Screenshot review rules

- Use the exact packaged 0.2.0 build and a non-sensitive local fixture.
- Show actual UI and realistic output; do not imply unsupported annotation, OCR, cloud conversion, remote backup or browser-internal capture that the product does not provide.
- For PDF screenshots, prefer page-oriented progress/result states rather than internal tile counters.
- A screenshot that says or visually implies PDF completion must correspond to a real completed result; do not manufacture a `100%`/verified state.
- Remove personal data, credentials, private URLs, downloads and unrelated browser chrome.
- Use full-bleed 1280x800 or 640x400 composition as accepted by the store dashboard.
- Provide localized screenshots for Vietnamese and English when the dashboard listing is localized.
- Review every pixel manually before upload; generated placeholders are not store-ready assets.
- Keep visual copy consistent with the privacy/permission disclosures and actual local-first behavior.

## Recommended 0.2.0 screenshot set

1. **Capture choices** — popup showing the main capture modes with the simplified hierarchy.
2. **PDF processing** — a real PDF viewer job showing page-first progress such as current/total pages.
3. **Verified PDF result** — a completed rendered-view result whose verified label is backed by durable manifest evidence.
4. **Region capture** — visible selector interaction and resulting guarded image flow.
5. **Privacy/diagnostics** — English or Vietnamese view showing local-first/privacy help and bounded diagnostics without page content.

## Publication boundary

Store media is deliberately not committed as product source or silently uploaded by CI. The release workflow preserves package/test artifacts; a release owner exports and approves final listing images before Chrome Web Store upload or submission.

Track remaining manual publication actions in GitHub issue #46 and `docs/release-checklist.md`.
