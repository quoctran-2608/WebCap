# WebCap privacy and permission policy

WebCap is a local-first Chrome extension. Capture and export are initiated by the user, processed on the user's device, and are not uploaded to a WebCap backend.

## Data processed locally

During a capture or export, WebCap may process:

- screenshot pixels supplied by Chrome;
- capture geometry, tile order, progress, output settings, and retry state;
- temporary image/PDF Blobs in extension IndexedDB;
- user settings and the selected Vietnamese/English UI locale in `chrome.storage.local`;
- short-lived job summaries and locks in `chrome.storage.session`.

WebCap does not place screenshot/PDF binary data in `chrome.storage.local`, `chrome.storage.sync`, or `chrome.storage.session`. Runtime messages carry identifiers and bounded metadata, not image/base64 payloads.

Temporary job data expires under the product cleanup policy and can also be removed by clearing extension storage or uninstalling WebCap. Downloaded files are managed by Chrome and the user's filesystem.

## No analytics or content upload by default

The MVP contains no analytics SDK, advertising SDK, account system, cloud sync, remote diagnostics upload, remote script, CDN executable module, or WebCap capture server.

Normal capture/export flows do not send WebCap analytics requests and must never transmit:

- screenshot, tile, thumbnail, or PDF bytes;
- full page URLs, browsing history, page titles, DOM text, HTML, selectors, or form values;
- cookies, access tokens, authorization headers, passwords, or other credentials;
- local filenames or filesystem paths.

Original-PDF passthrough may fetch the document URL only after explicit user action and the required optional permission. That request is made by the browser to the selected PDF source so WebCap can preserve the original bytes; it is not an analytics or WebCap upload request.

## Permission rationale

WebCap explains sensitive permissions in the popup and at the moment an optional permission is required.

| Permission/API          | Why WebCap uses it                                                            | Scope and lifecycle                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `activeTab`             | Read/capture the current tab after the user clicks WebCap.                    | Temporary access tied to the user's action; preferred over permanent all-site access.                             |
| `scripting`             | Inject isolated selection, preparation, and restoration code.                 | Used only for an active selection/capture job.                                                                    |
| `debugger`              | Measure and capture full-page tiles beyond the viewport with CDP.             | Attached immediately before supported full-page work and detached on success, failure, cancellation, or fallback. |
| `storage`               | Store settings, locale, safe metadata, and local IndexedDB job/artifact data. | No screenshot bytes in sync/session storage.                                                                      |
| `offscreen`             | Decode/crop/encode local image and PDF Blobs outside the service worker.      | Hidden processing surface; not used for tracking.                                                                 |
| `downloads`             | Save a user-requested image or PDF.                                           | Used only when the user starts a download/export action.                                                          |
| Optional HTTP(S) origin | Fetch original PDF bytes when passthrough is explicitly requested.            | Requested for the exact origin only when needed; denial leaves image capture available.                           |
| Optional `file:///*`    | Read a local PDF after Chrome's file-URL access is enabled.                   | Requested only for local-file passthrough; denial leaves image capture available.                                 |

WebCap does not declare default `host_permissions` or `<all_urls>` in the production manifest.

## Safe diagnostics

The “Copy safe diagnostics” action creates local JSON for support. It is copied to the clipboard only after the user clicks the button and is never uploaded automatically.

Allowed fields are limited to:

- diagnostics schema version and generation time;
- extension version and selected UI locale;
- popup/editor surface;
- Chromium major-version bucket;
- worker/tab status;
- shortened job ID, capture mode, engine, state, tile counts, and normalized error code;
- visible/PDF source status and permission state.

Diagnostics exclude URLs, page titles/text/HTML, images, PDFs, cookies, tokens, authorization data, selectors, filenames, paths, Blob/base64 data, raw error messages, and stack traces.

## Logging

Production logging defaults to `warn`. Logs pass through a single allowlist and contain only bounded technical fields such as shortened job ID, mode, engine, stage, tile counts, duration bucket, normalized error code, extension version, and Chromium-version bucket.

Raw page content, full URLs, credentials, binary data, filenames, selectors, raw exception messages, and arbitrary context properties are not allowed in production log records.

## Cross-origin and protected content

Chrome may include cross-origin iframe, Canvas, and WebGL pixels in compositor screenshots. WebCap does not use this to inspect cross-origin DOM or bypass browser/origin/content-protection boundaries. DRM/protected video, hardware-overlay content, browser-internal pages, and surfaces Chrome omits remain unsupported.

## User control and future changes

Users control when capture, optional permission requests, diagnostics copying, export, and download occur. Denying optional PDF permissions does not disable the standard image-capture modes.

Any future telemetry, cloud storage, account, remote diagnostics, data sharing, or additional permission would require an explicit product/specification update, privacy review, user-facing disclosure, and an opt-in design before implementation.
