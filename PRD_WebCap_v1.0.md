---
product: WebCap
document: Product Requirements Document
version: 1.0
date: 2026-08-02
status: Draft for build planning
repository: quoctran-2608/WebCap
language: vi
---

# WebCap — Product Requirements Document (PRD)

> PRD định nghĩa sản phẩm cần xây, phạm vi MVP và điều kiện nghiệm thu để Product, Design, Engineering và QA cùng triển khai.

# 1. Tóm tắt điều hành

WebCap là Chrome Extension cho phép người dùng chụp chính xác nội dung hiển thị trên trang web ở nhiều cấp độ: vùng đang xem, toàn bộ trang, vùng hình chữ nhật, một phần tử cụ thể hoặc một vùng cuộn nội bộ. Sản phẩm phải xử lý được trang rất dài, tài liệu PDF, nội dung lazy-load và các bố cục có phần tử fixed/sticky; sau khi chụp, người dùng có thể xuất ảnh hoặc PDF nhiều trang mà không cần tải dữ liệu lên máy chủ.

MVP tập trung vào ba giá trị cốt lõi: chụp đúng, chụp được nội dung dài và xuất được file ổn định. Các tính năng chỉnh sửa ảnh nâng cao, đồng bộ đám mây và cộng tác không nằm trong phạm vi phiên bản đầu.

> **Tuyên bố sản phẩm:** WebCap giúp người dùng lưu lại “toàn bộ những gì trang web đang thể hiện” thành một tài liệu có thể chia sẻ, lưu trữ hoặc in, ngay cả khi nội dung dài hơn nhiều lần màn hình.

## 1.1 Kết quả mong muốn của MVP

- Người dùng có thể hoàn thành một tác vụ chụp toàn trang và tải file xuống trong một luồng liên tục, không cần cấu hình kỹ thuật.
- Trang dài được chia thành tile an toàn, không yêu cầu tạo một canvas khổng lồ trong bộ nhớ.
- Tệp PDF xuất ra không thiếu nội dung, không lặp header ngoài ý muốn và mở được trên các trình đọc phổ biến.
- Extension minh bạch về quyền truy cập, chỉ xử lý dữ liệu trên thiết bị và khôi phục trang về trạng thái ban đầu sau khi chụp.

# 2. Bối cảnh, vấn đề và cơ hội

## 2.1 Vấn đề người dùng

- Ảnh chụp màn hình mặc định chỉ lưu phần đang hiển thị, không bao phủ toàn bộ trang hoặc nội dung trong khung cuộn.
- Nhiều công cụ chụp full-page bị lặp header sticky, bỏ sót ảnh lazy-load, lệch đường nối hoặc thất bại khi trang quá dài.
- Người dùng thường phải chụp nhiều ảnh thủ công rồi ghép lại, mất thời gian và khó đảm bảo thứ tự.
- Trang PDF, bảng dữ liệu, modal, khung chat và iframe có cơ chế cuộn khác nhau nên một phương pháp duy nhất không đủ tin cậy.
- Việc biến ảnh dài thành PDF thường gây file quá lớn, cắt trang sai hoặc tiêu tốn nhiều RAM.

## 2.2 Cơ hội sản phẩm

WebCap có thể tạo khác biệt bằng cách kết hợp nhiều capture engine, tự động nhận diện loại vùng cần chụp, chia nhỏ nội dung thành tile và đưa tile trực tiếp vào PDF. Cách tiếp cận này hướng đến độ chính xác và độ bền hơn là chỉ tối ưu tốc độ cho các trang đơn giản.

## 2.3 Các tình huống sử dụng có giá trị cao

| Tình huống | Nhu cầu | Kết quả mong đợi |
| --- | --- | --- |
| Lưu bằng chứng giao diện | Lưu toàn bộ trạng thái của một trang hoặc quy trình. | Ảnh/PDF có timestamp và tên nguồn rõ ràng. |
| Lưu tài liệu web/PDF | Chụp nội dung dài để đọc offline hoặc gửi cho người khác. | PDF nhiều trang dễ mở và in. |
| Review thiết kế website | Chụp một vùng hoặc phần tử để nhận xét. | Crop đúng vùng, không phải sửa thủ công. |
| Báo cáo và nghiên cứu | Lưu bảng, dashboard, nội dung nghiên cứu dài. | Không thiếu dòng, không mất phần phía dưới. |
| Hỗ trợ kỹ thuật/QA | Ghi lại lỗi và trạng thái trang. | File có đủ ngữ cảnh từ đầu đến cuối. |

# 3. Tầm nhìn, mục tiêu và chỉ số thành công

## 3.1 Tầm nhìn sản phẩm

Trở thành công cụ chụp nội dung web đáng tin cậy cho các trường hợp mà ảnh chụp màn hình thông thường không xử lý được, với trải nghiệm đơn giản cho người dùng phổ thông nhưng kiến trúc đủ mạnh cho trang dài và nội dung phức tạp.

## 3.2 Mục tiêu sản phẩm

