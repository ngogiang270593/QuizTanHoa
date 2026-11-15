# Danh mục Phòng ban và đồng bộ local → web

## Dữ liệu đối chiếu

Ngày 14/11/2026 đã kiểm tra danh mục gốc trong `backend/Data/InitialOrganizationSeeder.cs` và đối chiếu Firestore. Cả local và web có đủ 9 mã/tên/thứ tự giống nhau:

1. PHONG_KINH_TE — Phòng Kinh tế
2. PHONG_VHXH — Phòng Văn hóa-Xã hội
3. VP_HDND_UBND — Văn phòng HĐND và UBND
4. TT_DV_HCC — Trung tâm Dịch Vụ Hành Chính Công
5. TT_CUNG_UNG_DVC — Trung tâm Cung Ứng Dịch Vụ Công
6. CONG_AN_XA — Công an xã
7. BAN_CHQS_XA — Ban CHQS xã
8. BAN_QUAN_LY_AP — Ban quản lý các ấp
9. TRAM_Y_TE_XA — Trạm y tế xã

Kết quả: 0 thêm mới, 0 cập nhật, 9 giữ nguyên và đọc kiểm tra lại. Không tạo trùng hoặc sửa tài khoản thật. Nguồn là cấu hình seed local; không tìm thấy cơ sở dữ liệu vận hành local trong các đường dẫn cấu hình của workspace này.

`node scripts/sync-organization-units.mjs` chỉ đối chiếu. Thêm `--write` để đồng bộ và lưu báo cáo. Có thể truyền `--database <đường-dẫn-sqlite>` để dùng bảng OrganizationUnits trong DB cụ thể thay cho danh mục cấu hình. Script đọc SQLite ở chế độ read-only, đối chiếu theo mã và tên, không dùng ID local làm ID web. Khi cần cập nhật thì giữ ID web, đồng bộ tên tài khoản liên quan và có sao lưu trước thay đổi. Không tự đồng bộ lại khi ứng dụng khởi động.

Xuất danh mục, sao lưu và báo cáo nằm trong `.data/imports/organization-units-*`, không đưa lên git.

## Giao diện

Menu **Danh mục** nằm trong nhóm **Danh mục dùng chung**, có hai tab:

- **Chủ đề**: chức năng biên tập hiện có; người không có quyền đọc chủ đề không thấy tab này.
- **Phòng ban**: mã, tên, thứ tự hiển thị, số tài khoản trực thuộc; tìm theo tên/mã không dấu; thêm, sửa và xác nhận xóa.

Mở trực tiếp: `/ban-to-chuc/danh-muc?tab=phong-ban`. Tab hỗ trợ phím mũi tên, Home, End. Người tổ chức được xem danh mục; thêm/sửa/xóa cần quyền **Quản lý tài khoản và cấp quyền**.

## Quy tắc

- Mã gồm 1–50 ký tự Latin/số/gạch dưới/gạch ngang, chuẩn hóa chữ hoa.
- Tên 1–200 ký tự; kiểm tra trùng mã và tên không phân biệt hoa/thường, chuẩn Unicode.
- Thứ tự hiển thị là số nguyên từ 0 đến 10.000.
- Đổi tên cập nhật tên phòng ban của các tài khoản liên quan, gồm tài khoản bị khóa; không sửa lịch sử thi, snapshot hay danh sách giải đã lưu.
- Chỉ xóa phòng ban không còn tài khoản trực thuộc. Phòng ban đang dùng có nút **Xem tài khoản**, mở danh sách lọc sẵn để chuyển người sang phòng khác.
- Màn hình tạo/sửa tài khoản chọn phòng ban từ danh mục. API nhận `departmentId`, tra lại tên mới nhất khi lưu để tránh khôi phục tên cũ từ biểu mẫu mở trước đó. Giá trị đơn vị dạng chữ trong dữ liệu/API cũ vẫn được giữ tương thích.
- Cloud cập nhật trong transaction Firestore; SQLite cập nhật trong transaction DB. Thêm/sửa/xóa phòng ban ghi lịch sử quản trị.

## API và kiểm tra

- `GET/POST /api/organizer/organization-units`
- `PUT/DELETE /api/organizer/organization-units/{id}`
- `departmentId` tùy chọn trong API tạo/sửa tài khoản, không thay đổi ID tài khoản hay quyền đã cấp.

Đã qua 25 kiểm thử frontend và 14 nhóm kiểm thử cloud. SQLite có kiểm thử CRUD, đồng bộ tên, chọn theo ID và chặn xóa phòng ban có tài khoản. Preview `c070a1c5` đã kiểm thử CRUD thật qua API, bao gồm quyền đọc/ghi khác nhau và dọn tài khoản/phòng ban thử sau kiểm tra. Không tạo dữ liệu thử ở production. Chưa kiểm tra trực quan vì không có trình duyệt kết nối.

Đã phát hành production ngày 14/11/2026, deployment 5211e995: https://quiztanhoa.pages.dev/ban-to-chuc/danh-muc?tab=phong-ban. Kiểm tra sau phát hành xác nhận đủ 9 phòng ban khớp local theo mã/tên/thứ tự, số tài khoản trực thuộc, tab danh mục và bộ chọn phòng ban trên màn hình tài khoản.
