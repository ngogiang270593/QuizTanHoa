using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;

namespace Quiz_TanHoa.Api.Services;

public sealed record AssignedExamMetadata(int Id, string Name, string? FieldGroupName, int DurationMinutes,
    int TargetQuestionCount, int VersionId, int VersionNumber, bool IsDemo);
public sealed record PublicationIssue(string Field, string Message);
public sealed record PublicationReadiness(string Status, DateTime? PublishedAtUtc, bool CanPublish,
    List<PublicationIssue> Errors, int AssignmentCount, int ApprovedExamCount);

public static class AssignmentRules
{
    public static bool ValidSchedule(Competition competition) => competition.OpensAtUtc.HasValue
        && competition.StartDeadlineUtc.HasValue && competition.ClosesAtUtc.HasValue
        && competition.OpensAtUtc < competition.StartDeadlineUtc && competition.StartDeadlineUtc <= competition.ClosesAtUtc;

    public static IQueryable<ExamAttempt> Attempts(AppDbContext db, int competitionId, int userId) => db.ExamAttempts
        .Where(attempt => attempt.UserId == userId && attempt.CompetitionId == competitionId && !attempt.IsInvalidated);

    public static string AttemptStatus(ExamAttempt? attempt, DateTime now) => attempt is null ? "NotStarted"
        : attempt.SubmittedAtUtc.HasValue ? "Submitted" : attempt.DeadlineAtUtc > now ? "InProgress" : "Expired";

    public static string AttemptStatusLabel(string status) => status switch
    {
        "Submitted" => "Đã nộp bài", "InProgress" => "Đang làm bài", "Expired" => "Hết thời gian", _ => "Chưa bắt đầu"
    };

    public static AssignedExamMetadata? Metadata(CompetitionAssignment assignment)
    {
        var version = assignment.ExamVersion;
        if (assignment.Exam is null || version is null || assignment.ExamId != version.ExamId
            || assignment.Exam.CompetitionId != assignment.CompetitionId || assignment.ExamVersionId != version.Id) return null;
        try
        {
            using var document = JsonDocument.Parse(version.SnapshotJson);
            var exam = document.RootElement.GetProperty("exam");
            if (exam.GetProperty("id").GetInt32() != assignment.ExamId
                || exam.GetProperty("competitionId").GetInt32() != assignment.CompetitionId) return null;
            return new AssignedExamMetadata(exam.GetProperty("id").GetInt32(), exam.GetProperty("name").GetString() ?? "",
                exam.TryGetProperty("fieldGroupName", out var group) ? group.GetString() : null,
                assignment.Competition?.DurationMinutes ?? exam.GetProperty("durationMinutes").GetInt32(), exam.GetProperty("targetQuestionCount").GetInt32(),
                version.Id, version.VersionNumber, exam.TryGetProperty("isDemo", out var demo) && demo.GetBoolean());
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException or FormatException) { return null; }
    }

    public static async Task<PublicationReadiness> Publication(AppDbContext db, Competition competition)
    {
        var errors = new List<PublicationIssue>();
        if (competition.Status == CompetitionStatuses.Ended) errors.Add(new("status", "Cuộc thi đã kết thúc, không thể công bố lại."));
        if (!ValidSchedule(competition)) errors.Add(new("schedule", "Cần lịch hợp lệ: ngày giờ mở thi < hạn bắt đầu ≤ ngày giờ đóng thi."));
        var approvedExamCount = await db.ApprovedExamVersions.Where(version => version.Exam.CompetitionId == competition.Id)
            .Select(version => version.ExamId).Distinct().CountAsync();
        if (approvedExamCount == 0) errors.Add(new("exams", "Cuộc thi cần có ít nhất một đề đã duyệt."));
        var assignments = await db.CompetitionAssignments.AsNoTracking().Include(assignment => assignment.User)
            .Include(assignment => assignment.Exam).Include(assignment => assignment.ExamVersion)
            .Where(assignment => assignment.CompetitionId == competition.Id).ToListAsync();
        if (assignments.Count == 0) errors.Add(new("assignments", "Cần phân đề cho ít nhất một thí sinh trước khi công bố."));
        foreach (var assignment in assignments)
        {
            if (!assignment.User.IsActive || assignment.User.Role != AppRoles.Candidate)
                errors.Add(new("assignments", $"Tài khoản {assignment.User.Username} không còn là thí sinh đang hoạt động."));
            if (competition.Status == CompetitionStatuses.Draft && assignment.Exam is not null && assignment.ExamVersion is not null && (assignment.Exam.DraftRevision != assignment.ExamVersion.DraftRevision || assignment.Exam.ReviewStatus == "PendingReview" || assignment.Exam.CurrentApprovedVersionId != assignment.ExamVersionId)) errors.Add(new("exams", "Cần duyệt và phân công đúng phiên bản hiện tại trước khi công khai."));
            if (Metadata(assignment) is null)
                errors.Add(new("assignments", $"Tài khoản {assignment.User.Username} chưa có đề đã duyệt hợp lệ thuộc cuộc thi này."));
        }
        return new PublicationReadiness(competition.Status,
            competition.PublishedAtUtc.HasValue ? DateTime.SpecifyKind(competition.PublishedAtUtc.Value, DateTimeKind.Utc) : null,
            errors.Count == 0 && competition.Status == CompetitionStatuses.Draft, errors, assignments.Count, approvedExamCount);
    }
}
