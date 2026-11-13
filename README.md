# Hội thi nghiệp vụ xã Tân Hòa

Website tiếng Việt cho cán bộ, công chức xã Tân Hòa. Dự án hiện có nền tảng phân quyền, quản trị Cuộc thi, Đề thi, Lịch thi, **Phân công dự thi và Công bố cuộc thi**, sử dụng React, ASP.NET Core 8 và SQLite trong cùng cơ sở dữ liệu.

Đã có đăng nhập, khôi phục phiên, đăng xuất phía máy chủ, hai không gian Ban Tổ chức / Thí sinh, quản trị tài khoản thí sinh, cuộc thi, đề theo lĩnh vực, câu hỏi, nhập Excel, lịch thi, duyệt phiên bản cố định, phân công, công bố và luồng làm/nộp bài. Mỗi cuộc thi chỉ có một lượt hợp lệ cho một tài khoản; lượt gắn với phiên đăng nhập và một tab có lease, hạn nộp cố định, tự chốt tại máy chủ khi hết giờ và có thể khôi phục sau tải lại. Ban Tổ chức có thể chuyển phiên hoặc cấp lượt thay thế có ghi lý do/audit. Kết quả được tự chấm theo snapshot, xếp hạng theo nhóm đề dựa trên số câu đúng rồi thời gian làm bài, và xuất Excel. Mục **Xét giải** cấu hình giải theo nhóm xếp hạng, lập/lưu dự kiến, ghi nhận lý do điều chỉnh, duyệt và công bố danh sách bất biến; thí sinh chỉ xem điểm theo cài đặt và chỉ thấy danh sách giải sau khi phát hành.

## Chạy thử nhanh trên Windows

Cần Node.js 24 trở lên và .NET 8 SDK. Tại PowerShell:

```powershell
cd D:\Quiz_TanHoa
npm.cmd run setup
npm.cmd run dev:demo
```

Mở **http://127.0.0.1:5175/dang-nhap**. Lệnh trên chạy cả API và giao diện; nhấn `Ctrl+C` để dừng. Dùng `npm.cmd` trong PowerShell để không phụ thuộc quyền chạy tệp `npm.ps1`.

| Tài khoản MINH HỌA | Mật khẩu MINH HỌA | Vai trò |
| --- | --- | --- |
| `organizer.demo` | `TanHoa@2026!` | Ban Tổ chức |
| `thisinh.demo` | `TanHoa@2026!` | Thí sinh |

Tạo dữ liệu minh họa phải bật rõ ràng bằng `QUIZ_TANHOA_SEED_DEMO=true`. Tài khoản có `IsDemo=true` trong cơ sở dữ liệu và được ghi nhãn trên giao diện. Dữ liệu mặc định lưu riêng ở `.data/demo`; không tạo kỳ thi, lịch hay điểm minh họa. Nếu tự đặt `QUIZ_TANHOA_DATA_DIR`, ứng dụng dùng đường dẫn đã đặt. Tắt biến seed không xóa tài khoản đã tạo; không dùng cơ sở dữ liệu minh họa cho vận hành.

## Chạy với dữ liệu chính thức

Khởi tạo lần đầu:

```powershell
$env:QUIZ_TANHOA_ADMIN_PASSWORD = 'ThayBangMatKhauRiengToiThieu12KyTu!'
npm.cmd run dev
```

Đăng nhập bằng `admin` và mật khẩu đã đặt. Cơ sở dữ liệu mặc định nằm ở `.data/web`. Không có mật khẩu mặc định cho cơ sở dữ liệu chính thức mới. Mật khẩu khởi tạo cần ít nhất 12 ký tự, tối đa 72 byte UTF-8. Biến khởi tạo không thay mật khẩu của tài khoản đã tồn tại. Không dùng mật khẩu ví dụ trong vận hành.

Nếu chạy riêng hai terminal:

```powershell
# Terminal 1: thiết lập mật khẩu trước lần khởi tạo chính thức đầu tiên
$env:QUIZ_TANHOA_ADMIN_PASSWORD = 'ThayBangMatKhauRiengToiThieu12KyTu!'
npm.cmd run dev:backend
```

```powershell
# Terminal 2
npm.cmd run dev:frontend
```

Frontend tại `http://127.0.0.1:5175`, API tại `http://127.0.0.1:5030`; Vite chuyển tiếp `/api` đến API.

Nếu muốn giữ frontend đang chạy và khởi động riêng backend với tài khoản minh họa:

