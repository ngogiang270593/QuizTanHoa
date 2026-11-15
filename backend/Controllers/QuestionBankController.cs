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
[Route("api/organizer/question-bank")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class QuestionBankController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    [HttpPost("set-topic")]
    public async Task<IActionResult> SetTopic(BankTopicRequest request)
    {
        if (request.QuestionIds is null || request.QuestionIds.Count is < 1 or > 400 || request.QuestionIds.Distinct().Count() != request.QuestionIds.Count)
            return BadRequest(new { message = "Chọn từ 1 đến 400 câu hỏi khác nhau." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var topic = await db.QuestionTopics.SingleOrDefaultAsync(t => t.Id == request.TopicId);
        if (topic is null) return NotFound(new { message = "Chủ đề không tồn tại." });
        var selected = await db.QuestionBankQuestions.Where(q => q.IsActive && request.QuestionIds.Contains(q.Id)).ToListAsync();
        if (selected.Count != request.QuestionIds.Count) return NotFound(new { message = "Một hoặc nhiều câu hỏi không còn hoạt động." });
        foreach (var q in selected) { q.Topic = topic.Name; q.UpdatedAtUtc = clock.UtcNow; }
        var linked = await db.ExamQuestions.Include(q => q.Exam).Where(q => request.QuestionIds.Contains(q.BankQuestionId ?? 0)).ToListAsync();
        foreach (var q in linked) q.Topic = topic.Name;
        foreach (var exam in linked.Select(q => q.Exam).DistinctBy(e => e.Id)) ExamRules.TouchDraft(exam);
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        return Ok(new { updatedCount = selected.Count });
    }
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? search, [FromQuery] string? group, [FromQuery] string? topic, CancellationToken cancellationToken)
    {
        var questions = db.QuestionBankQuestions.AsNoTracking().Where(question => question.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim();
            questions = questions.Where(question => EF.Functions.Like(question.Content, $"%{value}%"));
        }
        if (!string.IsNullOrWhiteSpace(group))
            questions = questions.Where(question => question.Group == group);

        var results = await questions.OrderByDescending(question => question.UpdatedAtUtc).ThenBy(question => question.Id)
            .Select(question => new
            {
                question.Id, question.Topic, question.Type, question.Content, question.OptionsJson, question.CorrectAnswer,
                question.Points, question.IsScenario, question.Explanation, question.Source, question.Group,
                question.RequiresSourceReview, question.SourceReviewed, question.ReviewedByUserId,
                question.ReviewedAtUtc, question.IsActive, question.CreatedAtUtc, question.UpdatedAtUtc,
                linkedDraftCount = db.ExamQuestions.Count(linked => linked.BankQuestionId == question.Id)
            }).ToListAsync(cancellationToken);
        return Ok(results.Where(item => string.IsNullOrWhiteSpace(topic) || (!string.IsNullOrWhiteSpace(item.Topic) ? item.Topic.Trim() : !string.IsNullOrWhiteSpace(item.Source) ? item.Source.Split('|')[0].Trim() : "Chưa phân chủ đề") == topic).Select(item => new
        {
            item.Id, item.Topic, item.Type, item.Content, options = DeserializeOptions(item.OptionsJson), item.CorrectAnswer,
            item.Points, item.IsScenario, item.Explanation, item.Source, item.Group, item.RequiresSourceReview,
            item.SourceReviewed, item.ReviewedByUserId,
            reviewedAtUtc = CompetitionResponse.Utc(item.ReviewedAtUtc),
            item.IsActive, createdAtUtc = CompetitionResponse.Utc(item.CreatedAtUtc),
            updatedAtUtc = CompetitionResponse.Utc(item.UpdatedAtUtc), item.linkedDraftCount
        }));
    }

    [HttpPost]
    public async Task<IActionResult> Create(QuestionWriteRequest request, CancellationToken cancellationToken)
    {
        if (!ValidateShape(request)) return ValidationProblem(ModelState);
        var now = clock.UtcNow;
        var draft = new ExamQuestion();
        QuestionRules.Apply(draft, request, CurrentAccount.User(HttpContext).Id);
        var question = CopyToBank(draft, CurrentAccount.User(HttpContext).Id, now);
        question.Topic = request.Topic?.Trim() ?? "";
        db.QuestionBankQuestions.Add(question);
        await db.SaveChangesAsync(cancellationToken);
        return StatusCode(201, ExamResponse.Question(question));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, QuestionWriteRequest request, CancellationToken cancellationToken)
    {
        if (!ValidateShape(request)) return ValidationProblem(ModelState);
        var question = await db.QuestionBankQuestions.SingleOrDefaultAsync(item => item.Id == id && item.IsActive, cancellationToken);
        if (question is null) return NotFound(new { message = "Không tìm thấy câu hỏi đang hoạt động trong ngân hàng." });

        var draft = new ExamQuestion();
        QuestionRules.Apply(draft, request, CurrentAccount.User(HttpContext).Id);
        CopyFields(draft, question);
        question.Topic = request.Topic?.Trim() ?? "";
        question.UpdatedAtUtc = clock.UtcNow;

        var linkedQuestions = await db.ExamQuestions.Include(item => item.Exam)
            .Where(item => item.BankQuestionId == id).ToListAsync(cancellationToken);
        foreach (var linked in linkedQuestions) CopyFields(question, linked);
        foreach (var exam in linkedQuestions.Select(item => item.Exam).DistinctBy(item => item.Id))
            ExamRules.TouchDraft(exam);

        await db.SaveChangesAsync(cancellationToken);
        return Ok(ExamResponse.Question(question));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var question = await db.QuestionBankQuestions.SingleOrDefaultAsync(item => item.Id == id && item.IsActive, cancellationToken);
        if (question is null) return NotFound(new { message = "Không tìm thấy câu hỏi đang hoạt động trong ngân hàng." });
        question.IsActive = false;
        question.UpdatedAtUtc = clock.UtcNow;

        var linkedQuestions = await db.ExamQuestions.Include(item => item.Exam)
            .Where(item => item.BankQuestionId == id).ToListAsync(cancellationToken);
        foreach (var linked in linkedQuestions)
        {
            linked.BankQuestionId = null;
        }
        foreach (var exam in linkedQuestions.Select(item => item.Exam).DistinctBy(item => item.Id))
            ExamRules.TouchDraft(exam);

        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private bool ValidateShape(QuestionWriteRequest request)
    {
        if (request.Type is not ("SingleChoice" or "TrueFalse")) ModelState.AddModelError("type", "Vui lòng chọn loại câu hỏi hợp lệ.");
        if (request.Options is null || request.Options.Count > 6 || request.Options.Any(option => option is null || (option.Key?.Length ?? 0) > 20 || (option.Text?.Length ?? 0) > 2000))
            ModelState.AddModelError("options", "Tối đa 6 phương án; mã tối đa 20 ký tự và nội dung tối đa 2.000 ký tự.");
        return ModelState.IsValid;
    }

    private static QuestionBankQuestion CopyToBank(ExamQuestion source, int userId, DateTime now) => new()
    {
        Type = source.Type,
        Content = source.Content,
        OptionsJson = source.OptionsJson,
        CorrectAnswer = source.CorrectAnswer,
        Points = source.Points,
        IsScenario = source.IsScenario,
        Explanation = source.Explanation,
        Source = source.Source,
        Group = source.Group,
        RequiresSourceReview = source.RequiresSourceReview,
        SourceReviewed = source.SourceReviewed,
        ReviewedByUserId = source.ReviewedByUserId,
        ReviewedAtUtc = source.ReviewedAtUtc,
        IsActive = true,
        CreatedByUserId = userId,
        CreatedAtUtc = now,
        UpdatedAtUtc = now
    };

    internal static void CopyFields(QuestionBankQuestion source, ExamQuestion target)
    {
        target.Topic = source.Topic;
        target.Type = source.Type;
        target.Content = source.Content;
        target.OptionsJson = source.OptionsJson;
        target.CorrectAnswer = source.CorrectAnswer;
        target.Points = source.Points;
        target.IsScenario = source.IsScenario;
        target.Explanation = source.Explanation;
        target.Source = source.Source;
        target.Group = source.Group;
        target.RequiresSourceReview = source.RequiresSourceReview;
        target.SourceReviewed = source.SourceReviewed;
        target.ReviewedByUserId = source.ReviewedByUserId;
        target.ReviewedAtUtc = source.ReviewedAtUtc;
    }

    internal static void CopyFields(ExamQuestion source, QuestionBankQuestion target)
    {
        target.Topic = source.Topic;
        target.Type = source.Type;
        target.Content = source.Content;
        target.OptionsJson = source.OptionsJson;
        target.CorrectAnswer = source.CorrectAnswer;
        target.Points = source.Points;
        target.IsScenario = source.IsScenario;
        target.Explanation = source.Explanation;
        target.Source = source.Source;
        target.Group = source.Group;
        target.RequiresSourceReview = source.RequiresSourceReview;
        target.SourceReviewed = source.SourceReviewed;
        target.ReviewedByUserId = source.ReviewedByUserId;
        target.ReviewedAtUtc = source.ReviewedAtUtc;
    }

    private static List<QuestionOption> DeserializeOptions(string json)
    {
        try { return JsonSerializer.Deserialize<List<QuestionOption>>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? []; }
        catch (JsonException) { return []; }
    }
}

public sealed class BankTopicRequest
{
    public int TopicId { get; set; }
    public List<int> QuestionIds { get; set; } = [];
}

/// <summary>Identifiers of active bank questions to add to an exam draft.</summary>
public sealed class QuestionBankImportRequest
{
    public List<int> QuestionIds { get; set; } = [];
    public bool SyncCounts { get; set; }
}
