using Microsoft.EntityFrameworkCore;
namespace Quiz_TanHoa.Api.Data;
public static class WorkflowSchemaUpgrade
{
    public static async Task ApplyAsync(AppDbContext db, System.Data.Common.DbTransaction transaction)
    {
        async Task Add(string table, string column, string definition)
        {
            if (table is not ("Users" or "Exams") || !new[] { "WorkflowPermissionsJson", "ReviewStatus", "SubmittedRevision", "SubmittedByUserId", "SubmittedAtUtc", "ReviewNote" }.Contains(column)) throw new InvalidOperationException("Unknown workflow schema field");
            var exists = false;
            await using (var command = db.Database.GetDbConnection().CreateCommand())
            {
                command.Transaction = transaction;
                command.CommandText = $"PRAGMA table_info(\"{table}\")";
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync()) exists |= reader.GetString(1) == column;
            }
#pragma warning disable EF1002 // All identifiers and definitions are fixed source-code constants, never request values.
            if (!exists) await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {definition}");
        }
#pragma warning restore EF1002
        await Add("Users", "WorkflowPermissionsJson", "TEXT NULL");
        await Add("Exams", "ReviewStatus", "TEXT NOT NULL DEFAULT 'Draft'");
        await Add("Exams", "SubmittedRevision", "INTEGER NULL");
        await Add("Exams", "SubmittedByUserId", "INTEGER NULL");
        await Add("Exams", "SubmittedAtUtc", "TEXT NULL");
        await Add("Exams", "ReviewNote", "TEXT NOT NULL DEFAULT ''");
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "WorkflowEvents" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "ExamId" INTEGER NULL, "UserId" INTEGER NULL,
                "ActorUserId" INTEGER NOT NULL, "ActorName" TEXT NOT NULL,
                "Action" TEXT NOT NULL, "Note" TEXT NOT NULL,
                "DraftRevision" INTEGER NOT NULL, "OccurredAtUtc" TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_WorkflowEvents_ExamId" ON "WorkflowEvents"("ExamId");
            CREATE INDEX IF NOT EXISTS "IX_WorkflowEvents_UserId" ON "WorkflowEvents"("UserId");
            """);
    }
}
