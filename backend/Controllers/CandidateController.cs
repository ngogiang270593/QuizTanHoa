using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/candidate")]
[Authorize(Policy = AppRoles.Candidate)]
public sealed class CandidateController(VietnamClock clock) : ControllerBase
{
    [HttpGet("overview")]
    public IActionResult Overview() => Ok(new
    {
        role = AppRoles.Candidate,
        timeZone = VietnamClock.TimeZoneId,
        serverTimeUtc = clock.UtcNow,
        permissions = AppRoles.Permissions(AppRoles.Candidate),
        message = "Khu vực Thí sinh đã sẵn sàng. Chức năng hội thi sẽ được triển khai ở bước tiếp theo."
    });
}
