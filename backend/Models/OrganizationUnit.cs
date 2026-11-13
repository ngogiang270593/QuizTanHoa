using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public sealed class OrganizationUnit
{
    public int Id { get; set; }
    [MaxLength(200)] public string Name { get; set; } = "";
    [MaxLength(50)] public string Code { get; set; } = "";
    public int SortOrder { get; set; }
}
