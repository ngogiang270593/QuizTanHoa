using System.Data;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

namespace Quiz_TanHoa.Api.Data;

public static class DatabaseBootstrap
{
    public static async Task InitializeAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();
        await db.Database.OpenConnectionAsync();
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            var hasDemoColumn = false;
            await using (var command = db.Database.GetDbConnection().CreateCommand())
            {
                command.Transaction = transaction.GetDbTransaction();
                command.CommandText = "PRAGMA table_info(\"Users\")";
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                    hasDemoColumn |= reader.GetString(1) == "IsDemo";
            }
            if (!hasDemoColumn)
                await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Users\" ADD COLUMN \"IsDemo\" INTEGER NOT NULL DEFAULT 0");

            // Additive upgrade for the original login-only schema: never drop or reseed existing users.
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS "AuthSessions" (
                    "Id" TEXT NOT NULL CONSTRAINT "PK_AuthSessions" PRIMARY KEY,
                    "UserId" INTEGER NOT NULL,
                    "CreatedAtUtc" TEXT NOT NULL,
                    "ExpiresAtUtc" TEXT NOT NULL,
                    "RevokedAtUtc" TEXT NULL,
                    CONSTRAINT "FK_AuthSessions_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS "IX_AuthSessions_UserId" ON "AuthSessions" ("UserId");
                CREATE TABLE IF NOT EXISTS "AppSettings" (
                    "Key" TEXT NOT NULL CONSTRAINT "PK_AppSettings" PRIMARY KEY,
                    "Value" TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS "SchemaVersions" (
                    "Version" INTEGER NOT NULL PRIMARY KEY,
                    "AppliedAtUtc" TEXT NOT NULL
                );
                UPDATE "Users" SET "Role" = 'Organizer' WHERE "Role" = 'Admin';
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"AppSettings\" (\"Key\", \"Value\") VALUES ('TimeZone', {VietnamClock.TimeZoneId})");
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (1, {DateTime.UtcNow})");
            // Step 2 adds competition records and assignment groundwork without changing existing data.
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS "Competitions" (
                    "Id" INTEGER NOT NULL CONSTRAINT "PK_Competitions" PRIMARY KEY AUTOINCREMENT,
                    "Name" TEXT NOT NULL,
                    "Description" TEXT NOT NULL,
                    "Rules" TEXT NOT NULL,
                    "Status" TEXT NOT NULL DEFAULT 'Draft',
                    "IsDemo" INTEGER NOT NULL DEFAULT 0,
                    "CreatedByUserId" INTEGER NULL,
                    "CreatedAtUtc" TEXT NOT NULL,
                    "UpdatedAtUtc" TEXT NOT NULL,
                    "OpensAtUtc" TEXT NULL,
                    "ClosesAtUtc" TEXT NULL,
                    CONSTRAINT "CK_Competitions_Status" CHECK ("Status" IN ('Draft', 'Published', 'Ended')),
                    CONSTRAINT "CK_Competitions_Name" CHECK (length(trim("Name")) BETWEEN 1 AND 300),
                    CONSTRAINT "FK_Competitions_Users_CreatedByUserId" FOREIGN KEY ("CreatedByUserId") REFERENCES "Users" ("Id") ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS "IX_Competitions_Status" ON "Competitions" ("Status");
                CREATE INDEX IF NOT EXISTS "IX_Competitions_CreatedByUserId" ON "Competitions" ("CreatedByUserId");
                CREATE TABLE IF NOT EXISTS "CompetitionAssignments" (
                    "CompetitionId" INTEGER NOT NULL,
                    "UserId" INTEGER NOT NULL,
                    CONSTRAINT "PK_CompetitionAssignments" PRIMARY KEY ("CompetitionId", "UserId"),
                    CONSTRAINT "FK_CompetitionAssignments_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE,
                    CONSTRAINT "FK_CompetitionAssignments_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS "IX_CompetitionAssignments_UserId" ON "CompetitionAssignments" ("UserId");
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO \"SchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES (2, {DateTime.UtcNow})");
            await ExamSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await WorkflowSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await ProcessSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await AssignmentSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await AttemptSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await AttemptSessionSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await CompetitionAwardsSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await OrganizationUnitSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await QuestionBankSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await TopicSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await CompetitionDeletionSchemaUpgrade.ApplyAsync(db, transaction.GetDbTransaction());
            await transaction.CommitAsync();
        }
        finally { await db.Database.CloseConnectionAsync(); }

        var timeZone = await db.AppSettings.AsNoTracking().SingleAsync(setting => setting.Key == "TimeZone");
        if (timeZone.Value != VietnamClock.TimeZoneId)
            throw new InvalidOperationException($"Múi giờ của dự án phải là {VietnamClock.TimeZoneId}.");

        var seedDemo = string.Equals(Environment.GetEnvironmentVariable("QUIZ_TANHOA_SEED_DEMO"), "true", StringComparison.OrdinalIgnoreCase);
        var seedInitialOrganization = string.Equals(Environment.GetEnvironmentVariable("QUIZ_TANHOA_SEED_INITIAL_ORGANIZATION"), "true", StringComparison.OrdinalIgnoreCase);
        var initialPassword = Environment.GetEnvironmentVariable("QUIZ_TANHOA_ADMIN_PASSWORD");
        if (!await db.Users.AnyAsync())
        {
            if (!string.IsNullOrWhiteSpace(initialPassword))
            {
                if (initialPassword.Length < 12 || Encoding.UTF8.GetByteCount(initialPassword) > 72)
                    throw new InvalidOperationException("QUIZ_TANHOA_ADMIN_PASSWORD phải có ít nhất 12 ký tự và tối đa 72 byte.");
                db.Users.Add(new User
                {
                    Username = "admin",
                    Password = BCrypt.Net.BCrypt.HashPassword(initialPassword),
                    FullName = "Ban Tổ chức xã Tân Hòa",
                    Role = AppRoles.Organizer
                });
                await db.SaveChangesAsync();
            }
            else if (!seedDemo && !seedInitialOrganization)
            {
                throw new InvalidOperationException("Database chưa có tài khoản. Để chạy minh họa từ thư mục backend: dotnet run --launch-profile MinhHoa. Với dữ liệu chính thức, hãy đặt QUIZ_TANHOA_ADMIN_PASSWORD (ít nhất 12 ký tự). Không tự tạo mật khẩu quản trị mặc định.");
            }
        }

        if (seedDemo)
        {
            await AddDemoUserAsync(db, "organizer.demo", "Ban Tổ chức minh họa", AppRoles.Organizer);
            await AddDemoUserAsync(db, "thisinh.demo", "Thí sinh minh họa", AppRoles.Candidate);
            await db.SaveChangesAsync();
        }
        if (seedInitialOrganization)
        {
            var temporaryPassword = Environment.GetEnvironmentVariable("QUIZ_TANHOA_INITIAL_PASSWORD");
            if (string.IsNullOrEmpty(temporaryPassword) || Encoding.UTF8.GetByteCount(temporaryPassword) > 72)
                throw new InvalidOperationException("QUIZ_TANHOA_INITIAL_PASSWORD phải được cung cấp và không vượt quá 72 byte.");
            await InitialOrganizationSeeder.SeedAsync(db, temporaryPassword);
        }
        await ProcessAccess.MigrateAsync(db);
    }

    private static async Task AddDemoUserAsync(AppDbContext db, string username, string fullName, string role)
    {
        // A name collision must never replace or reset an existing account.
        if (await db.Users.AnyAsync(user => user.Username == username)) return;
        db.Users.Add(new User
        {
            Username = username,
            FullName = fullName,
            Password = BCrypt.Net.BCrypt.HashPassword("TanHoa@2026!"),
            Role = role,
            IsDemo = true
        });
    }
}
