using System.ComponentModel.DataAnnotations;
namespace Quiz_TanHoa.Api.Models;
public sealed class AccessProcess
{
 public int Id { get; set; }
 public string Code { get; set; } = "";
 [MaxLength(200)] public string Name { get; set; } = "";
 public string NameKey { get; set; } = "";
 public string Role { get; set; } = "Organizer";
 public string StepsJson { get; set; } = "[]";
 [MaxLength(2000)] public string Description { get; set; } = "";
 public DateTime CreatedAtUtc { get; set; }
 public DateTime UpdatedAtUtc { get; set; }
}
public sealed record AssignedProcess(int Id, string Name, string Role, string[] Steps);
