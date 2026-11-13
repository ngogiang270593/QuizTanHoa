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
[Route("api/organizer/competitions/{competitionId:int}/assignments/{userId:int}/attempt-session")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class OrganizerAttemptSessionsController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    /// <summary>Transfers an attempt to a new active login session or issues a replacement attempt.</summary>
    [HttpPost]
    public async Task<IActionResult> Transfer(int competitionId, int userId, TransferAttemptSessionRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Reason))
            return BadRequest(new { message = "Cần ghi lý do chuyển phiên hoặc cấp lượt thi thay thế." });

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var assignment = await db.CompetitionAssignments.Include(item => item.Competition)
            .Include(item => item.Exam).Include(item => item.ExamVersion)
            .SingleOrDefaultAsync(item => item.CompetitionId == competitionId && item.UserId == userId, cancellationToken);
        if (assignment is null || assignment.ExamId is null || assignment.ExamVersionId is null)
            return NotFound(new { message = "Không tìm thấy phân công hợp lệ trong cuộc thi." });
        if (assignment.Competition.Status != CompetitionStatuses.Published)
            return Conflict(new { message = "Chỉ có thể chuyển phiên trong cuộc thi đã công bố." });
        if (assignment.Exam is null || assignment.ExamVersion is null
            || assignment.Exam.CompetitionId != competitionId
            || assignment.ExamVersion.ExamId != assignment.ExamId
            || AssignmentRules.Metadata(assignment) is not { } metadata)
            return Conflict(new { message = "Đề được phân không còn hợp lệ trong cuộc thi." });

        var now = clock.UtcNow;
        await AttemptFinalizer.FinalizeDueAsync(db, now, cancellationToken);
        var attempt = await db.ExamAttempts.Include(item => item.Questions)
            .Where(item => item.CompetitionId == competitionId && item.UserId == userId && !item.IsInvalidated)
            .OrderByDescending(item => item.Id).FirstOrDefaultAsync(cancellationToken);

        var previousSessionId = attempt?.OwnerSessionId;
        var nextSession = await db.AuthSessions.AsNoTracking().Where(session => session.UserId == userId
                && session.RevokedAtUtc == null && session.ExpiresAtUtc > now
                && (previousSessionId == null || session.Id != previousSessionId))
            .OrderByDescending(session => session.CreatedAtUtc).FirstOrDefaultAsync(cancellationToken);
        if (nextSession is null)
            return Conflict(new { message = "Không tìm thấy phiên đăng nhập mới đang hoạt động của thí sinh." });

        if (attempt is null)
            return Conflict(new { message = "Không tìm thấy lượt cũ cần chuyển phiên hoặc thay thế." });
        var currentAttempt = attempt;
        if (!request.AllowRetake && currentAttempt.SubmittedAtUtc is not null)
            return Conflict(new { message = "Lượt thi đã nộp; chỉ có thể cấp lượt thay thế nếu thể lệ cho phép." });

        if (request.AllowRetake)
        {
            if (!AssignmentRules.ValidSchedule(assignment.Competition) || assignment.Competition.ClosesAtUtc <= now)
                return Conflict(new { message = "Không thể cấp lượt thay thế sau giờ đóng thi hoặc khi lịch thi không hợp lệ." });

            currentAttempt.IsInvalidated = true;
            currentAttempt.InvalidatedAtUtc = now;
            currentAttempt.InvalidatedByUserId = CurrentAccount.User(HttpContext).Id;
            currentAttempt.InvalidationReason = request.Reason.Trim();
            currentAttempt.WriterTabId = null;
            currentAttempt.WriterLeaseUntilUtc = null;
            await db.SaveChangesAsync(cancellationToken);
            db.ExamAttemptSessionGrants.Add(new ExamAttemptSessionGrant
            {
                CompetitionId = competitionId,
                UserId = userId,
                SessionId = nextSession.Id,
                OldAttemptId = currentAttempt.Id,
                ActorUserId = CurrentAccount.User(HttpContext).Id,
                CreatedAtUtc = now,
                Reason = request.Reason.Trim()
            });
        }
        else
        {
            if (currentAttempt.DeadlineAtUtc <= now)
                return Conflict(new { message = "Lượt thi đã hết hạn; chỉ có thể cấp lượt thay thế nếu thể lệ cho phép." });
            currentAttempt.OwnerSessionId = nextSession.Id;
            currentAttempt.WriterTabId = null;
            currentAttempt.WriterLeaseUntilUtc = null;
        }

        db.ExamAttemptAdminEvents.Add(new ExamAttemptAdminEvent
        {
            AttemptId = currentAttempt.Id,
            ActorUserId = CurrentAccount.User(HttpContext).Id,
            OccurredAtUtc = now,
            Action = request.AllowRetake ? "ReplacementAuthorized" : "SessionTransferred",
            Reason = request.Reason.Trim(),
            PreviousSessionId = previousSessionId,
            NewSessionId = nextSession.Id,
            ReplacementAttemptId = null
        });
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new
        {
            message = request.AllowRetake ? "Đã vô hiệu hóa lượt cũ. Lượt thay thế sẽ bắt đầu khi thí sinh vào thi bằng phiên mới." : "Đã chuyển quyền làm bài sang phiên đăng nhập mới.",
            attemptId = request.AllowRetake ? (int?)null : currentAttempt.Id,
            deadlineAtUtc = request.AllowRetake ? (DateTime?)null : CompetitionResponse.Utc(currentAttempt.DeadlineAtUtc)
        });
    }
}

/// <summary>Reason and optional retake authorization for an organizer attempt intervention.</summary>
public sealed record TransferAttemptSessionRequest
{
    [Required, MaxLength(1000)]
    public required string Reason { get; init; }
    public bool AllowRetake { get; init; }
}
