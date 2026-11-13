using System.Text.RegularExpressions;

namespace Quiz_TanHoa.Api.Services;

public static partial class CompetitionScoringRules
{
    [GeneratedRegex(@"điểm\s+(?:phần\s+)?tình\s+huống", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ScenarioTieBreakPhrase();

    public static bool EnablesScenarioTieBreak(string rules) => ScenarioTieBreakPhrase().IsMatch(rules);
}
