---
product: WebCap
document: Product Requirements Delta
version: 1.1
date: 2026-08-04
status: Approved for implementation planning
repository: quoctran-2608/WebCap
language: vi
extends: ./PRD_WebCap_v1.0.md
release_target: 0.2.0
---

# WebCap — Product Requirements v1.1

Tài liệu này mở rộng PRD v1.0 cho WebCap 0.2.0. Mọi yêu cầu, giới hạn riêng tư và acceptance criteria của 0.1.0 vẫn có hiệu lực trừ khi tài liệu này thay thế rõ ràng. Danh sách khoảng trống đã audit nằm tại `docs/audits/0.1.0-gap-audit.md`.

# 1. Vấn đề cần giải quyết

Bản 0.1.0 có nền tảng capture tile, selector, scroll fallback và PDF exporter, nhưng trải nghiệm thực tế còn các khoảng trống:

1. Full-page scroll lập kế hoạch theo chiều cao đã đo và coi tăng chiều cao trong lúc capture là lỗi, nên chưa phù hợp với trang lazy-load tiếp tục dài ra.
2. Sau job `ready/completed`, người dùng không có hành động rõ ràng để bỏ kết quả và chụp mới.
3. Popup hiển thị nhiều thông tin kỹ thuật hơn thông tin phục vụ tác vụ.
4. Code region selector đã có thao tác kéo-vẽ, di chuyển, resize và auto-scroll, nhưng luồng khởi chạy chưa đảm bảo người dùng nhìn thấy overlay ngay: popup không chủ động đóng sau khi selector sẵn sàng, hướng dẫn chưa đủ rõ và chưa có acceptance test cho hành trình thực tế từ nút popup đến khung chọn.
5. Settings người dùng chưa là nguồn sự thật của job: tiled capture hiện tạo job từ `DEFAULT_CAPTURE_SETTINGS`; lựa chọn format/quality/fixed-sticky không được áp dụng và ghi nhớ nhất quán.
6. Output routing chưa rõ: visible capture có ảnh trực tiếp, còn full-page/region/element/scroll-area chủ yếu dừng ở tile set rồi yêu cầu mở PDF editor.
7. Popup dùng polling ngắn để đồng bộ trạng thái thay vì ưu tiên progress event, làm code UI phức tạp và tốn tài nguyên.
8. Active capture bị service-worker restart sẽ chuyển failed; với capture rất dài cần resume an toàn từ frontier hoặc giữ partial rõ ràng.

# 2. Mục tiêu 0.2.0

| Mã   | Mục tiêu                                    | Kết quả người dùng                                                    |
| ---- | ------------------------------------------- | --------------------------------------------------------------------- |
| G-06 | Tự động chụp cuộn đến cuối nội dung ổn định | Không phải cuộn hoặc ghép ảnh thủ công.                               |
| G-07 | Tự động tạo PDF sau capture dài             | Full-page hoàn tất mà không bắt buộc mở editor.                       |
| G-08 | Cho phép bắt đầu lại rõ ràng                | Có “Chụp mới” ở mọi trạng thái.                                       |
| G-09 | Đơn giản hóa popup                          | Chỉ giữ lựa chọn, tiến trình và hành động hữu ích.                    |
| G-10 | Giữ local-first và quyền tối thiểu          | Không thêm backend, telemetry, remote code hay quyền mặc định mới.    |
| G-11 | Khôi phục trải nghiệm vẽ vùng chọn          | Bấm chọn vùng là thấy overlay ngay, kéo-vẽ được và chụp đúng vùng.    |
| G-12 | Làm rõ output và settings                   | Mỗi mode có output mặc định hợp lý; lựa chọn được ghi nhớ và áp dụng. |
| G-13 | Tăng độ bền của job dài                     | Progress theo event và recovery/resume không làm mất tile đã lưu.     |

# 3. Phạm vi sản phẩm

## 3.1 Auto-scroll đến cuối trang

- “Toàn trang → PDF” bắt đầu từ đầu document, cuộn tuần tự và chụp contiguous prefix đến khi xác nhận đã đạt cuối nội dung ổn định.
- Sau mỗi bước cuộn, WebCap chờ layout/lazy content ổn định rồi đo lại chiều cao.
- Nếu chiều cao tăng, capture tiếp tục từ frontier đã lưu; không restart hoặc chụp lại prefix.
- Hoàn tất chỉ khi đã chạm đáy, chiều cao không tăng qua số vòng ổn định đã khóa và final probe không phát hiện nội dung mới.
- Scroll, focus, selection và WebCap-owned mutations phải được phục hồi sau success, error, cancel, reset hoặc recovery failure.
- Không có gap, duplicate strip hoặc silent truncation.

“Đến hết dù trang dài” nghĩa là không dừng bởi một ngưỡng CSS height cố định tùy ý. Feed infinite-scroll thực sự vẫn có budget thời gian, tile, storage và memory. Khi guard kích hoạt, UI phải nói rõ partial capture và cho phép giữ hoặc bỏ.

