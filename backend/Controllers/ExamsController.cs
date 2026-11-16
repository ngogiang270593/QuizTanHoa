using System.Security.Cryptography;
using System.Text;
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
[Route("api/organizer/competitions/{competitionId:int}/exams")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class ExamsController(AppDbContext db) : ControllerBase
{
    private IQueryable<Exam> InCompetition(int competitionId) => db.Exams.Include(exam => exam.Competition).Include(exam => exam.FieldGroup).Include(exam => exam.Questions).Where(exam => exam.CompetitionId == competitionId);
    private async Task<ApprovedExamVersion?> Approved(Exam exam) => exam.CurrentApprovedVersionId.HasValue ? await db.ApprovedExamVersions.AsNoTracking().SingleOrDefaultAsync(version => version.Id == exam.CurrentApprovedVersionId && version.ExamId == exam.Id) : null;

    [HttpGet]
    public async Task<IActionResult> List(int competitionId)
    {
        if (!await db.Competitions.AnyAsync(competition => competition.Id == competitionId)) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        var exams = await InCompetition(competitionId).AsNoTracking().OrderBy(exam => exam.Id).ToListAsync();
        var result = new List<object>();
        foreach (var exam in exams) result.Add(ExamResponse.Profile(exam, await Approved(exam)));
        return Ok(result);
    }

    [HttpGet("{examId:int}")]
    public async Task<IActionResult> Get(int competitionId, int examId)
    {
        var exam = await InCompetition(competitionId).AsNoTracking().SingleOrDefaultAsync(exam => exam.Id == examId);
        return exam is null ? NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." }) : Ok(ExamResponse.Profile(exam, await Approved(exam)));
    }

    [HttpPost]
    public async Task<IActionResult> Create(int competitionId, ExamWriteRequest request)
    {
        var competition = await db.Competitions.AsNoTracking().SingleOrDefaultAsync(competition => competition.Id == competitionId);
        if (competition is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (!await ValidateRequest(competitionId, request)) return ValidationProblem(ModelState);
        var exam = new Exam { CompetitionId = competitionId, IsDemo = competition.IsDemo, CreatedAtUtc = DateTime.UtcNow, UpdatedAtUtc = DateTime.UtcNow };
        Apply(exam, request);
        db.Exams.Add(exam); await db.SaveChangesAsync();
        await db.Entry(exam).Reference(item => item.FieldGroup).LoadAsync();
        return CreatedAtAction(nameof(Get), new { competitionId, examId = exam.Id }, ExamResponse.Profile(exam));
    }

    [HttpPut("{examId:int}")]
    public async Task<IActionResult> Update(int competitionId, int examId, ExamWriteRequest request)
    {
        var exam = await InCompetition(competitionId).SingleOrDefaultAsync(exam => exam.Id == examId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        if (!await ValidateRequest(competitionId, request)) return ValidationProblem(ModelState);
        Apply(exam, request); ExamRules.TouchDraft(exam);
        await db.SaveChangesAsync();
        await db.Entry(exam).Reference(item => item.FieldGroup).LoadAsync();
        return Ok(ExamResponse.Profile(exam, await Approved(exam)));
    }

    private static void Apply(Exam exam, ExamWriteRequest request)
    {
        exam.Name = request.Name.Trim(); exam.FieldGroupId = request.FieldGroupId; exam.DurationMinutes = request.DurationMinutes;
        exam.TargetQuestionCount = request.TargetQuestionCount; exam.CommonQuestionCount = request.CommonQuestionCount; exam.SpecializedQuestionCount = request.SpecializedQuestionCount;
    }

    private async Task<bool> ValidateRequest(int competitionId, ExamWriteRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) ModelState.AddModelError("name", "Vui lòng nhập tên đề thi.");
        if (!await db.ExamFieldGroups.AnyAsync(group => group.Id == request.FieldGroupId && group.CompetitionId == competitionId)) ModelState.AddModelError("fieldGroupId", "Nhóm lĩnh vực không thuộc cuộc thi này.");
        return ModelState.IsValid;
    }

    [HttpGet("{examId:int}/preview")]
    public async Task<IActionResult> Preview(int competitionId, int examId)
    {
        var exam = await InCompetition(competitionId).AsNoTracking().SingleOrDefaultAsync(exam => exam.Id == examId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        var errors = ExamRules.Validate(exam);
        return Ok(new { exam = ExamResponse.Profile(exam, await Approved(exam)), questions = exam.Questions.OrderBy(question => question.Position).ThenBy(question => question.Id).Select(ExamResponse.Question), validation = new { canApprove = errors.Count == 0, errors, warnings = Array.Empty<ValidationIssue>() } });
    }

    [HttpPost("{examId:int}/approve")]
    public async Task<IActionResult> Approve(int competitionId, int examId, [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] ReviewRequest? request = null)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var exam = await InCompetition(competitionId).SingleOrDefaultAsync(exam => exam.Id == examId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        var errors = ExamRules.Validate(exam);
        if (errors.Count > 0) return BadRequest(new { message = "Chưa thể duyệt đề. Vui lòng sửa các lỗi được chỉ rõ.", canApprove = false, errors });
        var existing = await db.ApprovedExamVersions.AsNoTracking().SingleOrDefaultAsync(version => version.ExamId == exam.Id && version.DraftRevision == exam.DraftRevision);
        if (existing is not null) return Ok(ExamResponse.Version(existing));
        if (exam.ReviewStatus != "PendingReview" || exam.SubmittedRevision != exam.DraftRevision) return Conflict(new { message = "Đề phải được gửi chờ duyệt trước khi duyệt." });
        if (string.IsNullOrWhiteSpace(request?.Note)) return BadRequest(new { message = "Vui lòng nhập ghi chú duyệt." });
        var note = request.Note.Trim();
        var now = DateTime.UtcNow;
        var snapshot = new
        {
            schemaVersion = 1,
            exam = new { exam.Id, exam.CompetitionId, exam.Name, exam.FieldGroupId, fieldGroupName = exam.FieldGroup.Name, exam.DurationMinutes, exam.TargetQuestionCount, exam.CommonQuestionCount, exam.SpecializedQuestionCount, exam.IsDemo },
            questions = exam.Questions.OrderBy(question => question.Position).ThenBy(question => question.Id).Select(ExamResponse.Question).ToList(),
            approvedAtUtc = now
        };
        var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var version = new ApprovedExamVersion
        {
            ExamId = exam.Id, DraftRevision = exam.DraftRevision,
            VersionNumber = (await db.ApprovedExamVersions.Where(item => item.ExamId == exam.Id).MaxAsync(item => (int?)item.VersionNumber) ?? 0) + 1,
            SnapshotJson = json, HashSha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant(),
            ApprovedAtUtc = now, ApprovedByUserId = CurrentAccount.User(HttpContext).Id
        };
        db.ApprovedExamVersions.Add(version); await db.SaveChangesAsync();
        var provisionalAssignments = await db.CompetitionAssignments.Where(item => item.CompetitionId == competitionId && item.ExamId == exam.Id && item.ExamVersionId == null).ToListAsync();
        foreach (var assignment in provisionalAssignments) assignment.ExamVersionId = version.Id;
        exam.CurrentApprovedVersionId = version.Id; exam.ReviewStatus = "Approved"; exam.ReviewNote = note;
        ExamReviewController.AddEvent(db, exam, CurrentAccount.User(HttpContext), "Approved", note); await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok(ExamResponse.Version(version));
    }

    [HttpGet("{examId:int}/versions")]
    public async Task<IActionResult> Versions(int competitionId, int examId)
    {
        if (!await db.Exams.AnyAsync(exam => exam.Id == examId && exam.CompetitionId == competitionId)) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        var versions = await db.ApprovedExamVersions.AsNoTracking().Where(version => version.ExamId == examId).OrderByDescending(version => version.VersionNumber).ToListAsync();
        return Ok(versions.Select(version => ExamResponse.Version(version, false)));
    }

    [HttpGet("{examId:int}/versions/{versionId:int}")]
    public async Task<IActionResult> Version(int competitionId, int examId, int versionId)
    {
        var version = await db.ApprovedExamVersions.AsNoTracking().Include(item => item.Exam).SingleOrDefaultAsync(version => version.Id == versionId && version.ExamId == examId && version.Exam.CompetitionId == competitionId);
        return version is null ? NotFound(new { message = "Không tìm thấy phiên bản đề đã duyệt." }) : Ok(ExamResponse.Version(version));
    }
}
