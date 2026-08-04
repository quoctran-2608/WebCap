# Chrome Web Store listing — English

## Name

WebCap

## Summary

Capture the viewport, full page, a region, an element, or a scroll area and export images/PDF locally.

## Single purpose

WebCap lets users intentionally capture content currently presented by Chrome as an image or PDF for archiving, sharing, printing, design review, or QA. Processing is local by default.

## Detailed description

WebCap captures web content beyond the limits of a normal screenshot while prioritizing accuracy, page restoration, and privacy.

Key features:

- Capture the visible viewport as PNG, JPEG, or WebP.
- Capture long full pages in bounded tiles, with a scroll fallback when CDP is unavailable.
- Drag a region beyond the viewport or choose a DOM element with mouse and keyboard controls.
- Capture the complete contents of a scroll container, modal, wide table, or chat panel.
- Export A4, Letter, or fit-width PDF; preview, reorder, remove pages, and retry export without recapturing.
- Detect PDF sources and preserve original bytes after the user grants the exact optional permission.
- Show progress, cancel safely, label partial captures honestly, and restore page scroll/style state.
- Use Vietnamese or English UI, keyboard-accessible controls, and redacted support diagnostics.

Privacy:

- No account, advertising, analytics, cloud sync, or content-upload backend.
- Screenshot/PDF bytes and temporary tiles are processed on the device.
- WebCap does not automatically send full URLs, page content, images, PDFs, cookies, tokens, or credentials.
- Optional site/file access is requested only when the user asks for original-PDF passthrough; denial leaves image capture available.

Limitations: Chrome blocks extensions on some internal/Store surfaces and protected media. WebCap reports these boundaries instead of silently producing an incomplete result.

## Suggested category

Productivity

## Reviewer test instructions

1. Open a normal HTTP/HTTPS page and click the WebCap toolbar action.
2. Choose “Visible area” to create a preview and download PNG.
3. Choose “Full page” on a long page to observe progress, tile preview, and PDF export.
4. Optional origin/file prompts appear only for original-PDF passthrough; no test account or credential is required.
5. Do not use `chrome://`, Chrome Web Store pages, or DRM content as fixtures because Chrome blocks these surfaces.
