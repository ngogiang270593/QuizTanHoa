# Phân công, công bố và quyền xem

API quản trị yêu cầu policy `Organizer` và dùng tiền tố `/api/organizer/competitions/{competitionId}`.

| Đường dẫn | Phương thức | Hành vi |
| --- | --- | --- |
| `/assignment-options` | GET | Tài khoản Thí sinh hoạt động và đề hiện tại đã duyệt thuộc cuộc thi |
| `/assignments` | GET | Danh sách, bộ phận, đề/phiên bản và trạng thái lượt |
| `/assignments` | POST | `{userIds, examId}`, gán nhiều tài khoản trong một giao dịch |
| `/assignments/{userId}` | PUT | `{examId}`, đổi đề/phiên bản trước khi bắt đầu |
| `/assignments/{userId}` | DELETE | Thu hồi trước khi bắt đầu |
| `/assignments/{userId}/attempt-session` | POST | Chuyển lượt đang làm sang phiên đăng nhập mới hoặc cho phép thi lại; bắt buộc có lý do |
| `/publication` | GET | Điều kiện công bố và lỗi còn thiếu |
| `/publish` | POST | Chuyển Nháp sang Đã công bố nếu đủ điều kiện |

`CompetitionAssignments` giữ khóa chính `(CompetitionId, UserId)`. Thêm ID đề và ID phiên bản đã duyệt, người/thời điểm phân công; không dùng ID bản nháp để lấy nội dung đã giao. API không cho gán đề khác cuộc thi hoặc phiên bản không thuộc đề. Mỗi nhóm tài khoản được kiểm tra toàn bộ trước khi ghi. Tài khoản không hoạt động hoặc vai trò Ban Tổ chức không xuất hiện trong lựa chọn thí sinh.

Bộ phận thuộc `Users.Department`, mặc định chuỗi trống cho dữ liệu cũ. Không thêm biểu mẫu quản lý tài khoản/bộ phận trong bước này; giao diện hiển thị Chưa cập nhật khi trống.

Một phân công có lượt bắt đầu ở bất kỳ đề nào thuộc cùng cuộc thi sẽ bị khóa đổi/thu hồi. Kiểm tra API dùng `ExamAttempts.UserId` kết hợp cuộc thi của đề, không chỉ so sánh đề đang được gán. Trigger SQLite bảo vệ cùng điều kiện. Trạng thái lấy từ lượt đã lưu: `NotStarted`, `InProgress`, `Submitted`, `Expired`; các trạng thái đã bắt đầu đều khóa phân công, kể cả hết giờ/chưa nộp.

Lựa chọn đề mới yêu cầu bản hiện tại đã duyệt. Sau khi gán, ID phiên bản được giữ nguyên dù bản nháp đổi hoặc có phiên bản mới. Công bố chấp nhận phiên bản đã duyệt cố định còn hợp lệ của phân công; không tự thay nó bằng bản mới nhất. Đổi tên/thời lượng bản nháp không làm thay đổi tên/thời lượng đề thí sinh đã được giao.

Công bố yêu cầu đủ lịch `opens < startDeadline <= closes`, ít nhất một phiên bản đề đã duyệt và ít nhất một phân công hợp lệ cho thí sinh hoạt động. Những phân công cũ chưa có đề/phiên bản phải xử lý trước khi công bố. Công bố lại không tạo bản ghi phân công hoặc thời điểm công bố mới; không dùng thao tác này mở lại cuộc thi Ended.

API Thí sinh yêu cầu policy `Candidate`:

