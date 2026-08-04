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

Tài liệu này mở rộng PRD v1.0 cho WebCap 0.2.0. Mọi yêu cầu, giới hạn riêng tư và acceptance criteria của 0.1.0 vẫn có hiệu lực trừ khi tài liệu này thay thế rõ ràng.

# 1. Vấn đề cần giải quyết

Bản 0.1.0 đã có nền tảng chụp tile, scroll fallback và PDF exporter, nhưng trải nghiệm người dùng còn ba khoảng trống:

1. Luồng chụp cuộn chưa thể hiện đúng kỳ vọng “bắt đầu một lần, tự đi đến cuối trang, tự tạo PDF”. Engine hiện lập kế hoạch theo chiều cao đã đo và coi thay đổi chiều cao trong lúc capture là lỗi, nên chưa phù hợp với trang tiếp tục tải nội dung khi cuộn.
2. Sau khi một job tiled ở trạng thái `ready` hoặc `completed`, popup không có hành động rõ ràng để bỏ kết quả cũ và bắt đầu lượt chụp mới.
3. Popup hiển thị nhiều thông tin kỹ thuật như service-worker status, version, milestone badge, tile count, checksum và permission details ngay trong luồng chính; điều này làm yếu hành động cốt lõi.

# 2. Mục tiêu 0.2.0

| Mã | Mục tiêu | Kết quả người dùng |
| --- | --- | --- |
| G-06 | Tự động chụp cuộn đến cuối nội dung ổn định | Người dùng không phải cuộn hoặc ghép ảnh thủ công. |
| G-07 | Tự động tạo PDF sau capture dài | Kết quả mặc định là PDF tải được, không cần mở editor để hoàn tất tác vụ cơ bản. |
| G-08 | Cho phép bắt đầu lại rõ ràng | Có nút “Chụp mới” hoặc “Bỏ kết quả” ở mọi trạng thái kết thúc. |
| G-09 | Đơn giản hóa popup | Luồng mặc định chỉ hiển thị lựa chọn và trạng thái cần thiết cho người dùng phổ thông. |
| G-10 | Giữ nguyên tính local-first và độ an toàn | Không thêm backend, telemetry, remote code hoặc quyền mặc định mới. |

# 3. Phạm vi sản phẩm

## 3.1 Auto-scroll đến cuối trang

- Chế độ mặc định “Toàn trang → PDF” phải tự bắt đầu từ đầu tài liệu, cuộn tuần tự và chụp một contiguous prefix cho đến khi xác nhận đã đạt cuối nội dung ổn định.
- Sau mỗi bước cuộn, WebCap phải chờ layout/lazy content ổn định rồi đo lại chiều cao tài liệu.
- Nếu chiều cao tăng, capture tiếp tục từ frontier đã lưu thay vì hủy job hoặc lập lại toàn bộ từ đầu.
- Kết thúc tự động chỉ được xác nhận khi đồng thời đạt đáy trang và chiều cao không tăng qua số vòng settle đã khóa trong SPEC.
- Page scroll, focus, selection và mọi mutation do WebCap sở hữu phải được phục hồi sau success, error, cancel hoặc reset.
- Không được tạo khoảng trắng ẩn, trùng nội dung hoặc bỏ qua một đoạn giữa hai tile.

“Đến hết dù trang dài” trong yêu cầu sản phẩm nghĩa là **không dừng bởi một ngưỡng chiều cao CSS cố định tùy ý**. Trang vô hạn thật sự hoặc tài nguyên thiết bị hữu hạn vẫn phải có guard theo thời gian, dung lượng, tile và bộ nhớ. Khi guard kích hoạt, UI phải nói rõ đây là partial capture và cho phép giữ phần đã chụp hoặc bỏ toàn bộ.

## 3.2 Auto-PDF

- Khi auto-scroll hoàn tất, WebCap tự chuyển sang export PDF với preset mặc định đã lưu.
- Pipeline phải dùng tile/page streaming hiện có; không ghép toàn bộ trang thành một canvas khổng lồ.
- Overlap/crop metadata, fixed/sticky policy và contiguous coverage phải được áp dụng trước khi ghi từng trang PDF.
- Kết quả cơ bản hiển thị nút “Tải PDF”; editor là hành động phụ “Chỉnh sửa trang”.
- Nếu export PDF lỗi nhưng tile còn nguyên vẹn, người dùng có thể thử lại mà không chụp lại trang.
- Partial capture chỉ được auto-export khi người dùng đã chọn “Dừng và giữ phần đã chụp” hoặc xác nhận giữ kết quả do guard.

## 3.3 Reset và vòng đời “Chụp mới”

- Mọi trạng thái terminal (`ready`, `completed`, `failed`, `cancelled`) phải có hành động “Chụp mới”.
- Reset terminal xóa metadata phiên hiện tại, job, tile, thumbnail, edit manifest và artifact tạm thuộc job khỏi bộ nhớ local của extension.
- File người dùng đã tải xuống không bị xóa.
- Reset khi job đang chạy phải thực hiện cancel, cleanup trang và xóa dữ liệu tạm; UI phải yêu cầu xác nhận vì hành động không thể hoàn tác.
- Reset phải idempotent: gửi lặp lại cùng request không gây lỗi và không xóa dữ liệu của job khác.
- Sau reset, popup quay lại màn hình chọn chế độ và có thể bắt đầu job mới ngay trên cùng tab.

