using System.Text.Json;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

public static class ExamResponse
{
    public static object Profile(Exam exam, ApprovedExamVersion? approvedVersion = null) => new
    {
        exam.Id, exam.CompetitionId, exam.Name, exam.FieldGroupId,
        fieldGroupName = exam.FieldGroup?.Name,
        exam.DurationMinutes, exam.TargetQuestionCount, exam.CommonQuestionCount, exam.SpecializedQuestionCount,
        exam.DraftRevision, exam.CurrentApprovedVersionId,
        isApproved = approvedVersion is not null && approvedVersion.DraftRevision == exam.DraftRevision,
        exam.IsDemo, questionCount = exam.Questions.Count,
        createdAtUtc = CompetitionResponse.Utc(exam.CreatedAtUtc), updatedAtUtc = CompetitionResponse.Utc(exam.UpdatedAtUtc)
    };

    public static object Question(ExamQuestion question) => new
    {
        question.Id, question.ExamId, question.BankQuestionId, question.Position, question.Type, question.Content,
        options = QuestionRules.Options(question), question.CorrectAnswer, question.Points, question.IsScenario,
        question.Explanation, question.Source, question.Group, question.RequiresSourceReview, question.SourceReviewed,
        question.ReviewedByUserId, reviewedAtUtc = CompetitionResponse.Utc(question.ReviewedAtUtc)
    };

    public static object Question(QuestionBankQuestion question) => new
    {
        question.Id, question.Type, question.Content,
        options = QuestionRules.Options(new ExamQuestion { OptionsJson = question.OptionsJson }),
        question.CorrectAnswer, question.Points, question.IsScenario, question.Explanation, question.Source,
        question.Group, question.RequiresSourceReview, question.SourceReviewed, question.ReviewedByUserId,
        reviewedAtUtc = CompetitionResponse.Utc(question.ReviewedAtUtc), question.IsActive,
        createdAtUtc = CompetitionResponse.Utc(question.CreatedAtUtc),
        updatedAtUtc = CompetitionResponse.Utc(question.UpdatedAtUtc)
    };

    public static object Version(ApprovedExamVersion version, bool includeSnapshot = true) => new
    {
        version.Id, version.ExamId, version.VersionNumber, version.DraftRevision, version.HashSha256,
        approvedAtUtc = CompetitionResponse.Utc(version.ApprovedAtUtc), version.ApprovedByUserId,
        snapshot = includeSnapshot ? JsonSerializer.Deserialize<JsonElement>(version.SnapshotJson) : (JsonElement?)null
    };
}
