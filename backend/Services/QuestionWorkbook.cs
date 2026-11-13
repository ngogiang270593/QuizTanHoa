using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Quiz_TanHoa.Api.Services;

public sealed record WorkbookRow(int RowNumber, Dictionary<int, string> Cells, List<string> Errors);
public sealed record WorkbookTable(Dictionary<string, int> Columns, List<WorkbookRow> Rows);

/// <summary>Bounded SpreadsheetML reader/writer for the downloadable question template.</summary>
public static class QuestionWorkbook
{
    public const int MaxRows = 500;
    public const int MaxFileBytes = 5 * 1024 * 1024;
    public static readonly string[] Headers = ["Loại câu", "Nhóm câu", "Nội dung", "Phương án A", "Phương án B", "Phương án C", "Phương án D", "Đáp án đúng", "Điểm", "Giải thích", "Nguồn đối chiếu", "Cần đối chiếu nguồn"];
    public static readonly string[] OptionalHeaders = ["Câu tình huống"];
    private static readonly XNamespace Main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace PackageRel = "http://schemas.openxmlformats.org/package/2006/relationships";

    public static string Normalize(string value)
    {
        var decomposed = value.Normalize(NormalizationForm.FormD).Replace('đ', 'd').Replace('Đ', 'D');
        return new string(decomposed.Where(character => CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark
            && char.IsLetterOrDigit(character)).Select(char.ToLowerInvariant).ToArray());
    }

