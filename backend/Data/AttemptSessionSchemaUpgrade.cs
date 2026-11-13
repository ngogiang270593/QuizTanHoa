using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace Quiz_TanHoa.Api.Data;

public static class AttemptSessionSchemaUpgrade
{
    private static async Task AddColumn(AppDbContext db, DbTransaction transaction, string name, string definition)
    {
        var exists = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "PRAGMA table_info(\"ExamAttempts\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) exists |= reader.GetString(1) == name;
        }
        if (exists) return;
        await using var add = db.Database.GetDbConnection().CreateCommand();
        add.Transaction = transaction;
        add.CommandText = $"ALTER TABLE \"ExamAttempts\" ADD COLUMN \"{name}\" {definition}";
        await add.ExecuteNonQueryAsync();
    }

    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        await AddColumn(db, transaction, "CompetitionId", "INTEGER NOT NULL DEFAULT 0");
        await AddColumn(db, transaction, "OwnerSessionId", "TEXT NULL");
        await AddColumn(db, transaction, "WriterTabId", "TEXT NULL");
        await AddColumn(db, transaction, "WriterLeaseUntilUtc", "TEXT NULL");
        await AddColumn(db, transaction, "IsInvalidated", "INTEGER NOT NULL DEFAULT 0");
        await AddColumn(db, transaction, "InvalidatedAtUtc", "TEXT NULL");
        await AddColumn(db, transaction, "InvalidatedByUserId", "INTEGER NULL");
        await AddColumn(db, transaction, "InvalidationReason", "TEXT NULL");
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE "ExamAttempts" SET "CompetitionId" = (
                SELECT "CompetitionId" FROM "Exams" WHERE "Exams"."Id" = "ExamAttempts"."ExamId"
            ) WHERE "CompetitionId" = 0;
            WITH ranked AS (
                SELECT "Id", ROW_NUMBER() OVER (
                    PARTITION BY "CompetitionId", "UserId"
                    ORDER BY "Id" DESC
                ) AS "RowNumber"
                FROM "ExamAttempts"
                WHERE "IsInvalidated" = 0
            )
            UPDATE "ExamAttempts" SET "IsInvalidated" = 1
            WHERE "Id" IN (SELECT "Id" FROM ranked WHERE "RowNumber" > 1);
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExamAttempts_CompetitionId_UserId_Active"
                ON "ExamAttempts" ("CompetitionId", "UserId")
                WHERE "IsInvalidated" = 0;
            CREATE INDEX IF NOT EXISTS "IX_ExamAttempts_OwnerSessionId"
                ON "ExamAttempts" ("OwnerSessionId");
            CREATE TABLE IF NOT EXISTS "ExamAttemptAdminEvents" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "AttemptId" INTEGER NOT NULL,
                "ActorUserId" INTEGER NOT NULL,
                "OccurredAtUtc" TEXT NOT NULL,
                "Action" TEXT NOT NULL,
                "Reason" TEXT NOT NULL,
                "PreviousSessionId" TEXT NULL,
                "NewSessionId" TEXT NOT NULL,
                "ReplacementAttemptId" INTEGER NULL,
                FOREIGN KEY ("AttemptId") REFERENCES "ExamAttempts" ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_ExamAttemptAdminEvents_AttemptId_OccurredAtUtc"
                ON "ExamAttemptAdminEvents" ("AttemptId", "OccurredAtUtc");
            CREATE TABLE IF NOT EXISTS "ExamAttemptSessionGrants" (
                "CompetitionId" INTEGER NOT NULL,
                "UserId" INTEGER NOT NULL,
                "SessionId" TEXT NOT NULL,
                "OldAttemptId" INTEGER NOT NULL,
                "ActorUserId" INTEGER NOT NULL,
                "CreatedAtUtc" TEXT NOT NULL,
                "Reason" TEXT NOT NULL,
                PRIMARY KEY ("CompetitionId", "UserId"),
                FOREIGN KEY ("OldAttemptId") REFERENCES "ExamAttempts" ("Id") ON DELETE RESTRICT,
                FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (6, {DateTime.UtcNow})");
    }
}