```powershell
cd D:\Quiz_TanHoa\backend
dotnet run --launch-profile MinhHoa
```

Profile `MinhHoa` lưu lựa chọn chạy minh họa ngay trong dự án, nên không cần đặt lại biến môi trường khi mở terminal mới. Profile bật rõ `QUIZ_TANHOA_SEED_DEMO=true` và mặc định dùng dữ liệu đã có ở `.data/demo`. Nếu tự đặt `QUIZ_TANHOA_DATA_DIR`, đường dẫn đó vẫn được ưu tiên. Tại thư mục gốc có lệnh tương đương `npm.cmd run dev:backend:demo`; trong VS Code có task **Quiz_TanHoa: Backend minh họa**.

Lệnh `dotnet run` không chỉ định profile dùng `Quiz_TanHoa`, mặc định `.data/web`; lần đầu cần mật khẩu quản trị riêng. Dùng mật khẩu `TanHoa@2026!` với hai tài khoản minh họa trong bảng phía trên sau khi chạy profile `MinhHoa`.

Khi đăng nhập báo lỗi 502, kiểm tra `http://127.0.0.1:5030/api/health`: API phải trả `status: "ok"`. Nếu API không chạy, xem terminal backend; không cần thay mật khẩu. Bản sửa hiện tại đã loại bỏ manifest tệp tĩnh trỏ sai đến `backend/wwwroot`. Khi nâng cấp từ bản trước, dừng backend cũ rồi chạy `dotnet clean backend/Quiz_TanHoa.Api.csproj` từ thư mục gốc dự án một lần trước khi chạy lại. Không cần tạo thư mục `wwwroot` thủ công.

## Đường dẫn màn hình

| Đường dẫn | Quyền truy cập |
| --- | --- |
| `/dang-nhap` | Màn hình đăng nhập |
| `/ban-to-chuc` | Tổng quan Ban Tổ chức |
| `/ban-to-chuc/tai-khoan` | Ban Tổ chức xem và cập nhật họ tên, đơn vị, trạng thái tài khoản |
| `/ban-to-chuc/ngan-hang-cau-hoi` | Thêm, sửa, tìm kiếm và xóa câu hỏi trong ngân hàng, Ban Tổ chức |
| `/ban-to-chuc/cuoc-thi` | Danh sách Cuộc thi, Ban Tổ chức |
| `/ban-to-chuc/cuoc-thi/tao` | Tạo cuộc thi mới, Ban Tổ chức |
| `/ban-to-chuc/cuoc-thi/{id}/chinh-sua` | Mở và chỉnh sửa cuộc thi đã lưu, Ban Tổ chức |
| `/ban-to-chuc/cuoc-thi/{id}/de-thi` | Danh sách đề thi và nhóm lĩnh vực trong cuộc thi |
| `/ban-to-chuc/cuoc-thi/{id}/de-thi/{examId}` | Cấu hình đề, câu hỏi, Excel, xem trước và duyệt |
| `/ban-to-chuc/cuoc-thi/{id}/lich-thi` | Ngày giờ mở thi, hạn bắt đầu, ngày giờ đóng thi |
| `/ban-to-chuc/cuoc-thi/{id}/phan-cong` | Phân công dự thi và kiểm tra điều kiện công bố |
| `/ban-to-chuc/cuoc-thi/{id}/xet-giai` | Cấu hình giải, rà soát đồng hạng/sự cố, lưu, duyệt, công bố, xuất Excel và kết thúc cuộc thi |
| `/thi-sinh` | Không gian Thí sinh |
| `/thi-sinh/cuoc-thi` | Cuộc thi của tôi: chỉ cuộc thi đã công bố và được phân |
| `/thi-sinh/cuoc-thi/{id}` | Chi tiết theo phân công; điểm cá nhân theo cài đặt công bố và giải sau khi phát hành |
| `/thi-sinh/cuoc-thi/{id}/de-thi` | Thông tin đề và phiên bản đã được giao |
| `/thi-sinh/cuoc-thi/{id}/huong-dan` | Hướng dẫn, thể lệ, đề được giao, lịch thi và nút bắt đầu |
| `/thi-sinh/cuoc-thi/{id}/lam-bai` | Làm bài, khôi phục câu trả lời và nộp bài theo lượt hiện tại |
| `/tai-khoan` | Hồ sơ của tài khoản đang đăng nhập |

Chưa đăng nhập sẽ về màn hình đăng nhập. Truy cập không gian sai vai trò hiển thị thông báo không có quyền; không tự đổi vai trò và không kết thúc phiên hợp lệ. Nhập trực tiếp hoặc tải lại đường dẫn con vẫn hoạt động ở bản web đã build.

