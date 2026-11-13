using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;

namespace Quiz_TanHoa.Api.Services;

public static class AttemptFinalizer
{
    public static Task<int> FinalizeDueAsync(AppDbContext db, DateTime now, CancellationToken cancellationToken) =>
        db.ExamAttempts.Where(attempt => !attempt.IsInvalidated && attempt.SubmittedAtUtc == null && attempt.DeadlineAtUtc <= now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(attempt => attempt.SubmittedAtUtc,
                attempt => attempt.DeadlineAtUtc), cancellationToken);
}
