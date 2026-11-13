using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Controllers;

[ApiController]
[Route("api/organizer/competitions/{competitionId:int}/results")]
[Authorize(Policy = AppRoles.Organizer)]
public sealed class CompetitionResultsController(ICompetitionResultsService results) : ControllerBase
{
    private const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    /// <summary>Returns automatically scored attempts and competition rankings.</summary>
    [HttpGet]
    public async Task<ActionResult<CompetitionResultsResponse>> Get(
        int competitionId,
        [FromQuery, MaxLength(200)] string? rankingGroupName,
        CancellationToken cancellationToken)
    {
        var response = await results.GetAsync(competitionId, rankingGroupName, cancellationToken);
        if (response is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (!string.IsNullOrWhiteSpace(rankingGroupName)
            && !response.RankingGroups.Contains(rankingGroupName.Trim(), StringComparer.OrdinalIgnoreCase))
            return BadRequest(new { message = "Nhóm xếp hạng không thuộc cuộc thi này." });
        return Ok(response);
    }

    /// <summary>Exports the displayed result set as an Excel workbook.</summary>
    [HttpGet("excel")]
    public async Task<IActionResult> Export(
        int competitionId,
        [FromQuery, MaxLength(200)] string? rankingGroupName,
        CancellationToken cancellationToken)
    {
        var response = await results.GetAsync(competitionId, rankingGroupName, cancellationToken);
        if (response is null) return NotFound(new { message = "Không tìm thấy cuộc thi." });
        if (!string.IsNullOrWhiteSpace(rankingGroupName)
            && !response.RankingGroups.Contains(rankingGroupName.Trim(), StringComparer.OrdinalIgnoreCase))
            return BadRequest(new { message = "Nhóm xếp hạng không thuộc cuộc thi này." });
        if (response.Rows.Count > 1_048_575)
            return BadRequest(new { message = "Số dòng kết quả vượt giới hạn của một trang tính Excel." });

        var scope = string.IsNullOrWhiteSpace(rankingGroupName) ? "TatCaNhom" : rankingGroupName.Trim();
        var safeName = SafeFilePart(response.CompetitionName);
        var safeScope = SafeFilePart(scope);
        var fileName = $"{safeName}_KetQua_{safeScope}.xlsx";
        return File(results.CreateWorkbook(response.Rows), ExcelContentType, fileName);
    }

    private static string SafeFilePart(string value) => string.Concat(value.Select(character =>
        Path.GetInvalidFileNameChars().Contains(character) || char.IsControl(character) || character is '/' or '\\' ? '_' : character)).Trim();
}