## Quản trị Cuộc thi — bước 2

Đăng nhập Ban Tổ chức, mở **Cuộc thi → Tạo cuộc thi**. Biểu mẫu có tên bắt buộc, mô tả và thể lệ. Nút **Dùng tên mẫu** điền tên:

> Hội thi trực tuyến tìm hiểu kiến thức, nghiệp vụ dành cho cán bộ, công chức xã Tân Hòa

Tên mẫu là gợi ý trong biểu mẫu; không tự tạo bản ghi cuộc thi. Khi lưu, máy chủ cắt khoảng trắng đầu/cuối và từ chối tên trống hoặc chỉ có khoảng trắng. Giới hạn: tên 300 ký tự, mô tả 5.000 ký tự, thể lệ 20.000 ký tự.

Cuộc thi mới luôn là **Nháp** (`Draft`), kể cả nếu trình duyệt gửi trạng thái khác. Đã chuẩn bị **Đã công bố** (`Published`) và **Đã kết thúc** (`Ended`); biểu mẫu bước này sửa tên, mô tả, thể lệ. Danh sách cho phép xóa cuộc thi nháp; máy chủ từ chối xóa cuộc thi đã công bố/kết thúc hoặc đã có lượt thi. Tài khoản minh họa tạo cuộc thi có nhãn **Minh họa** trong dữ liệu và giao diện.

Thí sinh chỉ được đọc cuộc thi **Đã công bố và có phân đề hợp lệ cho chính mình**. API danh sách, chi tiết, đề được giao và lượt thi đều kiểm tra điều kiện này; Nháp, Đã kết thúc hoặc chưa được phân sẽ không xuất hiện. Máy chủ xác định điều kiện lịch khi có đủ ba mốc: giờ mở ≤ giờ máy chủ ≤ hạn bắt đầu, đồng thời giờ máy chủ < giờ đóng. Thời gian lưu UTC và hiển thị theo `Asia/Ho_Chi_Minh`.

Thử theo yêu cầu:

1. Đăng nhập `organizer.demo`, mở `/ban-to-chuc/cuoc-thi`, bấm **Tạo cuộc thi** và **Dùng tên mẫu**, nhập mô tả/thể lệ rồi lưu.
2. Tải lại trang; kiểm tra các trường giữ nguyên. Sửa tên, bấm **Lưu thay đổi**, tải lại và kiểm tra tên mới.
3. Bỏ trống tên rồi lưu; biểu mẫu báo lỗi và không ghi đè dữ liệu đã lưu. API cũng chặn tên thiếu/trắng.
4. Đăng xuất và đăng nhập `thisinh.demo`; nhập trực tiếp đường dẫn danh sách hoặc chỉnh sửa quản trị để kiểm tra thông báo không có quyền. API quản trị trả `403`; phiên thí sinh vẫn hợp lệ.

## Đề thi, Excel và Lịch thi — bước 3

Mở một cuộc thi và chọn tab **Đề thi** hoặc **Lịch thi**. Mỗi cuộc thi có sáu nhóm lĩnh vực gợi ý: kiến thức chung, kinh tế và hạ tầng, đất đai và môi trường, tài chính, hành chính và tư pháp, văn hóa và xã hội. Mở **Nhóm lĩnh vực và phân công** để sửa tên theo thực tế hoặc thêm nhóm riêng. Sửa nhóm chỉ ảnh hưởng cuộc thi hiện tại.

**Tạo đề thi** với tên, lĩnh vực, thời lượng và cơ cấu câu hỏi. Cấu hình gợi ý được ghi rõ là minh họa: **30 câu, 30 phút, 10 câu Kiến thức chung và 20 câu Chuyên môn**. Có thể thay đổi; tổng hai nhóm phải bằng tổng số câu. Không tự tạo câu hỏi nghiệp vụ hoặc đáp án mẫu trong cơ sở dữ liệu.

Trong mỗi đề, **Thêm câu hỏi** một đáp án đúng hoặc đúng/sai; nhập nội dung, phương án, đáp án, điểm, giải thích, nguồn đối chiếu nếu có và nhóm câu. Có thể lưu câu chưa hoàn chỉnh vào bản nháp. **Xem trước đề** liệt kê nội dung đã lưu, đáp án, điểm, lỗi theo câu và trạng thái đối chiếu nguồn. **Duyệt đề** chỉ thành công khi đủ số câu/cơ cấu đã cấu hình, mọi câu có nội dung, phương án, một đáp án đúng hợp lệ và điểm lớn hơn 0.

