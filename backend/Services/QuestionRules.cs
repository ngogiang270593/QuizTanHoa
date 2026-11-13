using System.Text.Json;
using Quiz_TanHoa.Api.Controllers;
using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Services;

public sealed record ValidationIssue(string Field, string Message, int? QuestionId = null, int? QuestionNumber = null);

public static class QuestionRules
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static List<QuestionOption> Options(ExamQuestion question)
    {
        try { return JsonSerializer.Deserialize<List<QuestionOption>>(question.OptionsJson, Json) ?? []; }
        catch (JsonException) { return []; }
    }

    public static void Apply(ExamQuestion question, QuestionWriteRequest request, int reviewerId)
    {
        question.Type = request.Type ?? "";
        question.Content = request.Content?.Trim() ?? "";
        question.OptionsJson = JsonSerializer.Serialize(question.Type == "TrueFalse"
            ? new List<QuestionOption> { new() { Key = "True", Text = "Đúng" }, new() { Key = "False", Text = "Sai" } }
            : request.Options?.Select(option => new QuestionOption { Key = option.Key?.Trim() ?? "", Text = option.Text?.Trim() ?? "" }).ToList() ?? [], Json);
        question.CorrectAnswer = string.IsNullOrWhiteSpace(request.CorrectAnswer) ? null : request.CorrectAnswer.Trim();
        question.Points = request.Points;
        question.IsScenario = request.IsScenario;
        question.Explanation = request.Explanation?.Trim() ?? "";
        question.Source = request.Source?.Trim() ?? "";
        question.Group = request.Group ?? "";
        question.RequiresSourceReview = request.RequiresSourceReview;
        question.SourceReviewed = request.SourceReviewed && !string.IsNullOrWhiteSpace(question.Source);
        question.ReviewedByUserId = question.SourceReviewed ? reviewerId : null;
        question.ReviewedAtUtc = question.SourceReviewed ? DateTime.UtcNow : null;
    }

    public static List<ValidationIssue> Validate(ExamQuestion question)
    {
        var errors = new List<ValidationIssue>();
        void Error(string field, string message) => errors.Add(new(field, message, question.Id == 0 ? null : question.Id, question.Position));
        if (question.Type is not ("SingleChoice" or "TrueFalse")) Error("type", "Loại câu hỏi phải là một đáp án đúng hoặc đúng/sai.");
        if (question.Group is not ("Common" or "Specialized")) Error("group", "Nhóm câu phải là Kiến thức chung hoặc Chuyên môn.");
        if (string.IsNullOrWhiteSpace(question.Content)) Error("content", "Câu hỏi chưa có nội dung.");
        if (question.Content.Length > 5000) Error("content", "Nội dung câu hỏi không được vượt quá 5.000 ký tự.");
        var options = Options(question);
        if (options.Count is < 2 or > 6) Error("options", "Câu hỏi cần từ 2 đến 6 phương án.");
        if (options.Any(option => string.IsNullOrWhiteSpace(option.Key) || string.IsNullOrWhiteSpace(option.Text))) Error("options", "Mỗi phương án phải có mã và nội dung.");
        if (options.Any(option => option.Key.Length > 20 || option.Text.Length > 2000)) Error("options", "Mã phương án tối đa 20 ký tự, nội dung tối đa 2.000 ký tự.");
        if (options.Select(option => option.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count() != options.Count) Error("options", "Mã phương án không được trùng nhau.");
        if (string.IsNullOrWhiteSpace(question.CorrectAnswer) || options.Count(option => option.Key == question.CorrectAnswer) != 1) Error("correctAnswer", "Chưa chọn một đáp án đúng hợp lệ.");
        if (question.Type == "TrueFalse" && (options.Count != 2 || options.All(option => option.Key != "True") || options.All(option => option.Key != "False"))) Error("options", "Câu đúng/sai phải có hai phương án Đúng và Sai.");
        if (question.Points <= 0 || question.Points > 1000) Error("points", "Điểm phải lớn hơn 0 và không vượt quá 1.000.");
        return errors;
    }
}
