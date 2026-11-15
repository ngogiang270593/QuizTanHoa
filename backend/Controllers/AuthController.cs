using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(AppDbContext db, JwtSettings jwt) : ControllerBase
{
    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        if (Encoding.UTF8.GetByteCount(request.Password) > 72)
            return BadRequest(new { message = "Mật khẩu không được vượt quá 72 byte." });

        var username = request.Username.Trim().ToLowerInvariant();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(candidate => candidate.Username == username);
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.Password))
            return Unauthorized(new { message = "Tài khoản hoặc mật khẩu không đúng." });
        if (!user.IsActive || !AppRoles.IsKnown(user.Role))
            return StatusCode(403, new { message = "Tài khoản không có quyền truy cập." });

        await ProcessAccess.HydrateAsync(db, user);
        var now = DateTime.UtcNow;
        var session = new AuthSession
        {
            Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
            UserId = user.Id,
            CreatedAtUtc = now,
            ExpiresAtUtc = now.AddHours(8)
        };
        db.AuthSessions.Add(session);
        await db.SaveChangesAsync();

        var token = new JwtSecurityToken(
            issuer: JwtSettings.Issuer,
            audience: JwtSettings.Audience,
            claims: new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, session.Id),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role)
            },
            notBefore: now,
            expires: session.ExpiresAtUtc,
            signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)), SecurityAlgorithms.HmacSha256));

        return Ok(new
        {
            token = new JwtSecurityTokenHandler().WriteToken(token),
            user.Id,
            user.Username,
            user.FullName,
            user.Department,
            user.Role,
            user.IsActive,
            user.IsDemo,
            mustChangePassword = false,
            expiresAt = session.ExpiresAtUtc,
            processIds = ProcessAccess.Ids(user), assignedProcesses = user.AssignedProcesses, processPermissionKeys = user.ProcessPermissionKeys,
            accountGroup = WorkflowAccess.Group(user), workflowPermissions = WorkflowAccess.Permissions(user), accessLabel = WorkflowAccess.Label(user),
            permissions = AppRoles.Permissions(user)
        });
    }

    [Authorize]
    [HttpGet("me")]
    public IActionResult Me() => Ok(CurrentAccount.Profile(CurrentAccount.User(HttpContext), CurrentAccount.Session(HttpContext).ExpiresAtUtc));

    /// <summary>Changes an initial or current password to a strong password and revokes all active sessions.</summary>
    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        var current = CurrentAccount.User(HttpContext);
        var user = await db.Users.SingleAsync(item => item.Id == current.Id, cancellationToken);
        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.Password))
            return BadRequest(new { message = "Mật khẩu hiện tại không đúng." });
        if (!string.Equals(request.NewPassword, request.ConfirmPassword, StringComparison.Ordinal))
            return BadRequest(new { message = "Mật khẩu mới và phần xác nhận không khớp." });
        if (!StrongPassword.IsValid(request.NewPassword))
            return BadRequest(new { message = StrongPassword.Requirement });
        if (BCrypt.Net.BCrypt.Verify(request.NewPassword, user.Password))
            return BadRequest(new { message = "Mật khẩu mới phải khác mật khẩu hiện tại." });

        var now = DateTime.UtcNow;
        user.Password = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.MustChangePassword = false;
        await db.AuthSessions.Where(session => session.UserId == user.Id && session.RevokedAtUtc == null)
            .ExecuteUpdateAsync(update => update.SetProperty(session => session.RevokedAtUtc, now), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new { message = "Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới." });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        var sessionId = CurrentAccount.Session(HttpContext).Id;
        await db.AuthSessions.Where(session => session.Id == sessionId && session.RevokedAtUtc == null)
            .ExecuteUpdateAsync(update => update.SetProperty(session => session.RevokedAtUtc, DateTime.UtcNow));
        return Ok(new { message = "Đã đăng xuất và kết thúc phiên trên máy chủ." });
    }
}

public class LoginRequest
{
    [Required(ErrorMessage = "Vui lòng nhập tài khoản.")]
    [MaxLength(100, ErrorMessage = "Tài khoản không được vượt quá 100 ký tự.")]
    public string Username { get; set; } = "";
    [Required(ErrorMessage = "Vui lòng nhập mật khẩu.")]
    [MaxLength(72, ErrorMessage = "Mật khẩu quá dài.")]
    public string Password { get; set; } = "";
}

/// <summary>Current password and confirmed replacement.</summary>
public sealed record ChangePasswordRequest
{
    [Required, MaxLength(72)]
    public required string CurrentPassword { get; init; }
    [Required, MaxLength(72)]
    public required string NewPassword { get; init; }
    [Required, MaxLength(72)]
    public required string ConfirmPassword { get; init; }
}

public static class StrongPassword
{
    public const string Requirement = "Mật khẩu mới phải có ít nhất 12 ký tự, gồm chữ thường, chữ hoa, chữ số và ký tự đặc biệt.";

    public static bool IsValid(string value) =>
        value.Length >= 12
        && Encoding.UTF8.GetByteCount(value) <= 72
        && value.Any(char.IsLower)
        && value.Any(char.IsUpper)
        && value.Any(char.IsDigit)
        && value.Any(character => !char.IsLetterOrDigit(character));
}
