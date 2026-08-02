# Manual extension testing

## S04 visible image export

1. Run `pnpm build` and load `dist/` as an unpacked extension in Chrome.
2. Serve `tests/fixtures/visible-capture.html` over local HTTP and open it in the active tab.
3. Open WebCap. Confirm the worker is connected and the tab status is **Có thể chụp**.
4. Select PNG, click **Chụp và tải xuống**, and confirm the file opens with the reported dimensions.
5. Repeat with JPEG and WebP. Confirm each file extension and MIME output are valid.
6. Confirm the filename contains a sanitized page title, domain, timestamp, and no path traversal.
7. Start a capture and click **Hủy chụp**. Cancellation must not be displayed as a failure.
8. Trigger another export from the same stored capture through the runtime contract and confirm Chrome is not asked to capture the tab again.
9. Inspect extension IndexedDB `webcap-db`: source/output image bytes must be `Blob` values in `artifacts`; no base64 value may be stored in `chrome.storage`.
10. Confirm the offscreen document is reused during concurrent work and closes after roughly 60 seconds idle.
11. Simulate a download failure and confirm the temporary Blob URL is revoked and the artifact remains available for retry.
12. Open `chrome://settings`, reopen WebCap, and confirm capture remains disabled for the unsupported URL.

S04 intentionally does not add a thumbnail preview or restored popup job view. Those are S05.
