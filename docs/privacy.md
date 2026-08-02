# WebCap Privacy Baseline

WebCap is designed as a local-first Chrome extension.

## Data handling

- Captured pixels, page-derived metadata, settings, and generated artifacts remain on the user's device.
- WebCap does not upload captures to a WebCap server.
- WebCap does not include analytics, advertising SDKs, remote scripts, or CDN-loaded executable code.
- User settings are stored in `chrome.storage.local`.
- Future image tiles and generated artifacts will be stored in IndexedDB, not in `chrome.storage`.

## Permissions

WebCap requests only the permissions listed in `public/manifest.json` and documented in the PRD/SPEC. Optional host permissions are requested only when a user action requires access beyond `activeTab`.

The `debugger` permission is reserved for capture sessions. A debugger session must be attached immediately before capture and detached on every success, failure, and cancellation path.

## Logging

Production logging defaults to warnings and errors. Diagnostic records use an allowlist and must not contain:

- full URLs or browsing history;
- page title or DOM text;
- cookies, tokens, authorization headers, or form values;
- image bytes, base64 captures, or generated documents.

## User control

Settings and future captures can be removed by uninstalling the extension or clearing extension storage. Export and download actions are initiated by the user.

This baseline must be updated before any telemetry, cloud service, account system, or data-sharing feature is proposed.
