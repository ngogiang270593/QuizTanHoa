namespace Quiz_TanHoa.Api.Security;

public sealed record JwtSettings(string Key)
{
    public const string Issuer = "Quiz_TanHoa";
    public const string Audience = "Quiz_TanHoa";
}
