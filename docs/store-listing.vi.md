# Nội dung Chrome Web Store — tiếng Việt

## Tên

WebCap

## Mô tả ngắn

Chụp vùng đang xem, toàn trang, vùng chọn, phần tử hoặc vùng cuộn và xuất ảnh/PDF ngay trên thiết bị.

## Mục đích duy nhất

WebCap giúp người dùng chủ động chụp nội dung đang được Chrome hiển thị thành ảnh hoặc PDF để lưu trữ, chia sẻ, in hoặc phục vụ review/QA. Mọi xử lý mặc định diễn ra cục bộ trên thiết bị.

## Mô tả chi tiết

WebCap chụp nội dung web vượt ngoài giới hạn của ảnh màn hình thông thường, đồng thời ưu tiên độ chính xác, khả năng khôi phục trang và quyền riêng tư.

Tính năng chính:

- Chụp vùng đang xem thành PNG, JPEG hoặc WebP.
- Chụp toàn bộ trang dài bằng tile; tự chuyển sang phương án cuộn khi CDP không khả dụng.
- Kéo chọn một vùng dài hơn viewport hoặc chọn phần tử DOM bằng bàn phím/chuột.
- Chụp toàn bộ nội dung trong container cuộn, modal, bảng rộng hoặc khung chat.
- Xuất PDF A4, Letter hoặc fit-width; xem trước, đổi thứ tự, xóa trang và retry export mà không chụp lại.
- Nhận biết nguồn PDF và tải byte gốc khi người dùng chủ động cấp đúng quyền tùy chọn.
- Hiển thị tiến độ, cho hủy an toàn, báo rõ phần chụp một phần và khôi phục vị trí/style của trang.
- Giao diện tiếng Việt/Anh, hỗ trợ bàn phím và thông tin chẩn đoán đã loại dữ liệu nhạy cảm.

Quyền riêng tư:

- Không có tài khoản, quảng cáo, analytics, cloud sync hoặc backend tải nội dung.
- Ảnh/PDF và tile tạm được xử lý trên thiết bị.
- WebCap không tự động gửi URL đầy đủ, nội dung trang, ảnh, PDF, cookie, token hay thông tin đăng nhập.
- Quyền website/file tùy chọn chỉ được hỏi khi người dùng yêu cầu tải PDF gốc; từ chối quyền không làm mất các chế độ chụp ảnh.

Giới hạn: Chrome không cho extension truy cập một số trang nội bộ/Store và nội dung DRM; WebCap sẽ thông báo rõ thay vì âm thầm tạo kết quả thiếu.

## Danh mục đề xuất

Productivity

## Ghi chú kiểm thử cho reviewer

1. Mở một trang HTTP/HTTPS thông thường và bấm biểu tượng WebCap.
2. Chọn “Vùng đang xem” để tạo preview và tải PNG.
3. Chọn “Toàn bộ trang” trên trang dài để xem tiến độ, preview tile và xuất PDF.
4. Các quyền origin/file chỉ xuất hiện khi chọn tải PDF gốc; không cần tài khoản hay credential thử nghiệm.
5. Không dùng `chrome://`, trang Chrome Web Store hoặc nội dung DRM làm fixture vì Chrome chặn các surface này.
