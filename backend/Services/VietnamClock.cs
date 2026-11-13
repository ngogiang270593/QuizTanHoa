namespace Quiz_TanHoa.Api.Services;

/// <summary>Persist timestamps in UTC; convert schedule inputs and presentation using Vietnam time.</summary>
public sealed class VietnamClock
{
    public const string TimeZoneId = "Asia/Ho_Chi_Minh";
    private readonly TimeZoneInfo zone = ResolveTimeZone();
    public DateTime UtcNow => DateTime.UtcNow;

    public DateTimeOffset LocalNow => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);

    public DateTime ScheduleLocalToUtc(DateTime localTime)
    {
        if (localTime.Kind != DateTimeKind.Unspecified)
            throw new ArgumentException("Lịch phải là giờ địa phương Việt Nam chưa gắn múi giờ.", nameof(localTime));
        if (zone.IsInvalidTime(localTime) || zone.IsAmbiguousTime(localTime))
            throw new ArgumentException("Giờ cấu hình lịch không hợp lệ.", nameof(localTime));
        return TimeZoneInfo.ConvertTimeToUtc(localTime, zone);
    }

    private static TimeZoneInfo ResolveTimeZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(TimeZoneId); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time"); }
    }
}
