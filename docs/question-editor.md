# Trình soạn câu hỏi bằng modal

Áp dụng đồng nhất cho Ngân hàng câu hỏi và Câu hỏi của đề.

## Bố cục và thao tác

- Modal rộng có phần soạn ở trái, xem trước trực tiếp ở phải, thanh thao tác cố định ở dưới. Trên điện thoại, modal toàn màn hình và ẩn cột xem trước để ưu tiên nhập liệu.
- Chia thành Nội dung, Phương án & đáp án, và phần Giải thích/nguồn có thể thu gọn.
- Chọn đáp án ngay trên phương án bằng nút tròn. Phương án đúng được tô xanh và có dấu kiểm. Câu Đúng/Sai có hai thẻ riêng.
- Trắc nghiệm hỗ trợ 2–6 phương án. Xóa phương án đang đúng sẽ bỏ chọn đáp án, không tự chọn phương án khác. Chuyển loại câu rồi quay lại trong modal giữ phần soạn của từng loại.
- Lưu câu hỏi kiểm tra nội dung, phương án, đáp án và điểm, báo lỗi ngay tại trường cần sửa. Lưu nháp vẫn cho phép tiếp tục hoàn thiện sau, tương thích luồng duyệt đề hiện có.
- Ctrl/Command + Enter để lưu. Escape hoặc nút đóng yêu cầu xác nhận nếu còn nội dung chưa lưu. Modal sử dụng native dialog, giữ focus trong hộp thoại và trả focus về nút mở khi đóng. Khi đang gửi không cho đóng hoặc gửi lặp.
- Lỗi từ server hiển thị bên trong modal, giữ nguyên nội dung đang nhập.
- Danh sách câu hỏi dùng thẻ gọn, mở rộng nội dung/phương án khi cần. Ngân hàng có tìm kiếm chờ 300 ms và bộ lọc nhóm/loại câu.

## Bảo toàn dữ liệu

Form cũ ép mọi câu thành SingleChoice, chỉ giữ 4 phương án và đặt lại cờ tình huống. Form mới giữ đúng loại câu, mã đáp án, 2–6 phương án, điểm, nhóm, cờ tình huống và nội dung giải thích/nguồn. Không sửa schema hoặc API backend. Phiên bản đề đã duyệt tiếp tục bất biến như trước.

## Kiểm tra

- `npm.cmd run test:question-editor`: 7 kiểm tra thành công, gồm True/False, 6 phương án/mã tùy chỉnh, lưu nháp chưa có đáp án, điểm/tình huống không bị đặt lại, đáp án bị xóa, trùng mã và đối chiếu nguồn.
- `npm.cmd run build:cloud`: thành công.
- `node scripts/test-question-editor-live.mjs https://772d13d4.quiztanhoa.pages.dev`: thành công với Firestore thật trong namespace preview. Các câu hỏi kiểm tra được xóa khỏi ngân hàng sau kiểm tra.
- Script kiểm tra browser hiện có đã cập nhật selector cho modal/radio và lưu nháp. Phiên Browser không khả dụng trong lượt thực hiện nên không tuyên bố đã kiểm tra click, focus hoặc ảnh chụp trên trình duyệt thật.

Mã chính: `frontend/src/QuestionEditor.jsx`, `QuestionEditor.css`, `questionDraft.mjs`.
