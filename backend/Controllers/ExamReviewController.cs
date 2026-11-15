using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;
namespace Quiz_TanHoa.Api.Controllers;
[ApiController, Route("api/organizer/competitions/{competitionId:int}/exams/{examId:int}"), Authorize(Policy = AppRoles.Organizer)]
public sealed class ExamReviewController(AppDbContext db) : ControllerBase
{
    [HttpGet("review-history")]
    public async Task<IActionResult> History(int competitionId, int examId)
    {
        if (!await db.Exams.AnyAsync(e => e.Id == examId && e.CompetitionId == competitionId)) return NotFound();
        return Ok((await db.WorkflowEvents.Where(e => e.ExamId == examId).OrderByDescending(e => e.Id).ToListAsync()).Select(e => new { e.Id, e.ExamId, e.ActorUserId, e.ActorName, e.Action, e.Note, e.DraftRevision, occurredAtUtc = CompetitionResponse.Utc(e.OccurredAtUtc) }));
    }
    [HttpPost("submit-review")]
    public async Task<IActionResult> Submit(int competitionId, int examId, ReviewRequest request)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var exam = await db.Exams.Include(e => e.Questions).SingleOrDefaultAsync(e => e.Id == examId && e.CompetitionId == competitionId);
        if (exam is null) return NotFound();
        var errors = ExamRules.Validate(exam);
        if (errors.Count > 0) return BadRequest(new { message = "Đề chưa đủ điều kiện gửi duyệt.", errors });
        if (exam.ReviewStatus == "PendingReview" || await db.ApprovedExamVersions.AnyAsync(v => v.ExamId == examId && v.DraftRevision == exam.DraftRevision)) return Conflict(new { message = "Đề đã duyệt hoặc đang chờ duyệt." });
        if (request.DraftRevision is not null && request.DraftRevision != exam.DraftRevision) return Conflict(new { message = "Bản nháp đã thay đổi. Hãy tải lại dữ liệu." });
        exam.ReviewStatus = "PendingReview"; exam.SubmittedRevision = exam.DraftRevision; exam.SubmittedByUserId = CurrentAccount.User(HttpContext).Id; exam.SubmittedAtUtc = DateTime.UtcNow; exam.ReviewNote = "";
        AddEvent(db, exam, CurrentAccount.User(HttpContext), "Submitted");
        await db.SaveChangesAsync(); await transaction.CommitAsync(); return Ok(ExamResponse.Profile(exam));
    }
    [HttpPost("withdraw-review")]
    [HttpPost("return-review")]
    public async Task<IActionResult> Return(int competitionId, int examId, ReviewRequest request)
    {
        var exam = await db.Exams.SingleOrDefaultAsync(e => e.Id == examId && e.CompetitionId == competitionId);
        if (exam is null) return NotFound();
        if (exam.ReviewStatus != "PendingReview") return Conflict(new { message = "Đề không ở trạng thái chờ duyệt." });
        var user = CurrentAccount.User(HttpContext); var returning = Request.Path.Value!.EndsWith("return-review", StringComparison.OrdinalIgnoreCase);
        if (!returning && exam.SubmittedByUserId != user.Id && !WorkflowAccess.Has(user, "manageUsers")) return StatusCode(403, new { message = "Chỉ người gửi hoặc quản trị viên được rút đề." });
        if (returning && string.IsNullOrWhiteSpace(request.Note)) return BadRequest(new { message = "Vui lòng nhập lý do trả lại." });
        exam.ReviewStatus = "Draft"; exam.ReviewNote = request.Note?.Trim() ?? ""; exam.UpdatedAtUtc = DateTime.UtcNow;
        AddEvent(db, exam, user, returning ? "Returned" : "Withdrawn", exam.ReviewNote); await db.SaveChangesAsync(); return Ok(ExamResponse.Profile(exam));
    }
    internal static void AddEvent(AppDbContext db, Exam exam, User user, string action, string note = "") => db.WorkflowEvents.Add(new WorkflowEvent { ExamId = exam.Id, ActorUserId = user.Id, ActorName = user.FullName, Action = action, Note = note, DraftRevision = exam.DraftRevision, OccurredAtUtc = DateTime.UtcNow });
}
public sealed class ReviewRequest { public int? DraftRevision { get; set; } [MaxLength(2000)] public string? Note { get; set; } }
