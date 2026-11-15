# Hai quy trình Ban Tổ chức và luồng dự thi riêng

## Cấu trúc menu

### 1. Biên tập

- **Bàn biên tập** (`/ban-to-chuc/bien-tap`): đếm đề Nháp, Trả lại, Chờ duyệt và Đã duyệt; tìm theo tên cuộc thi/đề, lọc trạng thái, mở đúng đề cần xử lý.
- **Danh mục chủ đề**: thêm, sửa, xóa chủ đề trống.
- **Ngân hàng câu hỏi**: lọc chủ đề, soạn câu và chuyển nhiều câu sang chủ đề khác.
- **Cuộc thi & đề nháp**: tạo cuộc thi theo chủ đề, mặc định chọn toàn bộ câu và bỏ chọn nhiều câu; cấu hình đề và gửi duyệt.

Bộ phận biên tập bàn giao bằng thao tác **Gửi chờ duyệt**. Đề bị trả lại hiện lý do để sửa. Khi chờ duyệt, nội dung bị khóa theo quy trình đã triển khai.

### 2. Duyệt & tổ chức thi

- **Bàn duyệt & tổ chức thi** (`/ban-to-chuc/duyet-thi`): tổng hợp hồ sơ và công việc điều hành theo đúng quyền của người đăng nhập.
- **Hồ sơ chờ duyệt**: xem, trả lại có lý do hoặc duyệt phiên bản.
- **Đề đã duyệt** (`/ban-to-chuc/de-da-duyet`): các bản đề hiện tại đã duyệt, sẵn sàng phân công. Người điều hành được dẫn đến phân công; người có quyền đọc nội dung được mở đề. Các phiên bản cũ giữ trong lịch sử của từng đề.
- **Lịch thi & phân công** (`/ban-to-chuc/to-chuc-thi`): theo dõi cuộc thi từ chờ đề duyệt, thiếu lịch, thiếu phân công, chờ công bố, chờ mở thi, đang mở thi đến kết thúc.
- **Kết quả & xét giải** (`/ban-to-chuc/ket-qua`): mở bảng kết quả/xét giải của cuộc thi đã công bố hoặc có bài nộp.

Mỗi cuộc thi có số được phân công, chưa bắt đầu, đang làm, đã nộp và hết giờ chờ chốt. Nút tiếp theo dẫn tới xếp lịch, phân công, kiểm tra công bố hoặc rà soát kết quả. Đây là hướng dẫn theo tiến độ; API vẫn kiểm tra đầy đủ điều kiện công bố và bắt đầu thi.

Trang điều hành tự cập nhật mỗi 30 giây khi đang hiển thị và khi quay lại tab. Có nút Tải lại và thời điểm dữ liệu. Chỉ tính lượt thi hợp lệ mới nhất của từng người được phân công; lượt bị hủy không được đếm thành bài đang làm.

### Quản trị dùng chung

**Tài khoản & phân quyền** nằm trong nhóm Quản trị. Không đổi các bộ quyền đã cấp. Người chỉ biên tập chỉ thấy nhóm 1; người duyệt/điều hành chỉ thấy nhóm 2 tương ứng quyền. Tài khoản nhiều quyền thấy đủ các nhóm được cấp.

### Thí sinh

- **Tổng quan**: chỉ số và hướng dẫn bốn bước dự thi.
- **Lịch thi của tôi** (`/thi-sinh/lich-thi`): cuộc thi chưa hoàn tất và bài đang làm.
- **Cuộc thi của tôi**: toàn bộ cuộc thi được phân và đã công bố.
- **Bài đã nộp & kết quả** (`/thi-sinh/ket-qua`): bài đã nộp, hết giờ hoặc cuộc thi đã kết thúc. Điểm/giải vẫn chỉ hiện sau khi Ban Tổ chức công bố.

Bài đang làm được ưu tiên hiển thị và có nút Tiếp tục làm bài. Cuộc thi chưa bắt đầu mở hướng dẫn; đồng hồ chỉ chạy khi API xác nhận bắt đầu. Các đường dẫn cũ và phiên làm bài hiện có được giữ.

## API và kiểm tra

`GET /api/organizer/workflows` trả các khối `editorial`, `review`, `operations`, `approvedExams` theo quyền, không trả câu hỏi, đáp án hay mật khẩu. Candidate bị từ chối. ASP.NET và Cloudflare có cùng cấu trúc.

- 22 kiểm thử frontend, gồm ma trận quyền, bước tiếp theo và tách lịch thi/kết quả.
- 13 nhóm kiểm thử cloud, gồm dữ liệu đúng quyền, không có đáp án trong bản điều hành, đếm bài đang làm/đã nộp.
- Kiểm thử SQLite qua `npm.cmd run test:topics` xác nhận endpoint, phân quyền và danh sách đề đã duyệt.
- Preview dùng `scripts/test-workflow-live.mjs`, có bốn tài khoản thử riêng để kiểm tra bàn biên tập, danh sách duyệt, điều hành, làm/nộp bài và thu hồi phiên. Tài khoản thử bị khóa sau kiểm tra; không ghi dữ liệu kiểm thử vào production.

Dữ liệu cuộc thi, đề và lượt thi thật không bị tạo lại khi tổ chức menu. 30 câu Nghị Quyết 57 tiếp tục thuộc chủ đề đã gán.

Phát hành ngày 14/11/2026: preview 0e50ff0b đạt kiểm thử API thực tế; production b88846ae tại https://quiztanhoa.pages.dev. Kiểm tra production xác nhận đủ bảy đường dẫn mới, menu quy trình, dữ liệu theo quyền và 30 câu Nghị Quyết 57. Không tạo dữ liệu thử trên production. Chưa kiểm tra trực quan vì không có trình duyệt kết nối trong phiên làm việc.