| Mã | Mục tiêu | Chỉ báo |
| --- | --- | --- |
| G-01 | Chụp được nội dung ngoài viewport một cách ổn định. | Tỷ lệ job full-page hoàn thành thành công. |
| G-02 | Cho phép người dùng kiểm soát chính xác phạm vi chụp. | Tỷ lệ dùng region/element capture và tỷ lệ retry thấp. |
| G-03 | Xuất được file phù hợp cho lưu trữ và chia sẻ. | Tỷ lệ export thành công, file mở được. |
| G-04 | Giảm rủi ro riêng tư và tạo niềm tin. | Không upload mặc định; quyền được giải thích rõ. |
| G-05 | Tạo nền tảng dễ mở rộng. | Capture engine, processor và exporter tách module. |

## 3.3 Chỉ số thành công cho MVP

| Chỉ số | Mục tiêu ban đầu | Cách đo |
| --- | --- | --- |
| Capture success rate | ≥ 95% trên bộ fixture được hỗ trợ | Job hoàn thành / job bắt đầu. |
| Export success rate | ≥ 98% | File được tạo và download thành công. |
| Time to first successful capture | ≤ 2 phút đối với người dùng mới | Từ khi mở popup đến khi tải file đầu tiên. |
| Median full-page processing time | ≤ 15 giây cho trang 10.000 px trên máy tham chiếu | Telemetry cục bộ hoặc test benchmark. |
| Page restoration rate | 100% trong test tự động | Scroll/style sau job khớp trạng thái trước job. |
| Critical crash rate | < 1% job | Job dừng do exception hoặc service worker mất trạng thái. |

## 3.4 Không phải mục tiêu của MVP

- Không xây hệ thống tài khoản, đăng nhập hoặc đồng bộ đám mây.
- Không cung cấp OCR, nhận dạng văn bản hoặc chuyển ảnh thành tài liệu có thể chỉnh sửa.
- Không xây trình biên tập ảnh đầy đủ như Photoshop hoặc công cụ annotation chuyên sâu.
- Không cam kết chụp nội dung DRM, video được bảo vệ hoặc trang nội bộ bị Chrome hạn chế.
- Không tự động thu thập dữ liệu trang khi người dùng chưa chủ động bắt đầu tác vụ.

# 4. Người dùng mục tiêu và nhu cầu

## 4.1 Persona chính

| Persona | Bối cảnh | Nhu cầu ưu tiên |
| --- | --- | --- |
| P1 - Người dùng văn phòng/nghiên cứu | Thường lưu bài viết, biểu mẫu, dashboard hoặc tài liệu dài. | Nhanh, ít thao tác, PDF dễ chia sẻ. |
| P2 - Designer/Developer/QA | Cần ghi lại giao diện, bug hoặc vùng cụ thể của website. | Chính xác theo pixel, region/element capture, tên file rõ. |
| P3 - Người làm báo cáo/hỗ trợ | Cần bằng chứng toàn trang hoặc chuỗi nội dung trong khung cuộn. | Không bỏ sót dữ liệu, có progress và retry. |

## 4.2 Jobs-to-be-done

- Khi tôi cần lưu một trang dài, tôi muốn chụp toàn bộ trang trong một lần để không phải ghép ảnh thủ công.
- Khi tôi chỉ cần một phần của trang, tôi muốn kéo chọn hoặc chọn đúng phần tử để file kết quả không chứa nội dung thừa.
- Khi nội dung nằm trong một khung cuộn, tôi muốn WebCap chụp hết nội dung bên trong khung đó mà không cuộn nhầm toàn trang.
- Khi trang là PDF, tôi muốn chọn trang hoặc chụp toàn bộ tài liệu với chất lượng phù hợp.
- Khi file quá dài, tôi muốn xuất thành PDF nhiều trang để dễ đọc, in và chia sẻ.

# 5. Phạm vi sản phẩm

## 5.1 Phạm vi MVP

| Epic | Bao gồm trong MVP | Mức ưu tiên |
| --- | --- | --- |
| Capture viewport | Chụp phần đang hiển thị; PNG/JPEG/WebP. | MUST |
| Full-page capture | CDP tiled capture và scroll fallback. | MUST |
| Region capture | Kéo chọn vùng, hỗ trợ vùng ngoài viewport. | MUST |
| Element capture | Hover highlight, chọn parent/child, chụp bounding box. | MUST |
| Scrollable area | Chọn container cuộn và chụp toàn bộ nội dung. | SHOULD |
| PDF export | A4/Letter, fit-width, nhiều trang, quality setting. | MUST |
| PDF source handling | Nhận diện PDF URL và xử lý cơ bản. | SHOULD |
| Preview & basic crop | Xem trước, xóa trang/tile, crop đơn giản. | SHOULD |
| Job progress & cancel | Hiển thị trạng thái, hủy an toàn, retry lỗi. | MUST |
| Settings | Định dạng, chất lượng, lề, xử lý fixed/sticky. | MUST |

## 5.2 Phạm vi sau MVP

