using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Security;

// Only populated after JWT signature, persisted session and current account checks succeed.
public static class CurrentAccount
{
    private const string UserKey = "QuizTanHoa.CurrentUser";
    private const string SessionKey = "QuizTanHoa.CurrentSession";

    public static void Set(HttpContext context, User user, AuthSession session)
    {
        context.Items[UserKey] = user;
        context.Items[SessionKey] = session;
    }

    public static User User(HttpContext context) => (User)context.Items[UserKey]!;
    public static AuthSession Session(HttpContext context) => (AuthSession)context.Items[SessionKey]!;

    public static object Profile(User user, DateTime expiresAt) => new
    {
        user.Id,
        user.Username,
        user.FullName,
        user.Department,
        user.Role,
        user.IsActive,
        user.IsDemo,
        user.MustChangePassword,
        expiresAt = DateTime.SpecifyKind(expiresAt, DateTimeKind.Utc),
        permissions = AppRoles.Permissions(user.Role)
    };
}
