# Phương án thay thế: Firebase Hosting + Cloudflare Tunnel

Kiến trúc: trình duyệt tải React từ Firebase Hosting và gọi HTTPS API qua Cloudflare Tunnel tới ASP.NET Core. SQLite và jwt.key nằm trên ổ đĩa bền vững của máy backend. Máy Windows hoặc VPS này phải luôn bật, có Internet; Cloudflare không lưu/chạy thay backend. Firebase trong phương án này dùng Hosting, không thay SQLite bằng Firestore.

## 1. Chuẩn bị

- Firebase project có Hosting; tài khoản có quyền triển khai.
- Tên miền trên Cloudflare, ví dụ `example.com`; dành `api.example.com` cho API.
- Node.js 24+, .NET 8 SDK và cloudflared trên máy backend.
- Thư mục dữ liệu chính thức và bản sao lưu. Không dùng `.data/demo`.

## 2. Build và chạy backend

Tại thư mục gốc source, trong PowerShell:

```powershell
npm.cmd --prefix frontend ci
dotnet publish backend/Quiz_TanHoa.Api.csproj -c Release -o publish/api
$env:ASPNETCORE_ENVIRONMENT = 'Production'
$env:QUIZ_TANHOA_DATA_DIR = 'D:\QuizTanHoa\.data\web'
$env:QUIZ_TANHOA_SEED_DEMO = 'false'
$env:QUIZ_TANHOA_ALLOWED_ORIGINS = 'https://PROJECT_ID.web.app,https://PROJECT_ID.firebaseapp.com'
# Chỉ lần đầu với cơ sở dữ liệu mới: nhập mật khẩu riêng, không ghi vào source.
$adminSecret = Read-Host 'Mật khẩu quản trị khởi tạo' -AsSecureString
$env:QUIZ_TANHOA_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $adminSecret).Password
dotnet .\publish\api\Quiz_TanHoa.Api.dll --urls http://127.0.0.1:5030
```

Thay PROJECT_ID bằng project thật. Nếu dùng tên miền riêng cho giao diện, thêm origin HTTPS chính xác vào danh sách, cách nhau bằng dấu phẩy, không có `/` cuối. Tài khoản đã có giữ nguyên mật khẩu. Giữ terminal chạy; khi vận hành lâu dài cần cấu hình backend và cloudflared tự khởi động qua dịch vụ/Task Scheduler. Không chạy nhiều backend dùng các bản sao SQLite khác nhau.

Kiểm tra ở terminal khác:

```powershell
Invoke-RestMethod http://127.0.0.1:5030/api/health
```

## 3. Cloudflare Tunnel

Trong Cloudflare Dashboard → Networking → Tunnels, tạo tunnel quản lý từ xa, chọn Windows và chạy lệnh cài connector do dashboard cung cấp. Token chỉ nhập trên máy backend, không lưu vào Git hoặc gửi qua chat.

Thêm published application route:

- Hostname: `api.example.com`.
- Service type: HTTP; URL: `127.0.0.1:5030`.
- Nếu connector chạy trên máy/container khác, địa chỉ service phải trỏ đúng máy backend.

Đặt Cache Rule **Bypass cache** cho hostname API; không áp dụng Cache Everything. Giữ xác thực JWT sẵn có của ứng dụng. Không đặt trang đăng nhập Cloudflare Access trước API công khai cho thí sinh nếu chưa tích hợp Access vào frontend.

```powershell
Invoke-RestMethod https://api.example.com/api/health
```

## 4. Firebase Hosting

Tạo `frontend/.env.web.local` từ mẫu và đặt hostname API thật:

```text
VITE_API_BASE_URL=https://api.example.com/api
```

Đăng nhập và triển khai tại thư mục gốc source:

```powershell
npx.cmd --yes firebase-tools login
npx.cmd --yes firebase-tools projects:list
npx.cmd --yes firebase-tools deploy --only hosting --project PROJECT_ID
```

firebase.json tự build frontend trước khi deploy. Không đưa mật khẩu/token vào biến VITE vì các biến đó được nhúng vào JavaScript công khai. Không deploy khi chưa đặt URL API: mặc định `/api` chỉ dùng cho mô hình frontend/backend cùng origin.

## 5. Nghiệm thu và vận hành

Mở `https://PROJECT_ID.web.app/dang-nhap`, đăng nhập, tải lại đường dẫn con, kiểm tra tài khoản/đề thi và thử luồng thi trên cuộc thi kiểm tra riêng. Trong DevTools, API phải đi tới `https://api.example.com/api/...`, không có lỗi CORS hoặc nội dung hỗn hợp. Kiểm tra request OPTIONS được phép từ origin Firebase và request không token vẫn bị từ chối tại API cần đăng nhập.

Khởi động lại backend để xác nhận dữ liệu và phiên còn tồn tại. Sao lưu SQLite bằng SQLite backup API hoặc dừng backend trước khi sao chép toàn bộ thư mục dữ liệu; bảo vệ cả jwt.key. Cấu hình giám sát `/api/health` và tự khởi động dịch vụ trước khi tổ chức thi thật.

Tài liệu chính thức: [Firebase Hosting](https://firebase.google.com/docs/hosting/full-config), [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/).
