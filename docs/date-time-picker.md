# Chọn ngày giờ đến từng giây

Ngày cập nhật: 14/11/2026.

Ba mốc trong **Lịch thi** dùng `DateTimePicker`: chọn tháng/năm/ngày trên lịch, chọn giờ/phút/giây, xem giá trị rồi Áp dụng. Có nút Hiện tại, Hủy, đóng bằng Escape hoặc bấm ngoài; vẫn cho phép nhập trực tiếp. Định dạng hiển thị là `dd/MM/yyyy HH:mm:ss` (năm 4 chữ số). Các thời điểm hiển thị khác trong phần mềm cũng có giây.

Giá trị lịch được hiểu theo `Asia/Ho_Chi_Minh` (UTC+7), độc lập múi giờ thiết bị; backend lưu UTC. Cloud Worker và .NET chấp nhận định dạng có giây, vẫn đọc yêu cầu cũ chỉ có phút với giây mặc định `00`. Không sửa các lịch thi hoặc dữ liệu cuộc thi hiện có trong khi triển khai.

Kiểm tra đã thực hiện:

- `node --test frontend/tests/*.test.mjs worker/tests/*.test.mjs`: 21 bài thành công, gồm round-trip giây, thời gian Việt Nam, ngày nhuận, ngày không tồn tại, giây không hợp lệ và thứ tự ba mốc.
- Build cloud và .NET Release thành công, không lỗi .NET.
- `npm.cmd run test:exams`: thành công, gồm lưu và đọc lại `dd/MM/yyyy HH:mm:ss` trên .NET/SQLite.
- `node scripts/test-date-time-live.mjs https://82f7de68.quiztanhoa.pages.dev`: thành công trên Firestore preview. Cuộc thi kiểm thử đã dọn.
- Chưa kiểm tra trực quan/thao tác lịch trên trình duyệt vì phiên Browser hiện không có trình duyệt khả dụng. Script browser đã cập nhật giá trị giây nhưng chưa chạy.
