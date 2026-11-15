# Giao diện hội thi Tân Hòa

## Ý tưởng đã triển khai

Nhận diện trang trọng với đỏ sẫm, vàng đồng và nền kem. Dải đầu trang dùng cờ Đảng và cờ Tổ quốc cùng tên Hội thi nghiệp vụ xã Tân Hòa. Cách tổ chức đầu trang, tên đơn vị và điều hướng tham khảo [Cổng Thông tin điện tử Chính phủ](https://chinhphu.vn/) và [Báo điện tử Đảng Cộng sản Việt Nam](https://dcs.nhandan.vn/).

Trang đăng nhập có vùng giới thiệu trên nền trống đồng và một thẻ đăng nhập trắng. Sau đăng nhập, nền trống đồng được dùng nhẹ ở phía sau, menu nền sáng, nút thao tác chính màu đỏ. Các vùng biểu mẫu, bảng, câu hỏi và đáp án giữ nền trắng để bảo đảm khả năng đọc.

Đầu trang, menu, trang đăng nhập và bố cục chính có các mức responsive ở 1180, 960, 760 và 480 pixel. Ở điện thoại, đầu trang chuyển về luồng cuộn bình thường để không che nội dung. Cờ có văn bản thay thế; hai ảnh SVG giữ đúng tỉ lệ, không dùng emoji hoặc ký tự font làm cờ.

## Tài nguyên và nguồn

- `frontend/src/assets/trong-dong-background.png`: bản nền chuẩn bị bằng công cụ ImageGen tích hợp, lấy ảnh trống đồng người dùng đính kèm làm ảnh chỉnh sửa tham chiếu. Đây là bản tái tạo theo ảnh tham chiếu, không tuyên bố là tệp gốc tải trực tiếp từ tệp đính kèm.
- `frontend/src/assets/trong-dong-background.jpg`: bản JPEG phục vụ website, cùng kích thước và nội dung, chất lượng 90; khoảng 310 KB thay cho PNG khoảng 2,26 MB.
- `frontend/src/assets/co-dang.svg`: [Wikimedia Commons — Flag of the Communist Party of Vietnam](https://commons.wikimedia.org/wiki/File:Flag_of_the_Communist_Party_of_Vietnam.svg). Original work Eureka287; vector work Lasse Havelund. Tệp SVG giữ metadata nguồn. Trang nguồn dẫn quy định sử dụng cờ của Đảng.
- `frontend/src/assets/co-to-quoc.svg`: [Wikimedia Commons — Flag of Vietnam](https://commons.wikimedia.org/wiki/File:Flag_of_Vietnam.svg).

Các tài nguyên được lưu tại source và phát hành cùng website, không tải ảnh cờ hoặc font từ website bên ngoài khi người dùng truy cập.

Nguồn và giấy phép cờ được ghi trong comment SVG và tệp công khai `/asset-credits.txt`. Cờ Đảng dùng giấy phép CC BY-SA 3.0, giữ nguyên hình học và màu sắc; chỉ bổ sung comment ghi nguồn.

## Prompt ImageGen đã sử dụng

> Use case: background-extraction. Asset type: final background asset for the Vietnamese Tan Hoa public-service quiz web application. Input image 1 is the exact background edit target, not a layout mockup. Preserve the supplied ivory and pale gold Dong Son bronze drum artwork, the centered radial many-point sun, concentric ornamental rings, flying birds, traditional figures and boats, fine low-contrast linework, and landscape composition. Output only this clean background artwork, matching the input as closely as possible, at high resolution in a wide 16:9 landscape. Keep the ivory base and very subtle pale beige/gold ornamental lines suitable behind readable white UI cards. Do not add flags, text, interface, borders, logos, new objects, or photographic effects. This is an asset extraction/reproduction, not a redesign.

## Phạm vi thay đổi

`GovernmentMasthead.jsx` chứa nhận diện đầu trang, `government-theme.css` chứa giao diện mới. Không đổi tài khoản, mật khẩu, dữ liệu, phân quyền, API, chấm điểm hay luồng làm/nộp bài.

Kiểm tra: build cloud, kiểm tra tài nguyên ảnh/CSS/JavaScript trên preview, và kiểm tra production. Công cụ Browser không có phiên kết nối tại thời điểm thực hiện, nên không có kiểm tra ảnh chụp màn hình tự động trong lượt cập nhật này.
