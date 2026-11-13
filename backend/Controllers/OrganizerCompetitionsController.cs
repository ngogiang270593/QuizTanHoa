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
        return Ok(competitions.Select(CompetitionResponse.Profile));
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
        db.ExamFieldGroups.AddRange(ExamSchemaUpgrade.CreateGroups(competition.Id));
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = competition.Id }, CompetitionResponse.Profile(competition));
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
    [Required(ErrorMessage = "Vui lòng nhập tên cuộc thi.")]
    [MaxLength(300, ErrorMessage = "Tên cuộc thi không được vượt quá 300 ký tự.")]
    public string Name { get; set; } = "";
    [MaxLength(5000, ErrorMessage = "Mô tả không được vượt quá 5.000 ký tự.")]
    public string? Description { get; set; }
    [MaxLength(20000, ErrorMessage = "Thể lệ không được vượt quá 20.000 ký tự.")]
    public string? Rules { get; set; }
}
