using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/organizer/competitions/{competitionId:int}/field-groups")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class ExamFieldGroupsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(int competitionId)
    {
        if (!await db.Competitions.AnyAsync(competition => competition.Id == competitionId)) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        return Ok(await db.ExamFieldGroups.AsNoTracking().Where(group => group.CompetitionId == competitionId).OrderBy(group => group.Id)
            .Select(group => new { group.Id, group.CompetitionId, group.Name, group.RankingGroupName, group.IsSample }).ToListAsync());
    }

    [HttpPost]
    public async Task<IActionResult> Create(int competitionId, FieldGroupWriteRequest request)
    {
        if (!await db.Competitions.AnyAsync(competition => competition.Id == competitionId)) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (!await ValidateName(competitionId, request.Name)) return ValidationProblem(ModelState);
        var group = new ExamFieldGroup
        {
            CompetitionId = competitionId,
            Name = request.Name.Trim(),
            RankingGroupName = string.IsNullOrWhiteSpace(request.RankingGroupName) ? request.Name.Trim() : request.RankingGroupName.Trim(),
            IsSample = false
        };
        db.ExamFieldGroups.Add(group); await db.SaveChangesAsync();
        return StatusCode(201, new { group.Id, group.CompetitionId, group.Name, group.RankingGroupName, group.IsSample });
    }

    [HttpPut("{groupId:int}")]
    public async Task<IActionResult> Update(int competitionId, int groupId, FieldGroupWriteRequest request)
    {
        var group = await db.ExamFieldGroups.SingleOrDefaultAsync(item => item.Id == groupId && item.CompetitionId == competitionId);
        if (group is null) return NotFound(new { message = "Không tìm thấy nhóm lĩnh vực trong cuộc thi." });
        if (!await ValidateName(competitionId, request.Name, groupId)) return ValidationProblem(ModelState);
        var oldName = group.Name;
        if (group.Name != request.Name.Trim())
        {
            group.Name = request.Name.Trim(); group.IsSample = false;
            if (group.RankingGroupName == oldName) group.RankingGroupName = group.Name;
            foreach (var exam in await db.Exams.Where(exam => exam.CompetitionId == competitionId && exam.FieldGroupId == groupId).ToListAsync()) ExamRules.TouchDraft(exam);
        }
        if (request.RankingGroupName is not null)
            group.RankingGroupName = string.IsNullOrWhiteSpace(request.RankingGroupName) ? group.Name : request.RankingGroupName.Trim();
        else if (group.RankingGroupName == "")
            group.RankingGroupName = group.Name;
        await db.SaveChangesAsync();
        return Ok(new { group.Id, group.CompetitionId, group.Name, group.RankingGroupName, group.IsSample });
    }

    private async Task<bool> ValidateName(int competitionId, string name, int? exceptId = null)
    {
        if (string.IsNullOrWhiteSpace(name)) ModelState.AddModelError("name", "Vui lòng nhập tên nhóm lĩnh vực.");
        else if (await db.ExamFieldGroups.AnyAsync(group => group.CompetitionId == competitionId && group.Name == name.Trim() && group.Id != exceptId)) ModelState.AddModelError("name", "Tên nhóm lĩnh vực đã tồn tại trong cuộc thi.");
        return ModelState.IsValid;
    }
}
