# Kết quả nghiệm thu Đề thi, Lịch thi và lượt dự thi

## Quản lý tài khoản, ngân hàng câu hỏi và vòng đời cuộc thi

Kiểm tra hồi quy sau khi bổ sung các màn hình quản trị:

- `npm test`: đạt toàn bộ build, kiểm tra API, kiểm thử trình duyệt và quy trình làm bài.
- Ban Tổ chức sửa được họ tên, đơn vị và trạng thái tài khoản; API từ chối thí sinh, không cho tự khóa tài khoản hiện hành và không nhận thay đổi tên đăng nhập/vai trò qua overposting.
- Ngân hàng câu hỏi thêm/sửa/xóa, thêm câu vào đề bằng liên kết; sửa ngân hàng đồng bộ bản nháp nhưng không thay snapshot đã duyệt. Xóa khỏi ngân hàng giữ bản câu hỏi trong đề và ngắt liên kết.
- Cuộc thi nháp có thể xóa kèm đề đã duyệt/phân công khi chưa có lượt thi; cuộc thi đã công bố/kết thúc hoặc đã có lượt thi bị chặn. Kiểm tra xóa chạy trong giao dịch và giữ nguyên ràng buộc snapshot.
- Nâng cấp schema được kiểm tra trên database đã có 50 câu demo: 50 câu được chuyển vào ngân hàng và liên kết với đề; chạy lại không nhân đôi. Database vận hành hiện có 9 đơn vị, 46 tài khoản, 1 đề demo và 50 câu được giữ nguyên.

Kiểm tra ngày 13/11/2026 với Node.js 24, .NET 8 SDK và Chrome headless trên Windows. Các bộ kiểm tra dùng cơ sở dữ liệu/profile tạm; không thêm đề hoặc câu kiểm tra vào dữ liệu đang sử dụng.

| Nhóm kiểm tra | Kết quả |
| --- | --- |
| Build frontend + publish ASP.NET Core | Đạt; 74 module frontend, bản web gồm API và giao diện |
| `test:auth` | 8 nhóm đạt; đăng nhập, vai trò hiện tại, phiên và thu hồi phiên |
| `test:competitions` | 7 nhóm đạt; tạo/sửa, quyền, trạng thái, bộ lọc thí sinh và lịch |
| `test:exams` | 7 nhóm đạt; nhiều đề, câu, duyệt, nguồn, phiên bản, lịch và Excel |
| `test:development` | 3 nhóm đạt; profile MinhHoa không cần đặt sẵn biến seed trong terminal |
| Trình duyệt trên bản `publish/web` | 29 nhóm đạt; gồm cả thao tác người dùng, tải lại và màn hình 320 px |

Các tình huống được xác nhận:

- Tạo hai đề ở cùng cuộc thi với nhóm lĩnh vực khác nhau; cấu hình mặc định 30 câu/30 phút/10 chung/20 chuyên môn được hiển thị và có thể chỉnh sửa.
- Lưu nháp câu thiếu đáp án, bấm Duyệt đề: máy chủ từ chối, bản xem trước chỉ rõ lỗi và hiển thị nội dung/phương án. Câu có điểm không hợp lệ cũng không duyệt được.
- Câu nhận diện liên quan thủ tục/thẩm quyền/thời hạn cần nguồn và xác nhận người đối chiếu; sửa nguồn yêu cầu đối chiếu lại. Không tự xác nhận nội dung pháp lý.
- Duyệt hợp lệ tạo phiên bản và SHA-256; sửa/duyệt tiếp không đổi snapshot cũ. Snapshot không cho UPDATE/DELETE; tham chiếu phiên bản trong lượt đang làm/đã nộp không đổi. Bước làm bài bên dưới xác nhận phát đúng snapshot qua giao diện.
- Giờ đóng sớm hơn giờ mở bị từ chối; lịch hợp lệ lưu đúng UTC từ giờ Việt Nam. Bắt đầu sát hạn còn 10 phút với đề 30 phút có cảnh báo rõ. Trình duyệt được đặt America/New_York vẫn giữ giờ Việt Nam.
- Excel thật dạng .xlsx: tải mẫu, xem trước lỗi đáp án ở dòng 2, chặn nhập; sửa tệp rồi nhập thành công. Xem trước không lưu; nhập có lỗi không lưu một phần. Trang ví dụ/hướng dẫn không bị nhập vào đề.
- Thí sinh không truy cập được trang/API quản trị Đề thi, Duyệt đề, Lịch thi, Excel hoặc đáp án; phiên thí sinh hợp lệ vẫn được giữ.
- Khởi động Development từ profile MinhHoa và phục vụ giao diện/JS/CSS thành công. Bản build kiểm tra nằm riêng ở `.artifacts/development` vì backend của người dùng đang chạy.

Lưu ý môi trường: bước restore cho thư mục build kiểm tra riêng có cảnh báo `NU1900` vì không truy cập được dịch vụ dữ liệu lỗ hổng NuGet. Build và kiểm tra vẫn thành công với các dependency đã cài; lần chạy này không xác nhận được dữ liệu kiểm toán NuGet trực tuyến.

