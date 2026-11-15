using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Quiz_TanHoa.Api.Controllers;
using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Services;

public sealed record QuestionImportRow(int RowNumber, QuestionWriteRequest Question, List<string> Errors, List<string> Warnings);
public sealed record QuestionImportPreview(int TotalRows, int ValidRows, bool CanImport, List<QuestionImportRow> Rows, List<string> Errors);

public static class WorkbookQuestions
{
    public static QuestionImportPreview Preview(Stream stream)
    {
        var table = QuestionWorkbook.Read(stream);
        var rows = new List<QuestionImportRow>();
        foreach (var row in table.Rows)
        {
            string Cell(string header) => row.Cells.GetValueOrDefault(table.Columns[QuestionWorkbook.Normalize(header)], "");
            string CellOptional(string header) => table.Columns.TryGetValue(QuestionWorkbook.Normalize(header), out var column) ? row.Cells.GetValueOrDefault(column, "") : "";
            if (QuestionWorkbook.Headers.Concat(QuestionWorkbook.OptionalHeaders).All(header => string.IsNullOrWhiteSpace(CellOptional(header))) && row.Errors.Count == 0) continue;
            var errors = row.Errors.ToList();
            var type = QuestionWorkbook.Normalize(Cell("Loại câu"));
            var group = QuestionWorkbook.Normalize(Cell("Chủ đề"));
            var question = new QuestionWriteRequest
            {
                Type = type switch { "motdapandung" or "singlechoice" => "SingleChoice", "dungsai" or "truefalse" => "TrueFalse", _ => "" },
                Topic = group is "kienthucchung" or "common" or "chuyenmon" or "specialized" ? "" : Cell("Chủ đề"),
                Group = group switch { "kienthucchung" or "common" => "Common", "chuyenmon" or "specialized" => "Specialized", _ => "Common" },
                Content = Cell("Nội dung"),
                Explanation = Cell("Giải thích"),
                Source = Cell("Nguồn đối chiếu"),
                SourceReviewed = false
            };
            var scenario = QuestionWorkbook.Normalize(CellOptional("Câu tình huống"));
            if (scenario is not ("" or "co" or "khong" or "true" or "false" or "1" or "0" or "yes" or "no"))
                errors.Add("Câu tình huống: chỉ nhập Có hoặc Không.");
            question.IsScenario = scenario is "co" or "true" or "1" or "yes";
            var review = QuestionWorkbook.Normalize(Cell("Cần đối chiếu nguồn"));
            if (review is not ("" or "co" or "khong" or "true" or "false" or "1" or "0" or "yes" or "no"))
                errors.Add("Cần đối chiếu nguồn: chỉ nhập Có hoặc Không.");
            question.RequiresSourceReview = review is "co" or "true" or "1" or "yes";
            var answer = Cell("Đáp án đúng").Trim();
            if (question.Type == "TrueFalse")
            {
                question.Options = [new QuestionOption { Key = "True", Text = "Đúng" }, new QuestionOption { Key = "False", Text = "Sai" }];
                question.CorrectAnswer = QuestionWorkbook.Normalize(answer) switch { "dung" or "true" or "a" => "True", "sai" or "false" or "b" => "False", _ => null };
                if ((!string.IsNullOrWhiteSpace(Cell("Phương án A")) && QuestionWorkbook.Normalize(Cell("Phương án A")) != "dung")
                    || (!string.IsNullOrWhiteSpace(Cell("Phương án B")) && QuestionWorkbook.Normalize(Cell("Phương án B")) != "sai")
                    || !string.IsNullOrWhiteSpace(Cell("Phương án C")) || !string.IsNullOrWhiteSpace(Cell("Phương án D")))
                    errors.Add("Câu đúng/sai dùng A = Đúng, B = Sai; để trống C, D và có thể để trống cả A, B.");
            }
            else
            {
                question.Options = new[] { "A", "B", "C", "D" }.Where(key => !string.IsNullOrWhiteSpace(Cell("Phương án " + key)))
                    .Select(key => new QuestionOption { Key = key, Text = Cell("Phương án " + key) }).ToList();
                question.CorrectAnswer = string.IsNullOrWhiteSpace(answer) ? null : answer.ToUpperInvariant();
            }
            if (!decimal.TryParse(Cell("Điểm").Replace(',', '.'), NumberStyles.AllowDecimalPoint | NumberStyles.AllowLeadingSign | NumberStyles.AllowExponent,
                CultureInfo.InvariantCulture, out var points)) errors.Add("Điểm: vui lòng nhập một số lớn hơn 0.");
            question.Points = points;
            var attributeErrors = new List<ValidationResult>();
            Validator.TryValidateObject(question, new ValidationContext(question), attributeErrors, validateAllProperties: true);
            foreach (var result in attributeErrors) errors.Add(result.MemberNames.FirstOrDefault() switch
            {
                "Content" => "Nội dung tối đa 5.000 ký tự.",
                "Explanation" => "Giải thích tối đa 5.000 ký tự.",
                "Source" => "Nguồn đối chiếu tối đa 2.000 ký tự.",
                "CorrectAnswer" => "Đáp án đúng không hợp lệ hoặc quá dài.",
                _ => "Một trường trong câu hỏi vượt giới hạn cho phép."
            });
            var model = new ExamQuestion { Position = row.RowNumber - 1 };
            QuestionRules.Apply(model, question, reviewerId: 0);
            errors.AddRange(QuestionRules.Validate(model).Select(issue => issue.Message));
            question.RequiresSourceReview = model.RequiresSourceReview;
            rows.Add(new QuestionImportRow(row.RowNumber, question, errors.Distinct().ToList(), []));
        }
        var globalErrors = rows.Count == 0 ? new List<string> { "Trang CauHoi chưa có câu hỏi để nhập. Điền dữ liệu từ dòng 2 theo mẫu." } : [];
        return new QuestionImportPreview(rows.Count, rows.Count(row => row.Errors.Count == 0), rows.Count > 0 && rows.All(row => row.Errors.Count == 0), rows, globalErrors);
    }
}
