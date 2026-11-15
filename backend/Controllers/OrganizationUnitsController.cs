using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
namespace Quiz_TanHoa.Api.Controllers;
public sealed record OrganizationUnitResponse(int Id, string Code, string Name, int SortOrder, int UserCount);
[ApiController, Route("api/organizer/organization-units"), Authorize(Policy = AppRoles.Organizer)]
public sealed class OrganizationUnitsController(AppDbContext db) : ControllerBase
{
    private static string Key(string name) => name.Trim().Normalize().ToUpperInvariant();
    private static bool Belongs(User user, string name) => Key(user.Department) == Key(name);
    private static OrganizationUnitResponse Profile(OrganizationUnit unit, List<User> users) => new(unit.Id, unit.Code, unit.Name, unit.SortOrder, users.Count(u => Belongs(u, unit.Name)));
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var units = await db.OrganizationUnits.AsNoTracking().OrderBy(u => u.SortOrder).ThenBy(u => u.Name).ToListAsync(cancellationToken);
        var users = await db.Users.AsNoTracking().ToListAsync(cancellationToken);
        return Ok(units.Select(u => Profile(u, users)));
    }
    [HttpPost]
    public async Task<IActionResult> Create(OrganizationUnitRequest request)
    {
        var code = request.Code.Trim().ToUpperInvariant(); var name = request.Name.Trim().Normalize();
        if (!Regex.IsMatch(code, "^[A-Z0-9][A-Z0-9_-]{0,49}$") || name.Length == 0) return BadRequest(new { message = "Mã hoặc tên phòng ban không hợp lệ." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var units = await db.OrganizationUnits.ToListAsync();
        if (units.Any(u => u.Code.ToUpperInvariant() == code || Key(u.Name) == Key(name))) return Conflict(new { message = "Mã hoặc tên phòng ban đã tồn tại." });
        var unit = new OrganizationUnit { Code = code, Name = name, SortOrder = request.SortOrder };
        db.OrganizationUnits.Add(unit); await db.SaveChangesAsync();
        Audit(unit, "UnitCreated", JsonSerializer.Serialize(new { unit.Code, unit.Name, unit.SortOrder }));
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        return StatusCode(201, Profile(unit, await db.Users.AsNoTracking().ToListAsync()));
    }
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, OrganizationUnitRequest request)
    {
        var code = request.Code.Trim().ToUpperInvariant(); var name = request.Name.Trim().Normalize();
        if (!Regex.IsMatch(code, "^[A-Z0-9][A-Z0-9_-]{0,49}$") || name.Length == 0) return BadRequest(new { message = "Mã hoặc tên phòng ban không hợp lệ." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var units = await db.OrganizationUnits.ToListAsync(); var unit = units.SingleOrDefault(u => u.Id == id);
        if (unit is null) return NotFound(new { message = "Không tìm thấy phòng ban." });
        if (units.Any(u => u.Id != id && (u.Code.ToUpperInvariant() == code || Key(u.Name) == Key(name)))) return Conflict(new { message = "Mã hoặc tên phòng ban đã tồn tại." });
        var users = await db.Users.ToListAsync(); var changed = 0; var before = new { unit.Code, unit.Name, unit.SortOrder };
        foreach (var user in users.Where(u => Belongs(u, unit.Name))) if (user.Department != name) { user.Department = name; changed++; }
        unit.Code = code; unit.Name = name; unit.SortOrder = request.SortOrder;
        Audit(unit, "UnitUpdated", JsonSerializer.Serialize(new { before, after = new { code, name, request.SortOrder }, updatedUserCount = changed }));
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        return Ok(new { unit.Id, unit.Code, unit.Name, unit.SortOrder, userCount = users.Count(u => Belongs(u, unit.Name)), updatedUserCount = changed });
    }
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var unit = await db.OrganizationUnits.SingleOrDefaultAsync(u => u.Id == id);
        if (unit is null) return NotFound(new { message = "Không tìm thấy phòng ban." });
        if ((await db.Users.AsNoTracking().ToListAsync()).Any(u => Belongs(u, unit.Name))) return Conflict(new { message = "Phòng ban đang có tài khoản trực thuộc. Hãy chuyển tài khoản sang phòng ban khác trước khi xóa." });
        Audit(unit, "UnitDeleted", JsonSerializer.Serialize(new { unit.Code, unit.Name, unit.SortOrder }));
        db.OrganizationUnits.Remove(unit); await db.SaveChangesAsync(); await transaction.CommitAsync(); return NoContent();
    }
    private void Audit(OrganizationUnit unit, string action, string note)
    {
        var actor = CurrentAccount.User(HttpContext);
        db.WorkflowEvents.Add(new WorkflowEvent { ActorUserId = actor.Id, ActorName = actor.FullName, Action = action, Note = $"Phòng ban {unit.Id}: {note}", OccurredAtUtc = DateTime.UtcNow });
    }
}
public sealed class OrganizationUnitRequest
{
    [Required, MaxLength(50)] public string Code { get; set; } = "";
    [Required, MaxLength(200)] public string Name { get; set; } = "";
    [Range(0,10000)] public int SortOrder { get; set; }
}
