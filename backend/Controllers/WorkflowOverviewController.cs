using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;
namespace Quiz_TanHoa.Api.Controllers;
[ApiController, Route("api/organizer/workflows"), Authorize(Policy = AppRoles.Organizer)]
public sealed class WorkflowOverviewController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var user = CurrentAccount.User(HttpContext);
        var competitions = await db.Competitions.AsNoTracking().OrderByDescending(c => c.UpdatedAtUtc).ThenByDescending(c => c.Id).ToListAsync();
        var exams = await db.Exams.AsNoTracking().Include(e => e.Competition).OrderByDescending(e => e.UpdatedAtUtc).ThenByDescending(e => e.Id).ToListAsync();
        var versions = await db.ApprovedExamVersions.Select(v => new { v.Id, v.DraftRevision }).ToListAsync();
        var metadata = exams.Select(e => new
        {
            e.Id, e.CompetitionId, e.Name, competitionName = e.Competition.Name, e.DraftRevision,
            isApproved = versions.Any(v => v.Id == e.CurrentApprovedVersionId && v.DraftRevision == e.DraftRevision),
            reviewStatus = versions.Any(v => v.Id == e.CurrentApprovedVersionId && v.DraftRevision == e.DraftRevision) ? "Approved" : e.ReviewStatus == "Returned" ? "Draft" : e.ReviewStatus,
            submittedAtUtc = CompetitionResponse.Utc(e.SubmittedAtUtc), updatedAtUtc = CompetitionResponse.Utc(e.UpdatedAtUtc), e.TargetQuestionCount, e.DurationMinutes, e.ReviewNote
        }).ToList();
        object? editorial = null, review = null, operations = null;
        if (WorkflowAccess.Has(user, "draft") || WorkflowAccess.Has(user, "submit"))
        {
            var bank = await db.QuestionBankQuestions.AsNoTracking().Where(q => q.IsActive).ToListAsync();
            editorial = new { questionCount = bank.Count, topicCount = bank.Select(q => !string.IsNullOrWhiteSpace(q.Topic) ? q.Topic.Trim() : q.Source.Split('|')[0].Trim()).Where(t => t.Length > 0).Distinct().Count(), exams = metadata };
        }
        if (WorkflowAccess.Has(user, "approve")) review = new { exams = metadata.Where(e => e.reviewStatus is "PendingReview" or "Approved") };
        if (WorkflowAccess.Has(user, "operate"))
        {
            var assignments = await db.CompetitionAssignments.AsNoTracking().ToListAsync();
            var attempts = await db.ExamAttempts.AsNoTracking().Where(a => !a.IsInvalidated).OrderBy(a => a.Id).ToListAsync();
            operations = competitions.Select(c =>
            {
                var assigned = assignments.Where(a => a.CompetitionId == c.Id).ToList();
                var states = attempts.Where(a => a.CompetitionId == c.Id && assigned.Any(r => r.UserId == a.UserId)).GroupBy(a => a.UserId).Select(g => AssignmentRules.AttemptStatus(g.Last(), DateTime.UtcNow)).ToList();
                var own = metadata.Where(e => e.CompetitionId == c.Id).ToList();
                return new { c.Id, c.Name, c.Status, updatedAtUtc = CompetitionResponse.Utc(c.UpdatedAtUtc), opensAtUtc = CompetitionResponse.Utc(c.OpensAtUtc), closesAtUtc = CompetitionResponse.Utc(c.ClosesAtUtc), startDeadlineUtc = CompetitionResponse.Utc(c.StartDeadlineUtc), examCount = own.Count, approvedExamCount = own.Count(e => e.isApproved), pendingExamCount = own.Count(e => e.reviewStatus == "PendingReview"), scheduleComplete = AssignmentRules.ValidSchedule(c), assignmentCount = assigned.Count, inProgressCount = states.Count(s => s == "InProgress"), submittedCount = states.Count(s => s == "Submitted"), expiredCount = states.Count(s => s == "Expired"), notStartedCount = assigned.Count - states.Count };
            }).ToList();
        }
        return Ok(new { serverTimeUtc = CompetitionResponse.Utc(DateTime.UtcNow), editorial, review, operations, approvedExams = WorkflowAccess.Has(user, "approve") || WorkflowAccess.Has(user, "operate") ? metadata.Where(e => e.isApproved).ToList() : null });
    }
}