    public static WorkbookTable Read(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
        if (archive.Entries.Count > 128 || archive.Entries.Sum(entry => entry.Length) > 32L * 1024 * 1024
            || archive.Entries.Any(entry => entry.Length > 16L * 1024 * 1024))
            throw new InvalidDataException("Tệp Excel quá lớn sau giải nén. Giới hạn 500 câu và 5 MB mỗi tệp.");
        if (archive.Entries.GroupBy(entry => entry.FullName, StringComparer.OrdinalIgnoreCase).Any(group => group.Count() > 1))
            throw new InvalidDataException("Tệp Excel có thành phần trùng lặp, vui lòng lưu lại bằng mẫu mới.");
        if (archive.Entries.Any(entry => entry.FullName.EndsWith("vbaProject.bin", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidDataException("Vui lòng dùng tệp .xlsx không chứa macro.");

        var workbook = ReadXml(archive, "xl/workbook.xml");
        var sheets = workbook.Descendants().Where(element => element.Name.LocalName == "sheet").ToList();
        var sheet = sheets.FirstOrDefault(element => Normalize((string?)element.Attribute("name") ?? "") == "cauhoi") ?? sheets.FirstOrDefault();
        if (sheet is null) throw new InvalidDataException("Tệp Excel chưa có trang tính câu hỏi.");
        var relationshipId = sheet.Attributes().FirstOrDefault(attribute => attribute.Name.LocalName == "id")?.Value;
        var relationships = ReadXml(archive, "xl/_rels/workbook.xml.rels");
        var relationship = relationships.Descendants().FirstOrDefault(element => element.Name.LocalName == "Relationship"
            && (string?)element.Attribute("Id") == relationshipId);
        if (relationship is null || (string?)relationship.Attribute("TargetMode") == "External")
            throw new InvalidDataException("Trang câu hỏi không phải trang tính nội bộ hợp lệ.");
        var target = (string?)relationship.Attribute("Target") ?? "";
        if (target.Contains('\\') || target.Contains(':')) throw new InvalidDataException("Đường dẫn trang tính không hợp lệ.");
        var sheetPath = target.StartsWith('/') ? target.TrimStart('/') : new Uri(new Uri("https://workbook.invalid/xl/"), target).AbsolutePath.TrimStart('/');
        var document = ReadXml(archive, sheetPath);
        var shared = archive.GetEntry("xl/sharedStrings.xml") is null ? [] : ReadXml(archive, "xl/sharedStrings.xml")
            .Descendants().Where(element => element.Name.LocalName == "si")
            .Select(element => string.Concat(element.Descendants().Where(part => part.Name.LocalName == "t").Select(part => part.Value))).ToList();

        var rows = new List<WorkbookRow>();
        var rowElements = document.Descendants().Where(element => element.Name.LocalName == "sheetData")
            .SelectMany(element => element.Elements().Where(child => child.Name.LocalName == "row"));
        var lastRowNumber = 0;
        foreach (var row in rowElements)
        {
            var rowNumber = int.TryParse((string?)row.Attribute("r"), out var explicitRow) ? explicitRow : lastRowNumber + 1;
            if (rowNumber <= lastRowNumber || rowNumber > 1_048_576) throw new InvalidDataException("Số dòng trong trang tính không hợp lệ hoặc trùng lặp.");
            lastRowNumber = rowNumber;
            var cells = new Dictionary<int, string>();
            var errors = new List<string>();
            var nextColumn = 0;
            foreach (var cell in row.Elements().Where(element => element.Name.LocalName == "c"))
            {
                var reference = (string?)cell.Attribute("r");
                var column = string.IsNullOrEmpty(reference) ? nextColumn : ColumnIndex(reference);
                nextColumn = column + 1;
                if (column < 0 || column >= 16384 || !cells.TryAdd(column, "")) throw new InvalidDataException($"Dòng {rowNumber}: địa chỉ ô không hợp lệ hoặc trùng lặp.");
                if (cell.Elements().Any(element => element.Name.LocalName == "f"))
                {
                    errors.Add($"Ô {reference ?? (column + 1).ToString()}: không dùng công thức; hãy dán giá trị trước khi nhập.");
                    continue;
                }
                var type = (string?)cell.Attribute("t");
                var value = cell.Elements().FirstOrDefault(element => element.Name.LocalName == "v")?.Value ?? "";
                if (type == "s")
                {
                    if (!int.TryParse(value, out var index) || index < 0 || index >= shared.Count)
                        errors.Add($"Ô {reference}: chuỗi dùng chung không hợp lệ.");
                    else value = shared[index];
                }
                else if (type == "inlineStr") value = string.Concat(cell.Descendants().Where(element => element.Name.LocalName == "t").Select(element => element.Value));
                else if (type == "e") errors.Add($"Ô {reference}: ô Excel đang có lỗi {value}.");
                cells[column] = value.Trim();
            }
            if (cells.Values.Any(value => !string.IsNullOrWhiteSpace(value)) || errors.Count > 0) rows.Add(new WorkbookRow(rowNumber, cells, errors));
            if (rows.Count > MaxRows + 1) throw new InvalidDataException($"Mỗi tệp chỉ được nhập tối đa {MaxRows} câu hỏi.");
        }
        var header = rows.FirstOrDefault();
        if (header is null || header.RowNumber != 1) throw new InvalidDataException("Dòng 1 phải chứa tiêu đề theo mẫu Excel được tải từ hệ thống.");
        if (header.Errors.Count > 0) throw new InvalidDataException("Dòng tiêu đề: " + string.Join(" ", header.Errors));
        var columns = new Dictionary<string, int>();
        foreach (var pair in header.Cells)
        {
            var name = Normalize(pair.Value);
            if (Headers.Concat(OptionalHeaders).Any(expected => Normalize(expected) == name) && !columns.TryAdd(name, pair.Key))
                throw new InvalidDataException($"Dòng 1: cột {pair.Value} bị trùng.");
        }
        var missing = Headers.Where(name => !columns.ContainsKey(Normalize(name))).ToArray();
        if (missing.Length > 0) throw new InvalidDataException("Dòng 1 thiếu cột: " + string.Join(", ", missing) + ". Vui lòng dùng mẫu của hệ thống.");
        return new WorkbookTable(columns, rows.Skip(1).ToList());
    }

    private static XDocument ReadXml(ZipArchive archive, string name)
    {
        var entry = archive.GetEntry(name) ?? throw new InvalidDataException("Tệp .xlsx thiếu thành phần bắt buộc: " + name);
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 16L * 1024 * 1024 });
        return XDocument.Load(reader);
    }

    private static int ColumnIndex(string reference)
    {
        var index = 0;
        foreach (var character in reference)
        {
            if (!char.IsAsciiLetter(character)) break;
            index = index * 26 + char.ToUpperInvariant(character) - 'A' + 1;
            if (index > 16384) return -1;
        }
        return index - 1;
    }

    public static byte[] CreateTemplate()
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            XNamespace types = "http://schemas.openxmlformats.org/package/2006/content-types";
            var contentTypes = new XElement(types + "Types",
                new XElement(types + "Default", new XAttribute("Extension", "rels"), new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
                new XElement(types + "Default", new XAttribute("Extension", "xml"), new XAttribute("ContentType", "application/xml")),
                new XElement(types + "Override", new XAttribute("PartName", "/xl/workbook.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")),
                new XElement(types + "Override", new XAttribute("PartName", "/xl/styles.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml")));
            for (var index = 1; index <= 3; index++) contentTypes.Add(new XElement(types + "Override", new XAttribute("PartName", $"/xl/worksheets/sheet{index}.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")));
            WriteXml(archive, "[Content_Types].xml", contentTypes);
            WriteXml(archive, "_rels/.rels", new XElement(PackageRel + "Relationships", new XElement(PackageRel + "Relationship", new XAttribute("Id", "rId1"), new XAttribute("Type", Rel.NamespaceName + "/officeDocument"), new XAttribute("Target", "xl/workbook.xml"))));
            var names = new[] { "CauHoi", "ViDuMinhHoa", "HuongDan" };
            WriteXml(archive, "xl/workbook.xml", new XElement(Main + "workbook", new XAttribute(XNamespace.Xmlns + "r", Rel), new XElement(Main + "sheets", names.Select((name, index) => new XElement(Main + "sheet", new XAttribute("name", name), new XAttribute("sheetId", index + 1), new XAttribute(Rel + "id", $"rId{index + 1}"))))));
            WriteXml(archive, "xl/_rels/workbook.xml.rels", new XElement(PackageRel + "Relationships", Enumerable.Range(1, 3).Select(index => new XElement(PackageRel + "Relationship", new XAttribute("Id", $"rId{index}"), new XAttribute("Type", Rel.NamespaceName + "/worksheet"), new XAttribute("Target", $"worksheets/sheet{index}.xml"))), new XElement(PackageRel + "Relationship", new XAttribute("Id", "rId4"), new XAttribute("Type", Rel.NamespaceName + "/styles"), new XAttribute("Target", "styles.xml"))));
            WriteXml(archive, "xl/styles.xml", new XElement(Main + "styleSheet",
                new XElement(Main + "fonts", new XAttribute("count", 2), new XElement(Main + "font", new XElement(Main + "sz", new XAttribute("val", 11)), new XElement(Main + "name", new XAttribute("val", "Calibri"))), new XElement(Main + "font", new XElement(Main + "b"), new XElement(Main + "color", new XAttribute("rgb", "FFFFFFFF")), new XElement(Main + "sz", new XAttribute("val", 11)), new XElement(Main + "name", new XAttribute("val", "Calibri")))),
                new XElement(Main + "fills", new XAttribute("count", 3), new XElement(Main + "fill", new XElement(Main + "patternFill", new XAttribute("patternType", "none"))), new XElement(Main + "fill", new XElement(Main + "patternFill", new XAttribute("patternType", "gray125"))), new XElement(Main + "fill", new XElement(Main + "patternFill", new XAttribute("patternType", "solid"), new XElement(Main + "fgColor", new XAttribute("rgb", "FF162F47")), new XElement(Main + "bgColor", new XAttribute("indexed", 64))))),
                new XElement(Main + "borders", new XAttribute("count", 1), new XElement(Main + "border", new XElement(Main + "left"), new XElement(Main + "right"), new XElement(Main + "top"), new XElement(Main + "bottom"), new XElement(Main + "diagonal"))),
                new XElement(Main + "cellStyleXfs", new XAttribute("count", 1), new XElement(Main + "xf", new XAttribute("numFmtId", 0), new XAttribute("fontId", 0), new XAttribute("fillId", 0), new XAttribute("borderId", 0))),
                new XElement(Main + "cellXfs", new XAttribute("count", 2), new XElement(Main + "xf", new XAttribute("numFmtId", 0), new XAttribute("fontId", 0), new XAttribute("fillId", 0), new XAttribute("borderId", 0), new XAttribute("xfId", 0), new XElement(Main + "alignment", new XAttribute("wrapText", 1), new XAttribute("vertical", "top"))), new XElement(Main + "xf", new XAttribute("numFmtId", 0), new XAttribute("fontId", 1), new XAttribute("fillId", 2), new XAttribute("borderId", 0), new XAttribute("xfId", 0), new XAttribute("applyFill", 1), new XElement(Main + "alignment", new XAttribute("wrapText", 1))))));
            WriteXml(archive, "xl/worksheets/sheet1.xml", Sheet([Headers.Append(OptionalHeaders[0]).ToArray()]));
            WriteXml(archive, "xl/worksheets/sheet2.xml", Sheet([Headers.Append(OptionalHeaders[0]).ToArray(),
                ["Một đáp án đúng", "Kiến thức chung", "MINH HỌA KỸ THUẬT: 1 + 1 bằng bao nhiêu?", "1", "2", "3", "4", "B", "1", "Ví dụ nhập liệu, không dùng làm câu thi chính thức.", "", "Không", "Không"],
                ["Đúng/Sai", "Chuyên môn", "MINH HỌA KỸ THUẬT: số 2 lớn hơn số 1.", "Đúng", "Sai", "", "", "Đúng", "1", "Ví dụ nhập liệu, không phải nội dung nghiệp vụ đã duyệt.", "", "Không", "Có"]]));
            WriteXml(archive, "xl/worksheets/sheet3.xml", Sheet([
                ["HƯỚNG DẪN NHẬP CÂU HỎI"],
                ["Điền câu hỏi vào trang CauHoi, giữ nguyên dòng tiêu đề. Hệ thống không tự nhập trang ViDuMinhHoa."],
                ["Loại câu: Một đáp án đúng hoặc Đúng/Sai. Nhóm câu: Kiến thức chung hoặc Chuyên môn."],
                ["Một đáp án đúng: điền ít nhất hai phương án A–D và một đáp án A, B, C hoặc D."],
                ["Đúng/Sai: đáp án Đúng hoặc Sai; có thể để trống các ô phương án để dùng cặp Đúng/Sai."],
                ["Điểm phải lớn hơn 0; dùng dấu chấm hoặc dấu phẩy cho phần thập phân."],
                ["Câu tình huống: Có/Không. Cột này không bắt buộc với tệp mẫu cũ; khi bỏ trống, câu không được tính là câu tình huống."],
                ["Nguồn đối chiếu và Cần đối chiếu nguồn là thông tin tùy chọn, không bắt buộc để duyệt đề."],
                ["Xem trước trước khi nhập. Sửa đúng dòng Excel được báo lỗi; toàn bộ tệp phải hợp lệ mới được nhập."],
                ["Mỗi tệp tối đa 500 câu, 5 MB; chỉ .xlsx, không macro, không công thức. Dán giá trị nếu có công thức."],
                ["Cấu hình minh họa của đề: 30 câu, 30 phút, 10 câu chung và 20 câu chuyên môn; có thể thay đổi tại trang Đề thi."]], guide: true));
        }
        return output.ToArray();
    }