Ảnh kiểm tra nằm trong `.artifacts/`. Bộ kiểm tra trình duyệt giữ sandbox mặc định của Chrome; việc chạy ngoài giới hạn executor đã được auto-review chấp thuận. Các tiến trình kiểm tra và thư mục dữ liệu tạm đã được dọn sau khi hoàn tất.

## Hướng dẫn, làm bài và nộp bài

Kiểm tra ngày 13/11/2026 bằng API tích hợp và Chrome headless, sử dụng cơ sở dữ liệu tạm:

- `dotnet build backend/Quiz_TanHoa.Api.csproj -c Release`: đạt, không cảnh báo hoặc lỗi.
- `npm.cmd --prefix frontend run build:web`: đạt.
- `test:auth`, `test:competitions`, `test:exams`, `test:assignments`, `test:results`: đạt.
- `test:browser`: 34 nhóm đạt, không có lỗi JavaScript không xử lý.
- Bắt đầu ngoài lịch bị từ chối; tài khoản không được phân không đọc/bắt đầu lượt. Đề phát chỉ trả nội dung cần làm, không có đáp án đúng, giải thích, nguồn hoặc điểm.
- Hai đáp án/cờ xem lại được lưu; tải lại giữ nguyên thứ tự câu/phương án và đáp án. Nộp ghi thời điểm, trả trạng thái đã nộp và reload không mở lại câu hỏi.

## Khóa phiên và chốt hạn nộp

Kiểm tra hồi quy sau khi gia cố lượt thi:

- `npm test`: đạt toàn bộ build, kiểm tra xác thực/cuộc thi/đề thi/phân công, bundle web, startup Development và trình duyệt.
- `test:assignments`: hai yêu cầu bắt đầu đồng thời từ hai phiên đăng nhập trả cùng một lượt hợp lệ; phiên thứ hai và tab thứ hai bị từ chối. Ban Tổ chức chuyển quyền với lý do bắt buộc; phiên cũ mất quyền. Lượt thi lại vô hiệu hóa lượt trước, tạo audit và chỉ bắt đầu đồng hồ khi thí sinh dùng phiên mới bấm **Bắt đầu**.
- Tiếp tục lượt sau hạn bắt đầu nhưng trước hạn nộp giữ nguyên attempt ID/hạn nộp. Background service chốt lượt khi trình duyệt không gửi nộp; lưu câu sau hạn bị chặn và nộp lặp trả cùng thời điểm đã chốt.
- Reload giữ nguyên câu trả lời/thứ tự đề; bộ kiểm tra trình duyệt xác nhận bắt đầu, lưu, khôi phục, nộp và không mở lại câu đã nộp.
- Build Release đạt 0 cảnh báo/0 lỗi. Build Development phát cảnh báo `NU1900` do không truy cập NuGet vulnerability feed; 0 lỗi và các kiểm tra startup vẫn đạt.

## Chấm điểm, xếp hạng và xuất kết quả

- `npm test`: đạt toàn bộ build, API integration, frontend, startup Development và trình duyệt. Build Release đạt 0 cảnh báo/0 lỗi; `NU1900` chỉ xuất hiện ở build Development do không truy cập được NuGet vulnerability feed.
- `test:results`: xác nhận chấm đúng snapshot đề đã phân dù bản nháp thay đổi; số câu đúng, thời gian làm bài, các điểm thành phần; số câu đúng nhiều hơn được ưu tiên, cùng số câu đúng thì thời gian ngắn hơn được ưu tiên, bằng cả hai thì đồng hạng; nhóm khác nhau xếp độc lập, nhóm tương đương xếp chung; lượt cũ bị loại không có thứ hạng.
- Workbook Excel được đọc lại trong kiểm thử: thứ hạng, số câu đúng, thời gian, trạng thái bị loại, các cột điểm và lọc theo nhóm xếp hạng khớp API. Thí sinh không được gọi API kết quả.
- `test:browser`: Ban Tổ chức nhìn thấy bảng kết quả, phân công và nút xuất Excel trong trang chi tiết; trang không tràn ngang và không phát sinh lỗi JavaScript.

## Tài khoản và định dạng lịch

- `test:auth`: xác nhận Ban Tổ chức tạo tài khoản thí sinh với mật khẩu tạm `123456`, yêu cầu đổi mật khẩu lần đầu, xử lý tên đăng nhập trùng, cập nhật thông tin và chỉ xóa cứng tài khoản chưa có phân công/lượt thi.
- `test:exams` và `test:browser`: nhập/xuất lịch theo `dd/MM/yyyy HH:mm` giờ Việt Nam, xác nhận UTC được lưu đúng, ngày giờ ISO cũ vẫn được chấp nhận và lịch được giữ đúng sau khi mở lại trên thiết bị ở múi giờ khác.
