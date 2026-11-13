using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace Quiz_TanHoa.Api.Data;

public static class CompetitionDeletionSchemaUpgrade
{
    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        var hasDeletingFlag = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "PRAGMA table_info(\"Competitions\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) hasDeletingFlag |= reader.GetString(1) == "IsDeleting";
        }
        if (!hasDeletingFlag)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Competitions\" ADD COLUMN \"IsDeleting\" INTEGER NOT NULL DEFAULT 0");

        await db.Database.ExecuteSqlRawAsync("""
            DROP TRIGGER IF EXISTS "ApprovedExamVersions_NoDelete";
            CREATE TRIGGER "ApprovedExamVersions_NoDelete" BEFORE DELETE ON "ApprovedExamVersions"
            WHEN NOT EXISTS (
                SELECT 1
                FROM "Exams" e
                INNER JOIN "Competitions" c ON c."Id" = e."CompetitionId"
                WHERE e."Id" = OLD."ExamId"
                    AND c."IsDeleting" = 1
                    AND c."Status" = 'Draft'
                    AND NOT EXISTS (SELECT 1 FROM "ExamAttempts" a WHERE a."CompetitionId" = c."Id")
            )
            BEGIN SELECT RAISE(ABORT, 'Approved exam versions are immutable'); END;
            """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (11, {DateTime.UtcNow})");
    }
}
