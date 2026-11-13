using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public sealed class CompetitionAwardPlan
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition Competition { get; set; } = null!;
    [MaxLength(20)] public string Status { get; set; } = CompetitionAwardStatuses.Draft;
    public int Revision { get; set; } = 1;
    public string DraftJson { get; set; } = "{}";
    public string? ApprovedSnapshotJson { get; set; }
    public DateTime? ApprovedAtUtc { get; set; }
    public int? ApprovedByUserId { get; set; }
    public DateTime? PublishedAtUtc { get; set; }
    public int? PublishedByUserId { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}

public sealed class CompetitionAwardEvent
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition Competition { get; set; } = null!;
    public int ActorUserId { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    [MaxLength(32)] public string Action { get; set; } = "";
    [MaxLength(1000)] public string Reason { get; set; } = "";
}

public static class CompetitionAwardStatuses
{
    public const string Draft = "Draft";
    public const string Approved = "Approved";
    public const string Published = "Published";
}
