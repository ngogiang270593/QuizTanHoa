# Tạo cuộc thi từ toàn bộ câu hỏi theo chủ đề

## Cách sử dụng

1. Trong **Ngân hàng câu hỏi**, gán chủ đề khi thêm hoặc sửa câu hỏi. Ứng dụng hiện chỉ phân loại câu hỏi theo chủ đề.
2. Vào **Tạo cuộc thi → Theo chủ đề**, chọn một hoặc nhiều chủ đề. Hệ thống mặc định chọn toàn bộ câu hỏi của từng chủ đề.
3. Bấm **Xem và bỏ chọn câu hỏi**. Màn hình chỉ hiển thị câu hỏi thuộc các chủ đề đã chọn.
4. Bỏ tích từng câu, bấm nút bỏ ở danh sách bên phải, hoặc dùng **Bỏ chọn kết quả đang lọc** để loại nhiều câu cùng lúc. Có bộ lọc chủ đề, loại câu, nguồn và tìm kiếm không dấu. Lựa chọn giữ nguyên khi đổi bộ lọc hoặc trang.
5. Bấm **Giữ các câu đã chọn** để áp dụng. **Hủy** đóng màn hình mà không thay đổi lựa chọn trước đó. Có thể mở lại để chọn lại câu đã bỏ.
6. Từng chủ đề hiển thị số câu giữ lại / số câu có sẵn, kèm nút **Khôi phục tất cả**.
7. Đặt tên đề, thời lượng và lưu cuộc thi. Đề nháp chứa đúng các câu được giữ lại; mở lại không rút ngẫu nhiên. Tiếp tục kiểm tra, duyệt đề, cấu hình lịch, phân công và công bố theo quy trình hiện có.

## Quy tắc

- Chọn chủ đề luôn lấy đủ toàn bộ câu trước, kể cả khi tổng vượt 400. Khi đó hệ thống yêu cầu bỏ bớt trước khi áp dụng/lưu; cho phép bỏ dần từng câu cho tới khi còn tối đa 400.
- Đề cần từ 1 đến 400 câu, thời lượng 1–480 phút. Có thể bỏ toàn bộ câu của một chủ đề nếu các chủ đề khác vẫn còn câu.
- Bỏ câu khỏi đề đang tạo không xóa câu khỏi ngân hàng.
- Bỏ chọn chủ đề loại các câu của chủ đề đó khỏi đề đang tạo; chọn lại chủ đề sẽ lấy lại toàn bộ câu.
- Không chọn chủ đề nào vẫn cho phép lưu cuộc thi chưa có đề để bổ sung sau.
- Chế độ **Tự chọn câu hỏi** vẫn được giữ. Chỉ chế độ đang chọn được gửi khi lưu.
- Máy chủ xác thực các mã câu hỏi đang hoạt động, giới hạn và tính duy nhất. Câu hỏi đã bị xóa ở nơi khác khiến lưu báo lỗi thay vì âm thầm đổi danh sách.
- Câu hỏi cũ chưa có chủ đề dùng phần tên nguồn trước dấu `|`; nếu không có nguồn thì thuộc **Chưa phân chủ đề**.
- API rút theo số lượng chủ đề cũ vẫn được giữ để tương thích. Giao diện tạo cuộc thi mới gửi danh sách mã câu cụ thể sau rà soát.

## Kiểm tra

- `node --test frontend/tests/*.test.mjs`: mặc định tất cả, bỏ nhiều câu, chọn lại, khôi phục, lọc theo chủ đề và giảm danh sách quá giới hạn.
- `npm.cmd run test:cloud`: API cloud, danh sách câu giữ lại chính xác và ngân hàng không thay đổi.
- `npm.cmd run test:topics`: API SQLite với cơ sở dữ liệu riêng trong `.artifacts/topics`.
- `npm.cmd --prefix frontend run build:web`

Đã phát hành lên https://quiztanhoa.pages.dev ngày 14/11/2026; xem thêm docs/topic-catalog.md.