- Annotation: mũi tên, khung, blur, highlight và text note.
- Preset theo domain hoặc loại tài liệu.
- Batch capture nhiều URL.
- Tích hợp lưu vào Google Drive, Notion hoặc hệ thống tài liệu.
- OCR, tìm kiếm nội dung trong ảnh/PDF và trích xuất text.
- Đồng bộ setting giữa các thiết bị.

## 5.3 Ma trận hỗ trợ nguồn nội dung

| Nguồn | MVP | Hành vi kỳ vọng |
| --- | --- | --- |
| Trang HTML thông thường | Đầy đủ | Visible/full/region/element/scroll-area. |
| SPA và trang lazy-load | Đầy đủ có giới hạn | Pre-scroll, chờ layout ổn định. |
| Infinite scroll | Có giới hạn | Người dùng đặt giới hạn hoặc bấm dừng. |
| PDF trực tuyến | Cơ bản | Nhận diện, render/chụp hoặc fallback. |
| PDF local file:// | Tùy quyền | Yêu cầu bật quyền truy cập file URL. |
| Cross-origin iframe | Pixel-level | Chụp vùng hiển thị; DOM selection có thể bị hạn chế. |
| Chrome internal pages | Hạn chế | Thông báo rõ khi API không cho phép. |
| DRM/protected content | Không cam kết | Hiển thị giới hạn thay vì thất bại im lặng. |

# 6. Luồng trải nghiệm cốt lõi

## 6.1 Luồng chụp toàn trang

1. Người dùng mở trang cần chụp và nhấn biểu tượng WebCap.
2. Popup hiển thị các chế độ; người dùng chọn “Chụp toàn bộ trang”.
3. WebCap kiểm tra quyền, khả năng hỗ trợ và đo trang.
4. WebCap chuẩn bị trang: ghi trạng thái cuộn, tạm dừng animation và tải nội dung lazy-load theo chính sách.
5. Capture engine lập kế hoạch tile và chụp tuần tự; progress hiển thị số tile hoàn thành.
6. Khi hoàn tất, WebCap khôi phục trang và mở preview kết quả.
7. Người dùng chọn định dạng, cấu hình PDF/ảnh và tải file.

## 6.2 Luồng chọn vùng

1. Người dùng chọn “Chọn một vùng”.
2. Popup đóng; overlay toàn trang xuất hiện mà không làm thay đổi bố cục.
3. Người dùng kéo để tạo hình chữ nhật, có thể chỉnh handle, xem kích thước và cuộn trang để mở rộng vùng.
4. Người dùng xác nhận hoặc nhấn Esc để hủy.
5. WebCap chụp theo document coordinates, xử lý vùng vượt viewport và mở preview.

## 6.3 Luồng chọn phần tử/vùng cuộn

1. WebCap highlight phần tử dưới con trỏ và hiển thị kích thước.
2. Người dùng dùng phím lên/xuống để chuyển parent/child hoặc click để chọn.
3. Nếu phần tử có nội dung cuộn, WebCap đề xuất “Chụp phần đang thấy” hoặc “Chụp toàn bộ nội dung”.
4. Capture engine ghi lại scrollTop/scrollLeft, chụp tuần tự và khôi phục container.

# 7. Yêu cầu chức năng

Quy ước ưu tiên: MUST = bắt buộc cho MVP; SHOULD = nên có trong MVP nếu không làm trễ mốc chính; COULD = có thể hoãn; WON’T = không làm trong phiên bản này.

