using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/organizer/competitions/{competitionId:int}/exams/{examId:int}/questions")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class ExamQuestionsController(AppDbContext db) : ControllerBase
{
    private Task<Exam?> ScopedExam(int competitionId, int examId) => db.Exams.SingleOrDefaultAsync(exam => exam.Id == examId && exam.CompetitionId == competitionId);

    [HttpGet]
    public async Task<IActionResult> List(int competitionId, int examId)
    {
        if (await ScopedExam(competitionId, examId) is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        var questions = await db.ExamQuestions.AsNoTracking().Where(question => question.ExamId == examId).OrderBy(question => question.Position).ThenBy(question => question.Id).ToListAsync();
        return Ok(questions.Select(ExamResponse.Question));
    }

    [HttpPost]
    public async Task<IActionResult> Create(int competitionId, int examId, QuestionWriteRequest request)
    {
        var exam = await ScopedExam(competitionId, examId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        if (!ValidateShape(request)) return ValidationProblem(ModelState);
        if (await db.ExamQuestions.CountAsync(question => question.ExamId == examId) >= 500) return BadRequest(new { message = "Mỗi đề hỗ trợ tối đa 500 câu hỏi." });
        var question = new ExamQuestion { ExamId = examId, Position = (await db.ExamQuestions.Where(question => question.ExamId == examId).MaxAsync(question => (int?)question.Position) ?? 0) + 1 };
        QuestionRules.Apply(question, request, CurrentAccount.User(HttpContext).Id);
        db.ExamQuestions.Add(question); ExamRules.TouchDraft(exam); await db.SaveChangesAsync();
        return StatusCode(201, ExamResponse.Question(question));
    }

    [HttpPost("from-bank")]
    public async Task<IActionResult> ImportFromBank(int competitionId, int examId, QuestionBankImportRequest request, CancellationToken cancellationToken)
    {
        var exam = await ScopedExam(competitionId, examId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        if (request.QuestionIds is null || request.QuestionIds.Count == 0 || request.QuestionIds.Count > 500)
            return BadRequest(new { message = "Chọn từ 1 đến 500 câu hỏi trong ngân hàng." });
        if (request.QuestionIds.Distinct().Count() != request.QuestionIds.Count)
            return BadRequest(new { message = "Danh sách câu hỏi bị lặp." });

        var bankQuestions = await db.QuestionBankQuestions
            .Where(question => question.IsActive && request.QuestionIds.Contains(question.Id))
            .ToListAsync(cancellationToken);
        if (bankQuestions.Count != request.QuestionIds.Count)
            return BadRequest(new { message = "Một hoặc nhiều câu hỏi không còn hoạt động trong ngân hàng." });
        var existingCount = await db.ExamQuestions.CountAsync(question => question.ExamId == examId, cancellationToken);
        if (existingCount + bankQuestions.Count > 500)
            return BadRequest(new { message = "Mỗi đề hỗ trợ tối đa 500 câu hỏi." });

        var position = await db.ExamQuestions.Where(question => question.ExamId == examId)
            .MaxAsync(question => (int?)question.Position, cancellationToken) ?? 0;
        var added = bankQuestions.Select(bankQuestion =>
        {
            var question = new ExamQuestion { ExamId = examId, BankQuestionId = bankQuestion.Id, Position = ++position };
            QuestionBankController.CopyFields(bankQuestion, question);
            return question;
        }).ToList();
        db.ExamQuestions.AddRange(added);
        ExamRules.TouchDraft(exam);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(added.Select(ExamResponse.Question));
    }

    [HttpPut("{questionId:int}")]
    public async Task<IActionResult> Update(int competitionId, int examId, int questionId, QuestionWriteRequest request)
    {
        var exam = await ScopedExam(competitionId, examId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        var question = await db.ExamQuestions.SingleOrDefaultAsync(question => question.Id == questionId && question.ExamId == examId);
        if (question is null) return NotFound(new { message = "Không tìm thấy câu hỏi trong đề thi." });
        if (!ValidateShape(request)) return ValidationProblem(ModelState);
        QuestionRules.Apply(question, request, CurrentAccount.User(HttpContext).Id);
        ExamRules.TouchDraft(exam); await db.SaveChangesAsync();
        return Ok(ExamResponse.Question(question));
    }

    [HttpDelete("{questionId:int}")]
    public async Task<IActionResult> Delete(int competitionId, int examId, int questionId)
    {
        var exam = await ScopedExam(competitionId, examId);
        if (exam is null) return NotFound(new { message = "Không tìm thấy đề thi trong cuộc thi." });
        var question = await db.ExamQuestions.SingleOrDefaultAsync(question => question.Id == questionId && question.ExamId == examId);
        if (question is null) return NotFound(new { message = "Không tìm thấy câu hỏi trong đề thi." });
        db.ExamQuestions.Remove(question); ExamRules.TouchDraft(exam); await db.SaveChangesAsync();
        return NoContent();
    }

    private bool ValidateShape(QuestionWriteRequest request)
    {
        if (request.Type is not ("SingleChoice" or "TrueFalse")) ModelState.AddModelError("type", "Vui lòng chọn loại câu hỏi hợp lệ.");
        if (request.Group is not ("Common" or "Specialized")) ModelState.AddModelError("group", "Vui lòng chọn nhóm Kiến thức chung hoặc Chuyên môn.");
        if (request.Options is null || request.Options.Count > 6 || request.Options.Any(option => option is null || (option.Key?.Length ?? 0) > 20 || (option.Text?.Length ?? 0) > 2000)) ModelState.AddModelError("options", "Tối đa 6 phương án; mã tối đa 20 ký tự và nội dung tối đa 2.000 ký tự.");
        return ModelState.IsValid;
    }
}
