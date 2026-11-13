using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/system")]
public sealed class SystemController(AppDbContext db, VietnamClock clock) : ControllerBase
{
    [HttpGet("public")]
    [AllowAnonymous]
    public async Task<IActionResult> Public()
    {
        var demoAccounts = await db.Users.AsNoTracking().Where(user => user.IsDemo && user.IsActive)
            .OrderBy(user => user.Id).Select(user => new { user.Username, user.FullName, user.Role, user.IsDemo }).ToListAsync();
        return Ok(new
        {
            application = "Quiz_TanHoa",
            timeZone = VietnamClock.TimeZoneId,
            serverTimeUtc = clock.UtcNow,
            demoEnabled = demoAccounts.Count > 0,
            demoAccounts
        });
    }
}
