# WebCap 0.1.0 known limitations

These limitations are intentional boundaries, not silent failures. WebCap should show a useful error or partial-capture warning and restore the page whenever Chrome permits it.

| Area | Limitation | Workaround |
| --- | --- | --- |
| Restricted surfaces | `chrome://`, `edge://`, Chrome Web Store pages, other extension pages, and browser-owned UI cannot be injected or fully captured. | Use the operating system screenshot tool or capture a normal web page instead. |
| Protected media | DRM video, protected canvases, hardware overlays, and content omitted by Chrome may appear blank or incomplete. | Capture a non-protected static representation supplied by the content owner. |
| Cross-origin frames | Compositor screenshots may include frame pixels, but WebCap cannot inspect or select cross-origin DOM nodes. | Capture the visible frame pixels, select its outer element, or open the framed page directly when allowed. |
| Closed shadow roots | Deep element selection cannot enter a closed shadow root. | Select the host element or use region capture. |
| Highly dynamic pages | Continuous animation, layout shifts, lazy growth, or infinite scroll may hit a duration, height, or tile guard. | Freeze/stop the page where possible, lower the limit, or export the explicitly marked partial capture. |
| Fixed/sticky heuristics | Smart mode is deterministic but cannot infer every site-specific sticky behavior. | Retry with preserve/remove policy or use region capture. |
| Very large outputs | Pixel, tile, storage, PDF, and memory guardrails may reject an unsafe export. | Lower JPEG quality, use A4/Letter multi-page PDF, split the target, or retry on a device with more available memory. |
| PDF sources | Authenticated, blob-backed, browser-viewer, or policy-blocked PDF sources may not allow original-byte passthrough. | Use image capture, download the PDF manually, or grant the exact optional origin/file permission when appropriate. |
| Local files | `file://` PDF passthrough also depends on Chrome's user-controlled “Allow access to file URLs” setting. | Enable file access for WebCap, then grant the optional file permission; otherwise use visible capture. |
| Browser support | The supported target is desktop Chrome 116 or newer. Other Chromium browsers may work but are not a 0.1.0 compatibility commitment. | Use a tested Chrome release. |
| Fonts and rendering | Captured pixels reflect the active device, fonts, GPU, zoom, and page state, so results can differ across computers. | Use a controlled browser/profile for evidence or visual-regression work. |
| Store release | The repository prepares artifacts and copy but does not contain developer-account credentials or publish automatically. | Complete the manual dashboard checklist after explicit approval. |

No known P0 or P1 defect is accepted for the 0.1.0 release candidate. Any newly discovered content-loss, duplicate-content, cleanup, privacy, or permission-lifecycle defect blocks release.
