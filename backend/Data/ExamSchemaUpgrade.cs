using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Data;

public static class ExamSchemaUpgrade
{
    public static readonly string[] SampleFieldGroups = ["Kiến thức chung", "Kinh tế và hạ tầng", "Đất đai và môi trường", "Tài chính", "Hành chính và tư pháp", "Văn hóa và xã hội"];

    public static IEnumerable<ExamFieldGroup> CreateGroups(int competitionId) => SampleFieldGroups.Select(name => new ExamFieldGroup { CompetitionId = competitionId, Name = name, RankingGroupName = name, IsSample = true });

    private static async Task AddColumn(AppDbContext db, DbTransaction transaction, string table, string name, string definition)
    {
        var exists = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = $"PRAGMA table_info(\"{table}\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) exists |= reader.GetString(1) == name;
        }
        if (!exists)
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.Transaction = transaction;
            command.CommandText = $"ALTER TABLE \"{table}\" ADD COLUMN \"{name}\" {definition}";
            await command.ExecuteNonQueryAsync();
        }
    }

    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        await AddColumn(db, transaction, "Competitions", "DurationMinutes", "INTEGER NULL");
        var hasDeadline = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "PRAGMA table_info(\"Competitions\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) hasDeadline |= reader.GetString(1) == "StartDeadlineUtc";
        }
        if (!hasDeadline)
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Competitions\" ADD COLUMN \"StartDeadlineUtc\" TEXT NULL");
            await db.Database.ExecuteSqlRawAsync("UPDATE \"Competitions\" SET \"StartDeadlineUtc\" = \"ClosesAtUtc\" WHERE \"OpensAtUtc\" IS NOT NULL AND \"ClosesAtUtc\" IS NOT NULL");
        }
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "ExamFieldGroups" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "CompetitionId" INTEGER NOT NULL,
                "Name" TEXT NOT NULL,
                "RankingGroupName" TEXT NOT NULL DEFAULT '',
                "IsSample" INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY ("CompetitionId") REFERENCES "Competitions"("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExamFieldGroups_CompetitionId_Name" ON "ExamFieldGroups"("CompetitionId", "Name");
            CREATE TABLE IF NOT EXISTS "Exams" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "CompetitionId" INTEGER NOT NULL,
                "FieldGroupId" INTEGER NOT NULL,
                "Name" TEXT NOT NULL,
                "DurationMinutes" INTEGER NOT NULL DEFAULT 30,
                "TargetQuestionCount" INTEGER NOT NULL DEFAULT 30,
                "CommonQuestionCount" INTEGER NOT NULL DEFAULT 10,
                "SpecializedQuestionCount" INTEGER NOT NULL DEFAULT 20,
                "DraftRevision" INTEGER NOT NULL DEFAULT 1,
                "CurrentApprovedVersionId" INTEGER NULL,
                "IsDemo" INTEGER NOT NULL DEFAULT 0,
                "CreatedAtUtc" TEXT NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL,
                FOREIGN KEY ("CompetitionId") REFERENCES "Competitions"("Id") ON DELETE CASCADE,
                FOREIGN KEY ("FieldGroupId") REFERENCES "ExamFieldGroups"("Id") ON DELETE RESTRICT,
                FOREIGN KEY ("CurrentApprovedVersionId") REFERENCES "ApprovedExamVersions"("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_Exams_CompetitionId" ON "Exams"("CompetitionId");
            CREATE TABLE IF NOT EXISTS "ExamQuestions" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "ExamId" INTEGER NOT NULL,
                "Position" INTEGER NOT NULL,
                "Type" TEXT NOT NULL,
                "Content" TEXT NOT NULL,
                "OptionsJson" TEXT NOT NULL,
                "CorrectAnswer" TEXT NULL,
                "Points" TEXT NOT NULL,
                "IsScenario" INTEGER NOT NULL DEFAULT 0,
                "Explanation" TEXT NOT NULL,
                "Source" TEXT NOT NULL,
                "Group" TEXT NOT NULL,
                "RequiresSourceReview" INTEGER NOT NULL DEFAULT 0,
                "SourceReviewed" INTEGER NOT NULL DEFAULT 0,
                "ReviewedByUserId" INTEGER NULL,
                "ReviewedAtUtc" TEXT NULL,
                FOREIGN KEY ("ExamId") REFERENCES "Exams"("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_ExamQuestions_ExamId" ON "ExamQuestions"("ExamId");
            CREATE TABLE IF NOT EXISTS "ApprovedExamVersions" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "ExamId" INTEGER NOT NULL,
                "VersionNumber" INTEGER NOT NULL,
                "DraftRevision" INTEGER NOT NULL,
                "SnapshotJson" TEXT NOT NULL,
                "HashSha256" TEXT NOT NULL,
                "ApprovedAtUtc" TEXT NOT NULL,
                "ApprovedByUserId" INTEGER NOT NULL,
                UNIQUE ("Id", "ExamId"),
                FOREIGN KEY ("ExamId") REFERENCES "Exams"("Id") ON DELETE RESTRICT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ApprovedExamVersions_ExamId_VersionNumber" ON "ApprovedExamVersions"("ExamId", "VersionNumber");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ApprovedExamVersions_ExamId_DraftRevision" ON "ApprovedExamVersions"("ExamId", "DraftRevision");
            CREATE TABLE IF NOT EXISTS "ExamAttempts" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "ExamId" INTEGER NOT NULL,
                "UserId" INTEGER NOT NULL,
                "ExamVersionId" INTEGER NOT NULL,
                "StartedAtUtc" TEXT NOT NULL,
                "DeadlineAtUtc" TEXT NOT NULL,
                "SubmittedAtUtc" TEXT NULL,
                FOREIGN KEY ("ExamId") REFERENCES "Exams"("Id") ON DELETE RESTRICT,
                FOREIGN KEY ("UserId") REFERENCES "Users"("Id") ON DELETE RESTRICT,
                FOREIGN KEY ("ExamVersionId", "ExamId") REFERENCES "ApprovedExamVersions"("Id", "ExamId") ON DELETE RESTRICT
            );
            CREATE TRIGGER IF NOT EXISTS "ApprovedExamVersions_NoUpdate" BEFORE UPDATE ON "ApprovedExamVersions"
            BEGIN SELECT RAISE(ABORT, 'Approved exam versions are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS "ApprovedExamVersions_NoDelete" BEFORE DELETE ON "ApprovedExamVersions"
            BEGIN SELECT RAISE(ABORT, 'Approved exam versions are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS "ExamAttempts_PinVersion" BEFORE UPDATE OF "ExamVersionId", "ExamId" ON "ExamAttempts"
            WHEN NEW."ExamVersionId" != OLD."ExamVersionId" OR NEW."ExamId" != OLD."ExamId"
            BEGIN SELECT RAISE(ABORT, 'Issued exam attempt version cannot change'); END;
            """);
        await AddColumn(db, transaction, "Competitions", "ScenarioScoreTieBreakEnabled", "INTEGER NOT NULL DEFAULT 0");
        await AddColumn(db, transaction, "ExamQuestions", "IsScenario", "INTEGER NOT NULL DEFAULT 0");
        await AddColumn(db, transaction, "ExamFieldGroups", "RankingGroupName", "TEXT NOT NULL DEFAULT ''");
        await db.Database.ExecuteSqlRawAsync("UPDATE \"ExamFieldGroups\" SET \"RankingGroupName\" = \"Name\" WHERE trim(\"RankingGroupName\") = ''");
        // Seed all six groups in one statement only for competitions with no groups.
        // A renamed sample must not reappear on the next application startup.
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO "ExamFieldGroups" ("CompetitionId", "Name", "RankingGroupName", "IsSample")
            SELECT c."Id", samples."Name", samples."Name", 1 FROM "Competitions" c
            CROSS JOIN (
                SELECT 'Kiến thức chung' AS "Name" UNION ALL SELECT 'Kinh tế và hạ tầng'
                UNION ALL SELECT 'Đất đai và môi trường' UNION ALL SELECT 'Tài chính'
                UNION ALL SELECT 'Hành chính và tư pháp' UNION ALL SELECT 'Văn hóa và xã hội'
            ) samples WHERE NOT EXISTS (SELECT 1 FROM "ExamFieldGroups" g WHERE g."CompetitionId" = c."Id");
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (3, {DateTime.UtcNow})");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (7, {DateTime.UtcNow})");
    }
}
