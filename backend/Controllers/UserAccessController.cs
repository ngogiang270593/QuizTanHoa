using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
namespace Quiz_TanHoa.Api.Controllers;
[ApiController, Route("api/organizer/users/{id:int}"), Authorize(Policy = AppRoles.Organizer)]
public sealed class UserAccessController(AppDbContext db) : ControllerBase
{
    [HttpGet("access-history")]
    public async Task<IActionResult> History(int id) => Ok((await db.WorkflowEvents.Where(e => e.UserId == id && e.Action == "AccessChanged").OrderByDescending(e => e.Id).ToListAsync()).Select(e => new { e.Id, e.ActorUserId, e.ActorName, e.Action, e.Note, occurredAtUtc = CompetitionResponse.Utc(e.OccurredAtUtc) }));
    [HttpPut("access")]
    public async Task<IActionResult> Update(int id, UserAccessRequest request)
    {
        var actor = CurrentAccount.User(HttpContext);
        if (id == actor.Id) return Conflict(new { message = "Không thể thay đổi quyền của chính tài khoản đang đăng nhập." });

        await using var transaction = await db.Database.BeginTransactionAsync();
        (int[] Ids,string[] Permissions,string[]? Scope) assignment;
        try { assignment=await ProcessAccess.RequestAsync(db,request.Role,request.ProcessIds,request.WorkflowPermissions); } catch(ArgumentException e) {return BadRequest(new {message=e.Message});}
        var account = await db.Users.SingleOrDefaultAsync(u => u.Id == id); if (account is null) return NotFound();
        var catalog=await db.AccessProcesses.ToListAsync();var users=await db.Users.ToListAsync();foreach(var u in users)ProcessAccess.Resolve(u,catalog);
        if (account.IsActive && WorkflowAccess.Has(account, "manageUsers") && !(request.Role == AppRoles.Organizer && assignment.Permissions.Contains("manageUsers")) && users.Count(u => u.IsActive && WorkflowAccess.Has(u, "manageUsers")) <= 1) return Conflict(new { message = "Phải giữ ít nhất một tài khoản quản lý người dùng." });
        if (account.Role != request.Role && await db.ExamAttempts.AnyAsync(a => a.UserId == id && a.SubmittedAtUtc == null)) return Conflict(new { message = "Tài khoản đang có lượt thi chưa kết thúc; chưa thể đổi vai trò." });
        var before = JsonSerializer.Serialize(new { account.Role, workflowPermissions = WorkflowAccess.Permissions(account) });
        account.Role = request.Role; account.ProcessIdsJson=JsonSerializer.Serialize(assignment.Ids); account.PermissionScopeJson=assignment.Scope is null?null:JsonSerializer.Serialize(assignment.Scope); account.WorkflowPermissionsJson = JsonSerializer.Serialize(assignment.Permissions); ProcessAccess.Resolve(account,catalog);
        foreach (var session in await db.AuthSessions.Where(s => s.UserId == id && s.RevokedAtUtc == null).ToListAsync()) session.RevokedAtUtc = DateTime.UtcNow;
        db.WorkflowEvents.Add(new WorkflowEvent { UserId = id, ActorUserId = actor.Id, ActorName = actor.FullName, Action = "AccessChanged", Note = before + " → " + JsonSerializer.Serialize(request), OccurredAtUtc = DateTime.UtcNow });
        await db.SaveChangesAsync(); await transaction.CommitAsync(); return Ok(WorkflowAccess.Profile(account));
    }
    internal static bool Valid(string role, string[]? permissions) => permissions is not null && permissions.Length == permissions.Distinct().Count() && permissions.All(WorkflowAccess.All.Contains) && (role == AppRoles.Candidate && permissions.Length == 0 || role == AppRoles.Organizer && permissions.Length > 0);
}
public sealed class UserAccessRequest { public string Role { get; set; } = "Candidate"; public int[]? ProcessIds { get; set; } public string[] WorkflowPermissions { get; set; } = []; }
