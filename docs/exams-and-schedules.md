# Đề thi, phiên bản và lịch thi

## Hợp đồng API bước 3

Các đường dẫn sau dùng tiền tố `/api/organizer/competitions/{competitionId}` và yêu cầu policy `Organizer`. Mỗi truy vấn kiểm tra cả ID cuộc thi, đề và tài nguyên con. Thí sinh không có API đọc đáp án, xem trước quản trị, duyệt hoặc nhập câu hỏi.

Ngân hàng câu hỏi dùng tiền tố `/api/organizer/question-bank` (GET, POST, PUT, DELETE) và chỉ dành cho Ban Tổ chức. `POST /exams/{examId}/questions/from-bank` nhận `{ questionIds: [...] }` để gắn câu hỏi đang hoạt động vào bản nháp. Thay đổi câu hỏi ngân hàng đồng bộ vào mọi đề nháp còn liên kết và tăng `DraftRevision`; snapshot đã duyệt không đổi. Xóa câu khỏi ngân hàng đánh dấu không hoạt động, ngắt liên kết và giữ nội dung đã sao chép trong đề. Nâng cấp schema v10 chuyển các câu hỏi từ đề minh họa hiện có vào ngân hàng một lần.

| Đường dẫn | Phương thức | Mục đích |
| --- | --- | --- |
| `/field-groups` | GET, POST | Danh sách hoặc thêm nhóm lĩnh vực |
| `/field-groups/{groupId}` | PUT | Đổi tên nhóm trong cuộc thi |
| `/exams` | GET, POST | Danh sách hoặc tạo đề |
| `/exams/{examId}` | GET, PUT | Đọc hoặc sửa cấu hình bản nháp |
| `/exams/{examId}/questions` | GET, POST | Câu hỏi trong đề |
| `/exams/{examId}/questions/{questionId}` | PUT, DELETE | Sửa/xóa câu khỏi bản nháp |
| `/exams/{examId}/questions/from-bank` | POST | Thêm câu hỏi ngân hàng đang hoạt động, giữ liên kết đồng bộ |
| `/exams/{examId}/preview` | GET | Cấu hình, câu hỏi và lỗi/cảnh báo duyệt |
| `/exams/{examId}/approve` | POST | Kiểm tra và lưu phiên bản cố định |
| `/exams/{examId}/versions` | GET | Lịch sử phiên bản |
| `/exams/{examId}/versions/{versionId}` | GET | Đọc snapshot cũ |
| `/exams/{examId}/import-template` | GET | Tải mẫu .xlsx |
| `/exams/{examId}/import-preview` | POST multipart `file` | Đọc tệp, kiểm tra dòng, không lưu |
| `/exams/{examId}/import` | POST multipart `file` | Đọc lại tệp và lưu tất cả nếu hợp lệ |
| `/schedule` | GET, PUT | Lịch mở, hạn bắt đầu và đóng của cuộc thi |

Cấu hình đề: `name`, `fieldGroupId`, `durationMinutes`, `targetQuestionCount`, `commonQuestionCount`, `specializedQuestionCount`. Mặc định 30 phút/30 câu/10 chung/20 chuyên môn chỉ là gợi ý, không seed câu hỏi. Câu dùng `type=SingleChoice|TrueFalse`, `group=Common|Specialized`, `options=[{key,text}]`, `correctAnswer`, `points`, `isScenario`, `explanation`, `source`, `requiresSourceReview`, `sourceReviewed`. `isScenario` được ghim cùng câu hỏi trong snapshot đã duyệt.

Lưu nháp cho phép câu chưa có đáp án/điểm hợp lệ. Duyệt kiểm tra số lượng/cơ cấu, từng câu và dấu xác nhận đối chiếu nguồn. Câu thủ tục/thẩm quyền/thời hạn nhận diện bằng từ khóa hoặc được người soạn đánh dấu; cần nguồn và reviewer/time do máy chủ ghi. Nội dung và nguồn Excel không tự cấp xác nhận này.

## Bất biến của phiên bản

