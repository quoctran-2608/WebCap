# WebCap permission rationale

WebCap uses Chrome permissions only after a user opens the extension or starts a capture/export action.

- `activeTab` provides temporary current-tab access and avoids default access to every website.
- `scripting` installs isolated selectors and page preparation/restoration only for an active job.
- `debugger` enables CDP full-page measurement/capture and is detached on every exit path.
- `storage` stores settings, locale, metadata, and local IndexedDB records; image/PDF binary remains in IndexedDB.
- `offscreen` performs local Blob/canvas/PDF work that a service worker cannot perform.
- `downloads` starts a user-requested file download.
- Optional `http://*/*`, `https://*/*`, or `file:///*` access is declared only so Chrome can grant the exact origin/file pattern when original-PDF passthrough is explicitly requested. It is not pre-granted on installation, and denial does not disable image capture.

The production manifest has no default host permission and does not include `<all_urls>`. The E2E harness temporarily grants its local fixture host only inside a copied test manifest.

# WebCap 0.2.0 permission confirmation

The 0.2.0 release candidate does not add required permissions or default host permissions. Required permissions remain activeTab, scripting, storage, downloads, offscreen and debugger. HTTP(S)/file access remains optional and contextual for original PDF passthrough only.
