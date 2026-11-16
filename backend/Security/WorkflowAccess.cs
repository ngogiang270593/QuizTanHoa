using System.Text.Json;
using Quiz_TanHoa.Api.Models;
namespace Quiz_TanHoa.Api.Security;
public static class WorkflowAccess
{
    public static readonly string[] All = ["draft", "submit", "approve", "operate", "manageUsers"];
    public static string[] Permissions(User user)
    {
        if (user.Role != AppRoles.Organizer) return [];
        if (user.ResolvedWorkflowPermissions is not null) return user.ResolvedWorkflowPermissions;
        if (user.ProcessIdsJson is not null) return [];
        if (user.WorkflowPermissionsJson is null) return All;
        try { return (JsonSerializer.Deserialize<string[]>(user.WorkflowPermissionsJson) ?? []).Where(All.Contains).Distinct().ToArray(); } catch { return []; }
    }
    public static string Group(User user) => user.Role == AppRoles.Candidate ? "Candidate" : Has(user,"manageUsers") ? "SystemAdmin" : "Editorial";
    public static bool Has(User user, string permission) => Permissions(user).Contains(permission);
    public static object Profile(User user) => new { user.Id, user.Username, user.FullName, user.Department, user.Role, user.IsActive, user.IsDemo, accountGroup = Group(user), workflowPermissions = Permissions(user), accessLabel = Label(user), processIds = ProcessAccess.Ids(user), assignedProcesses = user.AssignedProcesses, processPermissionKeys = user.ProcessPermissionKeys };
    public static string Label(User user)
    {
        if (user.AssignedProcesses.Length > 0) return string.Join(" + ", user.AssignedProcesses.Select(p => p.Name));
        var p = Permissions(user);
        if (user.Role == AppRoles.Candidate) return "Thí sinh";
        if (p.Length == 5) return "Quản trị viên";
        if (p.Length == 2 && p.Contains("draft") && p.Contains("submit")) return "Biên soạn";
        if (p.Length == 1 && p[0] == "approve") return "Người duyệt";
        if (p.Length == 1 && p[0] == "operate") return "Tổ chức thi";
        return "Quyền tùy chỉnh";
    }
    public static string[]? Required(string[] parts, string method)
    {
        if (parts.Length < 3 || parts[1] != "organizer") return null;
        var write = method is not ("GET" or "HEAD" or "OPTIONS");
        var resource = parts[2]; var sub = parts.ElementAtOrDefault(4); var action = parts.ElementAtOrDefault(6);
        if (resource is "system-summary" or "activity" or "processes") return ["manageUsers"];
        if (resource == "organization-units") return write ? ["manageUsers"] : null;
        if (resource == "review-queue") return ["approve"];
        if (resource == "users") return ["manageUsers"];
        if (resource == "topics") return write ? ["draft", "manageUsers"] : ["draft", "approve", "submit", "manageUsers"];
        if (resource == "question-bank") return write ? ["draft"] : ["draft", "approve", "submit"];
        if (resource != "competitions") return null;
        if (parts.Length <= 4) return write ? ["draft"] : ["draft", "submit", "approve", "operate"];
        if (sub == "results" && !write) return parts.Contains("excel") ? ["operate"] : ["operate", "approve"];
        if (sub is "schedule" or "assignments" or "assignment-options" or "publication" or "publish" or "end" or "results") return ["operate"];
        if (sub == "awards") return write ? ["operate"] : parts.Contains("excel") ? ["operate"] : ["operate", "approve"];
        if (sub == "field-groups") return write ? ["draft"] : ["draft", "submit", "approve", "operate"];
        if (sub == "exams")
        {
            if (action is "submit-review" or "withdraw-review") return ["submit"];
            if (action is "approve" or "return-review") return ["approve"];
            if (action == "review-history" || !write && action is "questions" or "preview" or "versions" or "import-template") return ["draft", "submit", "approve"];
            return write ? ["draft"] : ["draft", "submit", "approve", "operate"];
        }
        return write ? ["operate"] : null;
    }
}
public sealed class WorkflowConflictException(string message) : Exception(message);