Câu hỏi có thể soạn trực tiếp trong đề hoặc quản lý tại mục **Ngân hàng câu hỏi** rồi thêm vào đề bằng nút **Thêm từ ngân hàng**. Câu đã liên kết đồng bộ thay đổi từ ngân hàng vào bản nháp của các đề; phiên bản đã duyệt không bị sửa. Xóa câu khỏi ngân hàng sẽ ngắt liên kết và giữ nguyên câu đã được đưa vào đề.

Câu về thủ tục, thẩm quyền hoặc thời hạn phải có nguồn và được Ban Tổ chức xác nhận **Tôi đã đối chiếu nội dung, đáp án và nguồn nêu trên**. Hệ thống nhận diện một số từ khóa và hỗ trợ đánh dấu thủ công; Ban Tổ chức vẫn cần rà soát toàn bộ câu theo nguồn đang áp dụng. Sửa câu hoặc nguồn trên giao diện sẽ bỏ xác nhận cũ, yêu cầu đối chiếu lại. Hệ thống không tự xác nhận độ đúng của nguồn.

**Nhập từ Excel**:

1. Chọn **Tải mẫu Excel** trong đề. Điền sheet `CauHoi`, giữ nguyên 13 cột và nhập từ dòng 2. Cột **Câu tình huống** nhận Có/Không; cột này không bắt buộc với tệp mẫu cũ.
2. Sheet `ViDuMinhHoa` có hai ví dụ nhập liệu được ghi rõ minh họa; sheet `HuongDan` giải thích định dạng. Hai sheet này không tự nhập vào đề.
3. Chọn tệp `.xlsx`, bấm **Xem trước dữ liệu Excel**. Mỗi dòng giữ số dòng Excel, có lỗi/cảnh báo cụ thể. Xem trước không lưu câu hỏi.
4. Sửa tệp nếu có lỗi. Chỉ khi toàn bộ dòng hợp lệ mới bấm **Nhập … câu hỏi**; máy chủ đọc và kiểm tra lại tệp, lưu toàn bộ trong một giao dịch.

Giới hạn 5 MB/tệp và 500 câu/đề. Dùng giá trị thuần, không công thức hoặc macro. Câu đúng/sai nhận đáp án **Đúng/Sai**; câu một đáp án nhận **A/B/C/D**. Cờ nguồn trong Excel không được coi là xác nhận của Ban Tổ chức: sau nhập vẫn phải đối chiếu nguồn trước khi duyệt.

**Lịch thi** nằm ở cấp cuộc thi, nhập giờ Việt Nam cho ba mốc: **ngày giờ mở thi < hạn bắt đầu ≤ ngày giờ đóng thi**. Máy chủ kiểm tra thứ tự và chuyển sang UTC trước khi lưu. Thời lượng đặt riêng ở mỗi đề. Nếu khoảng từ hạn bắt đầu đến giờ đóng ngắn hơn thời lượng một đề, hiển thị cảnh báo nêu tên đề, thời lượng đặt và số phút còn lại cho người bắt đầu sát hạn. Cảnh báo không chặn lưu lịch hợp lệ.

**Phiên bản đã duyệt**: mỗi lần duyệt bản nháp mới tạo một snapshot chỉ đọc, số phiên bản và mã SHA-256. Duyệt lại khi chưa sửa không tạo bản trùng. Sau khi sửa cấu hình, đổi tên nhóm hoặc sửa/nhập/xóa câu, bản nháp cần duyệt lại; các snapshot cũ giữ nguyên. Mở **Phiên bản đã duyệt → Xem phiên bản** để đối chiếu. Bảng lượt thi đã chuẩn bị khóa tham chiếu phiên bản cố định cho cả lượt đang làm/đã nộp; chưa có luồng làm bài trong bước này.

Thử theo yêu cầu:

