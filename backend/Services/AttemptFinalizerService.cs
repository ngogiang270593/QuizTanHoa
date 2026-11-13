using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;

namespace Quiz_TanHoa.Api.Services;

public sealed class AttemptFinalizerService(IServiceScopeFactory scopeFactory, VietnamClock clock, ILogger<AttemptFinalizerService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var finalized = await AttemptFinalizer.FinalizeDueAsync(db, clock.UtcNow, stoppingToken);
                if (finalized > 0) logger.LogInformation("Finalized {AttemptCount} attempts at their server deadlines.", finalized);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (DbUpdateException error)
            {
                logger.LogError(error, "Could not finalize due exam attempts.");
            }
            catch (Microsoft.Data.Sqlite.SqliteException error)
            {
                logger.LogError(error, "SQLite error while finalizing due exam attempts.");
            }

            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }
}
