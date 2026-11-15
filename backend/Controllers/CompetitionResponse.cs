using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Controllers;

internal static class CompetitionResponse
{
    public static object Profile(Competition competition, int? initialExamId = null, int initialQuestionCount = 0) => new
    {
        initialExamId,
        initialQuestionCount,
        competition.Id,
        competition.Name,
        competition.Description,
        competition.Rules,
        competition.Status,
        competition.IsDemo,
        createdAtUtc = Utc(competition.CreatedAtUtc),
        updatedAtUtc = Utc(competition.UpdatedAtUtc),
        opensAtUtc = Utc(competition.OpensAtUtc),
        startDeadlineUtc = Utc(competition.StartDeadlineUtc),
        closesAtUtc = Utc(competition.ClosesAtUtc),
        publishedAtUtc = Utc(competition.PublishedAtUtc)
    };

    public static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
    public static DateTime? Utc(DateTime? value) => value.HasValue ? Utc(value.Value) : null;
}