1. Trong cùng cuộc thi tạo hai đề ở hai lĩnh vực, kiểm tra cấu hình gợi ý 30/30/10/20 và lưu/tải lại.
2. Để thử nhanh, đổi một đề thành 1 câu chung, 0 câu chuyên môn, tổng 1 câu. Thêm một câu chưa chọn đáp án, lưu bản nháp và bấm **Duyệt đề**: báo **Chưa chọn một đáp án đúng hợp lệ**. **Xem trước đề** hiển thị phương án và lỗi.
3. Sửa câu chọn đáp án hợp lệ, lưu và duyệt: nhận phiên bản 1. Sửa tiếp bản nháp rồi xem lại phiên bản 1 để kiểm tra nội dung cũ giữ nguyên.
4. Trong **Lịch thi**, nhập giờ đóng sớm hơn giờ mở: báo lỗi và không lưu. Đặt mở 08:00, hạn bắt đầu 08:30, đóng 08:40 cùng ngày: lưu được và cảnh báo đề 30 phút chỉ còn 10 phút cho người bắt đầu sát hạn.
5. Tải mẫu Excel, bỏ trống đáp án dòng 2 rồi xem trước để kiểm tra số dòng báo lỗi. Sửa đáp án rồi xem trước và nhập lại.

## Phân công dự thi và Công bố — bước 4

Trong chi tiết cuộc thi, chọn **Phân công dự thi**. Chọn một hoặc nhiều tài khoản **Thí sinh đang hoạt động**, chọn một đề có bản hiện tại đã duyệt trong chính cuộc thi rồi lưu. Mỗi tài khoản có tối đa một phân công trong mỗi cuộc thi, nhưng có thể được phân vào nhiều cuộc thi khác nhau. Nếu một tài khoản trong nhóm chọn không hợp lệ, máy chủ từ chối toàn bộ lần lưu để tránh phân công một phần.

Danh sách có họ tên, bộ phận, đề/phiên bản được giao và trạng thái lượt thi. Dữ liệu bộ phận được lưu ở tài khoản; tài khoản cũ chưa có bộ phận hiển thị **Chưa cập nhật**, không tự suy đoán. Người dùng minh họa được ghi nhãn. Trạng thái gồm chưa bắt đầu, đang làm, đã nộp hoặc đã hết thời gian; bước này chưa tạo lượt làm bài qua giao diện.

Trước khi có bất kỳ lượt bắt đầu nào trong cuộc thi, Ban Tổ chức có thể đổi đề đã duyệt hoặc thu hồi phân công. Khi thí sinh đã bắt đầu, các thao tác này bị khóa cả ở máy chủ và cơ sở dữ liệu. Máy chủ cũng kiểm tra đề và phiên bản thuộc đúng cuộc thi, không tin ID gửi từ trình duyệt.

Mỗi phân công gắn với **phiên bản cố định đã duyệt**. Sửa bản nháp hoặc duyệt phiên bản mới không tự đổi phân công cũ. Muốn giao phiên bản mới trước khi thí sinh bắt đầu, thực hiện đổi đề/lưu phân công lại. Thông tin đề cho thí sinh lấy từ đúng phiên bản đã giao; không trả câu hỏi, đáp án, giải thích hoặc nguồn nội bộ qua API thông tin này.

Nút **Công bố cuộc thi** kiểm tra phía máy chủ: có lịch đúng thứ tự, có đề đã duyệt và ít nhất một thí sinh đang hoạt động đã được phân vào một phiên bản đề hợp lệ. Những phân công cũ chưa có đề/phiên bản phải được sửa hoặc thu hồi trước khi công bố. Nếu thiếu điều kiện, giao diện chỉ rõ từng mục. Cuộc thi đã kết thúc không được mở lại bằng thao tác công bố.

Thí sinh mở **Cuộc thi của tôi** để xem đúng các cuộc thi đã công bố và đề được phân. Nhập trực tiếp URL chi tiết hoặc URL đề của cuộc thi không được phân trả thông báo không có quyền/không tìm thấy; máy chủ trả `404`, không lộ nội dung cuộc thi khác. Phiên đăng nhập hợp lệ vẫn được giữ.

Thử theo yêu cầu:

1. Tạo hai cuộc thi, mỗi cuộc thi có một đề đã duyệt và lịch hợp lệ.
2. Phân cùng tài khoản thí sinh vào cả hai cuộc thi, chọn đúng đề của từng cuộc thi, rồi **Công bố cuộc thi**.
3. Đăng nhập tài khoản đó, mở `/thi-sinh/cuoc-thi`: kiểm tra có đúng hai cuộc thi và tên đề/phiên bản được giao tương ứng.
4. Với tài khoản thí sinh khác chưa được phân, nhập trực tiếp `/thi-sinh/cuoc-thi/{id}` và `/thi-sinh/cuoc-thi/{id}/de-thi`; kiểm tra thông báo từ chối. Bộ kiểm tra tự động tạo tài khoản khác trong cơ sở dữ liệu tạm để xác nhận trường hợp này.
5. Khi chưa bắt đầu, thử đổi đề hoặc thu hồi; sau khi đã có lượt bắt đầu, hai thao tác phải bị chặn. Kiểm tra tự động dùng lượt minh họa trong cơ sở dữ liệu tạm, không sửa lượt của người dùng.

