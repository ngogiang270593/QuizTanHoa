using System.Xml;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/organizer/competitions/{competitionId:int}/exams/{examId:int}")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class ExcelQuestionImportController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    [HttpGet("import-template")]
    public async Task<IActionResult> Template(int competitionId, int examId)
    {
        if (!await db.Exams.AnyAsync(exam => exam.Id == examId && exam.CompetitionId == competitionId))
            return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi này." });
        return File(QuestionWorkbook.CreateTemplate(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "MauNhapCauHoi_TanHoa.xlsx");
    }

    [HttpPost("import-preview")]
    [RequestSizeLimit(QuestionWorkbook.MaxFileBytes + 128 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = QuestionWorkbook.MaxFileBytes)]
    public async Task<IActionResult> Preview(int competitionId, int examId, [FromForm] IFormFile? file)
    {
        if (!await db.Exams.AnyAsync(exam => exam.Id == examId && exam.CompetitionId == competitionId))
            return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi này." });
        var (preview, error) = await Parse(file);
        return error is not null ? BadRequest(new { message = error }) : Ok(preview);
    }

    [HttpPost("import")]
    [RequestSizeLimit(QuestionWorkbook.MaxFileBytes + 128 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = QuestionWorkbook.MaxFileBytes)]
    public async Task<IActionResult> Import(int competitionId, int examId, [FromForm] IFormFile? file)
    {
        var exam = await db.Exams.SingleOrDefaultAsync(item => item.Id == examId && item.CompetitionId == competitionId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi này." });
        // Re-read and validate the original workbook; never trust client-side preview rows.
        var (preview, error) = await Parse(file);
        if (error is not null) return BadRequest(new { message = error });
        if (!preview!.CanImport) return BadRequest(preview);
        await using var transaction = await db.Database.BeginTransactionAsync();
        var count = await db.ExamQuestions.CountAsync(question => question.ExamId == examId);
        if (count + preview.TotalRows > QuestionWorkbook.MaxRows)
            return BadRequest(new { message = $"Một đề thi chỉ lưu tối đa {QuestionWorkbook.MaxRows} câu. Hiện có {count} câu, tệp có {preview.TotalRows} câu." });
        var position = await db.ExamQuestions.Where(question => question.ExamId == examId).Select(question => (int?)question.Position).MaxAsync() ?? 0;
        var reviewerId = CurrentAccount.User(HttpContext).Id;
        foreach (var row in preview.Rows)
        {
            var question = new ExamQuestion { ExamId = examId, Position = ++position };
            QuestionRules.Apply(question, row.Question, reviewerId);
            db.ExamQuestions.Add(question);
        }
        exam.DraftRevision++;
        exam.UpdatedAtUtc = clock.UtcNow;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok(new { message = $"Đã nhập {preview.TotalRows} câu hỏi vào bản nháp.", importedCount = preview.TotalRows, draftRevision = exam.DraftRevision,
            warnings = preview.Rows.SelectMany(row => row.Warnings.Select(message => new { rowNumber = row.RowNumber, message })).ToArray() });
    }

    private static async Task<(QuestionImportPreview? Preview, string? Error)> Parse(IFormFile? file)
    {
        if (file is null || file.Length == 0) return (null, "Vui lòng chọn tệp Excel .xlsx có dữ liệu.");
        if (!Path.GetExtension(file.FileName).Equals(".xlsx", StringComparison.OrdinalIgnoreCase)) return (null, "Chỉ hỗ trợ tệp .xlsx theo mẫu tải từ hệ thống.");
        if (file.Length > QuestionWorkbook.MaxFileBytes) return (null, "Tệp Excel không được lớn hơn 5 MB.");
        try
        {
            using var stream = new MemoryStream();
            await file.CopyToAsync(stream);
            stream.Position = 0;
            return (WorkbookQuestions.Preview(stream), null);
        }
        catch (Exception error) when (error is InvalidDataException or XmlException or FormatException or ArgumentException or OverflowException)
        {
            return (null, error is InvalidDataException ? error.Message : "Không đọc được dữ liệu Excel. Hãy dùng tệp .xlsx hợp lệ theo mẫu của hệ thống.");
        }
    }
}
