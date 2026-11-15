using System.ComponentModel.DataAnnotations;
using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Controllers;

public sealed class ExamWriteRequest
{
    [Required, MaxLength(300)] public string Name { get; set; } = "";
    public int FieldGroupId { get; set; }
    [Range(1, 480)] public int DurationMinutes { get; set; } = 30;
    [Range(1, 500)] public int TargetQuestionCount { get; set; } = 30;
    [Range(0, 500)] public int CommonQuestionCount { get; set; } = 0;
    [Range(0, 500)] public int SpecializedQuestionCount { get; set; } = 0;
}

public sealed class FieldGroupWriteRequest
{
    [Required(ErrorMessage = "Vui lòng nhập tên nhóm lĩnh vực."), MaxLength(200)]
    public string Name { get; set; } = "";
    [MaxLength(200)] public string? RankingGroupName { get; set; }
}

public sealed class QuestionWriteRequest
{
    [MaxLength(200)] public string Topic { get; set; } = "";
    [MaxLength(20)] public string Type { get; set; } = "SingleChoice";
    [MaxLength(5000)] public string Content { get; set; } = "";
    public List<QuestionOption> Options { get; set; } = [];
    [MaxLength(20)] public string? CorrectAnswer { get; set; }
    public decimal Points { get; set; }
    public bool IsScenario { get; set; }
    [MaxLength(5000)] public string Explanation { get; set; } = "";
    [MaxLength(2000)] public string Source { get; set; } = "";
    [MaxLength(20)] public string Group { get; set; } = "Common";
    public bool RequiresSourceReview { get; set; }
    public bool SourceReviewed { get; set; }
}

public sealed class ScheduleWriteRequest
{
    public string? OpensAtLocal { get; set; }
    public string? StartDeadlineLocal { get; set; }
    public string? ClosesAtLocal { get; set; }
}
