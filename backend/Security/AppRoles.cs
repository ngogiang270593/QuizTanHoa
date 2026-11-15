namespace Quiz_TanHoa.Api.Security;

public static class AppRoles
{
    public const string Organizer = "Organizer";
    public const string Candidate = "Candidate";
    public static string[] Permissions(Quiz_TanHoa.Api.Models.User user)
    {
        if (user.Role == Candidate) return Permissions(Candidate);
        if (user.Role != Organizer) return [];
        var result = new List<string> { "organizer.overview.read", "organizer.competitions.read" };
        if (WorkflowAccess.Has(user, "draft")) result.AddRange(["organizer.competitions.write", "organizer.exams.write"]);
        if (WorkflowAccess.Has(user, "submit")) result.Add("organizer.exams.submit");
        if (WorkflowAccess.Has(user, "approve")) result.Add("organizer.exams.approve");
        if (WorkflowAccess.Has(user, "operate")) result.AddRange(["organizer.schedule.write", "organizer.assignments.write", "organizer.competitions.publish"]);
        if (WorkflowAccess.Has(user, "manageUsers")) result.AddRange(["organizer.users.read", "organizer.users.write"]);
        return result.ToArray();
    }
    public static bool IsKnown(string role) => role is Organizer or Candidate;
    public static string[] Permissions(string role) => role switch
    {
        Organizer => ["organizer.overview.read", "organizer.users.read", "organizer.competitions.read", "organizer.competitions.write", "organizer.exams.write", "organizer.exams.approve", "organizer.schedule.write", "organizer.assignments.write", "organizer.competitions.publish"],
        Candidate => ["candidate.overview.read", "candidate.competitions.read"],
        _ => []
    };
}