## 3.2 Auto-PDF và output theo mode

- Full-page mặc định tự export PDF sau khi tile set hoàn chỉnh.
- Scroll-area mặc định PDF; có thể xuất ảnh khi kích thước nằm dưới image-memory guard.
- Region và element mặc định PNG; JPEG/WebP tùy chọn. Nếu kết quả nhiều tile hoặc vượt image guard, UI đề xuất PDF thay vì cố tạo canvas nguy hiểm.
- Visible giữ PNG/JPEG/WebP hiện tại.
- PDF dùng tile/page streaming, không tạo full-page canvas.
- Retry export dùng lại source tiles.
- Partial chỉ auto-export sau explicit keep.
- Result card hiển thị đúng output: Tải ảnh/PDF, Chỉnh sửa khi có ý nghĩa, Chụp mới.

## 3.3 Reset và vòng đời “Chụp mới”

- Mọi terminal state (`ready`, `completed`, `failed`, `cancelled`) có “Chụp mới”.
- Reset terminal xóa job, tile, source/output artifact, thumbnail, edit manifest, summary và stale lock thuộc capture đó.
- File đã tải xuống, locale và settings được giữ.
- Reset active yêu cầu xác nhận, thực hiện cancel → cleanup → discard local data.
- Reset idempotent và không ảnh hưởng job khác.
- Sau reset có thể tạo job mới ngay trên cùng tab.

## 3.4 Vẽ vùng chọn

Luồng bắt buộc:

1. Người dùng chọn **Vùng chữ nhật** và bấm **Vẽ vùng chọn**.
2. Background inject content runtime và chỉ ACK khi selector root đã gắn vào document, stage đã focus và sẵn sàng nhận pointer/keyboard.
3. Popup tự đóng sau ACK; trang hiển thị ngay dimming mask, crosshair, hướng dẫn ngắn và nút Hủy/Xác nhận.
4. Người dùng kéo chuột hoặc pointer để tạo rectangle; có thể move, resize bằng tám handle và auto-scroll khi kéo sát mép viewport.
5. Enter xác nhận, Escape hủy; overlay được xóa trước capture ít nhất hai animation frame.
6. Capture dùng CSS document coordinates và không chứa border/mask/toolbar của WebCap.

Keyboard-only:

- Space khi chưa có rectangle tạo một vùng mặc định ở giữa viewport.
- Arrow di chuyển; Shift+Arrow di chuyển 10 px.
- Alt+Arrow resize; Alt+Shift+Arrow resize 10 px.
- Hit target của handle tối thiểu 24 CSS px dù hình tròn hiển thị có thể nhỏ hơn.

Nếu selector không mở trong timeout, job bị hủy sạch và popup hiển thị hành động thử lại; không để orphan job.

## 3.5 Settings và tùy chọn nâng cao

- Settings repository là nguồn sự thật khi tạo job; không tạo job từ defaults nếu đã có stored settings hợp lệ.
- Ghi nhớ output gần nhất theo nhóm mode, image quality, PDF page size/orientation/margin và fixed/sticky policy.
- Có “Đặt lại tùy chọn mặc định” tách biệt với “Chụp mới”.
- Resource guard nội bộ không phơi thành input nguy hiểm trong main UI.
- Advanced options đóng mặc định và chỉ chứa lựa chọn user có thể hiểu.

## 3.6 Progress và recovery

- UI ưu tiên `JOB_PROGRESS/JOB_STATE_CHANGED` event; polling chỉ là reconciliation fallback chậm khi popup mở lại hoặc nghi mất event.
- Adaptive frontier được persist sau mỗi tile.
- Nếu service worker restart, WebCap revalidate tab/document identity, viewport/DPR và frontier:
  - hợp lệ: resume từ frontier chưa chụp;
  - không hợp lệ: giữ contiguous partial và cho Retry/Keep/Reset, không xóa im lặng.
- Không chụp trùng tile khi resume.

## 3.7 Tối ưu giao diện

Main popup chỉ giữ:

1. WebCap và notice khi tab không hỗ trợ/cần quyền.
2. Ba goal: Toàn trang → PDF; Vùng cụ thể; Màn hình hiện tại.
3. Target picker khi chọn Vùng cụ thể.
4. Một CTA chính.
5. Phase progress ngôn ngữ tự nhiên.
6. Result card.
7. Advanced options và Help & diagnostics đóng mặc định.

Ẩn khỏi main flow: worker/version, engine, raw tile count, milestone badge, checksum, permission inventory và diagnostics button. PDF detection không được tạo card/flicker trên tab không phải PDF.

# 4. Luồng trải nghiệm đích

## 4.1 Toàn trang → PDF

Mở popup → chọn/bấm Chụp toàn trang → Chuẩn bị → Cuộn và chụp → Tạo PDF → Tải PDF/Chỉnh sửa/Chụp mới.

