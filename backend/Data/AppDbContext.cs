using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Models;

namespace Quiz_TanHoa.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<OrganizationUnit> OrganizationUnits => Set<OrganizationUnit>();
    public DbSet<AuthSession> AuthSessions => Set<AuthSession>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<Competition> Competitions => Set<Competition>();
    public DbSet<CompetitionAssignment> CompetitionAssignments => Set<CompetitionAssignment>();
    public DbSet<CompetitionAwardPlan> CompetitionAwardPlans => Set<CompetitionAwardPlan>();
    public DbSet<CompetitionAwardEvent> CompetitionAwardEvents => Set<CompetitionAwardEvent>();
    public DbSet<ExamFieldGroup> ExamFieldGroups => Set<ExamFieldGroup>();
    public DbSet<Exam> Exams => Set<Exam>();
    public DbSet<ExamQuestion> ExamQuestions => Set<ExamQuestion>();
    public DbSet<QuestionBankQuestion> QuestionBankQuestions => Set<QuestionBankQuestion>();
    public DbSet<ApprovedExamVersion> ApprovedExamVersions => Set<ApprovedExamVersion>();
    public DbSet<ExamAttempt> ExamAttempts => Set<ExamAttempt>();
    public DbSet<ExamAttemptQuestion> ExamAttemptQuestions => Set<ExamAttemptQuestion>();
    public DbSet<ExamAttemptAdminEvent> ExamAttemptAdminEvents => Set<ExamAttemptAdminEvent>();
    public DbSet<ExamAttemptSessionGrant> ExamAttemptSessionGrants => Set<ExamAttemptSessionGrant>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>().Property(user => user.Username).UseCollation("NOCASE");
        modelBuilder.Entity<User>().Property(user => user.Department).HasDefaultValue("");
        modelBuilder.Entity<User>().Property(user => user.MustChangePassword).HasDefaultValue(false);
        modelBuilder.Entity<User>().HasIndex(user => user.Username).IsUnique();
        modelBuilder.Entity<OrganizationUnit>().HasIndex(unit => unit.Name).IsUnique();
        modelBuilder.Entity<OrganizationUnit>().HasIndex(unit => unit.Code).IsUnique();
        modelBuilder.Entity<AuthSession>().HasIndex(session => session.UserId);
        modelBuilder.Entity<AuthSession>().HasOne(session => session.User)
            .WithMany().HasForeignKey(session => session.UserId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Competition>().ToTable(table =>
        {
            table.HasCheckConstraint("CK_Competitions_Status", "\"Status\" IN ('Draft', 'Published', 'Ended')");
            table.HasCheckConstraint("CK_Competitions_Name", "length(trim(\"Name\")) BETWEEN 1 AND 300");
        });
        modelBuilder.Entity<Competition>().HasIndex(competition => competition.Status);
        modelBuilder.Entity<Competition>().HasOne(competition => competition.CreatedByUser).WithMany()
            .HasForeignKey(competition => competition.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
        modelBuilder.Entity<CompetitionAwardPlan>().HasOne(plan => plan.Competition).WithMany()
            .HasForeignKey(plan => plan.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<CompetitionAwardPlan>().HasIndex(plan => plan.CompetitionId).IsUnique();
        modelBuilder.Entity<CompetitionAwardPlan>().Property(plan => plan.Revision).IsConcurrencyToken();
        modelBuilder.Entity<CompetitionAwardEvent>().HasOne(item => item.Competition).WithMany()
            .HasForeignKey(item => item.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<CompetitionAwardEvent>().HasIndex(item => new { item.CompetitionId, item.OccurredAtUtc });
        modelBuilder.Entity<CompetitionAssignment>().HasKey(assignment => new { assignment.CompetitionId, assignment.UserId });
        modelBuilder.Entity<CompetitionAssignment>().HasOne(assignment => assignment.Competition)
            .WithMany(competition => competition.Assignments).HasForeignKey(assignment => assignment.CompetitionId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<CompetitionAssignment>().HasOne(assignment => assignment.Exam).WithMany()
            .HasForeignKey(assignment => assignment.ExamId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<CompetitionAssignment>().HasOne(assignment => assignment.ExamVersion).WithMany()
            .HasForeignKey(assignment => assignment.ExamVersionId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ExamFieldGroup>().HasOne(group => group.Competition).WithMany().HasForeignKey(group => group.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ExamFieldGroup>().HasIndex(group => new { group.CompetitionId, group.Name }).IsUnique();
        modelBuilder.Entity<Exam>().HasOne(exam => exam.Competition).WithMany().HasForeignKey(exam => exam.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Exam>().HasOne(exam => exam.FieldGroup).WithMany().HasForeignKey(exam => exam.FieldGroupId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Exam>().Property(exam => exam.DraftRevision).IsConcurrencyToken();
        modelBuilder.Entity<Exam>().HasOne<ApprovedExamVersion>().WithMany().HasForeignKey(exam => exam.CurrentApprovedVersionId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ExamQuestion>().HasOne(question => question.Exam).WithMany(exam => exam.Questions).HasForeignKey(question => question.ExamId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ExamQuestion>().HasOne<QuestionBankQuestion>().WithMany()
            .HasForeignKey(question => question.BankQuestionId).OnDelete(DeleteBehavior.SetNull);
        modelBuilder.Entity<QuestionBankQuestion>().HasIndex(question => new { question.IsActive, question.Group, question.UpdatedAtUtc });
        modelBuilder.Entity<QuestionBankQuestion>().HasOne<User>().WithMany()
            .HasForeignKey(question => question.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
        modelBuilder.Entity<ApprovedExamVersion>().HasOne(version => version.Exam).WithMany().HasForeignKey(version => version.ExamId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ApprovedExamVersion>().HasIndex(version => new { version.ExamId, version.VersionNumber }).IsUnique();
        modelBuilder.Entity<ApprovedExamVersion>().HasIndex(version => new { version.ExamId, version.DraftRevision }).IsUnique();
        modelBuilder.Entity<ApprovedExamVersion>().HasAlternateKey(version => new { version.Id, version.ExamId });
        modelBuilder.Entity<ExamAttempt>().HasOne(attempt => attempt.Exam).WithMany().HasForeignKey(attempt => attempt.ExamId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ExamAttempt>().HasOne(attempt => attempt.User).WithMany().HasForeignKey(attempt => attempt.UserId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ExamAttempt>().HasOne(attempt => attempt.ExamVersion).WithMany().HasForeignKey(attempt => new { attempt.ExamVersionId, attempt.ExamId }).HasPrincipalKey(version => new { version.Id, version.ExamId }).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ExamAttempt>().Property(attempt => attempt.IsInvalidated).HasDefaultValue(false);
        modelBuilder.Entity<ExamAttempt>().HasIndex(attempt => new { attempt.CompetitionId, attempt.UserId })
            .IsUnique().HasFilter("\"IsInvalidated\" = 0").HasDatabaseName("IX_ExamAttempts_CompetitionId_UserId_Active");
        modelBuilder.Entity<ExamAttemptAdminEvent>().HasOne(item => item.Attempt).WithMany()
            .HasForeignKey(item => item.AttemptId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<ExamAttemptAdminEvent>().HasIndex(item => new { item.AttemptId, item.OccurredAtUtc });
        modelBuilder.Entity<ExamAttemptSessionGrant>().HasKey(item => new { item.CompetitionId, item.UserId });
        modelBuilder.Entity<ExamAttemptQuestion>().HasKey(question => new { question.AttemptId, question.QuestionId });
        modelBuilder.Entity<ExamAttemptQuestion>().HasIndex(question => new { question.AttemptId, question.Position }).IsUnique();
        modelBuilder.Entity<ExamAttemptQuestion>().HasOne(question => question.Attempt).WithMany(attempt => attempt.Questions)
            .HasForeignKey(question => question.AttemptId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<CompetitionAssignment>().HasOne(assignment => assignment.User).WithMany()
            .HasForeignKey(assignment => assignment.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