| ID | Tên yêu cầu | Mô tả | Ưu tiên |
| --- | --- | --- | --- |
| FR-CAP-001 | Chụp vùng đang hiển thị | Extension phải chụp đúng viewport hiện tại và loại trừ UI overlay của WebCap. | MUST |
| FR-CAP-002 | Chụp toàn trang | Extension phải đo toàn bộ document và chụp nội dung ngoài viewport. | MUST |
| FR-CAP-003 | Capture engine chính | Ưu tiên Chrome DevTools Protocol để chụp ngoài viewport theo tile. | MUST |
| FR-CAP-004 | Engine dự phòng | Khi CDP không khả dụng hoặc thất bại, hệ thống phải có scroll-and-capture fallback. | MUST |
| FR-CAP-005 | Tiling | Trang vượt ngưỡng an toàn phải được chia theo tile; tile có sequence và metadata. | MUST |
| FR-CAP-006 | Trang rộng | Nếu document rộng hơn giới hạn tile, hệ thống phải chia theo cả trục X và Y. | SHOULD |
| FR-CAP-007 | Lazy-load | Trước full-page capture, hệ thống phải hỗ trợ pre-scroll và chờ layout ổn định theo cấu hình. | MUST |
| FR-CAP-008 | Infinite scroll | Hệ thống phải có giới hạn chiều cao/số tile/thời gian và cho phép người dùng dừng để export phần đã chụp. | MUST |
| FR-CAP-009 | Fixed/sticky | Người dùng có thể chọn Preserve, Smart hoặc Remove đối với phần tử fixed/sticky. | MUST |
| FR-CAP-010 | Animation | Hệ thống phải tạm dừng CSS animation/transition trong lúc chụp và khôi phục sau đó. | SHOULD |
| FR-REG-001 | Kéo chọn vùng | Người dùng có thể kéo tạo vùng hình chữ nhật, chỉnh handle và hủy bằng Esc. | MUST |
| FR-REG-002 | Vùng ngoài viewport | Vùng chọn phải được lưu theo document coordinates và có thể vượt viewport. | MUST |
| FR-REG-003 | Hiển thị kích thước | Overlay phải hiển thị width × height và biên vùng chọn theo thời gian thực. | SHOULD |
| FR-ELM-001 | Chọn phần tử | WebCap phải highlight phần tử dưới con trỏ và cho phép click để chọn. | MUST |
| FR-ELM-002 | Điều hướng DOM | Người dùng có thể chuyển parent/child bằng bàn phím trước khi xác nhận. | SHOULD |
| FR-ELM-003 | Shadow DOM | Element selector nên dùng composed path để hỗ trợ phần tử trong Shadow DOM khi có thể. | COULD |
| FR-SCR-001 | Phát hiện vùng cuộn | Hệ thống phải nhận diện scrollable ancestor và phân biệt với window scroll. | SHOULD |
| FR-SCR-002 | Chụp container | Hệ thống phải chụp toàn bộ scrollWidth/scrollHeight của container đã chọn. | SHOULD |
| FR-SCR-003 | Khôi phục container | Sau khi chụp, scrollTop/scrollLeft và style của container phải trở về trạng thái ban đầu. | MUST |
| FR-PDF-001 | Nhận diện PDF | WebCap phải nhận diện tab/URL PDF và chuyển sang luồng phù hợp. | SHOULD |
| FR-PDF-002 | Phạm vi trang | Với PDF có thể đọc, người dùng có thể chọn toàn bộ hoặc range trang. | SHOULD |
| FR-PDF-003 | Original passthrough | Nếu không chỉnh sửa, hệ thống nên cho phép giữ/tải PDF gốc khi có thể. | COULD |
| FR-EXP-001 | Xuất ảnh | Hỗ trợ PNG, JPEG và WebP; người dùng chọn chất lượng khi phù hợp. | MUST |
| FR-EXP-002 | Xuất PDF nhiều trang | Hỗ trợ A4, Letter, portrait/landscape, lề và fit-width. | MUST |
| FR-EXP-003 | PDF một trang dài | Có thể xuất one-long-page kèm cảnh báo tương thích/kích thước. | COULD |
| FR-EXP-004 | Không cần canvas khổng lồ | Exporter phải có khả năng đưa tile trực tiếp vào các trang PDF. | MUST |
| FR-EXP-005 | Tên file | Tên file mặc định gồm title/domain/timestamp và được sanitize. | MUST |
| FR-EDT-001 | Preview | Sau capture, người dùng phải xem được thumbnail và kích thước ước tính. | MUST |
| FR-EDT-002 | Xóa/sắp xếp | Người dùng có thể xóa tile/trang lỗi và sắp xếp lại trang PDF. | SHOULD |
| FR-EDT-003 | Crop cơ bản | Người dùng có thể crop lại kết quả trước khi export. | SHOULD |
| FR-JOB-001 | Trạng thái job | Job phải có state machine rõ ràng: created/preparing/capturing/processing/exporting/completed/failed/cancelled. | MUST |
| FR-JOB-002 | Progress | UI hiển thị tiến trình, tile hiện tại và hành động cancel. | MUST |
| FR-JOB-003 | Cancel an toàn | Hủy job phải dừng capture, detach debugger, giải phóng tài nguyên và restore trang. | MUST |
| FR-JOB-004 | Resume/recovery | Metadata job phải được lưu để tránh mất trạng thái khi service worker bị suspend. | MUST |
| FR-SET-001 | Cấu hình mặc định | Người dùng có thể lưu định dạng, quality, PDF size, margin và fixed/sticky mode. | MUST |
| FR-SET-002 | Reset | Người dùng có thể đặt lại toàn bộ setting về mặc định. | SHOULD |
| FR-ERR-001 | Thông báo lỗi | Lỗi phải có mã, mô tả dễ hiểu và gợi ý hành động tiếp theo. | MUST |
| FR-ERR-002 | Retry/fallback | Lỗi engine chính có thể chuyển sang fallback mà không yêu cầu người dùng khởi động lại toàn bộ luồng. | SHOULD |

# 8. Yêu cầu UX và nội dung giao diện

## 8.1 Nguyên tắc trải nghiệm

- Một hành động chính trên mỗi màn hình; người dùng không cần hiểu CDP, tile hoặc DPR.
- Luôn hiển thị WebCap đang làm gì và còn bao nhiêu bước/tile.
- Không làm người dùng mất trạng thái trang; mọi thay đổi tạm thời phải được khôi phục.
- Giải thích quyền truy cập đúng thời điểm, bằng ngôn ngữ liên quan trực tiếp đến hành động.
- Đưa ra mặc định an toàn nhưng cho phép người dùng nâng chất lượng hoặc giới hạn kích thước.

## 8.2 Popup chính

