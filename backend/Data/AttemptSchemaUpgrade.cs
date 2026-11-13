using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace Quiz_TanHoa.Api.Data;

public static class AttemptSchemaUpgrade
{
    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "ExamAttemptQuestions" (
                "AttemptId" INTEGER NOT NULL,
                "QuestionId" INTEGER NOT NULL,
                "Position" INTEGER NOT NULL,
                "OptionsOrderJson" TEXT NOT NULL,
                "Answer" TEXT NULL,
                "IsMarked" INTEGER NOT NULL DEFAULT 0,
                "UpdatedAtUtc" TEXT NULL,
                PRIMARY KEY ("AttemptId", "QuestionId"),
                FOREIGN KEY ("AttemptId") REFERENCES "ExamAttempts" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExamAttemptQuestions_AttemptId_Position"
                ON "ExamAttemptQuestions" ("AttemptId", "Position");
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (5, {DateTime.UtcNow})");
    }
}
