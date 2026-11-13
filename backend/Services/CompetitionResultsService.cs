using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Services;

/// <summary>One candidate attempt as scored from its issued exam snapshot.</summary>
public sealed record CompetitionResultRow(
    int? AttemptId,
    string CandidateCode,
    string FullName,
    string Department,
    string FieldGroupName,
    string RankingGroupName,
    decimal? CommonScore,
    decimal? SpecializedScore,
    decimal? ScenarioScore,
    decimal? TotalScore,
    int? CorrectAnswersCount,
    long? DurationMilliseconds,
    DateTimeOffset? SubmittedAtUtc,
    string AttemptStatus,
    bool IsValid,
    int? Rank,
    bool HadIncident);

/// <summary>Competition result rows and the available ranking groups.</summary>
public sealed record CompetitionResultsResponse(
    int CompetitionId,
    string CompetitionName,
    IReadOnlyList<string> RankingGroups,
    IReadOnlyList<CompetitionResultRow> Rows);

public interface ICompetitionResultsService
{
    Task<CompetitionResultsResponse?> GetAsync(int competitionId, string? rankingGroupName, CancellationToken cancellationToken);
    byte[] CreateWorkbook(IReadOnlyList<CompetitionResultRow> rows);
}

public sealed class CompetitionResultsService(AppDbContext db, VietnamClock clock) : ICompetitionResultsService
{
    private static readonly string[] WorkbookHeaders =
    [
        "Thứ hạng", "Mã thí sinh", "Họ tên", "Bộ phận", "Nhóm đề", "Nhóm xếp hạng",
        "Số câu đúng", "Thời gian làm bài (giây)", "Điểm chung", "Điểm chuyên môn", "Điểm tình huống", "Tổng điểm",
        "Thời điểm nộp (UTC)", "Trạng thái lượt thi", "Hợp lệ"
    ];

    public async Task<CompetitionResultsResponse?> GetAsync(int competitionId, string? rankingGroupName, CancellationToken cancellationToken)
    {
        var competition = await db.Competitions.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == competitionId, cancellationToken);
        if (competition is null) return null;

        var groupNames = await db.ExamFieldGroups.AsNoTracking()
            .Where(item => item.CompetitionId == competitionId)
            .ToDictionaryAsync(item => item.Id, item => item.RankingGroupName, cancellationToken);
        var assignments = await db.CompetitionAssignments.AsNoTracking()
            .Where(item => item.CompetitionId == competitionId)
            .Include(item => item.User)
            .Include(item => item.Exam).ThenInclude(item => item!.FieldGroup)
            .ToListAsync(cancellationToken);
        var attempts = await db.ExamAttempts.AsNoTracking()
            .Where(item => item.CompetitionId == competitionId)
            .Include(item => item.User)
            .Include(item => item.ExamVersion)
            .Include(item => item.Questions)
            .OrderBy(item => item.Id)
            .ToListAsync(cancellationToken);

        var attemptsByUser = attempts.GroupBy(item => item.UserId).ToDictionary(group => group.Key, group => group.ToList());
        var rows = new List<MutableResultRow>();
        foreach (var assignment in assignments)
        {
            if (attemptsByUser.TryGetValue(assignment.UserId, out var userAttempts) && userAttempts.Count > 0)
            {
                foreach (var attempt in userAttempts)
                    rows.Add(CreateAttemptRow(attempt, groupNames, clock.UtcNow));
            }
            else
            {
                var fieldGroup = assignment.Exam?.FieldGroup;
                var rankingGroup = fieldGroup?.RankingGroupName;
                rows.Add(new MutableResultRow
                {
                    CandidateCode = assignment.User.Username,
                    FullName = assignment.User.FullName,
                    Department = assignment.User.Department,
                    FieldGroupName = fieldGroup?.Name ?? "",
                    RankingGroupName = string.IsNullOrWhiteSpace(rankingGroup) ? fieldGroup?.Name ?? "" : rankingGroup,
                    AttemptStatus = "NotStarted"
                });
            }
        }

        var assignedUserIds = assignments.Select(item => item.UserId).ToHashSet();
        foreach (var attempt in attempts.Where(item => !assignedUserIds.Contains(item.UserId)))
            rows.Add(CreateAttemptRow(attempt, groupNames, clock.UtcNow));