| Thành phần | Yêu cầu |
| --- | --- |
| Nhóm chế độ chụp | Visible, Full page, Region, Element, Scrollable area. |
| Định dạng nhanh | PNG/JPEG/WebP/PDF, nhớ lựa chọn gần nhất. |
| Chất lượng | Nhẹ / Cân bằng / Cao hoặc slider khi định dạng hỗ trợ. |
| Nút bắt đầu | Trạng thái enabled/disabled rõ; loading khi kiểm tra tab. |
| Cảnh báo quyền | Chỉ hiển thị khi quyền thực sự cần thiết. |

## 8.3 Overlay chọn vùng/phần tử

- Màu overlay đủ tương phản nhưng không che mất nội dung cần chọn.
- Hiển thị tooltip kích thước và nhãn phần tử mà không nằm trong vùng file kết quả.
- Hỗ trợ Esc để hủy, Enter để xác nhận và phím mũi tên để điều chỉnh/điều hướng.
- Khi người dùng cuộn trong lúc chọn, rectangle vẫn bám đúng document coordinates.

## 8.4 Progress và trạng thái

| Trạng thái | Copy đề xuất |
| --- | --- |
| Preparing | Đang chuẩn bị trang… |
| Loading lazy content | Đang tải phần nội dung phía dưới… |
| Capturing | Đang chụp {completed}/{total}… |
| Processing | Đang xử lý ảnh… |
| Exporting | Đang tạo tệp {format}… |
| Restoring | Đang khôi phục trang… |
| Completed | Đã sẵn sàng để tải xuống. |
| Cancelled | Đã hủy. Trang đã được khôi phục. |

## 8.5 Lỗi quan trọng

| Mã UX | Trường hợp | Thông điệp/hành động |
| --- | --- | --- |
| E-PERMISSION | Thiếu quyền | Giải thích quyền và nút cấp quyền. |
| E-UNSUPPORTED | Trang bị Chrome hạn chế | Nêu rõ trang này không thể chụp toàn trang; đề xuất visible capture. |
| E-DETACHED | Debugger bị ngắt | Đề xuất đóng DevTools hoặc dùng fallback. |
| E-MEMORY | Kết quả quá lớn | Giảm chất lượng, chia file hoặc xuất PDF nhiều trang. |
| E-LAYOUT-CHANGED | Trang thay đổi liên tục | Cho retry với chế độ khóa/giới hạn nội dung. |
| E-EXPORT | Tạo file thất bại | Retry export mà không chụp lại nếu tile còn tồn tại. |

# 9. Yêu cầu phi chức năng

| ID | Nhóm | Yêu cầu | Ưu tiên |
| --- | --- | --- | --- |
| NFR-PERF-001 | Hiệu năng | Không block UI tab dài hơn 100 ms trong một tác vụ đồng bộ; xử lý ảnh nặng ở offscreen/worker. | MUST |
| NFR-PERF-002 | Bộ nhớ | Không giữ toàn bộ ảnh base64 trong service worker; tile lưu dạng binary/IndexedDB và giải phóng sau sử dụng. | MUST |
| NFR-PERF-003 | Giới hạn an toàn | Có ngưỡng cảnh báo theo pixel, số tile và dung lượng ước tính. | MUST |
| NFR-REL-001 | Tính nhất quán | Mỗi tile có ID, thứ tự, checksum hoặc metadata đủ để phát hiện thiếu/trùng. | SHOULD |
| NFR-REL-002 | Khôi phục | Mọi đường thoát success/error/cancel đều phải chạy cleanup và restore trong finally-equivalent. | MUST |
| NFR-REL-003 | Idempotency | Message xử lý job phải có jobId và tránh tạo tile trùng khi retry. | MUST |
| NFR-COMP-001 | Tương thích | Hỗ trợ phiên bản Chrome tối thiểu được xác định trong manifest và hai phiên bản stable gần nhất. | MUST |
| NFR-COMP-002 | DPI/Zoom | Hoạt động tại DPR 1–2 và zoom 80–150% theo ma trận test. | MUST |
| NFR-SEC-001 | Local-first | Không upload ảnh/nội dung trang lên server trong MVP. | MUST |
| NFR-SEC-002 | Quyền tối thiểu | Ưu tiên activeTab và optional host permissions; chỉ yêu cầu quyền khi cần. | MUST |
| NFR-SEC-003 | Debugger lifecycle | Attach debugger ngay trước capture và detach ngay sau capture/cancel/error. | MUST |
| NFR-A11Y-001 | Bàn phím | Popup, overlay và editor sử dụng được bằng bàn phím. | SHOULD |
| NFR-A11Y-002 | Tương phản | Tuân thủ mức tương phản WCAG AA cho text và control chính. | SHOULD |
| NFR-I18N-001 | Ngôn ngữ | Kiến trúc copy hỗ trợ tiếng Việt và tiếng Anh; MVP ít nhất có tiếng Việt đầy đủ. | SHOULD |
| NFR-MAINT-001 | Module hóa | Capture engine, processor, storage và exporter có interface độc lập để thay thế/test. | MUST |
| NFR-MAINT-002 | Quan sát lỗi | Mọi lỗi nội bộ có mã, context an toàn và log cục bộ cho debug. | MUST |

