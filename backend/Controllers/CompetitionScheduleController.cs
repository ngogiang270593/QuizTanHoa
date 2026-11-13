using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/organizer/competitions/{competitionId:int}/schedule")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class CompetitionScheduleController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(int competitionId)
    {
        var competition = await db.Competitions.AsNoTracking().SingleOrDefaultAsync(item => item.Id == competitionId);
        return competition is null ? NotFound(new { message = "Không tìm thấy cuộc thi." }) : Ok(await Profile(competition));
    }

    [HttpPut]
    public async Task<IActionResult> Save(int competitionId, ScheduleWriteRequest request)
    {
        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == competitionId);
        if (competition is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        var opens = Parse(request.OpensAtLocal, "opensAtLocal");
        var deadline = Parse(request.StartDeadlineLocal, "startDeadlineLocal");
        var closes = Parse(request.ClosesAtLocal, "closesAtLocal");
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (opens >= deadline) ModelState.AddModelError("startDeadlineLocal", "Hạn bắt đầu phải sau ngày giờ mở thi.");
        if (closes <= opens) ModelState.AddModelError("closesAtLocal", "Ngày giờ đóng thi phải sau ngày giờ mở thi.");
        if (deadline > closes) ModelState.AddModelError("closesAtLocal", "Ngày giờ đóng thi không được sớm hơn hạn bắt đầu.");
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        competition.OpensAtUtc = opens;
        competition.StartDeadlineUtc = deadline;
        competition.ClosesAtUtc = closes;
        competition.UpdatedAtUtc = clock.UtcNow;
        await db.SaveChangesAsync();
        return Ok(await Profile(competition));
    }

    private DateTime? Parse(string? value, string field)
    {
        if (!DateTime.TryParseExact(value,
                ["dd/MM/yyyy HH:mm", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"],
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
        {
            ModelState.AddModelError(field, "Vui lòng nhập ngày giờ theo dạng dd/MM/yyyy HH:mm, theo giờ Việt Nam.");
            return null;
        }
        try { return clock.ScheduleLocalToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified)); }
        catch (ArgumentException error) { ModelState.AddModelError(field, error.Message); return null; }
    }

    private static string? Local(DateTime? value) => value.HasValue
        ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(value.Value, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(VietnamClock.TimeZoneId)).ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)
        : null;

    private async Task<object> Profile(Competition competition)
    {
        var exams = await db.Exams.AsNoTracking().Where(exam => exam.CompetitionId == competition.Id).ToListAsync();
        var available = competition.StartDeadlineUtc.HasValue && competition.ClosesAtUtc.HasValue
            ? (competition.ClosesAtUtc.Value - competition.StartDeadlineUtc.Value).TotalMinutes : (double?)null;
        var warnings = exams.Where(exam => available.HasValue && exam.DurationMinutes > available.Value).Select(exam => new
        {
            examId = exam.Id, examName = exam.Name, durationMinutes = exam.DurationMinutes,
            availableMinutes = Math.Max(0, available!.Value),
            message = $"Đề “{exam.Name}” có thời lượng {exam.DurationMinutes} phút. Người bắt đầu sát hạn chỉ còn khoảng {Math.Max(0, available!.Value):0.##} phút trước giờ đóng thi."
        }).ToList();
        return new
        {
            opensAtLocal = Local(competition.OpensAtUtc), startDeadlineLocal = Local(competition.StartDeadlineUtc), closesAtLocal = Local(competition.ClosesAtUtc),
            opensAtUtc = CompetitionResponse.Utc(competition.OpensAtUtc), startDeadlineUtc = CompetitionResponse.Utc(competition.StartDeadlineUtc), closesAtUtc = CompetitionResponse.Utc(competition.ClosesAtUtc),
            timeZone = VietnamClock.TimeZoneId, warnings
        };
    }
}
