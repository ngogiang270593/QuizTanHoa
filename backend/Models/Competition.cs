using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public sealed class Competition
{
    public int Id { get; set; }
    [MaxLength(300)]
    public string Name { get; set; } = "";
    [MaxLength(5000)]
    public string Description { get; set; } = "";
    [MaxLength(20000)]
    public string Rules { get; set; } = "";
    public bool ScenarioScoreTieBreakEnabled { get; set; }
    [MaxLength(20)]
    public string Status { get; set; } = CompetitionStatuses.Draft;
    public bool IsDeleting { get; set; }
    public bool IsDemo { get; set; }
    public int? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public DateTime? OpensAtUtc { get; set; }
    public DateTime? StartDeadlineUtc { get; set; }
    public DateTime? ClosesAtUtc { get; set; }
    public DateTime? PublishedAtUtc { get; set; }
    public ICollection<CompetitionAssignment> Assignments { get; set; } = new List<CompetitionAssignment>();
}

public static class CompetitionStatuses
{
    public const string Draft = "Draft";
    public const string Published = "Published";
    public const string Ended = "Ended";
}