`DraftRevision` tăng khi sửa cấu hình, câu hỏi, nhập Excel hoặc đổi tên nhóm đang dùng. Nó là concurrency token để tránh một phiên ghi đè phiên sửa khác; xung đột trả 409 yêu cầu tải lại. Duyệt hợp lệ lưu `ApprovedExamVersions` với `SnapshotJson`, SHA-256, người và thời điểm duyệt. Cặp `(ExamId, DraftRevision)` duy nhất giúp duyệt lặp không sinh phiên bản trùng.

SQLite chặn UPDATE/DELETE snapshot bằng trigger. `ExamAttempts` tham chiếu cặp `(ExamVersionId, ExamId)` và chặn đổi cặp này sau khi phát đề; lượt đang làm và đã nộp giữ cùng phiên bản. Máy chủ phát câu hỏi từ đúng snapshot, lưu thứ tự câu/phương án và đáp án xác nhận vào `ExamAttemptQuestions`; không đọc đề nháp cho lượt cũ.

## Lịch và thời gian

PUT lịch nhận `opensAtLocal`, `startDeadlineLocal`, `closesAtLocal` dạng `dd/MM/yyyy HH:mm` theo giờ Việt Nam; định dạng ISO local cũ vẫn được chấp nhận để tương thích. Chuyển bằng `VietnamClock` theo `Asia/Ho_Chi_Minh`, kiểm tra mở < hạn bắt đầu ≤ đóng trước khi lưu UTC. GET trả cả thời điểm UTC dạng ISO và chuỗi giờ Việt Nam dạng `dd/MM/yyyy HH:mm`, cùng cảnh báo theo mỗi đề nếu `ClosesAtUtc - StartDeadlineUtc < DurationMinutes`.

Cuộc thi phải Published và thí sinh được phân mới được xem hoặc thao tác lượt. Thông tin `canStart` còn cần đủ ba mốc và `OpensAtUtc <= UtcNow <= StartDeadlineUtc`, `UtcNow < ClosesAtUtc`. API bắt đầu kiểm tra lại điều kiện và đặt hạn lượt bằng `min(start + thời lượng phiên bản đã phát, giờ đóng cuộc thi)`; gọi lại khi lượt còn hoạt động khôi phục cùng lượt và thứ tự câu.

Schema v3 thêm `StartDeadlineUtc`, các bảng nhóm/đề/câu/phiên bản/lượt; schema v5 bổ sung câu hỏi/đáp án từng lượt. Dữ liệu đã có hai mốc lịch trước nâng cấp nhận hạn bắt đầu bằng giờ đóng để giữ cách kiểm tra cũ; chưa có lịch giữ NULL. Tài khoản, phiên và dữ liệu bước trước không bị xóa. Sáu tên nhóm mẫu chỉ thêm khi cuộc thi chưa có nhóm; đổi tên không bị seed lại sau restart.

## Excel

Mẫu có `CauHoi` trống để nhập, `ViDuMinhHoa` chứa ví dụ kỹ thuật được ghi nhãn, `HuongDan` chứa chỉ dẫn. Đọc trang `CauHoi`; nếu không có tên này dùng trang đầu. Hỗ trợ inline string và shared string khi Excel lưu lại. Dòng 1 bắt buộc đủ các cột chuẩn; `Câu tình huống` là cột tùy chọn để nhận Có/Không, tệp cũ không có cột này vẫn đọc được. Không nhận công thức/macro. Giới hạn tệp 5 MB, tối đa 500 câu/đề và dung lượng giải nén được kiểm soát. XML không đọc DTD/thực thể bên ngoài.

Xem trước trả `totalRows`, `validRows`, `canImport`, `rows[{rowNumber,question,errors,warnings}]`, `errors` cấp tệp. Dòng báo lỗi giữ số dòng trong Excel; không có dòng hợp lệ cũng không cho nhập. Nhập lại đọc cùng tệp, kiểm tra lại phía máy chủ và lưu trong giao dịch; không nhận danh sách câu do trình duyệt tự đánh dấu hợp lệ.

Định dạng tham khảo: [Microsoft — cấu trúc SpreadsheetML](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document) và [bảng shared strings](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table).
