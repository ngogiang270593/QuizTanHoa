using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Services;

public static class ExamRules
{
    public static List<ValidationIssue> Validate(Exam exam)
    {
        var errors = new List<ValidationIssue>();
        if (string.IsNullOrWhiteSpace(exam.Name)) errors.Add(new("name", "Vui lòng nhập tên đề thi."));
        if (exam.DurationMinutes is < 1 or > 480) errors.Add(new("durationMinutes", "Thời lượng phải từ 1 đến 480 phút."));
        if (exam.TargetQuestionCount is < 1 or > 500) errors.Add(new("targetQuestionCount", "Số câu phải từ 1 đến 500."));
        if (exam.CommonQuestionCount < 0 || exam.SpecializedQuestionCount < 0 || exam.CommonQuestionCount + exam.SpecializedQuestionCount != exam.TargetQuestionCount)
            errors.Add(new("commonQuestionCount", "Số câu kiến thức chung cộng chuyên môn phải bằng tổng số câu đã cấu hình."));
        var questions = exam.Questions.OrderBy(question => question.Position).ThenBy(question => question.Id).ToList();
        if (questions.Count == 0) errors.Add(new("questions", "Đề chưa có câu hỏi; chưa thể duyệt đề."));
        if (questions.Count != exam.TargetQuestionCount) errors.Add(new("targetQuestionCount", $"Đề đang có {questions.Count} câu, cần {exam.TargetQuestionCount} câu theo cấu hình."));
        if (questions.Count(question => question.Group == "Common") != exam.CommonQuestionCount) errors.Add(new("commonQuestionCount", $"Cần đúng {exam.CommonQuestionCount} câu Kiến thức chung."));
        if (questions.Count(question => question.Group == "Specialized") != exam.SpecializedQuestionCount) errors.Add(new("specializedQuestionCount", $"Cần đúng {exam.SpecializedQuestionCount} câu Chuyên môn."));
        for (var index = 0; index < questions.Count; index++)
            errors.AddRange(QuestionRules.Validate(questions[index]).Select(issue => issue with { QuestionNumber = index + 1 }));
        return errors;
    }

    public static void TouchDraft(Exam exam)
    {
        exam.DraftRevision++;
        exam.UpdatedAtUtc = DateTime.UtcNow;
    }
}
