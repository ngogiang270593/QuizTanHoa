namespace Quiz_TanHoa.Api.Models;

// One assignment per user/competition; the approved version is pinned explicitly.
public sealed class CompetitionAssignment
{
    public int CompetitionId { get; set; }
    public Competition Competition { get; set; } = null!;
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public int? ExamId { get; set; }
    public Exam? Exam { get; set; }
    public int? ExamVersionId { get; set; }
    public ApprovedExamVersion? ExamVersion { get; set; }
    public DateTime? AssignedAtUtc { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    public int? AssignedByUserId { get; set; }
}
