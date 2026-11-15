using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Models;
namespace Quiz_TanHoa.Api.Data;
public static class TopicSchemaUpgrade
{
    public static async Task ApplyAsync(AppDbContext db, System.Data.Common.DbTransaction transaction)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "QuestionTopics" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "Name" TEXT NOT NULL, "NameKey" TEXT NOT NULL,
                "CreatedAtUtc" TEXT NOT NULL, "UpdatedAtUtc" TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_QuestionTopics_NameKey" ON "QuestionTopics"("NameKey");
            """);
        var hasTopic = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "PRAGMA table_info(\"ExamQuestions\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) hasTopic |= reader.GetString(1) == "Topic";
        }
        if (!hasTopic) await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"ExamQuestions\" ADD COLUMN \"Topic\" TEXT NOT NULL DEFAULT ''");
        var catalog = await db.QuestionTopics.ToListAsync();
        foreach (var q in await db.QuestionBankQuestions.Where(q => q.IsActive).ToListAsync())
        {
            var name = !string.IsNullOrWhiteSpace(q.Topic) ? q.Topic.Trim() : q.Source.Split('|')[0].Trim();
            if (string.IsNullOrEmpty(name)) continue;
            var key = name.Normalize().ToUpperInvariant();
            if (catalog.Any(t => t.NameKey == key)) continue;
            var topic = new QuestionTopic { Name = name, NameKey = key, CreatedAtUtc = DateTime.UtcNow, UpdatedAtUtc = DateTime.UtcNow };
            db.QuestionTopics.Add(topic); catalog.Add(topic);
        }
        await db.SaveChangesAsync();
    }
}
