using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Data;

public static class QuestionBankSchemaUpgrade
{
    public static async Task ApplyAsync(AppDbContext db, DbTransaction transaction)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "QuestionBankQuestions" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_QuestionBankQuestions" PRIMARY KEY AUTOINCREMENT,
                "Type" TEXT NOT NULL,
                "Content" TEXT NOT NULL,
                "OptionsJson" TEXT NOT NULL,
                "CorrectAnswer" TEXT NULL,
                "Points" TEXT NOT NULL,
                "IsScenario" INTEGER NOT NULL,
                "Explanation" TEXT NOT NULL,
                "Source" TEXT NOT NULL,
                "Group" TEXT NOT NULL,
                "RequiresSourceReview" INTEGER NOT NULL,
                "SourceReviewed" INTEGER NOT NULL,
                "ReviewedByUserId" INTEGER NULL,
                "ReviewedAtUtc" TEXT NULL,
                "IsActive" INTEGER NOT NULL DEFAULT 1,
                "CreatedByUserId" INTEGER NULL,
                "CreatedAtUtc" TEXT NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL,
                FOREIGN KEY ("CreatedByUserId") REFERENCES "Users"("Id") ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_QuestionBankQuestions_IsActive_Group_UpdatedAtUtc"
                ON "QuestionBankQuestions"("IsActive", "Group", "UpdatedAtUtc");
            """);

        var hasTopic = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "PRAGMA table_info(\"QuestionBankQuestions\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) hasTopic |= reader.GetString(1) == "Topic";
        }
        if (!hasTopic) await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"QuestionBankQuestions\" ADD COLUMN \"Topic\" TEXT NOT NULL DEFAULT ''");
        var hasBankQuestionId = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "PRAGMA table_info(\"ExamQuestions\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) hasBankQuestionId |= reader.GetString(1) == "BankQuestionId";
        }
        if (!hasBankQuestionId)
            await db.Database.ExecuteSqlRawAsync("""
                ALTER TABLE "ExamQuestions"
                ADD COLUMN "BankQuestionId" INTEGER NULL REFERENCES "QuestionBankQuestions"("Id") ON DELETE SET NULL
                """);

        var alreadyApplied = false;
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "SELECT EXISTS(SELECT 1 FROM \"SchemaVersions\" WHERE \"Version\" = 10)";
            alreadyApplied = Convert.ToInt32(await command.ExecuteScalarAsync()) != 0;
        }
        if (!alreadyApplied)
        {
            var legacyQuestions = await db.ExamQuestions
                .Include(question => question.Exam)
                .Where(question => question.Exam.IsDemo && question.BankQuestionId == null)
                .OrderBy(question => question.ExamId).ThenBy(question => question.Position).ThenBy(question => question.Id)
                .ToListAsync();
            foreach (var question in legacyQuestions)
            {
                var bankQuestion = new QuestionBankQuestion
                {
                    Type = question.Type,
                    Content = question.Content,
                    OptionsJson = question.OptionsJson,
                    CorrectAnswer = question.CorrectAnswer,
                    Points = question.Points,
                    IsScenario = question.IsScenario,
                    Explanation = question.Explanation,
                    Source = question.Source,
                    Group = question.Group,
                    RequiresSourceReview = question.RequiresSourceReview,
                    SourceReviewed = question.SourceReviewed,
                    ReviewedByUserId = question.ReviewedByUserId,
                    ReviewedAtUtc = question.ReviewedAtUtc,
                    IsActive = true,
                    CreatedAtUtc = DateTime.UtcNow,
                    UpdatedAtUtc = DateTime.UtcNow
                };
                db.QuestionBankQuestions.Add(bankQuestion);
                await db.SaveChangesAsync();
                question.BankQuestionId = bankQuestion.Id;
            }
            if (legacyQuestions.Count > 0) await db.SaveChangesAsync();
        }

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (10, {DateTime.UtcNow})");
    }
}
