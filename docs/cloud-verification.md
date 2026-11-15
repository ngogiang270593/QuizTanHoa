# Kiểm tra triển khai cloud — 14/11/2026

Production: https://quiztanhoa.pages.dev

- Bản production cập nhật datetimepicker: https://8582734d.quiztanhoa.pages.dev, branch `main`. Hướng dẫn và kiểm tra giây: [date-time-picker.md](date-time-picker.md).
- Bản production chọn nhiều câu hỏi: https://7a178141.quiztanhoa.pages.dev. Hướng dẫn và kết quả: [multi-select-questions.md](multi-select-questions.md).
- Preview API chọn nhiều câu hỏi đã kiểm tra: https://fa9d2b88.quiztanhoa.pages.dev; dữ liệu kiểm thử đã dọn.
- Bản production trước, trình soạn câu hỏi modal: https://8b0946ec.quiztanhoa.pages.dev.
- Preview đã kiểm tra: https://191ebb7b.quiztanhoa.pages.dev, branch `verify`.
- Preview giao diện mới: https://b422328b.quiztanhoa.pages.dev. Ghi chú thiết kế, tệp ảnh và nguồn: [government-theme.md](government-theme.md).
- Preview trình soạn câu hỏi: https://772d13d4.quiztanhoa.pages.dev. Thiết kế, thao tác và kết quả kiểm tra: [question-editor.md](question-editor.md).
- Database: Firestore Native Standard `(default)`, project `quiztanhoa`, region `asia-southeast1`.
- Cloudflare secret `FIREBASE_SERVICE_ACCOUNT` và `PASSWORD_PEPPER` được lưu cho Preview và Production theo xác nhận của chủ tài khoản. Không có secret trong bundle giao diện hoặc Git.

## Kết quả kiểm tra

`npm.cmd run test:cloud`: 6 bài kiểm tra tích hợp thành công, bao gồm quyền truy cập, phiên/tab, snapshot đề, hạn nộp, chấm điểm/xếp hạng, xét giải, XLSX, codec Firestore và đổi mật khẩu tự chọn. Cờ bắt buộc đổi mật khẩu cũ không còn chặn truy cập; đổi mật khẩu vẫn xác minh mật khẩu hiện tại và thu hồi mọi phiên cũ.

`node scripts/test-cloud-live.mjs https://191ebb7b.quiztanhoa.pages.dev`: thành công trên Worker online với Firestore thật. Đã xác nhận tài khoản vào được tổng quan ngay khi đăng nhập, tạo tài khoản kiểm tra, tự đổi mật khẩu, tạo/duyệt đề, cấu hình lịch, phân công/công bố, làm/nộp bài, chặn sửa sau nộp, chấm điểm, duyệt/công bố giải, xuất Excel, kết thúc và đăng xuất. Dữ liệu thử nghiệm chỉ nằm trong `qt_verify_*`.

`node scripts/check-cloud-production.mjs`: thành công. Các đường dẫn SPA trả HTML đúng, header bảo vệ tồn tại, `/api/health` trả HTTP 200 với `storage: Firestore` và `environment: production`. API riêng tư từ chối truy cập không đăng nhập. Admin đăng nhập được với mật khẩu người dùng yêu cầu, vào được tổng quan ngay và phiên bị thu hồi sau đăng xuất. Kiểm tra không thay đổi mật khẩu.

Backend ASP.NET đã build Release thành công; `npm.cmd run test:auth` kiểm tra tài khoản mới và dữ liệu khởi tạo không buộc đổi mật khẩu, đồng thời kiểm tra đổi mật khẩu tự chọn và thu hồi phiên đều thành công.

Truy cập trực tiếp Firestore không có xác thực trả HTTP 403. Dependency cloud đã được audit sau cập nhật fflate 0.8.3: không còn lỗ hổng được báo trong lần cài đặt.

## Bàn giao

Tài khoản: `admin`. Mật khẩu hiện tại lưu ở `.data/cloud/admin-login.txt` trên máy triển khai, không in trong log. Không bắt buộc đổi mật khẩu khi đăng nhập; chức năng đổi mật khẩu nằm tại Thông tin tài khoản (`/tai-khoan`). Bảo quản `.data/cloud/pages-secrets.json` làm bản sao server secret.

Không tự bật Blaze, Cloud Run hay gói Cloudflare trả phí. Các kiểm tra này chưa phải kiểm thử tải; cần theo dõi quota và đánh giá số lượng thí sinh trước kỳ thi lớn. Dữ liệu SQLite cũ chưa được nhập vào Firestore.

Xem hướng dẫn cập nhật tại [deployment-firebase-cloudflare.md](deployment-firebase-cloudflare.md).
