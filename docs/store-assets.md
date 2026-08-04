# Chrome Web Store asset handoff

## Required and prepared inputs

| Asset                | Store requirement                                                    | WebCap 0.1.0 handoff                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension/store icon | 128×128 PNG                                                          | `icons/icon-128.png` is verified inside the release ZIP; final visual/padding review remains a human approval item.                                                                           |
| Screenshots          | At least one, preferably up to five; 1280×800 or 640×400, full bleed | Capture actual 0.1.0 packaged UI after the final CI gate. Recommended set: Vietnamese mode picker, full-page progress/preview, PDF editor, scroll-area selector, English privacy/diagnostics. |
| Small promo tile     | 440×280 PNG/JPEG                                                     | Produce from approved WebCap branding; avoid unsupported performance claims and excessive text.                                                                                               |
| Marquee image        | 1400×560 PNG/JPEG, optional for ordinary listing/featuring           | Optional; create only after brand review.                                                                                                                                                     |

## Screenshot review rules

- Use the exact packaged 0.1.0 build and a non-sensitive local fixture.
- Show actual UI and realistic output; do not imply unsupported annotation, OCR, cloud, or browser-internal capture.
- Remove personal data, credentials, URLs, downloads, and unrelated browser chrome.
- Use square corners and full-bleed 1280×800 composition.
- Provide localized screenshots for Vietnamese and English when the dashboard listing is localized.
- Review every pixel manually before upload; generated placeholders are not store-ready assets.

Store media is deliberately not committed as product source or silently uploaded by CI. The release workflow preserves package/test artifacts; a release owner exports and approves the final listing images before submission.
