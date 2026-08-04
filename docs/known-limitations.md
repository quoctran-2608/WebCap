# Known capture limitations

WebCap is local-first and captures pixels that Chrome makes available to the extension. It does not bypass browser, origin, operating-system, or content-protection boundaries.

## Difficult and continuously changing pages

- Lazy and infinite pages are bounded by stable-height sampling, maximum CSS height, elapsed duration, maximum tile count, and explicit user stop.
- Reaching a guard produces an explicit partial-capture reason and warning. WebCap never labels guard-limited output as complete.
- When a run stops mid-grid, WebCap retains only a complete contiguous row-major prefix. An incomplete final row is discarded so later image/PDF composition cannot contain a hidden logical gap.
- A page that never reaches the bounded layout-settle policy can fail with `E_LAYOUT_UNSTABLE`; WebCap restores owned page state before reporting the failure.

## Iframes

- Same-origin and cross-origin iframe pixels can appear in screenshots when Chrome's compositor includes them.
- WebCap does not inspect, serialize, or select DOM inside a cross-origin frame. Element-level behavior inside such a frame is not promised.
- A frame that Chrome blocks, replaces, crashes, or omits may appear blank or as Chrome's own fallback surface.

## Canvas, WebGL, media, and protected surfaces

- Canvas 2D and WebGL are captured from the compositor output visible to Chrome; deterministic fixtures are covered by browser tests.
- Transient GPU surfaces can change between tiles. WebCap freezes CSS animation where possible but cannot guarantee application-controlled render loops stop.
- DRM/protected video, hardware-overlay content, browser-internal pages, and other surfaces Chrome excludes are unsupported. WebCap does not attempt to bypass those protections.

## Restoration and user/page changes

- WebCap restores only values it still owns. Compare-before-restore intentionally skips a scroll/style/focus value changed by the user or page after preparation rather than overwriting newer state.
- Scroll snapping is disabled only while WebCap owns page preparation. The original inline/computed behavior is restored when ownership is unchanged.

## Zoom, DPR, and browser coverage

- Automated coverage includes the default Chromium project and the critical DPR 2 / 125% zoom project. Other combinations use the same CSS/device coordinate contracts but are not an exhaustive browser matrix.
- Chrome for Testing is the current automated reference. Other Chromium builds may differ in compositor timing, GPU availability, or restricted-surface behavior.
