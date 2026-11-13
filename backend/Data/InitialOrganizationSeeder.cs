using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;

namespace Quiz_TanHoa.Api.Data;

public static class InitialOrganizationSeeder
{
    private const string CompetitionName = "DEMO - Tìm hiểu Nghị quyết 57-NQ/TW";
    private const string ResolutionSource = "Nghị quyết số 57-NQ/TW ngày 22/12/2024 của Bộ Chính trị";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly UnitSeed[] Units =
    [
        new("PHONG_KINH_TE", "Phòng Kinh tế"),
        new("PHONG_VHXH", "Phòng Văn hóa-Xã hội"),
        new("VP_HDND_UBND", "Văn phòng HĐND và UBND"),
        new("TT_DV_HCC", "Trung tâm Dịch Vụ Hành Chính Công"),
        new("TT_CUNG_UNG_DVC", "Trung tâm Cung Ứng Dịch Vụ Công"),
        new("CONG_AN_XA", "Công an xã"),
        new("BAN_CHQS_XA", "Ban CHQS xã"),
        new("BAN_QUAN_LY_AP", "Ban quản lý các ấp"),
        new("TRAM_Y_TE_XA", "Trạm y tế xã")
    ];

    private static readonly QuestionSeed[] Questions =
    [
        new("Nghị quyết số 57-NQ/TW được ban hành bởi cơ quan nào?",
            ["Bộ Chính trị", "Chính phủ", "Quốc hội", "Ủy ban Thường vụ Quốc hội"], "A",
            "Nghị quyết số 57-NQ/TW là nghị quyết của Bộ Chính trị."),
        new("Nghị quyết 57-NQ/TW được ban hành ngày nào?",
            ["22/12/2024", "03/02/2025", "01/01/2024", "19/05/2025"], "A",
            "Nghị quyết được ban hành ngày 22/12/2024."),
        new("Nội dung trọng tâm của Nghị quyết 57-NQ/TW là gì?",
            ["Đột phá phát triển khoa học, công nghệ, đổi mới sáng tạo và chuyển đổi số quốc gia", "Chỉ cải cách chế độ tiền lương", "Chỉ phát triển giao thông đường bộ", "Chỉ sắp xếp đơn vị hành chính"], "A",
            "Tên và nội dung nghị quyết xác định bốn trụ cột trọng tâm nêu trong đáp án A."),
        new("Nghị quyết 57 xác định khoa học, công nghệ, đổi mới sáng tạo và chuyển đổi số là gì đối với phát triển đất nước?",
            ["Đột phá quan trọng hàng đầu, động lực chính", "Nhiệm vụ chỉ của doanh nghiệp", "Hoạt động phụ trợ không cần ưu tiên", "Nội dung chỉ triển khai khi có dự án nước ngoài"], "A",
            "Nghị quyết xác định đây là đột phá quan trọng hàng đầu, động lực chính để phát triển."),
        new("Nghị quyết 57 nhấn mạnh vai trò chủ thể trung tâm của lực lượng nào trong phát triển khoa học, công nghệ và đổi mới sáng tạo?",
            ["Người dân và doanh nghiệp", "Chỉ cơ quan quản lý nhà nước", "Chỉ nhà cung cấp công nghệ", "Chỉ đơn vị nghiên cứu ở trung ương"], "A",
            "Người dân và doanh nghiệp là trung tâm, chủ thể, nguồn lực và động lực chính."),
        new("Mốc thời gian mục tiêu chính của Nghị quyết 57 là năm nào?",
            ["2030, tầm nhìn đến năm 2045", "2025, tầm nhìn đến năm 2030", "2045, tầm nhìn đến năm 2060", "2028, tầm nhìn đến năm 2035"], "A",
            "Nghị quyết đề ra mục tiêu đến năm 2030 và tầm nhìn đến năm 2045."),
        new("Một nguyên tắc xuyên suốt khi triển khai chuyển đổi số quốc gia là gì?",
            ["Lấy người dân, doanh nghiệp làm trung tâm và chủ thể phục vụ", "Ưu tiên số hóa hồ sơ nội bộ nhưng không thay đổi phục vụ", "Chỉ mua sắm thiết bị mới", "Chuyển mọi trách nhiệm sang người dân"], "A",
            "Chuyển đổi số cần hướng tới phục vụ người dân, doanh nghiệp và lấy họ làm trung tâm."),
        new("Chuyển đổi số trong cơ quan nhà nước nên được hiểu như thế nào?",
            ["Thay đổi phương thức hoạt động, quy trình và cung cấp dịch vụ dựa trên dữ liệu, công nghệ số", "Chỉ quét giấy tờ thành ảnh", "Chỉ thay máy tính cũ bằng máy tính mới", "Chỉ mở thêm tài khoản mạng xã hội"], "A",
            "Chuyển đổi số bao gồm thay đổi quy trình, phương thức hoạt động và cách cung cấp dịch vụ."),
        new("Số hóa tài liệu khác chuyển đổi số ở điểm nào?",
            ["Số hóa là chuyển thông tin sang dạng số; chuyển đổi số còn đổi mới quy trình và cách tạo giá trị", "Hai khái niệm hoàn toàn giống nhau", "Số hóa luôn bao gồm cải cách tổ chức", "Chuyển đổi số chỉ là lưu trữ bản scan"], "A",
            "Số hóa là một phần; chuyển đổi số rộng hơn, gắn với đổi mới quy trình và hoạt động."),
        new("Khi triển khai hệ thống số ở cấp xã, bước khởi đầu phù hợp là gì?",
            ["Rà soát nhu cầu, quy trình, dữ liệu và người sử dụng", "Mua phần mềm trước rồi mới xác định vấn đề", "Sao chép nguyên trạng quy trình giấy lên màn hình", "Thu thập càng nhiều dữ liệu cá nhân càng tốt"], "A",
            "Cần bắt đầu từ nhu cầu và quy trình thực tế để xác định giải pháp phù hợp."),
        new("Nghị quyết 57 yêu cầu hoàn thiện thể chế nhằm mục tiêu nào?",
            ["Tháo gỡ điểm nghẽn, tạo hành lang thuận lợi cho khoa học, công nghệ, đổi mới sáng tạo và chuyển đổi số", "Tăng thủ tục để hạn chế thử nghiệm", "Thay thế mọi quy định bằng hướng dẫn miệng", "Chỉ áp dụng cho cơ quan trung ương"], "A",
            "Hoàn thiện thể chế là giải pháp để tháo gỡ điểm nghẽn và thúc đẩy các lĩnh vực trọng tâm."),
        new("Trong thực thi công vụ số, dữ liệu nên được quản lý theo hướng nào?",
            ["Đúng, đủ, sạch, sống, thống nhất, dùng chung và được cập nhật", "Mỗi đơn vị lưu nhiều bản khác nhau", "Không cần kiểm tra nguồn gốc", "Chỉ lưu trên thiết bị cá nhân"], "A",
            "Dữ liệu cần có chất lượng, được cập nhật và khai thác chia sẻ theo quy định."),
        new("Khi người dân đã cung cấp thông tin hợp lệ cho cơ quan nhà nước, cách tiếp cận số phù hợp là gì?",
            ["Tăng kết nối, chia sẻ dữ liệu để hạn chế yêu cầu cung cấp lại", "Yêu cầu nộp lại bản giấy trong mọi trường hợp", "Chụp màn hình dữ liệu thay cho xác thực", "Gửi thông tin qua tài khoản cá nhân của công chức"], "A",
            "Khai thác, chia sẻ dữ liệu hợp pháp giúp giảm giấy tờ và khai báo lặp lại."),
        new("Nguyên tắc phù hợp khi thiết kế dịch vụ công trực tuyến là gì?",
            ["Dễ tiếp cận, dễ sử dụng, an toàn và giải quyết trọn vẹn nhu cầu của người dân", "Chỉ tối ưu cho người am hiểu công nghệ", "Bắt buộc người dân cài nhiều ứng dụng không liên quan", "Ẩn hướng dẫn và trạng thái xử lý"], "A",
            "Dịch vụ cần lấy người dùng làm trung tâm, thuận tiện và an toàn."),
        new("Nếu người dân chưa có kỹ năng số để sử dụng dịch vụ trực tuyến, cán bộ nên làm gì?",
            ["Hướng dẫn, hỗ trợ phù hợp và bảo đảm vẫn tiếp cận được dịch vụ", "Từ chối tiếp nhận yêu cầu", "Yêu cầu người dân tự tìm hiểu", "Nhờ người khác đăng nhập bằng tài khoản của cán bộ"], "A",
            "Chuyển đổi số bao trùm cần có hỗ trợ để người dân tiếp cận dịch vụ."),
        new("Cán bộ nhận được đường dẫn lạ yêu cầu đăng nhập tài khoản công vụ. Cách xử lý nào đúng?",
            ["Không nhập thông tin; xác minh qua kênh chính thức và báo bộ phận phụ trách", "Đăng nhập thử bằng mật khẩu đang dùng", "Chuyển đường dẫn cho người dân", "Tải tệp đính kèm về thiết bị cá nhân"], "A",
            "Cần cảnh giác lừa đảo, xác minh nguồn và bảo vệ thông tin xác thực."),
        new("Nguyên tắc cần tuân thủ khi xử lý dữ liệu cá nhân trên hệ thống số là gì?",
            ["Chỉ truy cập, sử dụng theo nhiệm vụ và quy định; bảo vệ khỏi truy cập trái phép", "Chia sẻ rộng rãi để tiện phối hợp", "Tải về thiết bị cá nhân để xử lý", "Dùng dữ liệu vào mục đích khác nếu thuận tiện"], "A",
            "Dữ liệu cá nhân phải được xử lý đúng thẩm quyền, mục đích và yêu cầu bảo vệ."),
        new("Khi phát hiện gửi nhầm thông tin cá nhân qua email, việc nên làm đầu tiên là gì?",
            ["Báo ngay người phụ trách, thực hiện biện pháp hạn chế lộ lọt và ghi nhận sự việc", "Xóa email rồi không báo ai", "Chuyển tiếp cho nhiều người để xác nhận", "Đăng sự việc lên mạng xã hội"], "A",
            "Báo cáo nhanh giúp hạn chế ảnh hưởng và xử lý sự cố theo quy trình."),
        new("Mật khẩu tài khoản công vụ nên được sử dụng như thế nào?",
            ["Mạnh, riêng biệt; không chia sẻ và bật xác thực bổ sung khi được hỗ trợ", "Dùng chung trong cả đơn vị", "Ghi trên giấy dán cạnh máy tính", "Dùng ngày sinh hoặc tên đơn vị"], "A",
            "Tài khoản phải được bảo vệ bằng thông tin xác thực riêng và đủ mạnh."),
        new("Khi dùng thiết bị công cộng để xử lý công việc, cán bộ cần làm gì?",
            ["Tránh đăng nhập dữ liệu nhạy cảm; nếu bắt buộc thì đăng xuất và không lưu thông tin", "Lưu mật khẩu trên trình duyệt", "Tải dữ liệu công dân về máy", "Để nguyên phiên đăng nhập cho người sau"], "A",
            "Thiết bị công cộng có nguy cơ lộ dữ liệu và phiên đăng nhập."),
        new("Mục tiêu của liên thông dữ liệu giữa cơ quan nhà nước là gì?",
            ["Hỗ trợ phối hợp, giảm nhập liệu trùng lặp và nâng chất lượng phục vụ", "Tăng số lần người dân khai lại thông tin", "Cho phép truy cập không phân quyền", "Thay thế trách nhiệm kiểm tra dữ liệu"], "A",
            "Liên thông có kiểm soát giúp phối hợp hiệu quả và giảm trùng lặp."),
        new("Khi dữ liệu giữa hai hệ thống không khớp, cán bộ nên làm gì?",
            ["Kiểm tra nguồn, thời điểm cập nhật và quy trình đối soát trước khi chỉnh sửa", "Tự chọn bản ghi thuận tiện nhất", "Xóa cả hai bản ghi", "Sao chép dữ liệu lên nhóm chat"], "A",
            "Cần đối soát có căn cứ, bảo đảm truy vết và đúng thẩm quyền."),
        new("Mua sắm giải pháp công nghệ cho cơ quan nên dựa trên yếu tố nào?",
            ["Nhu cầu, khả năng tích hợp, an toàn, tổng chi phí và hiệu quả sử dụng", "Giá thấp nhất bất kể chất lượng", "Quảng cáo của nhà cung cấp", "Số lượng tính năng càng nhiều càng tốt"], "A",
            "Lựa chọn công nghệ cần dựa trên hiệu quả, khả năng tích hợp và yêu cầu an toàn."),
        new("Một phần mềm mới không kết nối được với hệ thống hiện có. Cách xử lý phù hợp là gì?",
            ["Đánh giá chuẩn dữ liệu và khả năng tích hợp trước khi mở rộng triển khai", "Nhập lại mọi dữ liệu thủ công vô thời hạn", "Cho nhà cung cấp dùng chung tài khoản", "Bỏ qua yêu cầu an toàn"], "A",
            "Khả năng kết nối, tích hợp cần được xem xét ngay từ khâu thiết kế và lựa chọn."),
        new("Mục đích của tiêu chuẩn, quy chuẩn dữ liệu và kỹ thuật chung là gì?",
            ["Tạo khả năng kết nối, chia sẻ và vận hành đồng bộ", "Buộc mỗi đơn vị dùng định dạng riêng", "Ngăn cản trao đổi dữ liệu hợp pháp", "Thay thế mọi yêu cầu bảo mật"], "A",
            "Chuẩn chung hỗ trợ các hệ thống trao đổi và khai thác dữ liệu tương thích."),
        new("Ứng dụng trí tuệ nhân tạo trong cơ quan công quyền cần lưu ý điều gì?",
            ["Có kiểm soát của con người, bảo vệ dữ liệu và kiểm chứng kết quả", "Mặc nhiên coi mọi câu trả lời là đúng", "Đưa dữ liệu mật lên công cụ công cộng", "Để hệ thống tự quyết mọi quyền lợi của người dân"], "A",
            "AI cần được sử dụng có trách nhiệm, kiểm tra đầu ra và bảo vệ dữ liệu."),
        new("Khi dùng công cụ AI để soạn dự thảo văn bản, cán bộ cần làm gì?",
            ["Kiểm tra căn cứ, tính chính xác, thẩm quyền và thông tin nhạy cảm trước khi sử dụng", "Ký ban hành ngay nội dung do AI tạo", "Đưa toàn bộ hồ sơ mật lên công cụ", "Không cần lưu người chịu trách nhiệm"], "A",
            "Cán bộ vẫn chịu trách nhiệm kiểm chứng nội dung và bảo vệ thông tin."),
        new("Kết quả phân tích dữ liệu hỗ trợ lãnh đạo ra quyết định như thế nào?",
            ["Cung cấp bằng chứng tham khảo, đi kèm kiểm tra chất lượng và bối cảnh", "Thay thế hoàn toàn trách nhiệm của người quyết định", "Luôn chính xác dù dữ liệu đầu vào sai", "Chỉ dùng để trang trí báo cáo"], "A",
            "Dữ liệu hỗ trợ ra quyết định nhưng không loại bỏ trách nhiệm và đánh giá bối cảnh."),
        new("Đổi mới sáng tạo trong khu vực công có thể bắt đầu từ đâu?",
            ["Cải tiến quy trình để giải quyết tốt hơn vấn đề thực tế", "Chỉ từ dự án quy mô lớn", "Chỉ từ việc mua thiết bị", "Không thể thực hiện ở cấp cơ sở"], "A",
            "Đổi mới có thể bắt đầu từ cải tiến thiết thực trong quy trình và dịch vụ."),
        new("Một sáng kiến thử nghiệm chưa đạt kết quả như mong muốn. Cách ứng xử phù hợp là gì?",
            ["Đánh giá có căn cứ, rút kinh nghiệm và điều chỉnh trong khuôn khổ được phép", "Che giấu kết quả", "Tiếp tục mở rộng mà không đánh giá", "Đổ lỗi cho người sử dụng"], "A",
            "Thử nghiệm có trách nhiệm cần đánh giá, học hỏi và điều chỉnh minh bạch."),
        new("Nghị quyết 57 đề cao yếu tố nào để tạo đột phá bền vững?",
            ["Nhân lực chất lượng cao và năng lực số", "Chỉ tăng số lượng thiết bị", "Giảm đào tạo cán bộ", "Phụ thuộc hoàn toàn vào chuyên gia bên ngoài"], "A",
            "Phát triển nhân lực là yếu tố nền tảng của khoa học, công nghệ và chuyển đổi số."),
        new("Cán bộ cấp xã nên nâng cao năng lực số bằng cách nào?",
            ["Học thường xuyên, thực hành trên quy trình công việc và cập nhật kỹ năng an toàn", "Chỉ tham gia một buổi học rồi dừng", "Giao toàn bộ thao tác cho một người", "Không cần hiểu hệ thống đang sử dụng"], "A",
            "Năng lực số cần được cập nhật và thực hành gắn với nhiệm vụ thực tế."),
        new("Cách triển khai đào tạo kỹ năng số hiệu quả là gì?",
            ["Theo vị trí việc làm, nhu cầu thực tế và có hỗ trợ sau đào tạo", "Dùng một nội dung giống hệt cho mọi đối tượng", "Chỉ phát tài liệu rồi không hướng dẫn", "Chỉ kiểm tra lý thuyết, không thực hành"], "A",
            "Đào tạo nên phù hợp nhiệm vụ và gắn với thực hành, hỗ trợ liên tục."),
        new("Khi triển khai nền tảng số dùng chung, cơ quan cần ưu tiên điều gì?",
            ["Khả năng dùng chung, kết nối, an toàn và tránh đầu tư trùng lặp", "Mỗi phòng tự mua nền tảng không kết nối", "Dùng tài khoản cá nhân làm tài khoản hệ thống", "Không cần phương án vận hành"], "A",
            "Nền tảng dùng chung cần hỗ trợ kết nối, bảo đảm an toàn và sử dụng hiệu quả."),
        new("Bảo đảm an toàn thông tin cần được thực hiện khi nào?",
            ["Xuyên suốt từ thiết kế, triển khai đến vận hành và xử lý sự cố", "Chỉ sau khi xảy ra sự cố", "Chỉ khi nghiệm thu phần cứng", "Chỉ thuộc trách nhiệm của người dùng cuối"], "A",
            "An toàn thông tin phải được tích hợp xuyên suốt vòng đời hệ thống."),
        new("Khi phát hiện máy tính công vụ có dấu hiệu nhiễm mã độc, cán bộ nên làm gì?",
            ["Ngắt kết nối theo hướng dẫn, báo đầu mối kỹ thuật và không tự phát tán tệp", "Tiếp tục đăng nhập các hệ thống", "Sao chép tệp sang máy khác", "Tắt cảnh báo để làm việc tiếp"], "A",
            "Cần cô lập nguy cơ và báo đơn vị phụ trách để xử lý theo quy trình."),
        new("Sao lưu dữ liệu công vụ nhằm mục đích gì?",
            ["Khôi phục hoạt động và dữ liệu khi xảy ra sự cố", "Tạo thêm bản dữ liệu không kiểm soát", "Thay thế phân quyền truy cập", "Cho phép chia sẻ dữ liệu rộng rãi"], "A",
            "Sao lưu là biện pháp hỗ trợ khôi phục dữ liệu và hoạt động."),
        new("Nhật ký truy cập hệ thống có ích gì?",
            ["Hỗ trợ giám sát, truy vết và xác định trách nhiệm khi cần", "Thay thế mật khẩu mạnh", "Cho phép bỏ qua phân quyền", "Tự động chứng minh mọi thao tác đều đúng"], "A",
            "Nhật ký giúp truy vết và giám sát nhưng không thay thế các biện pháp kiểm soát khác."),
        new("Khi sử dụng dữ liệu mở của cơ quan, cần làm gì?",
            ["Kiểm tra giấy phép, nguồn, thời điểm cập nhật và điều kiện sử dụng", "Giả định mọi dữ liệu đều được dùng không điều kiện", "Xóa thông tin nguồn", "Kết hợp dữ liệu cá nhân tùy ý"], "A",
            "Dữ liệu cần được sử dụng theo nguồn, điều kiện và quy định áp dụng."),
        new("Công bố dữ liệu của cơ quan nhà nước cần bảo đảm điều gì?",
            ["Đúng thẩm quyền, đúng định dạng và không làm lộ thông tin được bảo vệ", "Công bố cả dữ liệu cá nhân để minh bạch", "Bỏ qua kiểm tra chất lượng", "Đăng lên tài khoản cá nhân"], "A",
            "Công khai phải tuân thủ thẩm quyền, chất lượng và yêu cầu bảo vệ dữ liệu."),
        new("Một quy trình nội bộ có nhiều bước nhập cùng thông tin. Cải tiến số phù hợp là gì?",
            ["Rà soát quy trình và tái sử dụng dữ liệu hợp pháp, có kiểm soát", "Tạo thêm biểu mẫu nhập lại", "Mua thêm máy in", "Yêu cầu người dân tự chuyển hồ sơ giữa các bộ phận"], "A",
            "Cải tiến quy trình và tái sử dụng dữ liệu giúp giảm thao tác lặp."),
        new("Đánh giá hiệu quả dịch vụ công trực tuyến nên dựa vào đâu?",
            ["Mức độ hoàn thành nhu cầu, thời gian, chất lượng và phản hồi của người sử dụng", "Số lượng màn hình của phần mềm", "Số văn bản quảng bá", "Số tài khoản được tạo nhưng không hoạt động"], "A",
            "Đánh giá cần phản ánh chất lượng phục vụ và kết quả thực tế."),
        new("Người dân phản ánh không biết hồ sơ trực tuyến đang ở bước nào. Cơ quan nên cải thiện gì?",
            ["Cung cấp trạng thái xử lý rõ ràng và kênh hỗ trợ phù hợp", "Ẩn trạng thái để tránh câu hỏi", "Yêu cầu người dân gọi nhiều số điện thoại", "Đóng hồ sơ tự động"], "A",
            "Thông tin trạng thái và hỗ trợ giúp dịch vụ minh bạch, dễ tiếp cận."),
        new("Phối hợp giữa các phòng ban trong chuyển đổi số cần dựa trên điều gì?",
            ["Mục tiêu, trách nhiệm, quy trình và chia sẻ dữ liệu theo thẩm quyền", "Chia sẻ mật khẩu cho nhanh", "Tự ý truy cập dữ liệu của nhau", "Không cần xác định đơn vị chịu trách nhiệm"], "A",
            "Phối hợp cần có phân công trách nhiệm và chia sẻ dữ liệu đúng quy định."),
        new("Vai trò của người đứng đầu trong triển khai Nghị quyết 57 là gì?",
            ["Chỉ đạo, chịu trách nhiệm, tháo gỡ vướng mắc và thúc đẩy thực hiện", "Giao toàn bộ cho bộ phận công nghệ", "Chỉ ký kế hoạch mà không theo dõi", "Không cần bố trí nguồn lực"], "A",
            "Sự lãnh đạo, chỉ đạo và trách nhiệm của người đứng đầu là yếu tố quan trọng."),
        new("Kế hoạch chuyển đổi số cấp cơ sở nên được xây dựng như thế nào?",
            ["Bám mục tiêu cấp trên, vấn đề địa phương, nguồn lực và chỉ số đánh giá", "Sao chép nguyên văn kế hoạch nơi khác", "Chỉ liệt kê thiết bị cần mua", "Không cần mốc thời gian"], "A",
            "Kế hoạch cần phù hợp mục tiêu, điều kiện địa phương và có thể theo dõi."),
        new("Nguồn lực ngân sách cho nhiệm vụ khoa học, công nghệ và chuyển đổi số cần được sử dụng ra sao?",
            ["Có trọng tâm, đúng quy định, gắn với mục tiêu và hiệu quả", "Chia đều bất kể nhu cầu", "Chi trước, đánh giá sau nhiều năm", "Dùng cho mục đích cá nhân"], "A",
            "Nguồn lực cần được bố trí và sử dụng đúng quy định, có trọng tâm và hiệu quả."),
        new("Hợp tác với doanh nghiệp công nghệ khi cung cấp dịch vụ công cần bảo đảm gì?",
            ["Phân định trách nhiệm, bảo vệ dữ liệu và giám sát chất lượng dịch vụ", "Chuyển toàn bộ quyền quản lý dữ liệu cho nhà cung cấp", "Dùng một mật khẩu chung", "Không cần hợp đồng hoặc tiêu chí"], "A",
            "Hợp tác cần có trách nhiệm rõ ràng, bảo vệ dữ liệu và kiểm soát chất lượng."),
        new("Chuyển đổi số ở cấp xã có thể triển khai theo cách nào?",
            ["Bắt đầu từ nhu cầu thiết thực, thí điểm có đánh giá rồi mở rộng phù hợp", "Chờ đủ mọi công nghệ mới bắt đầu", "Triển khai đồng loạt không cần thử nghiệm", "Chỉ thay đổi tên quy trình"], "A",
            "Cách làm phù hợp là xuất phát từ nhu cầu, thử nghiệm, đánh giá và mở rộng."),
        new("Khi người dân phản ánh dịch vụ số khó sử dụng, cơ quan nên làm gì?",
            ["Thu thập phản hồi, tìm nguyên nhân và điều chỉnh thiết kế/quy trình", "Bỏ qua vì hệ thống đã nghiệm thu", "Yêu cầu người dân tự thích nghi", "Đóng kênh tiếp nhận phản ánh"], "A",
            "Phản hồi người dùng là căn cứ quan trọng để cải tiến dịch vụ."),
    ];

