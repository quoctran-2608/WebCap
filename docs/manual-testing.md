# Manual extension testing

## S03 visible capture

1. Run `pnpm build` and load `dist/` as an unpacked extension in Chrome.
2. Serve `tests/fixtures/visible-capture.html` over local HTTP and open it in the active tab.
3. Open WebCap. Confirm the worker is connected and the tab status is **Có thể chụp**.
4. Click **Chụp vùng đang xem**. Confirm the popup reports PNG dimensions and a non-zero byte size.
5. Repeat quickly. Confirm one request is accepted at a time and the extension remains responsive.
6. Start a capture and click **Hủy chụp**. Cancellation must not be displayed as a failure.
7. Open `chrome://settings`, reopen WebCap, and confirm the tab is marked unsupported and capture is disabled.
8. Confirm the popup itself is not present in the captured page pixels.

S03 intentionally keeps the PNG data URL only in the service-worker coordinator. There is no preview,
persistence, conversion, or download until S04/S05.
