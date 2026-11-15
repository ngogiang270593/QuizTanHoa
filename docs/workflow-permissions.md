# Quy trình và phân quyền

Hai quy trình mặc định trong Danh mục → Quy trình:

- Ban tổ chức: Nháp → Chờ duyệt → Đã duyệt → Công khai.
- Người dùng: Thi, vào cuộc thi được phân công trong lịch cho phép.

Chờ duyệt có hai quyết định Duyệt và Trả lại. Cả hai bắt buộc ghi chú. Duyệt lưu phiên bản cố định; Trả lại về Nháp. Lịch sử lưu người thực hiện, thời gian, bản sửa và ghi chú. Đề chờ duyệt khóa chỉnh sửa. Người gửi không tự duyệt trừ quản trị có quyền quản lý tài khoản.

Công khai cần lịch hợp lệ, có phân công và phiên bản phân công còn là bản hiện tại đã duyệt. Nếu sửa đề thì phải gửi duyệt lại, cập nhật phân công trước khi công khai. Lượt thi đã phát giữ phiên bản cố định.

## Quản lý và gán quy trình

Danh mục → Quy trình hỗ trợ thêm, sửa, xóa, mô tả, loại tài khoản, chọn quyền và sắp thứ tự bằng Lên/Xuống. Các chuyển trạng thái luôn tuân thủ quy trình nội dung.

Trong Tài khoản & phân quyền, chọn một hoặc nhiều quy trình cùng loại. Quyền hiệu lực là hợp các quyền được gán. Không gán lẫn Ban tổ chức và Người dùng. Thay đổi phân quyền hoặc quyền trong quy trình thu hồi phiên tài khoản liên quan. API kiểm tra quyền hiện tại từ dữ liệu.

Không xóa quy trình đang được gán, kể cả tài khoản đã khóa; không đổi loại khi đang dùng. Không bỏ quyền quản lý cuối cùng hoặc quyền quản lý của chính người sửa quy trình.

## Chuyển dữ liệu

Migration tạo đúng hai mặc định, gán theo vai trò và giữ nguyên quyền từng tài khoản qua phạm vi tương thích. Không tự nâng quyền. Khi quản trị chủ động lưu gán lại quy trình, giao diện cảnh báo và hiển thị quyền đầy đủ sẽ áp dụng.

scripts/migrate-processes.mjs mặc định kiểm tra; --preview chọn dữ liệu thử; --write sao lưu trước khi ghi và đọc lại xác minh quyền. Bản sao trong .data/imports được bỏ qua bởi Git. Cloud lưu processes/processState/processEvents; SQLite lưu AccessProcesses và tham chiếu trên Users. Không thay thế đề, phiên bản hoặc bài thi.

Ô tìm kiếm dùng chung chiều cao, viền, bo góc, chữ và focus với input thường qua frontend/src/form-controls.css.

## Xác minh 14/11/2026

- 16 kiểm thử API cloud, 28 kiểm thử logic giao diện đạt.
- test:topics SQLite đạt: CRUD, gán quy trình, thay đổi quyền, thu hồi phiên, khóa đề và duyệt.
- Preview e2339a9c đạt kiểm thử API thật về gán quy trình, thứ tự quyền, chặn vượt quyền, thu hồi phiên và luồng soạn → gửi → trả lại → gửi → duyệt → công khai → thi → nộp bài.
- Production aa4be2b6 tại https://quiztanhoa.pages.dev: 2 quy trình, 2 tài khoản giữ nguyên quyền; đủ 30 câu Nghị Quyết 57 và 9 phòng ban. Migration có sao lưu và đọc lại xác minh.
- check-processes-production.mjs xác nhận điều khiển ghi chú duyệt/trả lại và CSS tìm kiếm đã triển khai. Không gửi duyệt hoặc công khai đề thật khi kiểm tra production.
- Chưa kiểm tra thao tác trực quan vì không có trình duyệt kết nối.