    public static async Task SeedAsync(AppDbContext db, string temporaryPassword)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        foreach (var (unit, index) in Units.Select((value, index) => (value, index + 1)))
        {
            if (!await db.OrganizationUnits.AnyAsync(item => item.Code == unit.Code))
                db.OrganizationUnits.Add(new OrganizationUnit { Code = unit.Code, Name = unit.Name, SortOrder = index });
        }
        await db.SaveChangesAsync();

        var organizer = await AddUserAsync(db, "ngochung.pvhxh", "Ngọc Hùng", Units[1].Name, AppRoles.Organizer, temporaryPassword);
        foreach (var unit in Units)
        {
            for (var index = 1; index <= 5; index++)
            {
                var username = $"{unit.Code.ToLowerInvariant()}{index:00}";
                await AddUserAsync(db, username, $"Thí sinh {index:00} - {unit.Name}", unit.Name, AppRoles.Candidate, temporaryPassword);
            }
        }

        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Name == CompetitionName);
        if (competition is null)
        {
            var now = DateTime.UtcNow;
            competition = new Competition
            {
                Name = CompetitionName,
                Description = "Cuộc thi nháp minh họa gồm 50 câu hỏi trắc nghiệm tìm hiểu Nghị quyết 57-NQ/TW dành cho cán bộ, công chức cấp xã.",
                Rules = "Dữ liệu minh họa. Ban Tổ chức cần đối chiếu văn bản gốc, thẩm định câu hỏi và thiết lập lịch trước khi duyệt đề hoặc công bố cuộc thi.",
                Status = CompetitionStatuses.Draft,
                IsDemo = true,
                CreatedByUserId = organizer.Id,
                CreatedAtUtc = now,
                UpdatedAtUtc = now
            };
            db.Competitions.Add(competition);
            await db.SaveChangesAsync();
        }

        var fieldGroup = await db.ExamFieldGroups.SingleOrDefaultAsync(item =>
            item.CompetitionId == competition.Id && item.Name == "Nghị quyết 57");
        if (fieldGroup is null)
        {
            fieldGroup = new ExamFieldGroup
            {
                CompetitionId = competition.Id,
                Name = "Nghị quyết 57",
                RankingGroupName = "Nghị quyết 57",
                IsSample = false
            };
            db.ExamFieldGroups.Add(fieldGroup);
            await db.SaveChangesAsync();
        }

        var exam = await db.Exams.SingleOrDefaultAsync(item =>
            item.CompetitionId == competition.Id && item.Name == "Tìm hiểu Nghị quyết 57 - 50 câu");
        if (exam is null)
        {
            var now = DateTime.UtcNow;
            exam = new Exam
            {
                CompetitionId = competition.Id,
                FieldGroupId = fieldGroup.Id,
                Name = "Tìm hiểu Nghị quyết 57 - 50 câu",
                DurationMinutes = 60,
                TargetQuestionCount = Questions.Length,
                CommonQuestionCount = Questions.Length,
                SpecializedQuestionCount = 0,
                IsDemo = true,
                CreatedAtUtc = now,
                UpdatedAtUtc = now
            };
            db.Exams.Add(exam);
            await db.SaveChangesAsync();
            var bankQuestions = Questions.Select((item, index) =>
            {
                var (options, correctAnswer) = SeedOptions(item, index);
                return new QuestionBankQuestion
                {
                    Type = "SingleChoice",
                    Content = item.Content,
                    OptionsJson = JsonSerializer.Serialize(options, JsonOptions),
                    CorrectAnswer = correctAnswer,
                    Points = 1,
                    Explanation = item.Explanation,
                    Source = ResolutionSource,
                    Group = "Common",
                    RequiresSourceReview = true,
                    SourceReviewed = false,
                    CreatedByUserId = organizer.Id,
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now
                };
            }).ToArray();
            db.QuestionBankQuestions.AddRange(bankQuestions);
            await db.SaveChangesAsync();
            db.ExamQuestions.AddRange(bankQuestions.Select((item, index) => new ExamQuestion
            {
                ExamId = exam.Id,
                BankQuestionId = item.Id,
                Position = index + 1,
                Type = item.Type,
                Content = item.Content,
                OptionsJson = item.OptionsJson,
                CorrectAnswer = item.CorrectAnswer,
                Points = item.Points,
                Explanation = item.Explanation,
                Source = item.Source,
                Group = item.Group,
                RequiresSourceReview = item.RequiresSourceReview,
                SourceReviewed = item.SourceReviewed
            }));
            await db.SaveChangesAsync();
        }
        await transaction.CommitAsync();
    }

    private static async Task<User> AddUserAsync(
        AppDbContext db, string username, string fullName, string department, string role, string temporaryPassword)
    {
        var existing = await db.Users.SingleOrDefaultAsync(item => item.Username == username);
        if (existing is not null) return existing;
        var user = new User
        {
            Username = username,
            FullName = fullName,
            Department = department,
            Password = BCrypt.Net.BCrypt.HashPassword(temporaryPassword),
            Role = role,
            IsActive = true,
            IsDemo = false,
            MustChangePassword = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private sealed record UnitSeed(string Code, string Name);
    private sealed record QuestionSeed(string Content, string[] Options, string CorrectAnswer, string Explanation);

    private static (List<QuestionOption> Options, string CorrectAnswer) SeedOptions(QuestionSeed item, int index)
    {
        var correctIndex = index % 4;
        var declaredCorrectIndex = item.CorrectAnswer[0] - 'A';
        var orderedOptions = item.Options.Where((_, optionIndex) => optionIndex != declaredCorrectIndex).ToList();
        orderedOptions.Insert(correctIndex, item.Options[declaredCorrectIndex]);
        var options = orderedOptions.Select((text, optionIndex) =>
            new QuestionOption { Key = ((char)('A' + optionIndex)).ToString(), Text = text }).ToList();
        return (options, ((char)('A' + correctIndex)).ToString());
    }
}
