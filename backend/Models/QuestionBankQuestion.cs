using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public sealed class QuestionBankQuestion
{
    public int Id { get; set; }
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
    public bool IsActive { get; set; } = true;
    public int? CreatedByUserId { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
