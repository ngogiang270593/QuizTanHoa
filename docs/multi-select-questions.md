# Chọn nhiều câu hỏi cho cuộc thi

Triển khai ngày 14/11/2026 tại https://quiztanhoa.pages.dev.

## Cách sử dụng

1. Vào **Cuộc thi → Tạo cuộc thi → Chọn nhiều câu hỏi**.
2. Tìm nội dung bằng từ khóa có hoặc không dấu; lọc theo nhóm kiến thức, loại câu hỏi hoặc tên tài liệu nguồn (ví dụ `aaa.docx`).
3. Tích chọn từng câu hoặc chọn tất cả kết quả phù hợp. Lựa chọn được giữ khi đổi bộ lọc hoặc chuyển trang. Bên phải có danh sách đã chọn, nút bỏ nhanh và tổng số câu, cơ cấu nhóm, tổng điểm.
4. Áp dụng, nhập tên đề và thời lượng, rồi lưu cuộc thi. Cuộc thi và đề ban đầu được tạo cùng một giao dịch ở trạng thái nháp. Chưa tự duyệt hoặc công bố.
5. Trong một đề đã có, dùng **Thêm từ ngân hàng** để mở lại thư viện. Câu đã có được đánh dấu; phía server cũng bỏ qua liên kết trùng. Có tùy chọn tự khớp số câu và cơ cấu nhóm.
6. Tích chọn các thẻ câu hỏi và bấm **Bỏ câu đã chọn**, sau đó xác nhận. Chỉ bỏ khỏi bản nháp, giữ nguyên ngân hàng và các phiên bản đề đã duyệt. Bỏ một câu cũng khớp lại số câu.

Mỗi lần chọn/thêm/bỏ tối đa 400 câu; mỗi đề tối đa 500 câu. Với đề trên 400 câu, nút chọn nhanh chọn 400 câu đầu, có thể thao tác đợt tiếp theo sau khi bỏ. Nếu bỏ hết câu, giữ cấu hình số câu dự kiến cuối cùng để tiếp tục soạn; đề trống không đủ điều kiện duyệt.

## Kiểm chứng

- `node --test frontend/tests/*.test.mjs worker/tests/*.test.mjs`: 17 bài thành công, gồm tìm kiếm không dấu, giữ lựa chọn qua bộ lọc, giới hạn không chọn dở dang, tạo cuộc thi nguyên tử, chống trùng, phân quyền, phạm vi câu hỏi và phiên bản duyệt bất biến.
- Build cloud và backend .NET Release thành công.
- `npm.cmd run test:exams`: thành công, bao gồm API mới trên SQLite cục bộ.
- `npm.cmd run test:competitions`: thành công; kiểm tra phân quyền, dữ liệu nháp, lịch và bảo toàn trạng thái cuộc thi.
- Production https://7a178141.quiztanhoa.pages.dev: kiểm tra health, đăng nhập/đăng xuất và bundle JS/CSS trên tên miền chính thành công.
- `node scripts/test-question-selection-live.mjs https://fa9d2b88.quiztanhoa.pages.dev`: thành công với Firestore preview. Dữ liệu QA đã dọn; không sửa ngân hàng production.
- Chưa kiểm tra thao tác và ảnh giao diện trong trình duyệt vì phiên Browser hiện không có trình duyệt khả dụng. Không coi kiểm tra build/API là kiểm tra trực quan.

## Thay đổi kỹ thuật

`QuestionLibraryPicker.jsx` dùng native dialog, focus ban đầu, Escape/đóng, cuộn riêng và bố cục thích ứng. Các bộ lọc xử lý tại client sau khi tải ngân hàng. `questionLibrary.mjs` chứa logic lọc và chọn độc lập.

POST tạo cuộc thi nhận tùy chọn `initialExam: { name, durationMinutes, questionIds }`; phản hồi bổ sung `initialExamId` và `initialQuestionCount`. POST `questions/from-bank` nhận `syncCounts`; POST `questions/remove-many` nhận ID câu trong đề và `syncCounts`. Server xác minh toàn bộ ID trước khi thay đổi; các thao tác cloud nằm trong transaction có retry xung đột. API .NET có chức năng tương ứng.