        var attemptIds = rows.Where(row => row.AttemptId.HasValue).Select(row => row.AttemptId!.Value).Distinct().ToArray();
        var attemptsWithIncidents = await db.ExamAttemptAdminEvents.AsNoTracking()
            .Where(item => attemptIds.Contains(item.AttemptId)).Select(item => item.AttemptId).Distinct()
            .ToListAsync(cancellationToken);
        var incidentIds = attemptsWithIncidents.ToHashSet();
        foreach (var row in rows)
            row.HadIncident = row.AttemptId.HasValue && incidentIds.Contains(row.AttemptId.Value);

        AssignRanks(rows);
        var rankingGroups = rows.Select(row => row.RankingGroupName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        IEnumerable<MutableResultRow> visibleRows = rows;
        if (!string.IsNullOrWhiteSpace(rankingGroupName))
        {
            if (!rankingGroups.Contains(rankingGroupName.Trim(), StringComparer.OrdinalIgnoreCase))
                return new CompetitionResultsResponse(competition.Id, competition.Name, rankingGroups, []);
            visibleRows = visibleRows.Where(row => string.Equals(row.RankingGroupName, rankingGroupName.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        return new CompetitionResultsResponse(
            competition.Id,
            competition.Name,
            rankingGroups,
            visibleRows.OrderBy(row => row.RankingGroupName, StringComparer.OrdinalIgnoreCase)
                .ThenBy(row => row.Rank ?? int.MaxValue)
                .ThenBy(row => row.CandidateCode, StringComparer.OrdinalIgnoreCase)
                .Select(row => row.ToResponse())
                .ToArray());
    }

    public byte[] CreateWorkbook(IReadOnlyList<CompetitionResultRow> rows)
    {
        if (rows.Count > 1_048_575)
            throw new InvalidOperationException("Số dòng kết quả vượt giới hạn của một trang tính Excel.");

        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        XNamespace packageRel = "http://schemas.openxmlformats.org/package/2006/relationships";
        XNamespace contentTypes = "http://schemas.openxmlformats.org/package/2006/content-types";
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteXml(archive, "[Content_Types].xml", new XElement(contentTypes + "Types",
                new XElement(contentTypes + "Default", new XAttribute("Extension", "rels"), new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
                new XElement(contentTypes + "Default", new XAttribute("Extension", "xml"), new XAttribute("ContentType", "application/xml")),
                new XElement(contentTypes + "Override", new XAttribute("PartName", "/xl/workbook.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")),
                new XElement(contentTypes + "Override", new XAttribute("PartName", "/xl/worksheets/sheet1.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"))));
            WriteXml(archive, "_rels/.rels", new XElement(packageRel + "Relationships",
                new XElement(packageRel + "Relationship", new XAttribute("Id", "rId1"), new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"), new XAttribute("Target", "xl/workbook.xml"))));
            WriteXml(archive, "xl/workbook.xml", new XElement(main + "workbook",
                new XAttribute(XNamespace.Xmlns + "r", rel),
                new XElement(main + "sheets", new XElement(main + "sheet", new XAttribute("name", "KetQua"), new XAttribute("sheetId", 1), new XAttribute(rel + "id", "rId1")))));
            WriteXml(archive, "xl/_rels/workbook.xml.rels", new XElement(packageRel + "Relationships",
                new XElement(packageRel + "Relationship", new XAttribute("Id", "rId1"), new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"), new XAttribute("Target", "worksheets/sheet1.xml"))));

            var sheetRows = new List<XElement> { BuildRow(1, WorkbookHeaders.Select(value => (string?)value).ToArray()) };
            foreach (var (row, index) in rows.Select((value, index) => (value, index)))
            {
                sheetRows.Add(BuildRow(index + 2,
                [
                    row.Rank?.ToString(CultureInfo.InvariantCulture),
                    row.CandidateCode,
                    row.FullName,
                    row.Department,
                    row.FieldGroupName,
                    row.RankingGroupName,
                    row.CorrectAnswersCount?.ToString(CultureInfo.InvariantCulture),
                    row.DurationMilliseconds.HasValue ? Number(row.DurationMilliseconds.Value / 1000m) : null,
                    Number(row.CommonScore),
                    Number(row.SpecializedScore),
                    Number(row.ScenarioScore),
                    Number(row.TotalScore),
                    row.SubmittedAtUtc?.ToString("O", CultureInfo.InvariantCulture),
                    StatusLabel(row.AttemptStatus),
                    row.IsValid ? "Có" : "Không"
                ]));
            }
            WriteXml(archive, "xl/worksheets/sheet1.xml", new XElement(main + "worksheet",
                new XElement(main + "sheetViews", new XElement(main + "sheetView", new XAttribute("workbookViewId", 0),
                    new XElement(main + "pane", new XAttribute("ySplit", 1), new XAttribute("topLeftCell", "A2"), new XAttribute("activePane", "bottomLeft"), new XAttribute("state", "frozen")))),
                new XElement(main + "sheetData", sheetRows)));
        }
        return output.ToArray();

        XElement BuildRow(int rowNumber, IReadOnlyList<string?> values)
        {
            var cells = new List<XElement>();
            for (var index = 0; index < values.Count; index++)
            {
                var reference = $"{ColumnName(index + 1)}{rowNumber}";
                var value = values[index];
                if (index is 0 or >= 6 and <= 11 && value is not null)
                    cells.Add(new XElement(main + "c", new XAttribute("r", reference), new XElement(main + "v", value)));
                else if (value is not null)
                    cells.Add(new XElement(main + "c", new XAttribute("r", reference), new XAttribute("t", "inlineStr"),
                        new XElement(main + "is", new XElement(main + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), value))));
            }
            return new XElement(main + "row", new XAttribute("r", rowNumber), cells);
        }
    }

    private static string? Number(decimal? value) => value?.ToString(CultureInfo.InvariantCulture);

    private static string ColumnName(int column)
    {
        var name = "";
        while (column > 0)
        {
            column--;
            name = (char)('A' + column % 26) + name;
            column /= 26;
        }
        return name;
    }

    private static void WriteXml(ZipArchive archive, string name, XElement element)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Fastest);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false });
        new XDocument(new XDeclaration("1.0", "utf-8", null), element).Save(writer);
    }

    private static MutableResultRow CreateAttemptRow(ExamAttempt attempt, IReadOnlyDictionary<int, string> groupNames, DateTime now)
    {
        using var snapshot = JsonDocument.Parse(attempt.ExamVersion.SnapshotJson);
        var exam = snapshot.RootElement.GetProperty("exam");
        var fieldGroupId = exam.GetProperty("fieldGroupId").GetInt32();
        var fieldGroupName = exam.TryGetProperty("fieldGroupName", out var nameElement) ? nameElement.GetString() ?? "" : "";
        var rankingGroup = groupNames.TryGetValue(fieldGroupId, out var configuredName) && !string.IsNullOrWhiteSpace(configuredName)
            ? configuredName : fieldGroupName;
        var valid = attempt.SubmittedAtUtc is not null && !attempt.IsInvalidated;
        decimal? common = null;
        decimal? specialized = null;
        decimal? scenario = null;
        decimal? total = null;
        int? correctAnswersCount = null;
        long? durationMilliseconds = null;
        if (attempt.SubmittedAtUtc is not null)
        {
            var answers = attempt.Questions.ToDictionary(item => item.QuestionId, item => item.Answer);
            decimal commonScore = 0;
            decimal specializedScore = 0;
            decimal scenarioScore = 0;
            var correctCount = 0;
            foreach (var question in snapshot.RootElement.GetProperty("questions").EnumerateArray())
            {
                if (!question.TryGetProperty("id", out var idElement) || !answers.TryGetValue(idElement.GetInt32(), out var answer)
                    || string.IsNullOrEmpty(answer)) continue;
                var correct = question.TryGetProperty("correctAnswer", out var correctElement) ? correctElement.GetString() : null;
                if (!string.Equals(answer, correct, StringComparison.OrdinalIgnoreCase)) continue;
                correctCount++;
                var points = question.TryGetProperty("points", out var pointsElement) && pointsElement.TryGetDecimal(out var score) ? score : 0;
                var group = question.TryGetProperty("group", out var groupElement) ? groupElement.GetString() : null;
                if (group == "Common") commonScore += points;
                else if (group == "Specialized") specializedScore += points;
                if (question.TryGetProperty("isScenario", out var scenarioElement) && scenarioElement.ValueKind == JsonValueKind.True)
                    scenarioScore += points;
            }
            common = commonScore;
            specialized = specializedScore;
            scenario = scenarioScore;
            total = commonScore + specializedScore;
            correctAnswersCount = correctCount;
            durationMilliseconds = Math.Max(0L, (long)(attempt.SubmittedAtUtc.Value - attempt.StartedAtUtc).TotalMilliseconds);
        }

        return new MutableResultRow
        {
            AttemptId = attempt.Id,
            CandidateCode = attempt.User.Username,
            FullName = attempt.User.FullName,
            Department = attempt.User.Department,
            FieldGroupName = fieldGroupName,
            RankingGroupName = rankingGroup,
            CommonScore = common,
            SpecializedScore = specialized,
            ScenarioScore = scenario,
            TotalScore = total,
            CorrectAnswersCount = correctAnswersCount,
            DurationMilliseconds = durationMilliseconds,
            SubmittedAtUtc = attempt.SubmittedAtUtc is DateTime submittedAt
                ? new DateTimeOffset(DateTime.SpecifyKind(submittedAt, DateTimeKind.Utc))
                : null,
            AttemptStatus = attempt.IsInvalidated ? "Invalidated"
                : attempt.SubmittedAtUtc is not null ? "Submitted"
                : attempt.DeadlineAtUtc <= now ? "Expired" : "InProgress",
            IsValid = valid
        };
    }

    private static void AssignRanks(List<MutableResultRow> rows)
    {
        var rankGroups = rows.Where(row => row.IsValid && row.TotalScore.HasValue)
            .GroupBy(row => row.RankingGroupName, StringComparer.OrdinalIgnoreCase);
        foreach (var group in rankGroups)
        {
            var sorted = group.OrderByDescending(row => row.CorrectAnswersCount)
                .ThenBy(row => row.DurationMilliseconds)
                .ThenBy(row => row.CandidateCode, StringComparer.OrdinalIgnoreCase)
                .ToList();
            int? previousCorrectCount = null;
            long? previousDuration = null;
            var previousRank = 0;
            for (var index = 0; index < sorted.Count; index++)
            {
                var row = sorted[index];
                var sameResult = index > 0 && row.CorrectAnswersCount == previousCorrectCount
                    && row.DurationMilliseconds == previousDuration;
                if (!sameResult) previousRank = index + 1;
                row.Rank = previousRank;
                previousCorrectCount = row.CorrectAnswersCount;
                previousDuration = row.DurationMilliseconds;
            }
        }
    }

    private static string StatusLabel(string status) => status switch
    {
        "Submitted" => "Đã nộp",
        "Invalidated" => "Đã loại",
        "InProgress" => "Đang làm",
        "Expired" => "Hết hạn",
        _ => "Chưa bắt đầu"
    };

    private sealed class MutableResultRow
    {
        public int? AttemptId { get; init; }
        public string CandidateCode { get; init; } = "";
        public string FullName { get; init; } = "";
        public string Department { get; init; } = "";
        public string FieldGroupName { get; init; } = "";
        public string RankingGroupName { get; init; } = "";
        public decimal? CommonScore { get; init; }
        public decimal? SpecializedScore { get; init; }
        public decimal? ScenarioScore { get; init; }
        public decimal? TotalScore { get; init; }
        public int? CorrectAnswersCount { get; init; }
        public long? DurationMilliseconds { get; init; }
        public DateTimeOffset? SubmittedAtUtc { get; init; }
        public string AttemptStatus { get; init; } = "";
        public bool IsValid { get; init; }
        public bool HadIncident { get; set; }
        public int? Rank { get; set; }

        public CompetitionResultRow ToResponse() => new(
            AttemptId, CandidateCode, FullName, Department, FieldGroupName, RankingGroupName,
            CommonScore, SpecializedScore, ScenarioScore, TotalScore, CorrectAnswersCount, DurationMilliseconds,
            SubmittedAtUtc, AttemptStatus, IsValid, Rank, HadIncident);
    }
}