## 4.2 Vẽ vùng chọn → ảnh

Chọn Vùng cụ thể → Vùng chữ nhật → Vẽ vùng chọn → popup đóng → kéo rectangle → Xác nhận → preview ảnh → Tải ảnh/Đổi định dạng/Chụp mới.

## 4.3 Bắt đầu lại

Bấm Chụp mới → cleanup dữ liệu capture cũ → quay về goal selector với settings được giữ.

# 5. Phân loại các vấn đề 0.1.0

## 5.1 Bắt buộc xử lý trong 0.2.0

- Region selector launch/discoverability và keyboard creation.
- Reset/new capture.
- Adaptive long-page capture.
- Auto-PDF và output routing rõ ràng.
- Stored settings được áp dụng.
- Event-driven progress và durable long-job recovery.
- Popup progressive disclosure.

## 5.2 Giới hạn nền tảng — giữ và giải thích tốt hơn

- Chrome internal/Store/extension surfaces.
- DRM, protected video/canvas/hardware overlay.
- Cross-origin iframe DOM selection và closed shadow root.
- Optional permission/file URL policy cho original PDF.
- Scroll-visible engines cần source tab active.
- Pixel output phụ thuộc font/GPU/zoom/device.
- Desktop Chrome là compatibility target chính.

## 5.3 Defer sau 0.2.0

- Annotation, blur, text note, OCR/search text.
- Batch URL, cloud sync, Drive/Notion integrations.
- Full capture history/library.
- Advanced crop editor, original-PDF page range và one-long-page PDF nếu chưa thể thêm mà không làm trễ core release.

# 6. Acceptance criteria mới

| Mã    | Acceptance criterion                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------- |
| AC-19 | Lazy-growth hữu hạn được chụp đến stable end mà không restart job.                                                  |
| AC-20 | Trang hữu hạn >100.000 CSS px không dừng chỉ vì ngưỡng 100.000 px.                                                  |
| AC-21 | Logical coverage không gap/duplicate; integrity fixture phải phát hiện sai lệch.                                    |
| AC-22 | Full-page thành công tự bắt đầu PDF export không cần mở editor.                                                     |
| AC-23 | Auto-PDF không tạo full-page canvas; decoded-tile concurrency bị giới hạn.                                          |
| AC-24 | Export lỗi giữ source tiles và retry không recapture.                                                               |
| AC-25 | Chụp mới trên terminal job xóa local capture data và cho phép job mới cùng tab.                                     |
| AC-26 | Reset active cancel/cleanup/discard sau xác nhận và phục hồi page state.                                            |
| AC-27 | Reset idempotent, isolated và giữ settings/downloaded files.                                                        |
| AC-28 | Popup mặc định không hiển thị version, milestone, raw tile count, engine hay checksum.                              |
| AC-29 | Help, diagnostics và advanced settings dùng được bằng keyboard.                                                     |
| AC-30 | Toàn bộ regression 0.1.0, privacy, permission và packaged lifecycle vẫn pass.                                       |
| AC-31 | Bấm Vẽ vùng chọn đóng popup sau ready ACK và overlay xuất hiện trên active tab trong 500 ms trên fixture.           |
| AC-32 | Pointer có thể create/move/resize/auto-scroll; kết quả khớp rectangle và không chứa selector pixels.                |
| AC-33 | Keyboard-only có thể tạo, move, resize, confirm và cancel vùng chọn.                                                |
| AC-34 | Selector launch failure không để orphan job, root, tab lock, tile hoặc artifact.                                    |
| AC-35 | Stored format/quality/PDF/fixed-sticky settings được dùng khi tạo job và tồn tại qua popup reopen.                  |
| AC-36 | Output mặc định theo mode đúng; region/element có ảnh trực tiếp khi dưới guard và fallback PDF rõ ràng khi quá lớn. |
| AC-37 | Progress event cập nhật UI; reconciliation polling không chạy với chu kỳ 350 ms liên tục.                           |
| AC-38 | Restart giữa adaptive capture resume an toàn hoặc giữ partial minh bạch, không duplicate prefix.                    |
| AC-39 | Actual-browser matrix có static 30k, 100k, >100k, lazy-growth, region launch và critical DPR/zoom flows.            |
| AC-40 | Release compatibility chạy minimum Chrome, current stable và previous stable trên các OS đã hỗ trợ.                 |

# 7. Chỉ số nghiệm thu nội bộ

- Region start-to-overlay success: 100% trên headed/package E2E fixture.
- Auto-scroll success: 100% trên static/lazy finite fixtures.
- Reset success: 100% terminal/active/interrupted/duplicate cases.
- Auto-PDF và bounded image export tạo file loadable, đúng coverage.
- Popup core flow: tối đa một goal selection và một start click trước progress.
- Không có P0/P1 về mất/lặp nội dung, cleanup, privacy, permission lifecycle hoặc orphan selector/job.
