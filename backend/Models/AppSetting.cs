using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public sealed class AppSetting
{
    [Key, MaxLength(100)]
    public string Key { get; set; } = "";
    [MaxLength(500)]
    public string Value { get; set; } = "";
}