# 10. Dữ liệu, quyền riêng tư và bảo mật

## 10.1 Nguyên tắc

- Xử lý ảnh và PDF trên thiết bị; không có backend trong MVP.
- Không lưu lịch sử capture vĩnh viễn nếu người dùng không chủ động lưu.
- Tile tạm phải được xóa sau download hoặc theo thời gian hết hạn cấu hình.
- Không thu thập nội dung trang, URL đầy đủ hoặc ảnh chụp vào analytics.
- Mọi quyền nhạy cảm phải có giải thích về mục đích và thời điểm sử dụng.

## 10.2 Ma trận quyền

| Quyền/API | Mục đích | Nguyên tắc sử dụng |
| --- | --- | --- |
| activeTab | Truy cập tạm thời tab khi người dùng chủ động bấm chụp. | Mặc định ưu tiên thay cho quyền toàn bộ website. |
| scripting | Inject selector, page preparation và restore logic. | Chỉ inject khi job bắt đầu. |
| debugger | Dùng CDP để đo/chụp ngoài viewport. | Attach ngắn hạn; luôn detach. |
| offscreen | Canvas/DOM/PDF processing ngoài service worker. | Không hiển thị và không dùng để theo dõi. |
| downloads | Lưu file kết quả. | Chỉ sau thao tác export. |
| storage | Lưu setting và metadata job. | Không lưu nội dung ảnh vào sync storage. |
| optional host permissions | Xử lý PDF/iframe/file URL khi cần. | Xin theo tình huống, không xin trước toàn bộ. |

## 10.3 Threat considerations

- Không thực thi remote code; mọi thư viện phải được bundle và pin version.
- Sanitize tên file và dữ liệu text hiển thị từ trang để tránh injection vào editor UI.
- Giới hạn dữ liệu truyền qua message; binary lớn đi qua storage/object URL phù hợp.
- Không ghi cookie, token hoặc nội dung HTML nguyên bản vào log.
- Cần có dependency scanning và kiểm tra license trước mỗi release.

# 11. Analytics và quan sát sản phẩm

Analytics trong MVP là tùy chọn và phải ưu tiên privacy. Nếu triển khai telemetry, chỉ thu thập event kỹ thuật tổng hợp, không thu URL đầy đủ, tiêu đề trang, ảnh, nội dung hoặc selector.

| Event | Thuộc tính cho phép | Không được thu |
| --- | --- | --- |
| capture_started | mode, engine_attempt, browser_version_bucket | URL, title, page content |
| capture_completed | mode, tile_count_bucket, duration_bucket, output_type | Ảnh/tile binary |
| capture_failed | error_code, stage, fallback_used | Stack chứa dữ liệu trang |
| export_completed | format, page_count_bucket, size_bucket | Tên file hoặc path |
| permission_prompted | permission_type, accepted/rejected | Thông tin website cụ thể |

## 11.1 Dashboard tối thiểu

- Capture success theo mode và engine.
- Top error code theo phiên bản extension.
- Median/P95 duration theo số tile.
- Export success theo định dạng.
- Tỷ lệ fallback từ CDP sang scroll engine.

# 12. Tiêu chí nghiệm thu

| ID | Hạng mục | Điều kiện đạt | Phương pháp |
| --- | --- | --- | --- |
| AC-01 | Visible capture | Ảnh có kích thước khớp viewport theo DPR; không chứa popup/overlay WebCap. | Automated + visual diff |
| AC-02 | Full-page cơ bản | Trang fixture 30.000 px được chụp đủ từ đầu đến cuối, không thiếu/lặp tile. | E2E |
| AC-03 | Trang rất dài | Trang 100.000 px hoàn thành bằng tiled capture mà không vượt ngưỡng memory của máy test. | Benchmark |
| AC-04 | Lazy image | Tất cả ảnh lazy-load trong fixture xuất hiện hoặc được báo là chưa tải theo timeout policy. | E2E |
| AC-05 | Infinite scroll | Job dừng đúng giới hạn và cho export phần đã chụp. | E2E |
| AC-06 | Fixed header Smart | Header xuất hiện một lần ở đầu, không lặp tại biên tile. | Visual diff |
| AC-07 | Region ngoài viewport | Vùng chọn dài hơn viewport được crop đúng trong sai số ≤ 1 device pixel tại biên. | E2E + pixel assertion |
| AC-08 | Element capture | Bounding box của phần tử khớp kết quả; overlay không lọt vào ảnh. | E2E |
| AC-09 | Scrollable container | Chụp đủ scrollHeight của container và giữ nguyên vị trí scroll sau job. | E2E |
| AC-10 | Cancel | Khi hủy giữa job, debugger được detach, tile tạm được dọn và trang được restore. | Integration |
| AC-11 | Service worker suspend | Job metadata không mất; UI nhận trạng thái hợp lệ sau khi worker khởi động lại. | Integration |
| AC-12 | PDF A4 | Ảnh dài được chia trang liên tục, không có khoảng trắng bất thường hoặc nội dung trùng. | Automated PDF check + manual |
| AC-13 | Export retry | Nếu export lỗi nhưng tile còn tồn tại, retry không cần chụp lại. | Integration |
| AC-14 | Zoom/DPR | Các chế độ chính vượt qua test tại zoom 80/100/125/150% và DPR 1/1.5/2. | Matrix |
| AC-15 | Privacy | Không có network request chứa image/page content trong capture/export flow. | Network audit |
| AC-16 | Permission lifecycle | Không xin host permission toàn cục khi chưa cần; debugger chỉ attach trong job. | Manual + API spy |
| AC-17 | File integrity | PNG/JPEG/WebP/PDF mở được bằng các ứng dụng mục tiêu và có dung lượng > 0. | Automated smoke |
| AC-18 | Error copy | Mỗi lỗi bắt buộc có mã, mô tả và ít nhất một hành động khả thi. | UX review |

