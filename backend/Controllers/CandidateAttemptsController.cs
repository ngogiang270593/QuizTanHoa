using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/candidate/competitions/{competitionId:int}/attempt")]
[Authorize(Policy = AppRoles.Candidate)]
public sealed class CandidateAttemptsController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int LeaseSeconds = 30;

    private Task<CompetitionAssignment?> Assignment(int competitionId, int userId, CancellationToken cancellationToken) =>
        db.CompetitionAssignments.AsNoTracking()
            .Include(item => item.Competition).Include(item => item.Exam).Include(item => item.ExamVersion)
            .SingleOrDefaultAsync(item => item.CompetitionId == competitionId && item.UserId == userId
                && item.Competition.Status == CompetitionStatuses.Published
                && item.ExamId != null && item.ExamVersionId != null
                && item.Exam != null && item.ExamVersion != null
                && item.Exam.CompetitionId == item.CompetitionId
                && item.ExamVersion.ExamId == item.ExamId, cancellationToken);

    private string? TabId => Request.Headers["X-Quiz-Attempt-Tab"].FirstOrDefault();

    private bool HasValidTabId() => TabId is { Length: >= 8 and <= 64 }
        && TabId.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

    [HttpGet]
    public async Task<IActionResult> Get(int competitionId, CancellationToken cancellationToken)
    {
        var assignment = await Assignment(competitionId, CurrentAccount.User(HttpContext).Id, cancellationToken);
        if (assignment is null || AssignmentRules.Metadata(assignment) is null)
            return NotFound(new { message = "Không tìm thấy cuộc thi hoặc đề được phân tham gia." });
        var attempt = await FindAttempt(competitionId, assignment.UserId, cancellationToken);
        var now = clock.UtcNow;
        if (attempt is null)
        {
            var grant = await db.ExamAttemptSessionGrants.AsNoTracking()
                .SingleOrDefaultAsync(item => item.CompetitionId == competitionId && item.UserId == assignment.UserId, cancellationToken);
            if (grant is not null && grant.SessionId != CurrentAccount.Session(HttpContext).Id) return SessionConflict();
            return Ok(NotStarted(assignment, now, grant is not null));
        }
        if (!await BindSession(attempt.Id, cancellationToken)) return SessionConflict();
        await FinalizeDueAttempt(attempt.Id, now, cancellationToken);
        attempt = await LoadAttempt(attempt.Id, cancellationToken);
        if (attempt.SubmittedAtUtc is null && attempt.DeadlineAtUtc > now)
        {
            if (!HasValidTabId()) return BadRequest(new { message = "Phiên tab làm bài không hợp lệ." });
            if (!await ClaimWriter(attempt.Id, now, cancellationToken)) return TabConflict();
            attempt = await LoadAttempt(attempt.Id, cancellationToken);
        }
        return Ok(Packet(attempt, now));
    }

    [HttpPost("start")]
    public async Task<IActionResult> Start(int competitionId, CancellationToken cancellationToken)
    {
        var user = CurrentAccount.User(HttpContext);
        var session = CurrentAccount.Session(HttpContext);
        if (!HasValidTabId()) return BadRequest(new { message = "Phiên tab làm bài không hợp lệ." });
        var assignment = await Assignment(competitionId, user.Id, cancellationToken);
        var metadata = assignment is null ? null : AssignmentRules.Metadata(assignment);
        if (assignment is null || metadata is null)
            return NotFound(new { message = "Không tìm thấy cuộc thi hoặc đề được phân tham gia." });

        var now = clock.UtcNow;
        await AttemptFinalizer.FinalizeDueAsync(db, now, cancellationToken);
        var existing = await FindAttempt(competitionId, user.Id, cancellationToken);
        if (existing is not null)
        {
            if (!await BindSession(existing.Id, cancellationToken)) return SessionConflict();
            if (existing.SubmittedAtUtc is null && existing.DeadlineAtUtc > now)
            {
                if (!await ClaimWriter(existing.Id, now, cancellationToken)) return TabConflict();
                existing = await LoadAttempt(existing.Id, cancellationToken);
            }
            return Ok(Packet(existing, now));
        }

        var competition = assignment.Competition;
        var grant = await db.ExamAttemptSessionGrants.SingleOrDefaultAsync(
            item => item.CompetitionId == competitionId && item.UserId == user.Id, cancellationToken);
        if (grant is not null && grant.SessionId != session.Id) return SessionConflict();
        if (!AssignmentRules.ValidSchedule(competition)
            || competition.OpensAtUtc > now
            || (grant is null && competition.StartDeadlineUtc < now)
            || competition.ClosesAtUtc <= now)
            return Conflict(new { message = "Hiện không nằm trong thời gian được phép bắt đầu lượt thi." });

        List<AttemptQuestionSeed> questions;
        try { questions = ReadQuestions(assignment.ExamVersion!.SnapshotJson); }
        catch (JsonException) { return Conflict(new { message = "Phiên bản đề được phân không đọc được; vui lòng liên hệ Ban Tổ chức." }); }
        if (questions.Count == 0) return Conflict(new { message = "Phiên bản đề được phân không có câu hỏi." });
        ShuffleQuestions(questions);

        var closesAtUtc = DateTime.SpecifyKind(competition.ClosesAtUtc!.Value, DateTimeKind.Utc);
        var attempt = new ExamAttempt
        {
            CompetitionId = competitionId,
            ExamId = assignment.ExamId!.Value,
            UserId = user.Id,
            ExamVersionId = assignment.ExamVersionId!.Value,
            OwnerSessionId = session.Id,
            WriterTabId = TabId,
            WriterLeaseUntilUtc = now.AddSeconds(LeaseSeconds),
            StartedAtUtc = now,
            DeadlineAtUtc = now.AddMinutes(metadata.DurationMinutes) < closesAtUtc ? now.AddMinutes(metadata.DurationMinutes) : closesAtUtc,
            Questions = ToAttemptQuestions(questions)
        };
        db.ExamAttempts.Add(attempt);
        if (grant is not null)
            db.ExamAttemptSessionGrants.Remove(grant);
        await using var grantTransaction = grant is null ? null : await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            if (grant is not null)
            {
                var audit = await db.ExamAttemptAdminEvents.SingleAsync(item => item.AttemptId == grant.OldAttemptId
                    && item.Action == "ReplacementAuthorized" && item.ReplacementAttemptId == null, cancellationToken);
                audit.ReplacementAttemptId = attempt.Id;
                await db.SaveChangesAsync(cancellationToken);
                await grantTransaction!.CommitAsync(cancellationToken);
            }
        }
        catch (DbUpdateException)
        {
            if (grantTransaction is not null) await grantTransaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            var winner = await FindAttempt(competitionId, user.Id, cancellationToken);
            if (winner is null) throw;
            if (!await BindSession(winner.Id, cancellationToken)) return SessionConflict();
            if (winner.SubmittedAtUtc is null && winner.DeadlineAtUtc > clock.UtcNow
                && !await ClaimWriter(winner.Id, clock.UtcNow, cancellationToken)) return TabConflict();
            winner = await LoadAttempt(winner.Id, cancellationToken);
            return Ok(Packet(winner, clock.UtcNow));
        }
        var issuedAttempt = await LoadAttempt(attempt.Id, cancellationToken);
        return Ok(Packet(issuedAttempt, now));
    }

    [HttpPut("questions/{questionId:int}")]
    public async Task<IActionResult> SaveAnswer(int competitionId, int questionId, SaveAttemptAnswerRequest request, CancellationToken cancellationToken)
    {
        var userId = CurrentAccount.User(HttpContext).Id;
        if (!HasValidTabId()) return BadRequest(new { message = "Phiên tab làm bài không hợp lệ." });
        var assignment = await Assignment(competitionId, userId, cancellationToken);
        if (assignment is null || AssignmentRules.Metadata(assignment) is null)
            return NotFound(new { message = "Không tìm thấy cuộc thi hoặc đề được phân tham gia." });
        var attempt = await FindAttempt(competitionId, userId, cancellationToken);
        if (attempt is null) return Conflict(new { message = "Bạn chưa bắt đầu lượt thi." });
        if (attempt.OwnerSessionId != CurrentAccount.Session(HttpContext).Id) return SessionConflict();
        var now = clock.UtcNow;
        await FinalizeDueAttempt(attempt.Id, now, cancellationToken);
        attempt = await LoadAttempt(attempt.Id, cancellationToken);
        if (attempt.SubmittedAtUtc.HasValue) return Conflict(new { message = "Bài thi đã được nộp." });
        if (attempt.DeadlineAtUtc <= now) return Conflict(new { message = "Lượt thi đã hết thời gian và không thể thay đổi câu trả lời." });
        if (!HasValidTabId() || !await ClaimWriter(attempt.Id, now, cancellationToken)) return TabConflict();
        var question = attempt.Questions.SingleOrDefault(item => item.QuestionId == questionId);
        if (question is null) return NotFound(new { message = "Câu hỏi không thuộc lượt thi này." });
        var options = JsonSerializer.Deserialize<List<AttemptOption>>(question.OptionsOrderJson, Json) ?? [];
        if (!string.IsNullOrEmpty(request.Answer) && !options.Any(option => option.Key == request.Answer))
            return BadRequest(new { message = "Phương án trả lời không hợp lệ cho câu hỏi này." });
        var sessionId = CurrentAccount.Session(HttpContext).Id;
        var tabId = TabId!;
        var updated = await db.ExamAttemptQuestions.Where(item => item.AttemptId == attempt.Id && item.QuestionId == questionId
                && db.ExamAttempts.Any(owner => owner.Id == item.AttemptId && !owner.IsInvalidated
                    && owner.SubmittedAtUtc == null && owner.DeadlineAtUtc > now
                    && owner.OwnerSessionId == sessionId && owner.WriterTabId == tabId && owner.WriterLeaseUntilUtc > now))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Answer, string.IsNullOrEmpty(request.Answer) ? null : request.Answer)
                .SetProperty(item => item.IsMarked, request.IsMarked)
                .SetProperty(item => item.UpdatedAtUtc, now), cancellationToken);
        if (updated != 1)
        {
            var current = await db.ExamAttempts.AsNoTracking().SingleOrDefaultAsync(item => item.Id == attempt.Id, cancellationToken);
            if (current is null || current.IsInvalidated || current.SubmittedAtUtc.HasValue || current.DeadlineAtUtc <= now)
                return Conflict(new { message = "Lượt thi đã kết thúc hoặc không còn hợp lệ." });
            if (current.OwnerSessionId != sessionId) return SessionConflict();
            return TabConflict();
        }
        return Ok(new { saved = true, updatedAtUtc = CompetitionResponse.Utc(now) });
    }

    [HttpPost("lease")]
    public async Task<IActionResult> RenewLease(int competitionId, CancellationToken cancellationToken)
    {
        var userId = CurrentAccount.User(HttpContext).Id;
        if (!HasValidTabId()) return BadRequest(new { message = "Phiên tab làm bài không hợp lệ." });
        var attempt = await FindAttempt(competitionId, userId, cancellationToken);
        if (attempt is null) return Conflict(new { message = "Bạn chưa bắt đầu lượt thi." });
        if (attempt.OwnerSessionId != CurrentAccount.Session(HttpContext).Id) return SessionConflict();
        var now = clock.UtcNow;
        await FinalizeDueAttempt(attempt.Id, now, cancellationToken);
        if (attempt.SubmittedAtUtc.HasValue || attempt.DeadlineAtUtc <= now)
            return Conflict(new { message = "Lượt thi đã kết thúc." });
        return await ClaimWriter(attempt.Id, now, cancellationToken)
            ? Ok(new { leaseUntilUtc = CompetitionResponse.Utc(now.AddSeconds(LeaseSeconds)) })
            : TabConflict();
    }

    [HttpPost("submit")]
    public async Task<IActionResult> Submit(int competitionId, CancellationToken cancellationToken)
    {
        var userId = CurrentAccount.User(HttpContext).Id;
        if (!HasValidTabId()) return BadRequest(new { message = "Phiên tab làm bài không hợp lệ." });
        var assignment = await Assignment(competitionId, userId, cancellationToken);
        if (assignment is null || AssignmentRules.Metadata(assignment) is null)
            return NotFound(new { message = "Không tìm thấy cuộc thi hoặc đề được phân tham gia." });
        var attempt = await FindAttempt(competitionId, userId, cancellationToken);
        if (attempt is null) return Conflict(new { message = "Bạn chưa bắt đầu lượt thi." });
        if (attempt.OwnerSessionId != CurrentAccount.Session(HttpContext).Id) return SessionConflict();
        var now = clock.UtcNow;
        await FinalizeDueAttempt(attempt.Id, now, cancellationToken);
        attempt = await LoadAttempt(attempt.Id, cancellationToken);
        if (attempt.SubmittedAtUtc.HasValue) return Ok(Packet(attempt, now));
        if (!await ClaimWriter(attempt.Id, now, cancellationToken)) return TabConflict();
        var submitted = await db.ExamAttempts.Where(item => item.Id == attempt.Id && !item.IsInvalidated && item.SubmittedAtUtc == null
                && item.OwnerSessionId == CurrentAccount.Session(HttpContext).Id && item.WriterTabId == TabId
                && item.WriterLeaseUntilUtc > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.SubmittedAtUtc,
                item => item.DeadlineAtUtc <= now ? item.DeadlineAtUtc : now), cancellationToken);
        attempt = await LoadAttempt(attempt.Id, cancellationToken);
        if (submitted == 0 && !attempt.SubmittedAtUtc.HasValue)
        {
            if (attempt.OwnerSessionId != CurrentAccount.Session(HttpContext).Id) return SessionConflict();
            return TabConflict();
        }
        return Ok(Packet(attempt, now));
    }

    private Task<ExamAttempt?> FindAttempt(int competitionId, int userId, CancellationToken cancellationToken) =>
        db.ExamAttempts.AsNoTracking().Where(item => item.CompetitionId == competitionId && item.UserId == userId && !item.IsInvalidated)
            .OrderByDescending(item => item.Id).FirstOrDefaultAsync(cancellationToken);

    private Task<ExamAttempt> LoadAttempt(int attemptId, CancellationToken cancellationToken) =>
        db.ExamAttempts.AsNoTracking().Include(item => item.Questions).Include(item => item.ExamVersion)
            .SingleAsync(item => item.Id == attemptId, cancellationToken);

    private async Task<bool> BindSession(int attemptId, CancellationToken cancellationToken)
    {
        var sessionId = CurrentAccount.Session(HttpContext).Id;
        var attempt = await db.ExamAttempts.AsNoTracking().SingleAsync(item => item.Id == attemptId, cancellationToken);
        if (attempt.OwnerSessionId is not null) return attempt.OwnerSessionId == sessionId;
        await db.ExamAttempts.Where(item => item.Id == attemptId && item.OwnerSessionId == null && !item.IsInvalidated)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.OwnerSessionId, sessionId), cancellationToken);
        attempt = await db.ExamAttempts.AsNoTracking().SingleAsync(item => item.Id == attemptId, cancellationToken);
        return attempt.OwnerSessionId == sessionId;
    }

    private async Task<bool> ClaimWriter(int attemptId, DateTime now, CancellationToken cancellationToken)
    {
        var sessionId = CurrentAccount.Session(HttpContext).Id;
        var tabId = TabId!;
        var updated = await db.ExamAttempts.Where(item => item.Id == attemptId && !item.IsInvalidated
                && item.SubmittedAtUtc == null && item.DeadlineAtUtc > now && item.OwnerSessionId == sessionId
                && (item.WriterTabId == tabId || item.WriterLeaseUntilUtc == null || item.WriterLeaseUntilUtc <= now))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.WriterTabId, tabId)
                .SetProperty(item => item.WriterLeaseUntilUtc, now.AddSeconds(LeaseSeconds)), cancellationToken);
        if (updated == 1) return true;
        var attempt = await db.ExamAttempts.AsNoTracking().SingleOrDefaultAsync(item => item.Id == attemptId, cancellationToken);
        return attempt is not null && attempt.OwnerSessionId == sessionId && attempt.WriterTabId == tabId;
    }

    private async Task FinalizeDueAttempt(int attemptId, DateTime now, CancellationToken cancellationToken)
    {
        await db.ExamAttempts.Where(item => item.Id == attemptId && !item.IsInvalidated
                && item.SubmittedAtUtc == null && item.DeadlineAtUtc <= now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.SubmittedAtUtc, item => item.DeadlineAtUtc), cancellationToken);
    }

    private IActionResult SessionConflict() => Conflict(new { message = "Tài khoản đang có phiên làm bài" });
    private IActionResult TabConflict() => Conflict(new { message = "Bài thi đang được mở ở tab khác." });

    private static object NotStarted(CompetitionAssignment assignment, DateTime now, bool allowLateStart)
    {
        var competition = assignment.Competition;
        var canStart = AssignmentRules.ValidSchedule(competition) && competition.ClosesAtUtc > now
            && competition.OpensAtUtc <= now
            && (allowLateStart || competition.StartDeadlineUtc >= now);
        return new
        {
            attemptStatus = "NotStarted",
            canStart,
            startBlockedReason = canStart ? null : "Hiện không nằm trong thời gian được phép bắt đầu lượt thi.",
            serverNowUtc = CompetitionResponse.Utc(now),
            assignedExam = AssignmentRules.Metadata(assignment)
        };
    }

    private static object Packet(ExamAttempt attempt, DateTime now)
    {
        var status = attempt.SubmittedAtUtc.HasValue ? "Submitted" : attempt.DeadlineAtUtc <= now ? "Expired" : "InProgress";
        var questions = status == "InProgress" ? attempt.Questions.OrderBy(item => item.Position).Select(item =>
        {
            var snapshotQuestion = ReadSnapshotQuestion(attempt, item.QuestionId);
            var options = JsonSerializer.Deserialize<List<AttemptOption>>(item.OptionsOrderJson, Json) ?? [];
            return new
            {
                id = item.QuestionId,
                position = item.Position,
                type = snapshotQuestion.Type,
                content = snapshotQuestion.Content,
                options,
                item.Answer,
                item.IsMarked
            };
        }).ToList() : [];
        return new
        {
            attemptId = attempt.Id,
            attemptStatus = status,
            startedAtUtc = CompetitionResponse.Utc(attempt.StartedAtUtc),
            deadlineAtUtc = CompetitionResponse.Utc(attempt.DeadlineAtUtc),
            submittedAtUtc = CompetitionResponse.Utc(attempt.SubmittedAtUtc),
            serverNowUtc = CompetitionResponse.Utc(now),
            remainingSeconds = status == "InProgress" ? Math.Max(0, (int)Math.Ceiling((attempt.DeadlineAtUtc - now).TotalSeconds)) : 0,
            answeredCount = attempt.Questions.Count(item => !string.IsNullOrEmpty(item.Answer)),
            totalQuestionCount = attempt.Questions.Count,
            questions
        };
    }

    internal static List<AttemptQuestionSeed> ReadQuestions(string snapshotJson)
    {
        using var snapshot = JsonDocument.Parse(snapshotJson);
        var result = new List<AttemptQuestionSeed>();
        foreach (var question in snapshot.RootElement.GetProperty("questions").EnumerateArray())
        {
            var options = JsonSerializer.Deserialize<List<AttemptOption>>(question.GetProperty("options").GetRawText(), Json) ?? [];
            result.Add(new AttemptQuestionSeed
            {
                Id = question.GetProperty("id").GetInt32(),
                Type = question.GetProperty("type").GetString() ?? "",
                Content = question.GetProperty("content").GetString() ?? "",
                Options = options
            });
        }
        return result;
    }

    internal static List<ExamAttemptQuestion> ToAttemptQuestions(List<AttemptQuestionSeed> questions) =>
        questions.Select(question => new ExamAttemptQuestion
        {
            QuestionId = question.Id,
            Position = question.Position,
            OptionsOrderJson = JsonSerializer.Serialize(question.Options, Json)
        }).ToList();

    internal static void ShuffleQuestions(List<AttemptQuestionSeed> questions)
    {
        Shuffle(questions);
        for (var index = 0; index < questions.Count; index++)
        {
            Shuffle(questions[index].Options);
            questions[index].Position = index + 1;
        }
    }

    private static SnapshotQuestion ReadSnapshotQuestion(ExamAttempt attempt, int questionId)
    {
        using var snapshot = JsonDocument.Parse(attempt.ExamVersion.SnapshotJson);
        foreach (var question in snapshot.RootElement.GetProperty("questions").EnumerateArray())
        {
            if (question.GetProperty("id").GetInt32() != questionId) continue;
            return new SnapshotQuestion(question.GetProperty("type").GetString() ?? "", question.GetProperty("content").GetString() ?? "");
        }
        throw new InvalidOperationException("Attempt question was not present in its pinned approved version.");
    }

    private static void Shuffle<T>(IList<T> items)
    {
        for (var index = items.Count - 1; index > 0; index--)
        {
            var swap = RandomNumberGenerator.GetInt32(index + 1);
            (items[index], items[swap]) = (items[swap], items[index]);
        }
    }

    internal sealed class AttemptQuestionSeed
    {
        public int Id { get; init; }
        public int Position { get; set; }
        public string Type { get; init; } = "";
        public string Content { get; init; } = "";
        public List<AttemptOption> Options { get; init; } = [];
    }

    internal sealed record AttemptOption(string Key, string Text);
    private sealed record SnapshotQuestion(string Type, string Content);
}

/// <summary>Answer and review marker saved for one question in an active attempt.</summary>
public sealed record SaveAttemptAnswerRequest
{
    [MaxLength(20)]
    public string? Answer { get; init; }
    public bool IsMarked { get; init; }
}
