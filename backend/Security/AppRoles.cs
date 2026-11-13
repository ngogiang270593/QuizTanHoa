namespace Quiz_TanHoa.Api.Security;

public static class AppRoles
{
    public const string Organizer = "Organizer";
    public const string Candidate = "Candidate";
    public static bool IsKnown(string role) => role is Organizer or Candidate;
    public static string[] Permissions(string role) => role switch
    {
        Organizer => ["organizer.overview.read", "organizer.users.read", "organizer.competitions.read", "organizer.competitions.write", "organizer.exams.write", "organizer.exams.approve", "organizer.schedule.write", "organizer.assignments.write", "organizer.competitions.publish"],
        Candidate => ["candidate.overview.read", "candidate.competitions.read"],
        _ => []
    };
}
