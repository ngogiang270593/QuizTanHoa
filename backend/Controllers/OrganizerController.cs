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
            permissions = AppRoles.Permissions(AppRoles.Organizer)
        });
    }

    [HttpGet("users")]
    public async Task<IActionResult> Users() => Ok(await db.Users.AsNoTracking().OrderBy(user => user.Id)
        .Select(user => new { user.Id, user.Username, user.FullName, user.Department, user.Role, user.IsActive, user.IsDemo }).ToListAsync());

    [HttpGet("users/{id:int}")]
    public async Task<IActionResult> GetUser(int id, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().Where(item => item.Id == id)
            .Select(item => new { item.Id, item.Username, item.FullName, item.Department, item.Role, item.IsActive, item.IsDemo })
            .SingleOrDefaultAsync(cancellationToken);
        return user is null ? NotFound(new { message = "Không tìm thấy tài khoản." }) : Ok(user);
    }

    [HttpPost("users")]
    public async Task<IActionResult> CreateCandidate(CreateCandidateAccountRequest request, CancellationToken cancellationToken)
    {
        var username = request.Username.Trim();
        if (await db.Users.AnyAsync(user => user.Username == username, cancellationToken))
            return Conflict(new { message = "Tên đăng nhập đã được sử dụng." });

        var user = new User
        {
            Username = username,
            Password = BCrypt.Net.BCrypt.HashPassword("123456"),
            FullName = request.FullName.Trim(),
            Department = request.Department?.Trim() ?? "",
            Role = AppRoles.Candidate,
            IsActive = true,
            IsDemo = false,
            MustChangePassword = true
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

        var response = new { user.Id, user.Username, user.FullName, user.Department, user.Role, user.IsActive, user.IsDemo };
        return CreatedAtAction(nameof(GetUser), new { id = user.Id }, response);
    }

    [HttpPut("users/{id:int}")]
    public async Task<IActionResult> UpdateUser(int id, OrganizerUserUpdateRequest request, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (user is null) return NotFound(new { message = "Không tìm thấy tài khoản." });

        if (!request.IsActive && user.Id == CurrentAccount.User(HttpContext).Id)
            return BadRequest(new { message = "Không thể khóa tài khoản đang đăng nhập." });
        if (user.Role == AppRoles.Organizer && user.IsActive && !request.IsActive
            && await db.Users.CountAsync(item => item.Role == AppRoles.Organizer && item.IsActive, cancellationToken) <= 1)
            return Conflict(new { message = "Không thể khóa tài khoản Ban Tổ chức hoạt động cuối cùng." });

        user.FullName = request.FullName.Trim();
        user.Department = request.Department?.Trim() ?? "";
        user.IsActive = request.IsActive;
        await db.SaveChangesAsync(cancellationToken);
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
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}

/// <summary>Information needed to create an active candidate account.</summary>
public sealed record CreateCandidateAccountRequest
{
    [Required, MaxLength(100)]
    public string Username { get; init; } = "";

    [Required, MaxLength(200)]
    public string FullName { get; init; } = "";

    [MaxLength(200)]
    public string? Department { get; init; }
}

/// <summary>Candidate account details that an organizer can update.</summary>
public sealed record OrganizerUserUpdateRequest
{
    [Required, MaxLength(200)]
    public string FullName { get; init; } = "";

    [MaxLength(200)]
    public string? Department { get; init; }

    public bool IsActive { get; init; }
}