# 13. Kế hoạch phát hành

| Milestone | Phạm vi | Exit criteria |
| --- | --- | --- |
| M0 - Foundation | Manifest V3, TypeScript, build, popup, message schema, CI. | Load unpacked thành công; lint/typecheck/test pass. |
| M1 - Visible Capture | Viewport capture, preview, PNG/JPEG/WebP, download. | AC-01 và smoke export pass. |
| M2 - Full Page | CDP, tile planner, storage, progress, cleanup. | AC-02, AC-03, AC-06, AC-10 pass. |
| M3 - Region/Element | Overlay, coordinate conversion, element inspector. | AC-07, AC-08 pass. |
| M4 - PDF Export | A4/Letter, fit-width, page slicing, retry. | AC-12, AC-13, AC-17 pass. |
| M5 - Scroll Area/PDF Source | Container capture, PDF detection/handling cơ bản. | AC-09 và PDF smoke pass. |
| M6 - Hardening | Lazy/infinite, zoom/DPR, accessibility, store readiness. | Toàn bộ MUST AC pass; không còn P0/P1 bug. |

## 13.1 Quy tắc phát hành

- Không phát hành nếu còn lỗi mất nội dung, lặp nội dung, không restore trang hoặc debugger không detach.
- Mỗi milestone tạo một bản extension ZIP có version và changelog rõ ràng.
- Feature chưa đạt acceptance criteria phải nằm sau feature flag hoặc bị loại khỏi UI.
- Chrome Web Store submission chỉ diễn ra sau security/privacy review và test bản packaged.

# 14. Chiến lược QA

## 14.1 Các lớp kiểm thử

| Lớp | Mục tiêu | Ví dụ |
| --- | --- | --- |
| Unit | Logic thuần, nhanh và ổn định. | Tile planner, coordinate conversion, page slicing, filename sanitizer. |
| Integration | Message, job state, storage, cancellation và retry. | Service worker suspend, offscreen processing, debugger lifecycle mock. |
| E2E | Luồng extension thật trên Chromium. | Capture fixture, download file, kiểm tra restore. |
| Visual regression | Phát hiện đường nối, lệch crop, lặp fixed header. | Golden images tại các DPR/zoom. |
| Performance | Đo thời gian, peak memory và file size. | Trang 10k/30k/100k px, PNG vs JPEG vs PDF. |
| Security/privacy | Kiểm tra quyền, network và dependency. | Network audit, CSP, remote code scan. |

## 14.2 Bộ fixture bắt buộc

- normal-long-page, lazy-images, infinite-scroll, sticky-header, fixed-header-footer;
- nested-scroll, wide-table, iframe, canvas, WebGL, shadow-dom, animated-page;
- PDF nhiều trang, PDF yêu cầu xác thực giả lập, local file và trang lỗi/timeout.

## 14.3 Ma trận môi trường

| Biến | Giá trị |
| --- | --- |
| Hệ điều hành | Windows, macOS, Linux |
| Chrome | Minimum supported, Stable hiện tại, Stable - 1 |
| Zoom | 80%, 100%, 125%, 150% |
| DPR | 1.0, 1.25/1.5, 2.0 |
| Định dạng | PNG, JPEG, WebP, PDF A4/Letter |
| Chiều dài | 1 viewport, 10k, 30k, 100k CSS px |

# 15. Rủi ro và phương án giảm thiểu

| Rủi ro | Tác động | Xác suất | Giảm thiểu |
| --- | --- | --- | --- |
| Quyền debugger làm người dùng e ngại | Cao | Trung bình | Giải thích tại đúng thời điểm; attach ngắn hạn; privacy page rõ. |
| Trang quá dài gây hết RAM | Cao | Cao | Tiling, IndexedDB, streaming PDF, size guardrails. |
| Trang thay đổi liên tục | Trung bình | Cao | Freeze animation, stability polling, giới hạn infinite scroll. |
| Fixed/sticky bị lặp | Cao | Trung bình | Smart mode, fixture riêng và visual regression. |
| PDF có auth/CORS khó fetch | Trung bình | Cao | Nhiều fallback; pixel capture; giải thích hạn chế. |
| Debugger bị detach khi DevTools mở | Trung bình | Trung bình | Bắt onDetach, thông báo và fallback scroll. |
| Service worker bị suspend | Cao | Trung bình | Persist metadata, idempotent messages, recovery flow. |
| Chrome Web Store từ chối vì permission/remote code | Cao | Thấp-Trung bình | Bundle toàn bộ code, permission review, policy checklist. |

