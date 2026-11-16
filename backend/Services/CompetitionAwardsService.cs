using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Services;

/// <summary>One configured prize for a ranking group.</summary>
public sealed record AwardCategory(string RankingGroupName, string AwardName, int Quantity);

/// <summary>One candidate selected for a configured prize.</summary>
public sealed record AwardNomineeInput(int AttemptId, string AwardName, string RankingGroupName);

/// <summary>One saved prize recipient with frozen ranking details.</summary>
public sealed record AwardNominee(
    int AttemptId, string CandidateCode, string FullName, string Department, string FieldGroupName,
    string RankingGroupName, string AwardName, int Rank, decimal CommonScore, decimal SpecializedScore,
    decimal ScenarioScore, decimal TotalScore, DateTimeOffset SubmittedAtUtc, bool BoundaryTie, bool HadIncident);

/// <summary>Current award draft and the result rows available for review.</summary>
public sealed record CompetitionAwardsResponse(
    int CompetitionId, string CompetitionName, string Status, int Revision, bool IndividualScoresPublished,
    bool TieReviewConfirmed, string? AdjustmentReason, IReadOnlyList<AwardCategory> Categories,
    IReadOnlyList<AwardNominee> Nominees, IReadOnlyList<AwardNominee> ProposedNominees,
    IReadOnlyList<CompetitionResultRow> Results, DateTimeOffset? ApprovedAtUtc, int? ApprovedByUserId,
    DateTimeOffset? PublishedAtUtc, int? PublishedByUserId, string CompetitionStatus, IReadOnlyList<CompetitionAwardAudit> Audit);

/// <summary>Candidate-visible score and published award list.</summary>
public sealed record CandidateAwardsResponse(
    bool IndividualScorePublished, CandidatePersonalScore? IndividualScore,
    bool AwardsPublished, IReadOnlyList<CandidateAwardRecipient> Awards, CandidateAttemptSummary? AttemptSummary);

/// <summary>Only the personal score fields approved for candidate publication.</summary>
public sealed record CandidatePersonalScore(
    int? Rank, decimal? CommonScore, decimal? SpecializedScore, decimal? ScenarioScore,
    decimal? TotalScore, DateTimeOffset? SubmittedAtUtc);

/// <summary>Public award details without exposing unpublished scores.</summary>
public sealed record CandidateAttemptSummary(int CorrectAnswersCount, long DurationMilliseconds, DateTimeOffset SubmittedAtUtc);

public sealed record CandidateAwardRecipient(
    string AwardName, string CandidateCode, string FullName, string Department,
    string FieldGroupName, string RankingGroupName, int Rank);

/// <summary>One recorded award-list action.</summary>
public sealed record CompetitionAwardAudit(int ActorUserId, string ActorName, string Action, string Reason, DateTimeOffset OccurredAtUtc);

/// <summary>Payload for saving an award draft.</summary>
public sealed record SaveCompetitionAwardsRequest(
    int Revision, bool IndividualScoresPublished, bool TieReviewConfirmed,
    IReadOnlyList<AwardCategory> Categories, IReadOnlyList<AwardNomineeInput> Nominees,
    string? AdjustmentReason);

/// <summary>Outcome of an organizer award operation.</summary>
public sealed record CompetitionAwardOperation(bool Success, string Message, CompetitionAwardsResponse? Awards = null, bool IsConflict = false, bool IsNotFound = false);

/// <summary>Stores, reviews, publishes, and exports competition award snapshots.</summary>
public interface ICompetitionAwardsService
{
    Task<CompetitionAwardsResponse?> GetAsync(int competitionId, CancellationToken cancellationToken);
    Task<IReadOnlyList<AwardNominee>?> ProposeAsync(int competitionId, IReadOnlyList<AwardCategory> categories, CancellationToken cancellationToken);
    Task<CompetitionAwardOperation> SaveDraftAsync(int competitionId, int actorUserId, SaveCompetitionAwardsRequest request, CancellationToken cancellationToken);
    Task<CompetitionAwardOperation> ApproveAsync(int competitionId, int actorUserId, int revision, string? reason, CancellationToken cancellationToken);
    Task<CompetitionAwardOperation> PublishAsync(int competitionId, int actorUserId, CancellationToken cancellationToken);
    Task<CandidateAwardsResponse?> GetCandidateAsync(int competitionId, int userId, CancellationToken cancellationToken);
    Task<CompetitionAwardOperation> EndCompetitionAsync(int competitionId, int actorUserId, DateTime now, CancellationToken cancellationToken);
    byte[] CreateWorkbook(IReadOnlyList<AwardNominee> nominees);
}

