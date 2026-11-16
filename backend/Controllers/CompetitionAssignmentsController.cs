using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/organizer/competitions/{competitionId:int}")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class CompetitionAssignmentsController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    private async Task<(Exam? Exam, ApprovedExamVersion? Version)> ApprovedExam(int competitionId, int examId)
    {
        var exam = await db.Exams.Include(item => item.FieldGroup).SingleOrDefaultAsync(item => item.Id == examId && item.CompetitionId == competitionId);
        var version = exam?.ReviewStatus != "PendingReview" && exam?.CurrentApprovedVersionId is int versionId ? await db.ApprovedExamVersions.SingleOrDefaultAsync(item => item.Id == versionId
            && item.ExamId == examId && item.DraftRevision == exam.DraftRevision) : null;
        return (exam, version);
    }

    [HttpGet("assignment-options")]
    public async Task<IActionResult> Options(int competitionId)
    {
        if (!await db.Competitions.AnyAsync(item => item.Id == competitionId)) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        var accounts = await db.Users.AsNoTracking().Where(user => user.IsActive && user.Role == AppRoles.Candidate)
            .OrderBy(user => user.FullName).ThenBy(user => user.Id)
            .Select(user => new { user.Id, user.Username, user.FullName, user.Department, user.IsDemo }).ToListAsync();
        var exams = await db.Exams.AsNoTracking().Include(exam => exam.FieldGroup)
            .Where(exam => exam.CompetitionId == competitionId && exam.ReviewStatus != "PendingReview").OrderBy(exam => exam.Id).ToListAsync();
        var examIds = exams.Select(exam => exam.Id).ToArray();
        var versions = await db.ApprovedExamVersions.AsNoTracking().Where(version => examIds.Contains(version.ExamId)).ToListAsync();
        var approvedExams = exams.Select(exam => { var version = versions.FirstOrDefault(item => item.Id == exam.CurrentApprovedVersionId && item.DraftRevision == exam.DraftRevision);
            return new { exam.Id, exam.Name, fieldGroupName = exam.FieldGroup.Name, exam.DurationMinutes, exam.CurrentApprovedVersionId, versionNumber = version?.VersionNumber, isApproved = version is not null, exam.IsDemo }; }).ToList();
        return Ok(new { accounts, approvedExams });
    }

    [HttpGet("assignments")]
    public async Task<IActionResult> List(int competitionId)
    {
        var competition = await db.Competitions.AsNoTracking().SingleOrDefaultAsync(item => item.Id == competitionId);
        if (competition is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        var assignments = await db.CompetitionAssignments.AsNoTracking().Include(item => item.User).Include(item => item.Exam)
            .Include(item => item.ExamVersion).Where(item => item.CompetitionId == competitionId).OrderBy(item => item.User.FullName).ThenBy(item => item.UserId).ToListAsync();
        var attempts = await db.ExamAttempts.AsNoTracking().Where(item => item.CompetitionId == competitionId && !item.IsInvalidated)
            .OrderByDescending(item => item.Id).ToListAsync();
        return Ok(assignments.Select(assignment => Profile(assignment, competition, attempts.FirstOrDefault(attempt => attempt.UserId == assignment.UserId))));
    }

    private object Profile(CompetitionAssignment assignment, Competition competition, ExamAttempt? attempt)
    {
        var metadata = AssignmentRules.Metadata(assignment);
        var status = AssignmentRules.AttemptStatus(attempt, clock.UtcNow);
        return new
        {
            assignment.UserId, assignment.User.Username, assignment.User.FullName, assignment.User.Department,
            assignment.User.IsActive, isDemo = assignment.User.IsDemo || competition.IsDemo,
            assignment.ExamId, examName = metadata?.Name ?? assignment.Exam?.Name,
            assignment.ExamVersionId, versionNumber = metadata?.VersionNumber,
            attemptStatus = status, attemptStatusLabel = AssignmentRules.AttemptStatusLabel(status),
            awaitingApproval = metadata is null, canChange = attempt is null && competition.Status != CompetitionStatuses.Ended,
            assignedAtUtc = CompetitionResponse.Utc(assignment.AssignedAtUtc)
        };
    }

    [HttpPost("assignments")]
    public async Task<IActionResult> Create(int competitionId, AssignmentCreateRequest request)
    {
        if (request.UserIds is null || request.UserIds.Count is < 1 or > 500 || request.UserIds.Any(id => id <= 0))
            return BadRequest(new { message = "Vui lòng chọn từ 1 đến 500 tài khoản thí sinh đang hoạt động." });
        if (request.UserIds.Distinct().Count() != request.UserIds.Count)
            return BadRequest(new { message = "Danh sách tài khoản được chọn bị trùng." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == competitionId);
        if (competition is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (competition.Status == CompetitionStatuses.Ended) return Conflict(new { message = "Cuộc thi đã kết thúc, không thể thay đổi phân công." });
        var (exam, version) = await ApprovedExam(competitionId, request.ExamId);
        if (exam is null || exam.ReviewStatus == "PendingReview") return BadRequest(new { message = "Chỉ được chọn đề đã duyệt bản hiện tại và thuộc đúng cuộc thi này." });
        var accounts = await db.Users.Where(user => request.UserIds.Contains(user.Id) && user.IsActive && user.Role == AppRoles.Candidate).ToListAsync();
        if (accounts.Count != request.UserIds.Count) return BadRequest(new { message = "Một hoặc nhiều tài khoản không tồn tại, đã khóa hoặc không có vai trò Thí sinh." });
        if (await db.CompetitionAssignments.AnyAsync(item => item.CompetitionId == competitionId && request.UserIds.Contains(item.UserId)))
            return Conflict(new { message = "Một hoặc nhiều tài khoản đã có phân công trong cuộc thi. Hãy dùng chức năng Đổi đề." });
        if (await db.ExamAttempts.AnyAsync(item => item.CompetitionId == competitionId && !item.IsInvalidated && request.UserIds.Contains(item.UserId)))
            return Conflict(new { message = "Không thể phân công tài khoản đã bắt đầu lượt thi trong cuộc thi này." });
        var now = clock.UtcNow;
        db.CompetitionAssignments.AddRange(accounts.Select(user => new CompetitionAssignment
        {
            CompetitionId = competitionId, UserId = user.Id, ExamId = exam.Id, ExamVersionId = version?.Id,
            AssignedAtUtc = now, UpdatedAtUtc = now, AssignedByUserId = CurrentAccount.User(HttpContext).Id
        }));
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return StatusCode(201, new { message = $"Đã phân đề cho {accounts.Count} thí sinh.", assignedCount = accounts.Count });
    }

    [HttpPut("assignments/{userId:int}")]
    public async Task<IActionResult> Update(int competitionId, int userId, AssignmentExamRequest request)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var assignment = await db.CompetitionAssignments.Include(item => item.Competition).Include(item => item.User)
            .SingleOrDefaultAsync(item => item.CompetitionId == competitionId && item.UserId == userId);
        if (assignment is null) return NotFound(new { message = "Không tìm thấy phân công trong cuộc thi." });
        if (assignment.Competition.Status == CompetitionStatuses.Ended) return Conflict(new { message = "Cuộc thi đã kết thúc, không thể thay đổi phân công." });
        if (await AssignmentRules.Attempts(db, competitionId, userId).AnyAsync()) return Conflict(new { message = "Thí sinh đã bắt đầu làm bài; không thể đổi đề hoặc thu hồi phân công." });
        if (!assignment.User.IsActive || assignment.User.Role != AppRoles.Candidate) return BadRequest(new { message = "Chỉ được phân đề cho tài khoản Thí sinh đang hoạt động." });
        var (exam, version) = await ApprovedExam(competitionId, request.ExamId);
        if (exam is null || exam.ReviewStatus == "PendingReview") return BadRequest(new { message = "Chỉ được chọn đề đã duyệt bản hiện tại và thuộc đúng cuộc thi này." });
        assignment.ExamId = exam.Id; assignment.ExamVersionId = version?.Id; assignment.Exam = exam; assignment.ExamVersion = version;
        assignment.UpdatedAtUtc = clock.UtcNow; assignment.AssignedByUserId = CurrentAccount.User(HttpContext).Id;
        assignment.AssignedAtUtc ??= clock.UtcNow;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok(Profile(assignment, assignment.Competition, null));
    }

    [HttpDelete("assignments/{userId:int}")]
    public async Task<IActionResult> Delete(int competitionId, int userId)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var assignment = await db.CompetitionAssignments.Include(item => item.Competition)
            .SingleOrDefaultAsync(item => item.CompetitionId == competitionId && item.UserId == userId);
        if (assignment is null) return NotFound(new { message = "Không tìm thấy phân công trong cuộc thi." });
        if (assignment.Competition.Status == CompetitionStatuses.Ended) return Conflict(new { message = "Cuộc thi đã kết thúc, không thể thay đổi phân công." });
        if (await AssignmentRules.Attempts(db, competitionId, userId).AnyAsync()) return Conflict(new { message = "Thí sinh đã bắt đầu làm bài; không thể đổi đề hoặc thu hồi phân công." });
        db.CompetitionAssignments.Remove(assignment);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return NoContent();
    }

    [HttpGet("publication")]
    public async Task<IActionResult> Publication(int competitionId)
    {
        var competition = await db.Competitions.AsNoTracking().SingleOrDefaultAsync(item => item.Id == competitionId);
        return competition is null ? NotFound(new { message = "Không tìm thấy cuộc thi." }) : Ok(await AssignmentRules.Publication(db, competition));
    }

    [HttpPost("publish")]
    public async Task<IActionResult> Publish(int competitionId)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == competitionId);
        if (competition is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (competition.Status == CompetitionStatuses.Ended) return Conflict(new { message = "Cuộc thi đã kết thúc, không thể công bố lại." });
        if (competition.Status == CompetitionStatuses.Published) return Ok(await AssignmentRules.Publication(db, competition));
        var readiness = await AssignmentRules.Publication(db, competition);
        if (!readiness.CanPublish) return BadRequest(readiness);
        competition.Status = CompetitionStatuses.Published; competition.PublishedAtUtc = clock.UtcNow; competition.UpdatedAtUtc = clock.UtcNow;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok(await AssignmentRules.Publication(db, competition));
    }
}

public sealed class AssignmentCreateRequest
{
    public List<int> UserIds { get; set; } = [];
    [Range(1, int.MaxValue, ErrorMessage = "Vui lòng chọn đề thi đã duyệt.")]
    public int ExamId { get; set; }
}

public sealed class AssignmentExamRequest
{
    [Range(1, int.MaxValue, ErrorMessage = "Vui lòng chọn đề thi đã duyệt.")]
    public int ExamId { get; set; }
}
