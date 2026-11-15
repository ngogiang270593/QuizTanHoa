using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public sealed class ExamFieldGroup
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition Competition { get; set; } = null!;
    [MaxLength(200)] public string Name { get; set; } = "";
    [MaxLength(200)] public string RankingGroupName { get; set; } = "";
    public bool IsSample { get; set; } = true;
}

public sealed class Exam
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition Competition { get; set; } = null!;
    public int FieldGroupId { get; set; }
    public ExamFieldGroup FieldGroup { get; set; } = null!;
    [MaxLength(300)] public string Name { get; set; } = "";
    public int DurationMinutes { get; set; } = 30;
    public int TargetQuestionCount { get; set; } = 30;
    public int CommonQuestionCount { get; set; } = 10;
    public int SpecializedQuestionCount { get; set; } = 20;
    public string ReviewStatus { get; set; } = "Draft";
    public int? SubmittedRevision { get; set; }
    public int? SubmittedByUserId { get; set; }
    public DateTime? SubmittedAtUtc { get; set; }
    public string ReviewNote { get; set; } = "";
    public int DraftRevision { get; set; } = 1;
    public int? CurrentApprovedVersionId { get; set; }
    public bool IsDemo { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public ICollection<ExamQuestion> Questions { get; set; } = new List<ExamQuestion>();
}

public sealed class ExamQuestion
{
    [MaxLength(2000)] public string Topic { get; set; } = "";
    public int Id { get; set; }
    public int ExamId { get; set; }
    public Exam Exam { get; set; } = null!;
    public int? BankQuestionId { get; set; }
    public int Position { get; set; }
    [MaxLength(20)] public string Type { get; set; } = "SingleChoice";
    [MaxLength(5000)] public string Content { get; set; } = "";
    public string OptionsJson { get; set; } = "[]";
    [MaxLength(20)] public string? CorrectAnswer { get; set; }
    public decimal Points { get; set; }
    public bool IsScenario { get; set; }
    [MaxLength(5000)] public string Explanation { get; set; } = "";
    [MaxLength(2000)] public string Source { get; set; } = "";
    [MaxLength(20)] public string Group { get; set; } = "Common";
    public bool RequiresSourceReview { get; set; }
    public bool SourceReviewed { get; set; }
    public int? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAtUtc { get; set; }
}

public sealed class QuestionOption
{
    public string Key { get; set; } = "";
    public string Text { get; set; } = "";
}

public sealed class ApprovedExamVersion
{
    public int Id { get; set; }
    public int ExamId { get; set; }
    public Exam Exam { get; set; } = null!;
    public int VersionNumber { get; set; }
    public int DraftRevision { get; set; }
    public string SnapshotJson { get; set; } = "{}";
    [MaxLength(64)] public string HashSha256 { get; set; } = "";
    public DateTime ApprovedAtUtc { get; set; }
    public int ApprovedByUserId { get; set; }
}

// Future attempts must pin an immutable approved version, never the editable draft.
public sealed class ExamAttempt
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int ExamId { get; set; }
    public Exam Exam { get; set; } = null!;
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public int ExamVersionId { get; set; }
    public ApprovedExamVersion ExamVersion { get; set; } = null!;
    public DateTime StartedAtUtc { get; set; }
    public DateTime DeadlineAtUtc { get; set; }
    public DateTime? SubmittedAtUtc { get; set; }
    [MaxLength(64)] public string? OwnerSessionId { get; set; }
    [MaxLength(64)] public string? WriterTabId { get; set; }
    public DateTime? WriterLeaseUntilUtc { get; set; }
    public bool IsInvalidated { get; set; }
    public DateTime? InvalidatedAtUtc { get; set; }
    public int? InvalidatedByUserId { get; set; }
    [MaxLength(1000)] public string? InvalidationReason { get; set; }
    public ICollection<ExamAttemptQuestion> Questions { get; set; } = new List<ExamAttemptQuestion>();
}

public sealed class ExamAttemptQuestion
{
    public int AttemptId { get; set; }
    public ExamAttempt Attempt { get; set; } = null!;
    public int QuestionId { get; set; }
    public int Position { get; set; }
    public string OptionsOrderJson { get; set; } = "[]";
    public string? Answer { get; set; }
    public bool IsMarked { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
}

public sealed class ExamAttemptAdminEvent
{
    public int Id { get; set; }
    public int AttemptId { get; set; }
    public ExamAttempt Attempt { get; set; } = null!;
    public int ActorUserId { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    [MaxLength(32)] public string Action { get; set; } = "";
    [MaxLength(1000)] public string Reason { get; set; } = "";
    [MaxLength(64)] public string? PreviousSessionId { get; set; }
    [MaxLength(64)] public string NewSessionId { get; set; } = "";
    public int? ReplacementAttemptId { get; set; }
}

public sealed class ExamAttemptSessionGrant
{
    public int CompetitionId { get; set; }
    public int UserId { get; set; }
    [MaxLength(64)] public string SessionId { get; set; } = "";
    public int OldAttemptId { get; set; }
    public int ActorUserId { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    [MaxLength(1000)] public string Reason { get; set; } = "";
}
