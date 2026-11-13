using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace Quiz_TanHoa.Api.Data;

public static class OrganizationUnitSchemaUpgrade
{
    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        var hasPasswordFlag = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "PRAGMA table_info(\"Users\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) hasPasswordFlag |= reader.GetString(1) == "MustChangePassword";
        }
        if (!hasPasswordFlag)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Users\" ADD COLUMN \"MustChangePassword\" INTEGER NOT NULL DEFAULT 0");

        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "OrganizationUnits" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_OrganizationUnits" PRIMARY KEY AUTOINCREMENT,
                "Name" TEXT NOT NULL,
                "Code" TEXT NOT NULL,
                "SortOrder" INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_OrganizationUnits_Name" ON "OrganizationUnits" ("Name");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_OrganizationUnits_Code" ON "OrganizationUnits" ("Code");
            """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (9, {DateTime.UtcNow})");
    }
}