    private static XElement Sheet(IEnumerable<string[]> rows, bool guide = false)
    {
        var data = new XElement(Main + "sheetData");
        var number = 0;
        foreach (var values in rows)
        {
            number++;
            data.Add(new XElement(Main + "row", new XAttribute("r", number), new XAttribute("ht", number == 1 ? 32 : 45), new XAttribute("customHeight", 1), values.Select((value, index) => new XElement(Main + "c", new XAttribute("r", $"{(char)('A' + index)}{number}"), new XAttribute("t", "inlineStr"), new XAttribute("s", number == 1 ? 1 : 0), new XElement(Main + "is", new XElement(Main + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), value))))));
        }
        return new XElement(Main + "worksheet", new XElement(Main + "sheetViews", new XElement(Main + "sheetView", new XAttribute("workbookViewId", 0), new XElement(Main + "pane", new XAttribute("ySplit", 1), new XAttribute("topLeftCell", "A2"), new XAttribute("activePane", "bottomLeft"), new XAttribute("state", "frozen")))),
            new XElement(Main + "cols", Enumerable.Range(1, guide ? 1 : 13).Select(index => new XElement(Main + "col", new XAttribute("min", index), new XAttribute("max", index), new XAttribute("width", guide ? 120 : index is 3 or 10 or 11 ? 55 : 23), new XAttribute("customWidth", 1)))), data);
    }

    private static void WriteXml(ZipArchive archive, string name, XElement element)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Fastest);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false });
        new XDocument(new XDeclaration("1.0", "utf-8", null), element).Save(writer);
    }
}
