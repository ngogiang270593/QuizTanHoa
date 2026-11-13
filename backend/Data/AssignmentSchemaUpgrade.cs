using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace Quiz_TanHoa.Api.Data;

public static class AssignmentSchemaUpgrade
{
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
            // Names and definitions come only from the fixed migration declarations below.
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.Transaction = transaction;
            command.CommandText = $"ALTER TABLE \"{table}\" ADD COLUMN \"{name}\" {definition}";
            await command.ExecuteNonQueryAsync();
        }
    }

    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        await AddColumn(db, transaction, "Users", "Department", "TEXT NOT NULL DEFAULT ''");
        await AddColumn(db, transaction, "Competitions", "PublishedAtUtc", "TEXT NULL");
        await AddColumn(db, transaction, "CompetitionAssignments", "ExamId", "INTEGER NULL REFERENCES \"Exams\"(\"Id\") ON DELETE RESTRICT");
        await AddColumn(db, transaction, "CompetitionAssignments", "ExamVersionId", "INTEGER NULL REFERENCES \"ApprovedExamVersions\"(\"Id\") ON DELETE RESTRICT");
        await AddColumn(db, transaction, "CompetitionAssignments", "AssignedAtUtc", "TEXT NULL");
        await AddColumn(db, transaction, "CompetitionAssignments", "UpdatedAtUtc", "TEXT NULL");
        await AddColumn(db, transaction, "CompetitionAssignments", "AssignedByUserId", "INTEGER NULL");
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS "IX_CompetitionAssignments_ExamId" ON "CompetitionAssignments"("ExamId");
            CREATE INDEX IF NOT EXISTS "IX_CompetitionAssignments_ExamVersionId" ON "CompetitionAssignments"("ExamVersionId");
            CREATE TRIGGER IF NOT EXISTS "CompetitionAssignments_ExamScopeInsert" BEFORE INSERT ON "CompetitionAssignments"
            WHEN (NEW."ExamId" IS NULL) != (NEW."ExamVersionId" IS NULL)
              OR (NEW."ExamId" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM "Exams" e JOIN "ApprovedExamVersions" v ON v."ExamId" = e."Id"
                WHERE e."Id" = NEW."ExamId" AND e."CompetitionId" = NEW."CompetitionId" AND v."Id" = NEW."ExamVersionId"))
            BEGIN SELECT RAISE(ABORT, 'Assigned approved exam must belong to the competition'); END;
            CREATE TRIGGER IF NOT EXISTS "CompetitionAssignments_ExamScopeUpdate" BEFORE UPDATE ON "CompetitionAssignments"
            WHEN (NEW."ExamId" IS NULL) != (NEW."ExamVersionId" IS NULL)
              OR (NEW."ExamId" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM "Exams" e JOIN "ApprovedExamVersions" v ON v."ExamId" = e."Id"
                WHERE e."Id" = NEW."ExamId" AND e."CompetitionId" = NEW."CompetitionId" AND v."Id" = NEW."ExamVersionId"))
            BEGIN SELECT RAISE(ABORT, 'Assigned approved exam must belong to the competition'); END;
            CREATE TRIGGER IF NOT EXISTS "CompetitionAssignments_StartedInsert" BEFORE INSERT ON "CompetitionAssignments"
            WHEN EXISTS (SELECT 1 FROM "ExamAttempts" a JOIN "Exams" e ON e."Id" = a."ExamId"
                WHERE a."UserId" = NEW."UserId" AND e."CompetitionId" = NEW."CompetitionId")
            BEGIN SELECT RAISE(ABORT, 'Cannot assign after an attempt has started'); END;
            CREATE TRIGGER IF NOT EXISTS "CompetitionAssignments_StartedUpdate" BEFORE UPDATE ON "CompetitionAssignments"
            WHEN EXISTS (SELECT 1 FROM "ExamAttempts" a JOIN "Exams" e ON e."Id" = a."ExamId"
                WHERE a."UserId" = OLD."UserId" AND e."CompetitionId" = OLD."CompetitionId")
            BEGIN SELECT RAISE(ABORT, 'Cannot change assignment after an attempt has started'); END;
            CREATE TRIGGER IF NOT EXISTS "CompetitionAssignments_StartedDelete" BEFORE DELETE ON "CompetitionAssignments"
            WHEN EXISTS (SELECT 1 FROM "ExamAttempts" a JOIN "Exams" e ON e."Id" = a."ExamId"
                WHERE a."UserId" = OLD."UserId" AND e."CompetitionId" = OLD."CompetitionId")
            BEGIN SELECT RAISE(ABORT, 'Cannot revoke assignment after an attempt has started'); END;
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (4, {DateTime.UtcNow})");
    }
}
