using System.ComponentModel.DataAnnotations;
namespace Quiz_TanHoa.Api.Models;
public sealed class QuestionTopic
{
    public int Id { get; set; }
    [MaxLength(2000)] public string Name { get; set; } = "";
    [MaxLength(2000)] public string NameKey { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