| Đường dẫn | Kết quả |
| --- | --- |
| `GET /api/candidate/competitions` | Chỉ Published và có phân công/phiên bản hợp lệ cho người hiện tại |
| `GET /api/candidate/competitions/{id}` | Cùng điều kiện, không đủ quyền trả 404 |
| `GET /api/candidate/competitions/{id}/exam` | Cùng hồ sơ cuộc thi và thông tin đề được giao, cùng kiểm tra quyền |
| `GET /api/candidate/competitions/{id}/attempt` | Trạng thái lượt; câu hỏi chỉ có trong lượt đang làm |
| `POST /api/candidate/competitions/{id}/attempt/start` | Bắt đầu theo lịch hoặc khôi phục lượt chưa nộp |
| `PUT /api/candidate/competitions/{id}/attempt/questions/{questionId}` | Lưu câu trả lời/cờ xem lại thuộc lượt của người hiện tại |
| `POST /api/candidate/competitions/{id}/attempt/submit` | Chốt lượt và ghi thời điểm nộp |

Hồ sơ có `assignedExam` gồm ID/tên/lĩnh vực/thời lượng/số câu/phiên bản. Các giá trị lấy từ snapshot đã duyệt. Không trả `SnapshotJson`, câu hỏi, đáp án, giải thích hoặc nguồn đối chiếu. ID tài khoản lấy từ phiên đã xác thực, không nhận qua query/body để tra quyền.

Thông tin `canStart` kiểm tra lịch giờ Việt Nam và trạng thái chưa bắt đầu; API bắt đầu kiểm tra lại mọi điều kiện ở máy chủ. Mỗi lượt ghim đúng `ExamVersionId`, thứ tự câu/phương án đã xáo và đáp án được xác nhận lưu. Hạn lượt là sớm hơn giữa thời lượng phiên bản đề và giờ đóng cuộc thi. Câu đã nộp không mở lại; điểm/đáp án không được gửi khi chưa có lịch công bố.

Mọi yêu cầu lượt thi gửi `X-Quiz-Attempt-Tab` ổn định trong một tab. Máy chủ ràng buộc lượt với `AuthSession.Id`, chỉ gia hạn khóa tab hiện tại theo lease 30 giây, và trả `409 Tài khoản đang có phiên làm bài` nếu phiên đăng nhập khác truy cập. Trình duyệt dùng Web Locks để tab nhân bản không dùng chung ID; UI gia hạn lease mỗi 10 giây và thử gửi lại câu chưa đồng bộ khi mạng phục hồi. Hạn nộp được lưu một lần; tiến trình nền và các API tự chốt `SubmittedAtUtc = DeadlineAtUtc` khi hết giờ, kể cả khi trình duyệt đóng. Nộp lặp lại trả cùng thời điểm đã chốt.

Ban Tổ chức có thể chuyển quyền phiên sau khi xác minh thí sinh và ghi lý do. Máy chủ chọn phiên đăng nhập mới nhất đang hoạt động, đổi chủ sở hữu lượt và bỏ khóa tab; phiên cũ mất quyền ngay. Nếu thể lệ cho thi lại, thao tác sẽ vô hiệu hóa lượt cũ, ghi audit và cấp quyền cho phiên mới; đồng hồ của lượt thay thế chỉ bắt đầu khi thí sinh bấm **Bắt đầu**. Audit lưu người thao tác, thời điểm, lý do và phiên cũ/mới.

Schema v6 nâng cấp cộng dồn: giữ tài khoản, phiên, cuộc thi, đề, snapshot, phân công và lượt cũ. `ExamAttemptQuestions` lưu thứ tự phát đề, phương án đã xáo, câu trả lời và cờ xem lại. Chỉ cho phép một attempt chưa vô hiệu hóa theo cặp `(CompetitionId, UserId)` bằng unique index SQLite; lượt thi lại phải vô hiệu hóa lượt trước trước khi cấp lượt mới. `ExamAttemptAdminEvents` và `ExamAttemptSessionGrants` ghi thao tác chuyển/thi lại. Phân công cũ chưa có đề được giữ lại để Ban Tổ chức xử lý, không tự gán ngẫu nhiên. Không seed tài khoản hay phân công minh họa vào dữ liệu vận hành.