## Hướng dẫn, làm bài và nộp bài — bước 5

Trong **Cuộc thi của tôi**, bấm **Vào thi** để mở hướng dẫn gồm tên cuộc thi, nhóm đề, số câu, thời lượng, lịch thi và thể lệ. Bấm **Bắt đầu** gửi yêu cầu đến máy chủ. Máy chủ xác nhận tài khoản, phân công, trạng thái công bố và lịch hợp lệ trước khi tạo lượt; nếu đã có lượt đang làm thì trả lại đúng lượt đó. Thời gian chỉ chạy từ mốc bắt đầu do máy chủ lưu và thời hạn không vượt giờ đóng cuộc thi.

Khi phát đề, máy chủ ghim phiên bản đã phân, xáo trộn thứ tự câu và phương án rồi lưu thứ tự này cho lượt. Màn hình hiển thị đồng hồ theo thời gian máy chủ, số câu đã trả lời, nút đánh dấu cần xem lại và trạng thái đồng bộ. Mỗi đáp án/cờ đánh dấu chỉ hiện **Đã lưu** sau khi máy chủ xác nhận; nếu mất kết nối, màn hình báo **Chưa đồng bộ** và cho phép thử lưu lại. Tải lại trang khi đăng nhập sẽ khôi phục câu hỏi, thứ tự, phương án và câu trả lời đã lưu.

Nút **Nộp bài** nêu số câu chưa trả lời và yêu cầu xác nhận. Máy chủ chốt lượt một lần; truy cập lại bài đã nộp chỉ hiển thị trạng thái và thời điểm nộp, không mở lại câu hỏi. Hệ thống chưa có lịch công bố điểm/đáp án nên không gửi đáp án đúng, giải thích, nguồn hoặc điểm cho trình duyệt trước/sau khi nộp.

Kiểm tra tự động trong `npm.cmd run test:assignments` bắt đầu lượt theo lịch đang mở, xác nhận một tài khoản khác không thể đọc hoặc bắt đầu lượt, lưu nhiều đáp án, tải lại để xác minh thứ tự/câu trả lời, nộp và thử mở lại sau khi máy chủ khởi động lại.

## Chấm điểm, xếp hạng và xuất kết quả — bước 6

Trong tab **Phân công dự thi**, mục **Kết quả và xếp hạng** hiển thị mã thí sinh, họ tên, bộ phận, nhóm đề, số câu đúng, thời gian làm bài, các điểm thành phần, thời điểm nộp và trạng thái hợp lệ. Máy chủ chấm từ đáp án, điểm và cờ câu tình huống trong đúng snapshot phiên bản đề được phát; chỉnh sửa bản nháp sau đó không làm thay đổi kết quả của lượt đã phát. Lượt bị loại do cấp lượt thay thế vẫn hiện để Ban Tổ chức đối chiếu nhưng không được xếp hạng.

Nhóm xếp hạng mặc định tách theo từng nhóm lĩnh vực. Trong tab **Đề thi → Nhóm lĩnh vực và xếp hạng**, đặt cùng **Nhóm xếp hạng tương đương** để xếp chung các nhóm đề tương đương. Thứ hạng xếp theo số câu đúng giảm dần, sau đó thời gian làm bài tăng dần; nếu cả hai tiêu chí bằng nhau thì đồng hạng. Bảng và Excel ghi rõ số câu đúng và thời gian làm bài đến mili giây. Điểm thành phần vẫn được hiển thị để đối chiếu nhưng không dùng để xếp hạng. Câu tình huống được đánh dấu trong biểu mẫu câu hỏi hoặc cột **Câu tình huống** trong Excel. Điểm cá nhân chỉ được trả bởi API kết quả khi Ban Tổ chức bật công bố; đáp án đúng và giải thích không được gửi cho trình duyệt thí sinh.

Nút **Xuất Excel** tải cùng tập dữ liệu đang xem; chọn một nhóm xếp hạng để chỉ xuất nhóm đó. Chạy `npm.cmd run test:results` để kiểm tra hai thí sinh đồng điểm, điểm tình huống, hai nhóm đề riêng/tương đương, lượt cũ đã bị loại, quyền Ban Tổ chức và nội dung tệp Excel.

## Xét giải, công bố và kết thúc cuộc thi — bước 7

