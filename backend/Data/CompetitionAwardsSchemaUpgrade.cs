using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace Quiz_TanHoa.Api.Data;

public static class CompetitionAwardsSchemaUpgrade
{
    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "CompetitionAwardPlans" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_CompetitionAwardPlans" PRIMARY KEY AUTOINCREMENT,
                "CompetitionId" INTEGER NOT NULL,
                "Status" TEXT NOT NULL DEFAULT 'Draft',
                "Revision" INTEGER NOT NULL DEFAULT 1,
                "DraftJson" TEXT NOT NULL,
                "ApprovedSnapshotJson" TEXT NULL,
                "ApprovedAtUtc" TEXT NULL,
                "ApprovedByUserId" INTEGER NULL,
                "PublishedAtUtc" TEXT NULL,
                "PublishedByUserId" INTEGER NULL,
                "CreatedAtUtc" TEXT NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL,
                CONSTRAINT "FK_CompetitionAwardPlans_Competitions_CompetitionId"
                    FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_CompetitionAwardPlans_CompetitionId"
                ON "CompetitionAwardPlans" ("CompetitionId");
            CREATE TABLE IF NOT EXISTS "CompetitionAwardEvents" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_CompetitionAwardEvents" PRIMARY KEY AUTOINCREMENT,
                "CompetitionId" INTEGER NOT NULL,
                "ActorUserId" INTEGER NOT NULL,
                "OccurredAtUtc" TEXT NOT NULL,
                "Action" TEXT NOT NULL,
                "Reason" TEXT NOT NULL,
                CONSTRAINT "FK_CompetitionAwardEvents_Competitions_CompetitionId"
                    FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_CompetitionAwardEvents_CompetitionId_OccurredAtUtc"
                ON "CompetitionAwardEvents" ("CompetitionId", "OccurredAtUtc");
            """, cancellationToken: default);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (8, {DateTime.UtcNow})",
            cancellationToken: default);
    }
}
