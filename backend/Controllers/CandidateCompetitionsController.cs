using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/candidate/competitions")]
[Authorize(Policy = AppRoles.Candidate)]
public sealed class CandidateCompetitionsController(AppDbContext db, VietnamClock clock, ICompetitionAwardsService awards) : ControllerBase
{
    private IQueryable<CompetitionAssignment> VisibleAssignments()
    {
        var userId = CurrentAccount.User(HttpContext).Id;
        return db.CompetitionAssignments.AsNoTracking().Include(assignment => assignment.Competition)
            .Include(assignment => assignment.Exam).Include(assignment => assignment.ExamVersion)
            .Where(assignment => assignment.UserId == userId
                && (assignment.Competition.Status == CompetitionStatuses.Published
                    || assignment.Competition.Status == CompetitionStatuses.Ended
                        && db.CompetitionAwardPlans.Any(plan => plan.CompetitionId == assignment.CompetitionId
                            && plan.Status == CompetitionAwardStatuses.Published))
                && assignment.ExamId != null && assignment.ExamVersionId != null && assignment.Exam != null
                && assignment.ExamVersion != null && assignment.Exam.CompetitionId == assignment.CompetitionId
                && assignment.ExamVersion.ExamId == assignment.ExamId);
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var assignments = await VisibleAssignments().OrderByDescending(assignment => assignment.Competition.UpdatedAtUtc)
            .ThenByDescending(assignment => assignment.CompetitionId).ToListAsync();
        var userId = CurrentAccount.User(HttpContext).Id;
        var attempts = await db.ExamAttempts.AsNoTracking().Where(attempt => attempt.UserId == userId && !attempt.IsInvalidated)
            .OrderByDescending(attempt => attempt.Id).ToListAsync();
        var sessionId = CurrentAccount.Session(HttpContext).Id;
        var retakeGrants = await db.ExamAttemptSessionGrants.AsNoTracking()
            .Where(item => item.UserId == userId && item.SessionId == sessionId)
            .Select(item => item.CompetitionId).ToListAsync();
        var now = clock.UtcNow;
        return Ok(assignments.Where(assignment => AssignmentRules.Metadata(assignment) is not null)
            .Select(assignment => Profile(assignment, attempts.FirstOrDefault(attempt => attempt.CompetitionId == assignment.CompetitionId),
                now, retakeGrants.Contains(assignment.CompetitionId))));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        return await AssignedCompetition(id);
    }

    [HttpGet("{id:int}/exam")]
    public async Task<IActionResult> Exam(int id) => await AssignedCompetition(id);

    /// <summary>Returns only this assigned candidate's published score and the issued award list.</summary>
    [HttpGet("{id:int}/awards")]
    public async Task<IActionResult> Awards(int id, CancellationToken cancellationToken)
    {
        var response = await awards.GetCandidateAsync(id, CurrentAccount.User(HttpContext).Id, cancellationToken);
        return response is null ? NotFound(new { message = "Không tìm thấy cuộc thi hoặc phân công hợp lệ." }) : Ok(response);
    }

    private async Task<IActionResult> AssignedCompetition(int id)
    {
        var assignment = await VisibleAssignments().SingleOrDefaultAsync(item => item.CompetitionId == id);
        if (assignment is null || AssignmentRules.Metadata(assignment) is null)
            return NotFound(new { message = "Không tìm thấy cuộc thi hoặc đề được phân tham gia." });
        var attempt = await AssignmentRules.Attempts(db, id, assignment.UserId).AsNoTracking().OrderByDescending(item => item.Id).FirstOrDefaultAsync();
        var allowLateStart = await db.ExamAttemptSessionGrants.AsNoTracking()
            .AnyAsync(item => item.CompetitionId == id && item.UserId == assignment.UserId
                && item.SessionId == CurrentAccount.Session(HttpContext).Id);
        return Ok(Profile(assignment, attempt, clock.UtcNow, allowLateStart));
    }

    private static object Profile(CompetitionAssignment assignment, ExamAttempt? attempt, DateTime now, bool allowLateStart = false)
    {
        var competition = assignment.Competition;
        var status = AssignmentRules.AttemptStatus(attempt, now);
        var validSchedule = AssignmentRules.ValidSchedule(competition);
        var canStart = competition.Status == CompetitionStatuses.Published && attempt is null && validSchedule && competition.OpensAtUtc <= now
            && (allowLateStart || now <= competition.StartDeadlineUtc) && now < competition.ClosesAtUtc;
        var startBlockedReason = canStart ? null : competition.Status == CompetitionStatuses.Ended ? "Cuộc thi đã kết thúc."
            : attempt is not null ? status == "Submitted" ? "Bạn đã nộp bài trong cuộc thi này." : "Bạn đã bắt đầu lượt thi trong cuộc thi này."
            : !validSchedule ? "Cuộc thi chưa được cấu hình đủ lịch mở, hạn bắt đầu và đóng thi hợp lệ."
            : now < competition.OpensAtUtc ? "Chưa đến giờ mở thi." : "Đã hết hạn bắt đầu làm bài.";
        return new
        {
            competition.Id,
            competition.Name,
            competition.Description,
            competition.Rules,
            status = competition.Status,
            competition.IsDemo,
            createdAtUtc = CompetitionResponse.Utc(competition.CreatedAtUtc),
            updatedAtUtc = CompetitionResponse.Utc(competition.UpdatedAtUtc),
            opensAtUtc = CompetitionResponse.Utc(competition.OpensAtUtc),
            startDeadlineUtc = CompetitionResponse.Utc(competition.StartDeadlineUtc),
            closesAtUtc = CompetitionResponse.Utc(competition.ClosesAtUtc),
            publishedAtUtc = CompetitionResponse.Utc(competition.PublishedAtUtc),
            assignedExam = AssignmentRules.Metadata(assignment),
            attemptStatus = status,
            attemptStatusLabel = AssignmentRules.AttemptStatusLabel(status),
            canStart,
            startBlockedReason
        };
    }
}
