# Cloudflare Pages + Firebase Firestore, gói miễn phí

Website: **https://quiztanhoa.pages.dev**. Firebase project: **quiztanhoa**. Firestore Native Standard database: **(default)**, vị trí **asia-southeast1**.

React và API JavaScript chạy chung trên Cloudflare Pages (Pages Functions, runtime Workers). Frontend gọi `/api` cùng origin. Firestore lưu dữ liệu nghiệp vụ, tài khoản và phiên đăng nhập. Không cần tên miền riêng, VPS, máy tính luôn bật, Firebase Hosting, Cloud Run hay Blaze.

Backend ASP.NET/SQLite cũ vẫn dùng cho chạy local/Electron, không chạy trong Cloudflare. Bản cloud dùng API trong `worker/`. Việc triển khai cloud mới không tự chuyển dữ liệu SQLite cũ lên Firestore.

## Build và kiểm tra

Node.js 24 trở lên. Tại thư mục source:

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix cloud ci
npm.cmd run test:cloud
npm.cmd run build:cloud
```

`frontend/dist-web` là thư mục duy nhất được upload. `_worker.js` chứa code server, không chứa secret; `_routes.json` chỉ chuyển `/api` sang Functions. Các trang React sử dụng SPA fallback của Pages. Không đặt `VITE_API_BASE_URL` khi build bản cloud.

Kiểm tra tích hợp bao gồm quyền Organizer/Candidate, đăng nhập không bắt buộc đổi mật khẩu, đổi mật khẩu tự chọn tại Thông tin tài khoản, thu hồi phiên, snapshot đề bất biến, một lượt hợp lệ/tài khoản/cuộc thi, khóa tab, hạn nộp phía server, chấm điểm, xếp hạng, xét giải bất biến và Excel.

## Secret và khởi tạo lần đầu

Hai server secret bắt buộc: `FIREBASE_SERVICE_ACCOUNT` (nội dung JSON service account) và `PASSWORD_PEPPER` (khóa ngẫu nhiên riêng). Không thêm chúng vào biến VITE, source, log, Git hoặc file công khai.

```powershell
node scripts/init-cloud.mjs PATH_TO_FIREBASE_SERVICE_ACCOUNT_JSON
node scripts/init-cloud.mjs PATH_TO_FIREBASE_SERVICE_ACCOUNT_JSON --preview
```

Các lệnh này không đổi gói Firebase, không ghi đè tài khoản đã có. Secret backup nằm trong `.data/cloud/pages-secrets.json`; thông tin đăng nhập `admin` nằm trong `.data/cloud/admin-login.txt`. Không bắt buộc đổi mật khẩu lần đầu; người dùng đổi mật khẩu khi cần tại `/tai-khoan`. `.data` và service-account JSON đã bị loại khỏi Git. Bảo quản bản sao secret riêng; mất hoặc đổi pepper sẽ khiến mật khẩu hiện có không kiểm tra được.

Sau khi được chủ tài khoản cho phép lưu secret trên Cloudflare:

```powershell
npx.cmd --yes wrangler@4.162.0 login
npx.cmd --yes wrangler@4.162.0 pages secret bulk .data/cloud/pages-secrets.json --project-name quiztanhoa --env preview
npx.cmd --yes wrangler@4.162.0 pages secret bulk .data/cloud/pages-secrets.json --project-name quiztanhoa --env production
```

Có thể tự nhập hai giá trị bằng Dashboard Cloudflare → quiztanhoa → Settings → Variables and Secrets, cho cả Preview và Production. Nếu đổi khóa, cập nhật file backup được bảo vệ và deploy lại.

## Preview và production

`wrangler.toml` tách namespace Firestore: production dùng `qt_*`; preview dùng `qt_verify_*`. Không dùng preview để vận hành vì dữ liệu kiểm tra có thể được làm sạch. Các secret chỉ tồn tại phía server.

```powershell
npm.cmd run deploy:cloud:preview
# Dùng URL preview mà Cloudflare trả về, không dùng URL production cho bài kiểm tra có ghi dữ liệu:
node scripts/test-cloud-live.mjs https://PREVIEW_DEPLOYMENT.quiztanhoa.pages.dev
npm.cmd run deploy:cloud
```

`/api/health` trả `status: ok`, `storage: Firestore`, `environment: production` trên website chính. Bản preview trả `environment: preview`; script kiểm tra từ chối chạy ghi dữ liệu trên production.

## An toàn và hạn mức

- Duy trì Firestore Rules ở chế độ chặn client trực tiếp. Browser chỉ gọi API; server dùng IAM service account. Không mở `allow read, write: if true`.
- Mật khẩu dùng PBKDF2-SHA256 với salt riêng và HMAC pepper trong server secret. Token phiên là số ngẫu nhiên 256 bit, Firestore chỉ lưu hash token. Không có endpoint đăng ký công khai; Organizer tạo tài khoản Candidate.
- Quyền được đọc lại từ Firestore mỗi request. Tài khoản bị khóa hoặc phiên bị thu hồi mất quyền ngay ở các request tiếp theo.
- Native Firestore transactions bảo vệ tạo lượt, lưu/nộp bài, phiên và xét giải. Các lượt của thí sinh khác nhau không cùng ghi một khóa toàn cục. Snapshot đề tách thành nhiều document có giới hạn kích thước; không lưu toàn bộ database trong một document.
- Hạn nộp luôn kiểm tra tại server. Lượt quá hạn được chốt theo deadline khi có request tiếp theo, không phụ thuộc tab còn mở và không cần dịch vụ cron trả phí.
- Lease tab cloud kéo dài 60 giây, heartbeat 20 giây để giảm số lần ghi. Mỗi đề tối đa 500 câu, nhập/phân công tối đa 400 mục mỗi lần; tệp Excel tối đa 5 MB. Thao tác thay đổi trên 450 document sẽ bị từ chối để giữ nguyên tính nguyên tử.
- Cloudflare Workers Free và Firebase Spark có quota. Theo dõi Usage trước kỳ thi; số lượt truy cập không tương đương số lần đọc Firestore vì một API có thể đọc nhiều document. Free không bảo đảm đủ cho mọi quy mô thi.
- Không tự bật Blaze hoặc gói Cloudflare trả phí. Dữ liệu production được khởi tạo rỗng ngoài admin và danh mục đơn vị; dữ liệu kiểm tra chỉ trong namespace preview.

Tham khảo: [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/advanced-mode/), [Workers Free](https://developers.cloudflare.com/workers/platform/limits/), [Firestore quota](https://firebase.google.com/docs/firestore/quotas).
