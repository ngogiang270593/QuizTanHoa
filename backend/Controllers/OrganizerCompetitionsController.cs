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
[Route("api/organizer/competitions")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class OrganizerCompetitionsController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var competitions = await db.Competitions.AsNoTracking()
            .OrderByDescending(competition => competition.UpdatedAtUtc).ThenByDescending(competition => competition.Id)
            .ToListAsync();
        return Ok(competitions.Select(c => CompetitionResponse.Profile(c)));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var competition = await db.Competitions.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id);
        return competition is null ? NotFound(new { message = "Không tìm thấy cuộc thi." }) : Ok(CompetitionResponse.Profile(competition));
    }

    [HttpPost]
    public async Task<IActionResult> Create(CompetitionWriteRequest request)
    {
        if (!ValidateName(request.Name)) return ValidationProblem(ModelState);
        var selected = new List<QuestionBankQuestion>();
        if (request.InitialExam is { } initial)
        {
            if (initial.Topics is { Count: > 0 })
            {
                if (initial.QuestionIds is { Count: > 0 } || initial.Topics.Count > 400 || initial.Topics.Select(t => t.Topic.Trim()).Distinct().Count() != initial.Topics.Count)
                    return BadRequest(new { message = "Chủ đề không được trùng hoặc kết hợp với chọn câu thủ công." });
                var all = await db.QuestionBankQuestions.Where(q => q.IsActive).ToListAsync();
                foreach (var quota in initial.Topics)
                {
                    var pool = all.Where(q => TopicLabel(q) == quota.Topic.Trim()).ToList();
                    if (quota.Count < 1 || quota.Count > pool.Count)
                        return BadRequest(new { message = $"Chủ đề {quota.Topic} chỉ có {pool.Count} câu; vui lòng chọn số câu phù hợp." });
                    selected.AddRange(pool.OrderBy(_ => System.Security.Cryptography.RandomNumberGenerator.GetInt32(int.MaxValue)).Take(quota.Count));
                }
                initial.QuestionIds = selected.Select(q => q.Id).ToList();
            }
            if (initial.QuestionIds is null || initial.QuestionIds.Count is < 1 or > 400 || initial.QuestionIds.Distinct().Count() != initial.QuestionIds.Count)
                return BadRequest(new { message = "Chọn từ 1 đến 400 câu hỏi, không trùng nhau." });
            var bank = await db.QuestionBankQuestions.Where(q => q.IsActive && initial.QuestionIds.Contains(q.Id)).ToListAsync();
            if (bank.Count != initial.QuestionIds.Count) return BadRequest(new { message = "Một hoặc nhiều câu hỏi không còn hoạt động." });
            selected = initial.QuestionIds.Select(id => bank.Single(q => q.Id == id)).ToList();
        }
        await using var transaction = await db.Database.BeginTransactionAsync();
        var now = clock.UtcNow;
        var competition = new Competition
        {
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? "",
            Rules = request.Rules?.Trim() ?? "",
            Status = CompetitionStatuses.Draft,
            IsDemo = CurrentAccount.User(HttpContext).IsDemo,
            CreatedByUserId = CurrentAccount.User(HttpContext).Id,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };
        db.Competitions.Add(competition);
        await db.SaveChangesAsync();
        var groups = ExamSchemaUpgrade.CreateGroups(competition.Id).ToList();
        db.ExamFieldGroups.AddRange(groups);
        await db.SaveChangesAsync();
        Exam? exam = null;
        if (request.InitialExam is { } setup)
        {
            exam = new Exam { CompetitionId = competition.Id, FieldGroupId = groups[0].Id, Name = string.IsNullOrWhiteSpace(setup.Name) ? "Đề thi chính" : setup.Name.Trim(), DurationMinutes = setup.DurationMinutes, TargetQuestionCount = selected.Count, CommonQuestionCount = selected.Count(q => q.Group == "Common"), SpecializedQuestionCount = selected.Count(q => q.Group == "Specialized"), IsDemo = competition.IsDemo, CreatedAtUtc = now, UpdatedAtUtc = now };
            db.Exams.Add(exam); await db.SaveChangesAsync();
            var position = 0;
            foreach (var bank in selected)
            {
                var question = new ExamQuestion { ExamId = exam.Id, BankQuestionId = bank.Id, Position = ++position };
                QuestionBankController.CopyFields(bank, question); db.ExamQuestions.Add(question);
            }
            await db.SaveChangesAsync();
        }
        await transaction.CommitAsync();
        return CreatedAtAction(nameof(Get), new { id = competition.Id }, CompetitionResponse.Profile(competition, exam?.Id, selected.Count));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, CompetitionWriteRequest request)
    {
        if (!ValidateName(request.Name)) return ValidationProblem(ModelState);
        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == id);
        if (competition is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        var rules = request.Rules?.Trim() ?? "";
        // A content edit never changes publication, schedule, assignments or demo identity.
        competition.Name = request.Name.Trim();
        competition.Description = request.Description?.Trim() ?? "";
        competition.Rules = rules;
        competition.UpdatedAtUtc = clock.UtcNow;
        await db.SaveChangesAsync();
        return Ok(CompetitionResponse.Profile(competition));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (competition is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (competition.Status != CompetitionStatuses.Draft)
            return Conflict(new { message = "Chỉ có thể xóa cuộc thi đang ở trạng thái nháp." });
        if (await db.ExamAttempts.AnyAsync(attempt => attempt.CompetitionId == id, cancellationToken))
            return Conflict(new { message = "Không thể xóa cuộc thi đã có lượt thi; dữ liệu lịch sử phải được giữ lại." });

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Competitions.Where(item => item.Id == id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsDeleting, true), cancellationToken);
        await db.CompetitionAssignments.Where(assignment => assignment.CompetitionId == id).ExecuteDeleteAsync(cancellationToken);
        await db.Exams.Where(exam => exam.CompetitionId == id)
            .ExecuteUpdateAsync(update => update.SetProperty(exam => exam.CurrentApprovedVersionId, (int?)null), cancellationToken);
        await db.ApprovedExamVersions.Where(version => version.Exam.CompetitionId == id).ExecuteDeleteAsync(cancellationToken);
        db.Competitions.Remove(competition);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return NoContent();
    }

    private static string TopicLabel(QuestionBankQuestion q) => !string.IsNullOrWhiteSpace(q.Topic) ? q.Topic.Trim() : !string.IsNullOrWhiteSpace(q.Source) ? q.Source.Split('|')[0].Trim() : "Chưa phân chủ đề";

    private bool ValidateName(string? name)
    {
        if (!string.IsNullOrWhiteSpace(name)) return true;
        ModelState.AddModelError(nameof(CompetitionWriteRequest.Name), "Vui lòng nhập tên cuộc thi.");
        return false;
    }
}

// Only content fields bind from a request. Clients cannot grant publication or participation.
public sealed class CompetitionWriteRequest
{
    public InitialExamRequest? InitialExam { get; set; }
    [Required(ErrorMessage = "Vui lòng nhập tên cuộc thi.")]
    [MaxLength(300, ErrorMessage = "Tên cuộc thi không được vượt quá 300 ký tự.")]
    public string Name { get; set; } = "";
    [MaxLength(5000, ErrorMessage = "Mô tả không được vượt quá 5.000 ký tự.")]
    public string? Description { get; set; }
    [MaxLength(20000, ErrorMessage = "Thể lệ không được vượt quá 20.000 ký tự.")]
    public string? Rules { get; set; }
}

public sealed class InitialExamRequest
{
    public List<TopicQuotaRequest>? Topics { get; set; }
    [MaxLength(300)] public string Name { get; set; } = "Đề thi chính";
    [Range(1, 480)] public int DurationMinutes { get; set; } = 30;
    public List<int> QuestionIds { get; set; } = [];
}

public sealed class TopicQuotaRequest
{
    [Required, MaxLength(2000)] public string Topic { get; set; } = "";
    [Range(1,400)] public int Count { get; set; }
}