Tab **Xét giải** cấu hình tên giải và số lượng theo **nhóm xếp hạng** (bao gồm các nhóm đề được cấu hình tương đương), tạo danh sách đề xuất từ các lượt hợp lệ đã nộp, và cho Ban Tổ chức rà soát/điều chỉnh từng thí sinh. Đồng hạng tại ngưỡng xét thưởng và lượt có sự cố quản trị được đánh dấu riêng. Cần xác nhận đã rà soát đồng hạng trước khi duyệt; mọi điều chỉnh so với đề xuất tự động phải có lý do.

Lưu dự kiến, duyệt và công bố là các trạng thái riêng. Máy chủ ghi người thao tác, thời điểm và lý do trong lịch sử; nội dung được đóng băng khi duyệt, đồng thời việc duyệt/công bố bị từ chối nếu bảng kết quả đã thay đổi kể từ lúc lưu. Thí sinh chỉ nhận điểm cá nhân khi Ban Tổ chức bật công bố điểm; danh sách đạt giải chỉ hiện sau khi phát hành. Excel được tạo từ chính snapshot đã công bố. Chỉ có thể kết thúc cuộc thi khi danh sách giải đã phát hành và không còn lượt đang làm.

Chạy `npm.cmd run test:results` để kiểm tra đồng hạng ở vị trí xét thưởng, sự cố được gắn cờ, yêu cầu lý do điều chỉnh, quyền xem trước/sau công bố, dữ liệu Excel và kết thúc cuộc thi. `backend/competition-awards.http` có ví dụ gọi các API quản lý và xem kết quả thí sinh.

## Phân quyền và lưu trữ

- Hai mã vai trò: `Organizer` = Ban Tổ chức, `Candidate` = Thí sinh. Vai trò lấy từ cơ sở dữ liệu, không cho người dùng chọn để được cấp quyền.
- API mặc định yêu cầu đăng nhập. Mỗi yêu cầu kiểm tra chữ ký, thời hạn JWT, phiên đăng nhập và trạng thái/vai trò hiện tại của người dùng trong SQLite.
- Thí sinh không được gọi API Ban Tổ chức. API không gian Thí sinh yêu cầu đúng vai trò Thí sinh. Trả `401` khi chưa xác thực hoặc phiên không còn hợp lệ, `403` khi sai quyền.
- Mật khẩu băm bằng BCrypt. API danh sách/hồ sơ chỉ trả trường công khai, không trả mật khẩu hoặc mã băm.
- Đăng xuất thu hồi phiên ở cơ sở dữ liệu và xóa token của ứng dụng trong trình duyệt. JWT không còn dùng được sau đăng xuất.
- Chỉ Ban Tổ chức được tạo/chỉnh sửa Cuộc thi, phân công, thu hồi, công bố hoặc kết thúc. Chưa có API đăng ký công khai hoặc sửa vai trò.
- Bản nâng cấp giữ người dùng, mật khẩu và khóa ký hiện có; chuẩn hóa vai trò cũ `Admin` sang `Organizer`. Token cũ không có phiên trong cơ sở dữ liệu phải đăng nhập lại.

Múi giờ hệ thống là **`Asia/Ho_Chi_Minh`**, được lưu trong cơ sở dữ liệu. Giao diện định dạng thời gian với múi giờ này kể cả khi máy người dùng đặt múi giờ khác. Biểu mẫu lịch gửi giờ Việt Nam chưa gắn múi giờ; máy chủ chuyển đổi và lưu dưới dạng UTC.

| Biến môi trường | Mục đích |
| --- | --- |
| `QUIZ_TANHOA_DATA_DIR` | Thư mục chứa `quiz_tanhoa.db` và `jwt.key` |
| `QUIZ_TANHOA_ADMIN_PASSWORD` | Mật khẩu tài khoản quản trị khi khởi tạo mới |
| `QUIZ_TANHOA_SEED_DEMO` | Chỉ giá trị `true` mới tạo tài khoản minh họa còn thiếu |
| `QUIZ_TANHOA_JWT_KEY` | Tùy chọn khóa ký, tối thiểu 32 byte; nếu bỏ trống tự sinh và lưu `jwt.key` |
| `QUIZ_TANHOA_WEB_ROOT` | Tùy chọn đường dẫn giao diện đã build |

