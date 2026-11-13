using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public class User
{
    public int Id { get; set; }
    [MaxLength(100)]
    public string Username { get; set; } = "";
    [MaxLength(256)]
    public string Password { get; set; } = "";
    [MaxLength(200)]
    public string FullName { get; set; } = "";
    [MaxLength(200)]
    public string Department { get; set; } = "";
    [MaxLength(50)]
    public string Role { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public bool IsDemo { get; set; }
    public bool MustChangePassword { get; set; }
}
