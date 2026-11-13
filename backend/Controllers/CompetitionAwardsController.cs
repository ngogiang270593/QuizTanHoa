using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

/// <summary>Proposed award rows before they are persisted.</summary>
public sealed record AwardProposalRequest(IReadOnlyList<AwardCategory> Categories);

/// <summary>Approval metadata for an award list.</summary>
public sealed record AwardApprovalRequest([Range(0, int.MaxValue)] int Revision, [MaxLength(1000)] string? Reason);

[ApiController]
[Route("api/organizer/competitions/{competitionId:int}/awards")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class CompetitionAwardsController(ICompetitionAwardsService awards, VietnamClock clock) : ControllerBase
{
    private const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    /// <summary>Returns the current award configuration, draft, rankings, and audit trail.</summary>
    [HttpGet]
    public async Task<ActionResult<CompetitionAwardsResponse>> Get(int competitionId, CancellationToken cancellationToken)
    {
        var response = await awards.GetAsync(competitionId, cancellationToken);
        return response is null ? NotFound(new { message = "Không tìm thấy cuộc thi." }) : Ok(response);
    }

    /// <summary>Builds a suggested award list from the current valid rankings.</summary>
    [HttpPost("proposal")]
    public async Task<IActionResult> Proposal(int competitionId, AwardProposalRequest request, CancellationToken cancellationToken)
    {
        if (request.Categories is null || request.Categories.Count is < 1 or > 100
            || request.Categories.Any(item => item is null || string.IsNullOrWhiteSpace(item.RankingGroupName)
                || string.IsNullOrWhiteSpace(item.AwardName) || item.Quantity is < 1 or > 1000))
            return BadRequest(new { message = "Cấu hình cần có từ 1 đến 100 hạng giải hợp lệ." });
        var proposal = await awards.ProposeAsync(competitionId, request.Categories, cancellationToken);
        return proposal is null ? NotFound(new { message = "Không tìm thấy cuộc thi." }) : Ok(new { nominees = proposal });
    }

    /// <summary>Saves a draft award configuration and nominee list.</summary>
    [HttpPut("draft")]
    public async Task<IActionResult> SaveDraft(int competitionId, SaveCompetitionAwardsRequest request, CancellationToken cancellationToken)
    {
        var result = await awards.SaveDraftAsync(competitionId, CurrentAccount.User(HttpContext).Id, request, cancellationToken);
        return Operation(result);
    }

    /// <summary>Approves the current draft and freezes its contents.</summary>
    [HttpPost("approve")]
    public async Task<IActionResult> Approve(int competitionId, AwardApprovalRequest request, CancellationToken cancellationToken)
    {
        var result = await awards.ApproveAsync(competitionId, CurrentAccount.User(HttpContext).Id, request.Revision,
            request.Reason, cancellationToken);
        return Operation(result);
    }

    /// <summary>Publishes the approved award list to assigned candidates.</summary>
    [HttpPost("publish")]
    public async Task<IActionResult> Publish(int competitionId, CancellationToken cancellationToken)
    {
        var result = await awards.PublishAsync(competitionId, CurrentAccount.User(HttpContext).Id, cancellationToken);
        return Operation(result);
    }

    /// <summary>Exports the immutable published award snapshot as an Excel workbook.</summary>
    [HttpGet("excel")]
    public async Task<IActionResult> Export(int competitionId, CancellationToken cancellationToken)
    {
        var response = await awards.GetAsync(competitionId, cancellationToken);
        if (response is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (response.Status != CompetitionAwardStatuses.Published)
            return Conflict(new { message = "Chỉ có thể xuất danh sách giải đã công bố." });
        return File(awards.CreateWorkbook(response.Nominees), ExcelContentType, $"KetQuaXetGiai_{competitionId}.xlsx");
    }

    /// <summary>Ends a published competition after due attempts are finalized and awards are published.</summary>
    [HttpPost("~/api/organizer/competitions/{competitionId:int}/end")]
    public async Task<IActionResult> End(int competitionId, CancellationToken cancellationToken)
    {
        var result = await awards.EndCompetitionAsync(competitionId, CurrentAccount.User(HttpContext).Id, clock.UtcNow, cancellationToken);
        return Operation(result);
    }

    private IActionResult Operation(CompetitionAwardOperation operation)
    {
        if (operation.Success)
        {
            if (operation.Awards is null) return Ok(new { message = operation.Message });
            return Ok(new { message = operation.Message, awards = operation.Awards });
        }
        if (operation.IsNotFound) return NotFound(new { message = operation.Message });
        return operation.IsConflict
            ? Conflict(new { message = operation.Message })
            : BadRequest(new { message = operation.Message });
    }
}