Ứng dụng không tự đọc tệp `.env`; đặt biến môi trường trong terminal hoặc cấu hình dịch vụ chạy máy chủ. Dữ liệu, khóa, thư viện và bản build được bỏ qua trong `.gitignore`. Nếu đang dùng cơ sở dữ liệu cũ tại `%LOCALAPPDATA%\Quiz_TanHoa\web`, đặt `QUIZ_TANHOA_DATA_DIR` về đúng thư mục đó trước khi khởi động để dùng tiếp dữ liệu. Sao lưu dữ liệu trước khi nâng cấp hoặc chuyển môi trường.

## Cấu trúc dự án

```text
backend/
  competition-results.http API kết quả, cấu hình phá hòa và xuất Excel
  competition-awards.http API dự kiến, duyệt, công bố, thí sinh và kết thúc cuộc thi
  Controllers/       API xác thực và không gian theo vai trò
  Data/              DbContext, khởi tạo/nâng cấp SQLite
  Models/            Người dùng, phiên, cấu hình hệ thống
  Security/          JWT, vai trò, chính sách kiểm tra quyền
  Services/          Quy ước giờ UTC và chuyển đổi giờ Việt Nam
frontend/
  src/               Giao diện React, API client, định dạng thời gian
scripts/
  dev.cjs            Chạy cả frontend/backend, chế độ minh họa tách biệt
  test-auth.cjs      Kiểm tra API, phân quyền và lưu trữ
  test-competitions.cjs Kiểm tra lưu/sửa Cuộc thi, quyền và điều kiện hiển thị
  test-exams.cjs     Kiểm tra đề, câu hỏi, Excel, duyệt phiên bản và lịch thi
  test-assignments.cjs Kiểm tra phân công, công bố, quyền thí sinh và vòng đời lượt thi
  test-results.cjs  Kiểm tra chấm điểm, xét giải, phân quyền và workbook Excel
  test-development.cjs Kiểm tra profile MinhHoa trong terminal không đặt sẵn biến seed
  test-browser.cjs   Kiểm tra thực tế trên Chrome headless
docs/
  candidate-attempts.http Gọi API trạng thái, bắt đầu, lưu đáp án và nộp bài
  architecture.md    Hợp đồng API và nguyên tắc mở rộng các bước sau
```

## Kiểm tra

```powershell
npm.cmd test
```

Lệnh này build backend Release, kiểm tra xác thực/phân quyền, Cuộc thi và Đề thi/Excel/Lịch thi, build frontend, kiểm tra profile Development rồi kiểm tra trình duyệt. Cần Google Chrome; nếu cài ở đường dẫn khác, đặt `CHROME_PATH` đến tệp thực thi. Kiểm tra dùng profile và cơ sở dữ liệu tạm, không dùng tài khoản hoặc dữ liệu vận hành. Ảnh kiểm tra giao diện ở `.artifacts` khi chạy kiểm tra trình duyệt.

Kiểm tra Development build riêng vào `.artifacts/development` để không ghi đè backend đang chạy trong terminal. Sau mỗi lần cập nhật mã nguồn, cần dừng backend hiện tại bằng `Ctrl+C` và khởi động lại để API dùng phiên bản mới. Kết quả nghiệm thu bước 3 ghi trong [docs/verification.md](docs/verification.md).

Có thể chạy riêng:

```powershell
dotnet build backend/Quiz_TanHoa.Api.csproj -c Release
npm.cmd run test:auth
npm.cmd run test:competitions
npm.cmd run test:exams
npm.cmd run test:assignments
npm.cmd run test:results
npm.cmd --prefix frontend run build:web
npm.cmd run test:development
npm.cmd run test:browser
```

## Build bản web cùng máy chủ

```powershell
npm.cmd run build:web
$env:QUIZ_TANHOA_DATA_DIR = 'D:\Quiz_TanHoa\.data\web'
$env:QUIZ_TANHOA_ADMIN_PASSWORD = 'ThayBangMatKhauRiengToiThieu12KyTu!'
dotnet .\publish\web\Quiz_TanHoa.Api.dll --urls http://127.0.0.1:5030
```

Mở `http://127.0.0.1:5030/dang-nhap`. Thư mục `publish/web` chứa API và giao diện tĩnh. Chạy vận hành trên máy chủ ASP.NET Core với HTTPS, thư mục dữ liệu bền vững và mật khẩu riêng. Chưa triển khai website lên máy chủ bên ngoài trong bước này.

Bản Electron hiện có vẫn giữ trong dự án dưới dạng tùy chọn: `npm.cmd ci`, `npm.cmd run build:desktop`, `npm.cmd run electron`. Website là mục tiêu chính của bước này; luồng đóng gói Electron chưa nằm trong kiểm tra nghiệm thu.