public sealed class CompetitionAwardsService(AppDbContext db, ICompetitionResultsService results, VietnamClock clock) : ICompetitionAwardsService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<CompetitionAwardsResponse?> GetAsync(int competitionId, CancellationToken cancellationToken)
    {
        var competition = await db.Competitions.AsNoTracking().SingleOrDefaultAsync(item => item.Id == competitionId, cancellationToken);
        if (competition is null) return null;
        var plan = await db.CompetitionAwardPlans.AsNoTracking().SingleOrDefaultAsync(item => item.CompetitionId == competitionId, cancellationToken);
        var sourceJson = plan?.ApprovedSnapshotJson is not null
            && plan.Status is CompetitionAwardStatuses.Approved or CompetitionAwardStatuses.Published
            ? plan.ApprovedSnapshotJson : plan?.DraftJson;
        var document = sourceJson is null ? AwardDocument.Empty : ReadDocument(sourceJson);
        var result = await results.GetAsync(competitionId, null, cancellationToken);
        if (result is null) return null;
        var proposed = BuildProposal(document.Categories, result.Rows);
        var auditRows = await db.CompetitionAwardEvents.AsNoTracking().Where(item => item.CompetitionId == competitionId)
            .OrderBy(item => item.OccurredAtUtc).Join(db.Users.AsNoTracking(), item => item.ActorUserId, user => user.Id,
                (item, user) => new CompetitionAwardAudit(item.ActorUserId, user.FullName, item.Action, item.Reason,
                    new DateTimeOffset(DateTime.SpecifyKind(item.OccurredAtUtc, DateTimeKind.Utc))))
            .ToListAsync(cancellationToken);
        return new CompetitionAwardsResponse(competitionId, competition.Name, plan?.Status ?? CompetitionAwardStatuses.Draft,
            plan?.Revision ?? 0, document.IndividualScoresPublished, document.TieReviewConfirmed, document.AdjustmentReason,
            document.Categories, document.Nominees, proposed, result.Rows, Utc(plan?.ApprovedAtUtc), plan?.ApprovedByUserId,
            Utc(plan?.PublishedAtUtc), plan?.PublishedByUserId, competition.Status, auditRows);
    }

    public async Task<IReadOnlyList<AwardNominee>?> ProposeAsync(
        int competitionId, IReadOnlyList<AwardCategory> categories, CancellationToken cancellationToken)
    {
        var competitionExists = await db.Competitions.AnyAsync(item => item.Id == competitionId, cancellationToken);
        if (!competitionExists) return null;
        var result = await results.GetAsync(competitionId, null, cancellationToken);
        return result is null ? null : BuildProposal(categories, result.Rows);
    }

    public async Task<CompetitionAwardOperation> SaveDraftAsync(
        int competitionId, int actorUserId, SaveCompetitionAwardsRequest request, CancellationToken cancellationToken)
    {
        if (request.Categories is null || request.Nominees is null
            || request.Categories.Any(item => item is null) || request.Nominees.Any(item => item is null))
            return Invalid("Cần gửi đầy đủ cấu hình giải và danh sách thí sinh.");
        if (request.Categories.Count is < 1 or > 100 || request.Nominees.Count > 10_000)
            return Invalid("Cấu hình cần có từ 1 đến 100 hạng giải; danh sách dự kiến vượt giới hạn.");
        if (request.Categories.Any(item => string.IsNullOrWhiteSpace(item.RankingGroupName)
            || item.RankingGroupName.Length > 200 || string.IsNullOrWhiteSpace(item.AwardName)
            || item.AwardName.Trim().Length > 100 || item.Quantity is < 1 or > 1000))
            return Invalid("Mỗi hạng giải cần nhóm xếp hạng, tên giải và số lượng từ 1 đến 1.000 hợp lệ.");
        if (request.Categories.GroupBy(item => $"{item.RankingGroupName.Trim().ToUpperInvariant()}|{item.AwardName.Trim().ToUpperInvariant()}").Any(group => group.Count() > 1))
            return Invalid("Tên giải bị trùng trong cùng một nhóm xếp hạng.");

        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == competitionId, cancellationToken);
        if (competition is null) return Missing();
        if (competition.Status == CompetitionStatuses.Ended) return Conflict("Cuộc thi đã kết thúc.");
        var result = await results.GetAsync(competitionId, null, cancellationToken);
        if (result is null) return Missing();
        if (request.Categories.Any(category => !result.RankingGroups.Contains(category.RankingGroupName.Trim(), StringComparer.OrdinalIgnoreCase)))
            return Invalid("Một hoặc nhiều nhóm xếp hạng không thuộc cuộc thi này.");

        var categoryKeys = request.Categories.Select(item => CategoryKey(item.RankingGroupName, item.AwardName)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (request.Nominees.Any(item => !categoryKeys.Contains(CategoryKey(item.RankingGroupName, item.AwardName))))
            return Invalid("Mỗi thí sinh phải gắn với một hạng giải đã cấu hình trong đúng nhóm.");
        if (request.Nominees.Select(item => item.AttemptId).Distinct().Count() != request.Nominees.Count)
            return Invalid("Một lượt thi không thể nhận nhiều giải trong cùng danh sách.");

        var rowByAttempt = result.Rows.Where(row => row.AttemptId.HasValue)
            .ToDictionary(row => row.AttemptId!.Value);
        var nominees = new List<AwardNominee>();
        foreach (var input in request.Nominees)
        {
            if (!rowByAttempt.TryGetValue(input.AttemptId, out var row) || !row.IsValid || row.Rank is null
                || row.TotalScore is null || row.SubmittedAtUtc is null
                || !string.Equals(row.RankingGroupName, input.RankingGroupName.Trim(), StringComparison.OrdinalIgnoreCase))
                return Invalid("Chỉ lượt đã nộp, hợp lệ và thuộc đúng nhóm xếp hạng mới được đưa vào danh sách.");
            nominees.Add(ToNominee(row, input.AwardName.Trim(), false));
        }

        var proposed = BuildProposal(request.Categories, result.Rows);
        var sameAsProposal = SameNominees(proposed, nominees);
        var adjustmentReason = request.AdjustmentReason?.Trim();
        if (!sameAsProposal && string.IsNullOrWhiteSpace(adjustmentReason))
            return Invalid("Cần ghi lý do khi điều chỉnh danh sách dự kiến so với bảng xếp hạng.");
        if (adjustmentReason?.Length > 1000) return Invalid("Lý do điều chỉnh không được vượt quá 1.000 ký tự.");
        nominees = nominees.Select(item => item with { BoundaryTie = proposed.Any(candidate =>
            candidate.AttemptId == item.AttemptId && candidate.BoundaryTie), HadIncident = rowByAttempt[item.AttemptId].HadIncident }).ToList();
        var document = new AwardDocument(request.Categories.Select(item =>
            new AwardCategory(item.RankingGroupName.Trim(), item.AwardName.Trim(), item.Quantity)).ToArray(),
            nominees, request.IndividualScoresPublished, request.TieReviewConfirmed, sameAsProposal ? null : adjustmentReason,
            ResultFingerprint(result.Rows));

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var plan = await db.CompetitionAwardPlans.SingleOrDefaultAsync(item => item.CompetitionId == competitionId, cancellationToken);
        var now = clock.UtcNow;
        if (plan is null)
        {
            if (request.Revision != 0) return Conflict("Danh sách đã được thay đổi. Hãy tải lại trước khi lưu.");
            plan = new CompetitionAwardPlan
            {
                CompetitionId = competitionId, Revision = 1, Status = CompetitionAwardStatuses.Draft,
                DraftJson = JsonSerializer.Serialize(document, JsonOptions), CreatedAtUtc = now, UpdatedAtUtc = now
            };
            db.CompetitionAwardPlans.Add(plan);
        }
        else
        {
            if (plan.Status == CompetitionAwardStatuses.Published) return Conflict("Danh sách đã công bố và không thể sửa.");
            if (plan.Revision != request.Revision) return Conflict("Danh sách đã được thay đổi. Hãy tải lại trước khi lưu.");
            if (plan.Status == CompetitionAwardStatuses.Approved)
                AddEvent(competitionId, actorUserId, now, "ApprovalWithdrawn", adjustmentReason ?? "Mở lại danh sách để chỉnh sửa.");
            plan.Status = CompetitionAwardStatuses.Draft;
            plan.Revision++;
            plan.DraftJson = JsonSerializer.Serialize(document, JsonOptions);
            plan.ApprovedSnapshotJson = null;
            plan.ApprovedAtUtc = null;
            plan.ApprovedByUserId = null;
            plan.UpdatedAtUtc = now;
        }
        AddEvent(competitionId, actorUserId, now, "DraftSaved", adjustmentReason ?? "Lưu danh sách dự kiến.");
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("Danh sách đã được thay đổi đồng thời. Hãy tải lại trước khi lưu.");
        }
        await transaction.CommitAsync(cancellationToken);
        return new CompetitionAwardOperation(true, "Đã lưu danh sách dự kiến.", await GetAsync(competitionId, cancellationToken));
    }

    public async Task<CompetitionAwardOperation> ApproveAsync(
        int competitionId, int actorUserId, int revision, string? reason, CancellationToken cancellationToken)
    {
        var plan = await db.CompetitionAwardPlans.SingleOrDefaultAsync(item => item.CompetitionId == competitionId, cancellationToken);
        if (plan is null) return Missing();
        if (plan.Status != CompetitionAwardStatuses.Draft) return Conflict("Chỉ danh sách dự kiến mới có thể được duyệt.");
        if (plan.Revision != revision) return Conflict("Danh sách đã được thay đổi. Hãy tải lại trước khi duyệt.");
        var document = ReadDocument(plan.DraftJson);
        if (document.Nominees.Count == 0) return Invalid("Chưa có thí sinh trong danh sách dự kiến.");
        var competitionResults = await results.GetAsync(competitionId, null, cancellationToken);
        if (competitionResults is null) return Missing();
        if (!string.Equals(document.ResultFingerprint, ResultFingerprint(competitionResults.Rows), StringComparison.Ordinal))
            return Invalid("Bảng kết quả đã thay đổi sau khi lưu dự kiến. Hãy tải lại và lập danh sách mới trước khi duyệt.");
        if (!document.TieReviewConfirmed && BuildProposal(document.Categories, competitionResults.Rows).Any(item => item.BoundaryTie))
            return Invalid("Cần xác nhận đã rà soát các trường hợp đồng hạng tại vị trí xét giải theo thể lệ.");
        var competition = await db.Competitions.SingleAsync(item => item.Id == competitionId, cancellationToken);
        if (competition.Status == CompetitionStatuses.Ended) return Conflict("Cuộc thi đã kết thúc.");
        var now = clock.UtcNow;
        plan.Status = CompetitionAwardStatuses.Approved;
        plan.ApprovedSnapshotJson = plan.DraftJson;
        plan.ApprovedAtUtc = now;
        plan.ApprovedByUserId = actorUserId;
        plan.UpdatedAtUtc = now;
        AddEvent(competitionId, actorUserId, now, "Approved", reason?.Trim() ?? "Duyệt danh sách dự kiến.");
        await db.SaveChangesAsync(cancellationToken);
        return new CompetitionAwardOperation(true, "Đã duyệt danh sách giải.", await GetAsync(competitionId, cancellationToken));
    }

    public async Task<CompetitionAwardOperation> PublishAsync(
        int competitionId, int actorUserId, CancellationToken cancellationToken)
    {
        var plan = await db.CompetitionAwardPlans.SingleOrDefaultAsync(item => item.CompetitionId == competitionId, cancellationToken);
        if (plan is null) return Missing();
        if (plan.Status == CompetitionAwardStatuses.Published)
            return new CompetitionAwardOperation(true, "Danh sách giải đã được công bố.", await GetAsync(competitionId, cancellationToken));
        if (plan.Status != CompetitionAwardStatuses.Approved || plan.ApprovedSnapshotJson is null)
            return Conflict("Chỉ danh sách đã duyệt mới có thể công bố.");
        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == competitionId, cancellationToken);
        if (competition is null) return Missing();
        if (competition.Status == CompetitionStatuses.Draft) return Conflict("Chỉ có thể công bố giải của cuộc thi đã công bố.");
        var currentResults = await results.GetAsync(competitionId, null, cancellationToken);
        var approvedDocument = ReadDocument(plan.ApprovedSnapshotJson);
        if (currentResults is null) return Missing();
        if (!string.Equals(approvedDocument.ResultFingerprint, ResultFingerprint(currentResults.Rows), StringComparison.Ordinal))
            return Conflict("Bảng kết quả đã thay đổi sau khi duyệt. Hãy mở lại, rà soát và duyệt danh sách mới.");
        var now = clock.UtcNow;
        plan.Status = CompetitionAwardStatuses.Published;
        plan.PublishedAtUtc = now;
        plan.PublishedByUserId = actorUserId;
        plan.UpdatedAtUtc = now;
        AddEvent(competitionId, actorUserId, now, "Published", "Công bố danh sách đạt giải.");
        await db.SaveChangesAsync(cancellationToken);
        return new CompetitionAwardOperation(true, "Đã công bố danh sách đạt giải.", await GetAsync(competitionId, cancellationToken));
    }

    public async Task<CandidateAwardsResponse?> GetCandidateAsync(int competitionId, int userId, CancellationToken cancellationToken)
    {
        var assignment = await db.CompetitionAssignments.AsNoTracking().Include(item => item.Competition)
            .Include(item => item.Exam).Include(item => item.ExamVersion)
            .SingleOrDefaultAsync(item => item.CompetitionId == competitionId && item.UserId == userId
                && (item.Competition.Status == CompetitionStatuses.Published
                    || item.Competition.Status == CompetitionStatuses.Ended
                        && db.CompetitionAwardPlans.Any(plan => plan.CompetitionId == item.CompetitionId
                            && plan.Status == CompetitionAwardStatuses.Published))
                && item.ExamId != null && item.ExamVersionId != null
                && item.Exam != null && item.ExamVersion != null
                && item.Exam.CompetitionId == item.CompetitionId
                && item.ExamVersion.ExamId == item.ExamId,
                cancellationToken);
        if (assignment is null) return null;
        var plan = await db.CompetitionAwardPlans.AsNoTracking().SingleOrDefaultAsync(item => item.CompetitionId == competitionId, cancellationToken);
        var sourceJson = plan?.ApprovedSnapshotJson is not null
            && plan.Status is CompetitionAwardStatuses.Approved or CompetitionAwardStatuses.Published
            ? plan.ApprovedSnapshotJson : plan?.DraftJson;
        var document = sourceJson is null ? AwardDocument.Empty : ReadDocument(sourceJson);
        var scoreIsPublic = document.IndividualScoresPublished;
        var result = await results.GetAsync(competitionId, null, cancellationToken);
        var username = await db.Users.AsNoTracking().Where(user => user.Id == userId)
            .Select(user => user.Username).SingleAsync(cancellationToken);
        var row = result?.Rows.FirstOrDefault(item => item.IsValid
            && string.Equals(item.CandidateCode, username, StringComparison.OrdinalIgnoreCase));
        CandidatePersonalScore? individualScore = scoreIsPublic && row is not null
            ? new CandidatePersonalScore(row.Rank, row.CommonScore, row.SpecializedScore, row.ScenarioScore, row.TotalScore, row.SubmittedAtUtc)
            : null;
        CandidateAttemptSummary? attemptSummary = row?.CorrectAnswersCount is int correct && row.DurationMilliseconds is long duration && row.SubmittedAtUtc is DateTimeOffset submitted
            ? new CandidateAttemptSummary(correct, duration, submitted)
            : null;
        var published = plan?.Status == CompetitionAwardStatuses.Published && plan.ApprovedSnapshotJson is not null;
        var awards = published
            ? ReadDocument(plan!.ApprovedSnapshotJson!).Nominees.Select(item => new CandidateAwardRecipient(
                item.AwardName, item.CandidateCode, item.FullName, item.Department, item.FieldGroupName,
                item.RankingGroupName, item.Rank)).ToArray()
            : [];
        return new CandidateAwardsResponse(scoreIsPublic, individualScore, published, awards, attemptSummary);
    }

    public async Task<CompetitionAwardOperation> EndCompetitionAsync(
        int competitionId, int actorUserId, DateTime now, CancellationToken cancellationToken)
    {
        await AttemptFinalizer.FinalizeDueAsync(db, now, cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var competition = await db.Competitions.SingleOrDefaultAsync(item => item.Id == competitionId, cancellationToken);
        if (competition is null) return Missing();
        if (competition.Status == CompetitionStatuses.Ended)
            return new CompetitionAwardOperation(true, "Cuộc thi đã kết thúc.");
        if (competition.Status != CompetitionStatuses.Published) return Conflict("Chỉ cuộc thi đã công bố mới có thể kết thúc.");
        var plan = await db.CompetitionAwardPlans.SingleOrDefaultAsync(item => item.CompetitionId == competitionId, cancellationToken);
        if (plan?.Status != CompetitionAwardStatuses.Published) return Conflict("Cần công bố danh sách đạt giải trước khi kết thúc cuộc thi.");
        if (await db.ExamAttempts.AnyAsync(item => item.CompetitionId == competitionId && !item.IsInvalidated
            && item.SubmittedAtUtc == null && item.DeadlineAtUtc > now, cancellationToken))
            return Conflict("Chưa thể kết thúc khi còn thí sinh đang làm bài.");
        competition.Status = CompetitionStatuses.Ended;
        competition.UpdatedAtUtc = now;
        AddEvent(competitionId, actorUserId, now, "CompetitionEnded", "Kết thúc cuộc thi.");
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new CompetitionAwardOperation(true, "Đã kết thúc cuộc thi.");
    }

    public byte[] CreateWorkbook(IReadOnlyList<AwardNominee> nominees)
    {
        if (nominees.Count > 1_048_575) throw new InvalidOperationException("Danh sách vượt giới hạn của một trang tính Excel.");
        XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        XNamespace packageRel = "http://schemas.openxmlformats.org/package/2006/relationships";
        XNamespace contentTypes = "http://schemas.openxmlformats.org/package/2006/content-types";
        string[] headers = ["Giải", "Hạng", "Mã thí sinh", "Họ tên", "Bộ phận", "Nhóm đề", "Nhóm xếp hạng", "Điểm chung", "Điểm chuyên môn", "Điểm tình huống", "Tổng điểm", "Thời điểm nộp (UTC)", "Có sự cố", "Đồng hạng tại vị trí xét giải"];
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, true))
        {
            WriteXml(archive, "[Content_Types].xml", new XElement(contentTypes + "Types",
                new XElement(contentTypes + "Default", new XAttribute("Extension", "rels"), new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
                new XElement(contentTypes + "Default", new XAttribute("Extension", "xml"), new XAttribute("ContentType", "application/xml")),
                new XElement(contentTypes + "Override", new XAttribute("PartName", "/xl/workbook.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")),
                new XElement(contentTypes + "Override", new XAttribute("PartName", "/xl/worksheets/sheet1.xml"), new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"))));
            WriteXml(archive, "_rels/.rels", new XElement(packageRel + "Relationships", new XElement(packageRel + "Relationship",
                new XAttribute("Id", "rId1"), new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"), new XAttribute("Target", "xl/workbook.xml"))));
            WriteXml(archive, "xl/workbook.xml", new XElement(main + "workbook", new XAttribute(XNamespace.Xmlns + "r", rel),
                new XElement(main + "sheets", new XElement(main + "sheet", new XAttribute("name", "XetGiai"), new XAttribute("sheetId", 1), new XAttribute(rel + "id", "rId1")))));
            WriteXml(archive, "xl/_rels/workbook.xml.rels", new XElement(packageRel + "Relationships", new XElement(packageRel + "Relationship",
                new XAttribute("Id", "rId1"), new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"), new XAttribute("Target", "worksheets/sheet1.xml"))));
            var rows = new List<XElement> { BuildRow(1, headers) };
            foreach (var (item, index) in nominees.Select((value, index) => (value, index)))
                rows.Add(BuildRow(index + 2, [item.AwardName, item.Rank.ToString(CultureInfo.InvariantCulture), item.CandidateCode, item.FullName,
                    item.Department, item.FieldGroupName, item.RankingGroupName, Number(item.CommonScore), Number(item.SpecializedScore),
                    Number(item.ScenarioScore), Number(item.TotalScore), item.SubmittedAtUtc.ToString("O", CultureInfo.InvariantCulture),
                    item.HadIncident ? "Có" : "Không", item.BoundaryTie ? "Có" : "Không"]));
            WriteXml(archive, "xl/worksheets/sheet1.xml", new XElement(main + "worksheet",
                new XElement(main + "sheetViews", new XElement(main + "sheetView", new XAttribute("workbookViewId", 0),
                    new XElement(main + "pane", new XAttribute("ySplit", 1), new XAttribute("topLeftCell", "A2"), new XAttribute("activePane", "bottomLeft"), new XAttribute("state", "frozen")))),
                new XElement(main + "sheetData", rows)));

            XElement BuildRow(int rowNumber, IReadOnlyList<string?> values)
            {
                var cells = new List<XElement>();
                for (var index = 0; index < values.Count; index++)
                {
                    if (values[index] is not { } value) continue;
                    var reference = $"{ColumnName(index + 1)}{rowNumber}";
                    if (index is 1 or >= 7 and <= 10)
                        cells.Add(new XElement(main + "c", new XAttribute("r", reference), new XElement(main + "v", value)));
                    else
                        cells.Add(new XElement(main + "c", new XAttribute("r", reference), new XAttribute("t", "inlineStr"),
                            new XElement(main + "is", new XElement(main + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), value))));
                }
                return new XElement(main + "row", new XAttribute("r", rowNumber), cells);
            }
        }
        return output.ToArray();
    }

    private static List<AwardNominee> BuildProposal(IReadOnlyList<AwardCategory> categories, IReadOnlyList<CompetitionResultRow> rows)
    {
        var nominees = new List<AwardNominee>();
        foreach (var group in categories.GroupBy(item => item.RankingGroupName, StringComparer.OrdinalIgnoreCase))
        {
            var ranked = rows.Where(row => row.IsValid && row.Rank.HasValue && row.TotalScore.HasValue
                    && string.Equals(row.RankingGroupName, group.Key, StringComparison.OrdinalIgnoreCase))
                .OrderBy(row => row.Rank).ThenBy(row => row.CandidateCode, StringComparer.OrdinalIgnoreCase).ToList();
            var offset = 0;
            foreach (var category in group)
            {
                if (offset >= ranked.Count) continue;
                var selected = ranked.Skip(offset).Take(category.Quantity).ToList();
                if (selected.Count == 0) continue;
                var boundaryRank = selected[^1].Rank;
                var tiedRows = ranked.Where(row => row.Rank == boundaryRank).ToArray();
                var tie = tiedRows.Length > 1;
                selected = ranked.Skip(offset).TakeWhile((row, index) => index < category.Quantity || row.Rank == boundaryRank).ToList();
                nominees.AddRange(selected.Select(row => ToNominee(row, category.AwardName, tie)));
                offset += selected.Count;
            }
        }
        return nominees;
    }

    private static AwardNominee ToNominee(CompetitionResultRow row, string awardName, bool boundaryTie) => new(
        row.AttemptId!.Value, row.CandidateCode, row.FullName, row.Department, row.FieldGroupName, row.RankingGroupName,
        awardName, row.Rank!.Value, row.CommonScore ?? 0, row.SpecializedScore ?? 0, row.ScenarioScore ?? 0,
        row.TotalScore!.Value, row.SubmittedAtUtc!.Value, boundaryTie, row.HadIncident);

    private static bool SameNominees(IReadOnlyList<AwardNominee> left, IReadOnlyList<AwardNominee> right) =>
        left.Select(item => CategoryKey(item.AttemptId.ToString(CultureInfo.InvariantCulture), item.AwardName))
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .SequenceEqual(right.Select(item => CategoryKey(item.AttemptId.ToString(CultureInfo.InvariantCulture), item.AwardName))
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase);

    private void AddEvent(int competitionId, int actorUserId, DateTime occurredAtUtc, string action, string reason) =>
        db.CompetitionAwardEvents.Add(new CompetitionAwardEvent
        {
            CompetitionId = competitionId, ActorUserId = actorUserId, OccurredAtUtc = occurredAtUtc,
            Action = action, Reason = reason.Length > 1000 ? reason[..1000] : reason
        });

    private static AwardDocument ReadDocument(string json) =>
        JsonSerializer.Deserialize<AwardDocument>(json, JsonOptions) ?? AwardDocument.Empty;
    private static CompetitionAwardOperation Missing() => new(false, "Không tìm thấy cuộc thi hoặc danh sách xét giải.", IsNotFound: true);
    private static CompetitionAwardOperation Invalid(string message) => new(false, message);
    private static CompetitionAwardOperation Conflict(string message) => new(false, message, IsConflict: true);
    private static DateTimeOffset? Utc(DateTime? value) => value is DateTime date
        ? new DateTimeOffset(DateTime.SpecifyKind(date, DateTimeKind.Utc)) : null;
    private static string CategoryKey(string group, string award) => $"{group.Trim()}|{award.Trim()}";
    private static string ResultFingerprint(IReadOnlyList<CompetitionResultRow> rows)
    {
        var content = string.Join('\n', rows.Where(row => row.IsValid && row.AttemptId.HasValue)
            .OrderBy(row => row.AttemptId)
            .Select(row => string.Join('|', row.AttemptId, row.CandidateCode, row.FullName, row.Department,
                row.FieldGroupName, row.RankingGroupName, row.Rank,
                row.CommonScore?.ToString(CultureInfo.InvariantCulture), row.SpecializedScore?.ToString(CultureInfo.InvariantCulture),
                row.ScenarioScore?.ToString(CultureInfo.InvariantCulture), row.TotalScore?.ToString(CultureInfo.InvariantCulture),
                row.SubmittedAtUtc?.ToString("O", CultureInfo.InvariantCulture), row.AttemptStatus, row.HadIncident)));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content)));
    }
    private static string? Number(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    private static string ColumnName(int column)
    {
        var name = "";
        while (column > 0) { column--; name = (char)('A' + column % 26) + name; column /= 26; }
        return name;
    }

    private static void WriteXml(ZipArchive archive, string name, XElement element)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Fastest);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false });
        new XDocument(new XDeclaration("1.0", "utf-8", null), element).Save(writer);
    }

    private sealed record AwardDocument(
        IReadOnlyList<AwardCategory> Categories, IReadOnlyList<AwardNominee> Nominees,
        bool IndividualScoresPublished, bool TieReviewConfirmed, string? AdjustmentReason, string ResultFingerprint)
    {
        public static AwardDocument Empty { get; } = new([], [], false, false, null, "");
    }
}
