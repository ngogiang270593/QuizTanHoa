using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Security;

namespace Quiz_TanHoa.Api.Controllers;

/// <summary>One catalog organization unit.</summary>
public sealed record OrganizationUnitResponse(int Id, string Code, string Name);

[ApiController]
[Route("api/organizer/organization-units")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class OrganizationUnitsController(AppDbContext db) : ControllerBase
{
    /// <summary>Returns the organization unit catalog ordered for display.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<OrganizationUnitResponse>>> List(CancellationToken cancellationToken)
    {
        var units = await db.OrganizationUnits.AsNoTracking().OrderBy(item => item.SortOrder)
            .Select(item => new OrganizationUnitResponse(item.Id, item.Code, item.Name))
            .ToListAsync(cancellationToken);
        return Ok(units);
    }
}
