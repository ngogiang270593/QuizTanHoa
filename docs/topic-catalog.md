# Danh mục chủ đề

- Menu **Danh mục**, tab **Chủ đề**: thêm chủ đề, đổi tên, xem số câu và xóa chủ đề trống.
- Không tạo trùng tên khi chỉ khác chữ hoa/thường hoặc khoảng trắng ở hai đầu.
- Đổi tên cập nhật ngân hàng và bản nháp liên kết; phiên bản đã duyệt và lịch sử thi không đổi. Bản nháp có thay đổi cần được duyệt lại.
- Chủ đề đang có câu hỏi không thể xóa. Chọn nhiều câu trong Ngân hàng câu hỏi, chọn chủ đề đích, bấm **Áp dụng chủ đề** trước khi xóa chủ đề cũ.
- Ngân hàng, trình soạn câu hỏi, thư viện chọn câu và bản xem trước dùng chủ đề. Bộ lọc và số câu Kiến thức chung / Chuyên môn đã được loại khỏi giao diện và điều kiện duyệt đề.
- Các trường nhóm cũ vẫn lưu nội bộ để đọc dữ liệu và snapshot cũ, không dùng để quyết định điều kiện duyệt đề mới.
- Excel mới dùng cột **Chủ đề**, mẫu cũ có **Nhóm câu** vẫn được nhận diện để tương thích.
- API quản trị: `GET/POST /api/organizer/topics`, `PUT/DELETE /api/organizer/topics/{id}`, `POST /api/organizer/question-bank/set-topic` với `topicId` và `questionIds`.
- SQLite tự nâng cấp thêm bảng `QuestionTopics` và trường `ExamQuestions.Topic`; không xóa dữ liệu cũ. Firestore dùng collection `qt_topics`.

## Bộ Nghị Quyết 57

Ngày 14/11/2026 đã đối chiếu chính xác 30 ID với báo cáo nhập `aaa.docx`, gán 30 câu và 30 câu liên kết trong đề nháp vào **Nghị Quyết 57**, đọc kiểm tra lại dữ liệu. Không thay đổi nội dung, phương án, đáp án. Sao lưu trước khi đổi và báo cáo nằm trong `.data/imports/nghi-quyet-57-before.json` và `.data/imports/nghi-quyet-57-report.json` (không đưa lên git).

Script `scripts/group-imported-topics.mjs` mặc định chỉ kiểm tra; `--write` áp dụng thay đổi trong transaction. Không chạy lại nếu không cần, vì thao tác cập nhật làm thay đổi revision của bản nháp liên quan.

## Kiểm tra

`npm.cmd run test:cloud`, `npm.cmd run test:topics`, `node --test frontend/tests/*.test.mjs`, `npm.cmd run build:cloud`.

Kiểm thử bao gồm quyền tổ chức/thí sinh, chủ đề trùng, xóa chủ đề có câu hỏi, đổi tên liên kết, snapshot đã duyệt, chuyển chủ đề nhiều câu và duyệt đề không cần cơ cấu nhóm kiến thức.

Đã phát hành ngày 14/11/2026 tại https://quiztanhoa.pages.dev (deployment 50e5ad26). Kiểm tra sau phát hành xác nhận API chủ đề, đủ 30 câu Nghị Quyết 57 theo đúng ID nhập và gói giao diện có menu Danh mục, thao tác chuyển chủ đề nhiều câu. Chưa kiểm tra trực quan do không có trình duyệt kết nối.