## 3.4 Tối ưu giao diện

### Luồng chính

Popup mặc định chỉ giữ:

1. Tên sản phẩm và trạng thái hỗ trợ ngắn gọn khi có vấn đề.
2. Ba mục tiêu người dùng:
   - **Toàn trang → PDF** — mặc định.
   - **Vùng cụ thể** — mở lựa chọn vùng chữ nhật, phần tử hoặc vùng cuộn.
   - **Màn hình hiện tại**.
3. Một nút hành động chính.
4. Progress ngôn ngữ tự nhiên.
5. Result card với **Tải PDF/ảnh**, **Chỉnh sửa** và **Chụp mới**.

### Thông tin chuyển sang vùng phụ

- Worker status, version, tile count, engine, checksum và diagnostics chuyển vào “Trợ giúp & chẩn đoán”.
- Permission/privacy details chuyển vào settings/help; chỉ hiện inline tại thời điểm cần xin quyền.
- Không hiển thị milestone/session badge như `M1`, `S14`, `S16`, `S17` cho người dùng cuối.
- PDF source card chỉ hiện khi tab hiện tại thực sự là PDF hoặc cần hành động của người dùng.
- Page size, margin, JPEG quality và fixed/sticky policy nằm trong “Tùy chọn nâng cao”, đóng mặc định.

# 4. Luồng trải nghiệm đích

## 4.1 Toàn trang → PDF

1. Người dùng mở popup; “Toàn trang → PDF” được chọn mặc định.
2. Người dùng bấm “Chụp toàn trang”.
3. Popup hiển thị các bước: Chuẩn bị trang → Đang cuộn và chụp → Đang tạo PDF.
4. WebCap tự cuộn đến cuối nội dung ổn định và phục hồi trang.
5. WebCap tự tạo PDF.
6. Result card hiển thị “Tải PDF”, “Chỉnh sửa” và “Chụp mới”.

## 4.2 Bắt đầu lại

1. Người dùng bấm “Chụp mới”.
2. WebCap dọn dữ liệu tạm của lượt trước.
3. Popup trở về màn hình chọn chế độ với cùng settings đã lưu.
4. Người dùng có thể bắt đầu capture mới ngay.

# 5. Ngoài phạm vi 0.2.0

- Không cam kết hoàn tất một feed infinite-scroll không có điểm kết thúc hữu hạn.
- Không thêm OCR, annotation, cloud sync, tài khoản, batch URL hoặc upload server.
- Không tự động tải file xuống nếu Chrome/user policy yêu cầu thao tác xác nhận; sản phẩm chỉ đảm bảo PDF được tạo sẵn và có hành động tải rõ ràng.
- Không bỏ editor PDF hiện tại; chỉ chuyển editor khỏi đường đi bắt buộc.
- Không thêm required permission hoặc default host permission mới.

# 6. Acceptance criteria mới

| Mã | Acceptance criterion |
| --- | --- |
| AC-19 | Một trang lazy-load có chiều cao tăng trong lúc cuộn được chụp đến chiều cao ổn định cuối cùng mà không restart job. |
| AC-20 | Một trang hữu hạn dài hơn 100.000 CSS px không bị dừng chỉ vì ngưỡng chiều cao 100.000 px. |
| AC-21 | Auto-scroll tạo contiguous logical coverage; test phát hiện gap hoặc duplicate strip phải fail. |
| AC-22 | Sau capture thành công, PDF export tự bắt đầu và hoàn tất mà không cần mở editor. |
| AC-23 | Auto-PDF không tạo logical full-page canvas và decoded-tile concurrency vẫn bị giới hạn. |
| AC-24 | Export lỗi giữ nguyên source tile và retry không recapture. |
| AC-25 | “Chụp mới” trên job terminal xóa toàn bộ dữ liệu tạm của job và cho phép tạo job mới trên cùng tab. |
| AC-26 | Reset đang chạy cancel, cleanup và xóa partial data sau xác nhận; page state được phục hồi. |
| AC-27 | Reset lặp lại an toàn và không ảnh hưởng job/artifact khác. |
| AC-28 | Popup mặc định không hiển thị worker version, milestone badge, raw tile count hoặc checksum. |
| AC-29 | Diagnostics, privacy và advanced settings vẫn truy cập được bằng keyboard trong vùng phụ. |
| AC-30 | Toàn bộ regression 0.1.0, privacy audit, permission audit và packaged lifecycle vẫn pass. |

# 7. Chỉ số nghiệm thu nội bộ

- Auto-scroll success: 100% trên fixture static, lazy-growth hữu hạn, 30k, 100k và >100k được định nghĩa trong SPEC 0.2.0.
- Reset success: 100% unit/E2E trên terminal, active, interrupted và duplicate-request cases.
- Auto-PDF: PDF mở được, đúng page count, không gap/duplicate theo integrity fixtures.
- Popup core flow: tác vụ toàn trang hoàn tất với tối đa một lựa chọn mode và một nút start trước progress.
- Không có P0/P1 về mất nội dung, lặp nội dung, cleanup, privacy hoặc permission lifecycle.
