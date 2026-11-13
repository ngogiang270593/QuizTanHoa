using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public sealed class AuthSession
{
    [MaxLength(64)]
    public string Id { get; set; } = "";
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public DateTime CreatedAtUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? RevokedAtUtc { get; set; }
}
