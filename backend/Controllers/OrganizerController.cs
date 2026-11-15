using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using System.ComponentModel.DataAnnotations;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/organizer")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class OrganizerController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    [HttpGet("overview")]
    public async Task<IActionResult> Overview()
    {
        var counts = await db.Users.AsNoTracking().GroupBy(user => 1).Select(users => new
        {
            userCount = users.Count(),
            organizerCount = users.Count(user => user.Role == AppRoles.Organizer),
            candidateCount = users.Count(user => user.Role == AppRoles.Candidate),
            demoUserCount = users.Count(user => user.IsDemo)
        }).SingleOrDefaultAsync();
        return Ok(new
        {
            role = AppRoles.Organizer,
            timeZone = VietnamClock.TimeZoneId,
            serverTimeUtc = clock.UtcNow,
            userCount = counts?.userCount ?? 0,
            organizerCount = counts?.organizerCount ?? 0,
            candidateCount = counts?.candidateCount ?? 0,
            demoUserCount = counts?.demoUserCount ?? 0,
            permissions = AppRoles.Permissions(CurrentAccount.User(HttpContext))
        });
    }

    [HttpGet("review-queue")]
    public async Task<IActionResult> ReviewQueue() => Ok(await db.Exams.Where(e => e.ReviewStatus == "PendingReview").OrderBy(e => e.SubmittedAtUtc).Select(e => new { e.Id, e.Name, e.CompetitionId, competitionName = e.Competition.Name, e.DraftRevision, submittedAtUtc = e.SubmittedAtUtc }).ToListAsync());

    [HttpGet("users")]
    public async Task<IActionResult> Users() { var users = await db.Users.AsNoTracking().OrderBy(u => u.Id).ToListAsync(); var catalog = await db.AccessProcesses.AsNoTracking().ToListAsync(); foreach (var u in users) ProcessAccess.Resolve(u, catalog); return Ok(users.Select(WorkflowAccess.Profile)); }

    [HttpGet("users/{id:int}")]
    public async Task<IActionResult> GetUser(int id, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (user is null) return NotFound(new { message = "Không tìm thấy tài khoản." });
        await ProcessAccess.HydrateAsync(db, user); return Ok(WorkflowAccess.Profile(user));
    }

    [HttpPost("users")]
    public async Task<IActionResult> CreateCandidate(CreateCandidateAccountRequest request, CancellationToken cancellationToken)
    {

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (request.DepartmentId is int unitId)
        {
            var unit = await db.OrganizationUnits.FindAsync(unitId);
            if (unit is null) return Conflict(new { message = "Phòng ban không còn tồn tại. Hãy tải lại danh mục." });
            request.Department = unit.Name;
        }
        (int[] Ids, string[] Permissions, string[]? Scope) assignment;
        try { assignment = await ProcessAccess.RequestAsync(db, request.Role, request.ProcessIds, request.WorkflowPermissions); } catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
        var username = request.Username.Trim();
        if (await db.Users.AnyAsync(user => user.Username == username, cancellationToken))
            return Conflict(new { message = "Tên đăng nhập đã được sử dụng." });

        var user = new User
        {
            Username = username,
            Password = BCrypt.Net.BCrypt.HashPassword("123456"),
            FullName = request.FullName.Trim(),
            Department = request.Department?.Trim() ?? "",
            Role = request.Role, ProcessIdsJson = System.Text.Json.JsonSerializer.Serialize(assignment.Ids), PermissionScopeJson = assignment.Scope is null?null:System.Text.Json.JsonSerializer.Serialize(assignment.Scope), WorkflowPermissionsJson = System.Text.Json.JsonSerializer.Serialize(assignment.Permissions),
            IsActive = true,
            IsDemo = false,
            MustChangePassword = false
        };
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException error) when (error.InnerException is SqliteException { SqliteExtendedErrorCode: 2067 })
        {
            return Conflict(new { message = "Tên đăng nhập đã được sử dụng." });
        }

        Audit(user.Id,"AccountCreated"); await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await ProcessAccess.HydrateAsync(db, user);
        var response = WorkflowAccess.Profile(user);
        return CreatedAtAction(nameof(GetUser), new { id = user.Id }, response);
    }

    [HttpPut("users/{id:int}")]
    public async Task<IActionResult> UpdateUser(int id, OrganizerUserUpdateRequest request, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var user = await db.Users.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (user is null) return NotFound(new { message = "Không tìm thấy tài khoản." });

        var catalog = await db.AccessProcesses.AsNoTracking().ToListAsync(); ProcessAccess.Resolve(user, catalog);
        var activeUsers = await db.Users.Where(u => u.IsActive).ToListAsync(cancellationToken); foreach(var u in activeUsers) ProcessAccess.Resolve(u,catalog);
        if (!request.IsActive && user.Id == CurrentAccount.User(HttpContext).Id)
            return BadRequest(new { message = "Không thể khóa tài khoản đang đăng nhập." });
        if (WorkflowAccess.Has(user, "manageUsers") && user.IsActive && !request.IsActive
            && activeUsers.Count(item => WorkflowAccess.Has(item, "manageUsers")) <= 1)
            return Conflict(new { message = "Không thể khóa tài khoản Ban Tổ chức hoạt động cuối cùng." });

        if (request.DepartmentId is int unitId)
        {
            var unit = await db.OrganizationUnits.FindAsync(unitId);
            if (unit is null) return Conflict(new { message = "Phòng ban không còn tồn tại. Hãy tải lại danh mục." });
            request.Department = unit.Name;
        }
        user.FullName = request.FullName.Trim();
        user.Department = request.Department?.Trim() ?? "";
        user.IsActive = request.IsActive;
        Audit(user.Id,request.IsActive?"AccountUpdated":"AccountDisabled");
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { user.Id, user.Username, user.FullName, user.Department, user.Role, user.IsActive, user.IsDemo });
    }

    [HttpDelete("users/{id:int}")]
    public async Task<IActionResult> DeleteCandidate(int id, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (user is null) return NotFound(new { message = "Không tìm thấy tài khoản." });
        if (user.Role != AppRoles.Candidate)
            return Conflict(new { message = "Chỉ có thể xóa tài khoản thí sinh." });

        var hasAssignments = await db.CompetitionAssignments.AnyAsync(item => item.UserId == id, cancellationToken);
        var hasAttempts = await db.ExamAttempts.AnyAsync(item => item.UserId == id, cancellationToken);
        if (hasAssignments || hasAttempts)
            return Conflict(new { message = "Tài khoản đã có phân công hoặc lượt thi; hãy khóa tài khoản để bảo toàn lịch sử." });

        db.Users.Remove(user);
        Audit(user.Id,"AccountDeleted");
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
    private void Audit(int id,string action){var actor=CurrentAccount.User(HttpContext);db.WorkflowEvents.Add(new WorkflowEvent{UserId=id,ActorUserId=actor.Id,ActorName=actor.FullName,Action=action,OccurredAtUtc=DateTime.UtcNow});}
}

/// <summary>Information needed to create an active candidate account.</summary>
public sealed record CreateCandidateAccountRequest
{
    [Required, MaxLength(100)]
    public string Username { get; init; } = "";
    public string Role { get; init; } = "Candidate";
    public int[]? ProcessIds { get; init; }
    public string[] WorkflowPermissions { get; init; } = [];

    [Required, MaxLength(200)]
    public string FullName { get; init; } = "";

    [Range(1, int.MaxValue)] public int? DepartmentId { get; init; }
    [MaxLength(200)] public string? Department { get; set; }
}

/// <summary>Candidate account details that an organizer can update.</summary>
public sealed record OrganizerUserUpdateRequest
{
    [Required, MaxLength(200)]
    public string FullName { get; init; } = "";

    [Range(1, int.MaxValue)] public int? DepartmentId { get; init; }
    [MaxLength(200)] public string? Department { get; set; }

    public bool IsActive { get; init; }
}
