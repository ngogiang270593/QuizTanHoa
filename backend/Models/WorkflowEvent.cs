namespace Quiz_TanHoa.Api.Models;
public sealed class WorkflowEvent
{
    public int Id { get; set; }
    public int? ExamId { get; set; }
    public int? UserId { get; set; }
    public int ActorUserId { get; set; }
    public string ActorName { get; set; } = "";
    public string Action { get; set; } = "";
    public string Note { get; set; } = "";
    public int DraftRevision { get; set; }
    public DateTime OccurredAtUtc { get; set; }
}