# 16. Phụ thuộc, giả định và câu hỏi mở

## 16.1 Phụ thuộc

- Chrome Extension Manifest V3 và các API: tabs, scripting, debugger, offscreen, storage, downloads.
- Thư viện PDF được bundle nội bộ và tương thích CSP của extension.
- Playwright/Chromium để chạy E2E với extension.
- Bộ fixture được version-control để tái lập lỗi.

## 16.2 Giả định

- Người dùng chủ động bắt đầu tác vụ từ toolbar/popup.
- MVP ưu tiên Chrome desktop; Edge/Chromium khác có thể tương thích nhưng chưa cam kết.
- Không có backend, tài khoản hoặc cloud storage trong phiên bản đầu.
- Trang có thể thay đổi do script; WebCap chỉ đảm bảo theo policy ổn định đã định nghĩa.

## 16.3 Câu hỏi mở cần chốt trước M2

| ID | Câu hỏi | Đề xuất mặc định |
| --- | --- | --- |
| OQ-01 | Ngưỡng tile tối đa theo chiều cao và diện tích? | Bắt đầu 8.192 CSS px/tile, điều chỉnh theo benchmark. |
| OQ-02 | PDF library chính? | Đánh giá pdf-lib và jsPDF bằng prototype dung lượng lớn. |
| OQ-03 | Lưu tile tạm bao lâu? | Xóa sau download hoặc sau 30 phút nếu job bị bỏ dở. |
| OQ-04 | Có bật analytics mặc định không? | Tắt mặc định hoặc opt-in rõ ràng. |
| OQ-05 | Minimum Chrome version? | Chốt theo API offscreen/service worker cần dùng và ma trận test. |
| OQ-06 | Scrollable area có nằm trong MVP bắt buộc? | SHOULD; có thể đẩy sang M5 nếu ảnh hưởng mốc full-page/PDF. |

# 17. Phụ lục

## 17.1 Kiến trúc logic tham chiếu

> **Pipeline cốt lõi:** Đo trang → chuẩn bị trang → lập kế hoạch tile → chụp → lưu tile tạm → preview → xuất ảnh/PDF → giải phóng tài nguyên → khôi phục trang.

| Module | Trách nhiệm |
| --- | --- |
| Popup/Side panel | Chọn mode, định dạng và setting; khởi tạo job. |
| Background service worker | Điều phối job, quyền, debugger, lifecycle và download. |
| Content scripts | Region/element selector, đo trang, prepare/restore, scroll container. |
| Capture engines | CDP capture và scroll fallback. |
| Offscreen processor | Decode/crop/encode ảnh, PDF generation, memory management. |
| Editor/Preview | Thumbnail, crop cơ bản, xóa/sắp xếp và export settings. |
| Storage | Setting, job metadata và tile tạm. |

## 17.2 Mô hình dữ liệu job tham chiếu

```ts
interface CaptureJob {
  id: string;
  tabId: number;
  mode: CaptureMode;
  engine: CaptureEngine;
  state: "created" | "preparing" | "capturing" | "processing" | "exporting" | "completed" | "failed" | "cancelled";
  pageMetrics?: PageMetrics;
  region?: CaptureRegion;
  tilePlan?: Tile[];
  completedTiles: number;
  totalTiles: number;
  outputSettings: OutputSettings;
  errorCode?: string;
  cleanupStatus?: string;
  createdAt: string;
  updatedAt: string;
}
```

## 17.3 Định nghĩa hoàn thành MVP

- Tất cả yêu cầu MUST có implementation, test và tài liệu sử dụng.
- Tất cả acceptance criteria MUST tương ứng pass trên bản packaged.
- Không còn P0/P1 bug; P2 còn lại phải có workaround rõ.
- Privacy, permission và Chrome Web Store checklist được phê duyệt.
- README repo mô tả build, test, load unpacked và kiến trúc chính.
- Release artifact gồm extension ZIP, changelog và test report.

## 17.4 Thuật ngữ

| Thuật ngữ | Định nghĩa |
| --- | --- |
| Viewport | Phần trang hiện đang nhìn thấy trong tab. |
| Document coordinates | Tọa độ tương đối với toàn bộ tài liệu, không chỉ viewport. |
| Tile | Một mảnh ảnh có kích thước giới hạn được chụp và xử lý độc lập. |
| CDP | Chrome DevTools Protocol, dùng để đo và chụp ngoài viewport. |
| DPR | Device Pixel Ratio giữa CSS pixel và device pixel. |
| Scrollable container | Phần tử có vùng nội dung lớn hơn kích thước hiển thị và có cơ chế cuộn riêng. |
| Fallback engine | Phương pháp cuộn và chụp viewport khi engine chính không dùng được. |
