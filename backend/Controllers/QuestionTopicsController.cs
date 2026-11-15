using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;
namespace Quiz_TanHoa.Api.Controllers;
[ApiController, Route("api/organizer/topics"), Authorize(Policy = AppRoles.Organizer)]
public sealed class QuestionTopicsController(AppDbContext db) : ControllerBase
{
    private static string Label(QuestionBankQuestion q) => !string.IsNullOrWhiteSpace(q.Topic) ? q.Topic.Trim() : q.Source.Split('|')[0].Trim();
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var bank = await db.QuestionBankQuestions.ToListAsync();
        var catalog = await db.QuestionTopics.ToListAsync();
        foreach (var q in bank.Where(q => q.IsActive))
        {
            var name = Label(q); if (name.Length == 0 || catalog.Any(t => t.NameKey == name.Normalize().ToUpperInvariant())) continue;
            var topic = new QuestionTopic { Name = name, NameKey = name.Normalize().ToUpperInvariant(), CreatedAtUtc = DateTime.UtcNow, UpdatedAtUtc = DateTime.UtcNow };
            db.QuestionTopics.Add(topic); catalog.Add(topic);
        }
        await db.SaveChangesAsync();
        return Ok(catalog.OrderBy(t => t.Name).Select(t => new { t.Id, t.Name, questionCount = bank.Count(q => q.IsActive && Label(q) == t.Name) }));
    }
    [HttpPost]
    public async Task<IActionResult> Create(TopicRequest request)
    {
        var name = request.Name.Trim().Normalize();
        if (name.Length == 0 || name == "Chưa phân chủ đề") return BadRequest(new { message = "Vui lòng nhập tên chủ đề hợp lệ." });
        if (await db.QuestionTopics.AnyAsync(t => t.NameKey == name.ToUpperInvariant())) return Conflict(new { message = "Tên chủ đề đã tồn tại." });
        var topic = new QuestionTopic { Name = name, NameKey = name.ToUpperInvariant(), CreatedAtUtc = DateTime.UtcNow, UpdatedAtUtc = DateTime.UtcNow };
        db.QuestionTopics.Add(topic); await db.SaveChangesAsync();
        return StatusCode(201, new { topic.Id, topic.Name, questionCount = 0 });
    }
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, TopicRequest request)
    {
        var topic = await db.QuestionTopics.SingleOrDefaultAsync(t => t.Id == id);
        if (topic is null) return NotFound(new { message = "Không tìm thấy chủ đề." });
        var name = request.Name.Trim().Normalize();
        if (name.Length == 0 || name == "Chưa phân chủ đề") return BadRequest(new { message = "Vui lòng nhập tên chủ đề hợp lệ." });
        if (await db.QuestionTopics.AnyAsync(t => t.Id != id && t.NameKey == name.ToUpperInvariant())) return Conflict(new { message = "Tên chủ đề đã tồn tại." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var bank = (await db.QuestionBankQuestions.ToListAsync()).Where(q => Label(q) == topic.Name).ToList();
        var ids = bank.Select(q => q.Id).ToList();
        var linked = await db.ExamQuestions.Include(q => q.Exam).Where(q => ids.Contains(q.BankQuestionId ?? 0) || q.Topic == topic.Name).ToListAsync();
        foreach (var q in bank) { q.Topic = name; q.UpdatedAtUtc = DateTime.UtcNow; }
        foreach (var q in linked) q.Topic = name;
        foreach (var exam in linked.Select(q => q.Exam).DistinctBy(e => e.Id)) ExamRules.TouchDraft(exam);
        topic.Name = name; topic.NameKey = name.ToUpperInvariant(); topic.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        return Ok(new { topic.Id, topic.Name, questionCount = bank.Count(q => q.IsActive) });
    }
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var topic = await db.QuestionTopics.SingleOrDefaultAsync(t => t.Id == id);
        if (topic is null) return NotFound(new { message = "Không tìm thấy chủ đề." });
        if ((await db.QuestionBankQuestions.Where(q => q.IsActive).ToListAsync()).Any(q => Label(q) == topic.Name))
            return Conflict(new { message = "Chủ đề đang có câu hỏi. Hãy chuyển các câu sang chủ đề khác trước khi xóa." });
        db.QuestionTopics.Remove(topic); await db.SaveChangesAsync(); return NoContent();
    }
}
public sealed class TopicRequest { [Required, MaxLength(200)] public string Name { get; set; } = ""; }
