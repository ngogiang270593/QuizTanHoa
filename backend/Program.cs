using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Security;
using Quiz_TanHoa.Api.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
// No cookies or DataProtection-backed tokens are used. Keep framework keys in memory
// instead of touching the host user profile; JWT keys and SQLite sessions remain persistent.
builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();

var projectRoot = Path.GetFileName(builder.Environment.ContentRootPath).Equals("backend", StringComparison.OrdinalIgnoreCase)
    ? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, ".."))
    : builder.Environment.ContentRootPath;
var seedDemo = string.Equals(Environment.GetEnvironmentVariable("QUIZ_TANHOA_SEED_DEMO"), "true", StringComparison.OrdinalIgnoreCase);
var dataDirectory = Path.GetFullPath(Environment.GetEnvironmentVariable("QUIZ_TANHOA_DATA_DIR")
    ?? Path.Combine(projectRoot, ".data", seedDemo ? "demo" : "web"));
Directory.CreateDirectory(dataDirectory);

// Persist each installation's signing key; restarting never silently invalidates current sessions.
var jwtKey = Environment.GetEnvironmentVariable("QUIZ_TANHOA_JWT_KEY");
if (string.IsNullOrWhiteSpace(jwtKey))
{
    var keyPath = Path.Combine(dataDirectory, "jwt.key");
    if (!File.Exists(keyPath))
    {
        try
        {
            using var keyFile = new FileStream(keyPath, FileMode.CreateNew, FileAccess.Write);
            using var writer = new StreamWriter(keyFile);
            writer.Write(Convert.ToBase64String(RandomNumberGenerator.GetBytes(64)));
        }
        catch (IOException) when (File.Exists(keyPath)) { }
    }
    jwtKey = File.ReadAllText(keyPath).Trim();
}
if (Encoding.UTF8.GetByteCount(jwtKey) < 32)
    throw new InvalidOperationException("QUIZ_TANHOA_JWT_KEY phải có ít nhất 32 byte.");

builder.Services.AddSingleton(new JwtSettings(jwtKey));
builder.Services.AddSingleton<VietnamClock>();
builder.Services.AddScoped<ICompetitionResultsService, CompetitionResultsService>();
builder.Services.AddScoped<ICompetitionAwardsService, CompetitionAwardsService>();
var connection = new SqliteConnectionStringBuilder
{
    DataSource = Path.Combine(dataDirectory, "quiz_tanhoa.db"),
    ForeignKeys = true
}.ToString();
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite(connection));
builder.Services.AddHostedService<AttemptFinalizerService>();
builder.Services.AddControllers();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins("http://localhost:5175", "http://127.0.0.1:5175", "http://localhost:4175", "http://127.0.0.1:4175")
    .AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.MapInboundClaims = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = JwtSettings.Issuer,
        ValidateAudience = true,
        ValidAudience = JwtSettings.Audience,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        NameClaimType = ClaimTypes.Name,
        RoleClaimType = ClaimTypes.Role,
        ClockSkew = TimeSpan.FromSeconds(30)
    };
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = async context =>
        {
            var subject = context.Principal?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
            var sessionId = context.Principal?.FindFirst(JwtRegisteredClaimNames.Jti)?.Value;
            if (!int.TryParse(subject, out var userId) || string.IsNullOrEmpty(sessionId))
            {
                context.Fail("Phiên đăng nhập không hợp lệ.");
                return;
            }

            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var session = await db.AuthSessions.AsNoTracking().Include(item => item.User)
                .SingleOrDefaultAsync(item => item.Id == sessionId && item.UserId == userId);
            if (session is null || session.RevokedAtUtc is not null || session.ExpiresAtUtc <= DateTime.UtcNow
                || !session.User.IsActive || !AppRoles.IsKnown(session.User.Role))
            {
                context.Fail("Phiên đăng nhập không còn hiệu lực.");
                return;
            }

            // Build a fresh principal from the database. A stale JWT role cannot grant access.
            context.Principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, sessionId),
                new Claim(ClaimTypes.Name, session.User.Username),
                new Claim(ClaimTypes.Role, session.User.Role),
                new Claim("FullName", session.User.FullName),
                new Claim("MustChangePassword", session.User.MustChangePassword ? "true" : "false")
            }, JwtBearerDefaults.AuthenticationScheme));
            CurrentAccount.Set(context.HttpContext, session.User, session);
        },
        OnChallenge = async context =>
        {
            context.HandleResponse();
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.Headers.WWWAuthenticate = "Bearer";
            await context.Response.WriteAsJsonAsync(new { message = "Vui lòng đăng nhập lại để tiếp tục." });
        },
        OnForbidden = async context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "Bạn không có quyền truy cập chức năng này." });
        }
    };
});
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
    options.AddPolicy(AppRoles.Organizer, policy => policy.RequireAuthenticatedUser().RequireRole(AppRoles.Organizer));
    options.AddPolicy(AppRoles.Candidate, policy => policy.RequireAuthenticatedUser().RequireRole(AppRoles.Candidate));
});

var configuredWebRoot = Environment.GetEnvironmentVariable("QUIZ_TANHOA_WEB_ROOT");
var publishedWebRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
var webRoot = string.IsNullOrWhiteSpace(configuredWebRoot)
    ? publishedWebRoot
    : Path.GetFullPath(configuredWebRoot);
if (!Directory.Exists(webRoot) && string.IsNullOrWhiteSpace(configuredWebRoot))
    webRoot = Path.Combine(projectRoot, "frontend", "dist-web");
if (Directory.Exists(webRoot))
{
    builder.Environment.WebRootPath = webRoot;
    builder.Environment.WebRootFileProvider = new PhysicalFileProvider(webRoot);
}

var app = builder.Build();
using (var scope = app.Services.CreateScope())
    await DatabaseBootstrap.InitializeAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());

app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var failure = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    if (failure is DbUpdateConcurrencyException)
    {
        context.Response.StatusCode = StatusCodes.Status409Conflict;
        await context.Response.WriteAsJsonAsync(new { message = "Đề thi vừa được cập nhật ở phiên làm việc khác. Vui lòng tải lại dữ liệu trước khi lưu hoặc duyệt." });
        return;
    }
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new { message = "Máy chủ gặp lỗi. Vui lòng thử lại sau." });
}));
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "same-origin";
    if (context.Request.Path.StartsWithSegments("/api"))
        context.Response.Headers.CacheControl = "no-store";
    await next();
});
if (Directory.Exists(webRoot))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}
app.UseCors();
app.UseAuthentication();
app.Use(async (context, next) =>
{
    var mustChangePassword = string.Equals(
        context.User.FindFirst("MustChangePassword")?.Value, "true", StringComparison.Ordinal);
    var path = context.Request.Path.Value ?? "";
    var allowedPath = path.Equals("/api/Auth/change-password", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/Auth/me", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/Auth/logout", StringComparison.OrdinalIgnoreCase);
    if (context.User.Identity?.IsAuthenticated == true && mustChangePassword && !allowedPath)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { message = "Bạn phải đổi mật khẩu khởi tạo trước khi sử dụng hệ thống." });
        return;
    }
    await next();
});
app.UseAuthorization();
app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new
{
    application = "Quiz_TanHoa", status = "ok", timeZone = VietnamClock.TimeZoneId
})).AllowAnonymous();
// Unknown APIs must remain 404; never answer an API request with the SPA HTML.
app.Map("/api/{**path}", () => Results.NotFound(new { message = "Không tìm thấy API." })).AllowAnonymous();
if (Directory.Exists(webRoot))
    app.MapFallbackToFile("index.html").AllowAnonymous();
app.Logger.LogInformation("Quiz_TanHoa data directory: {DataDirectory}", dataDirectory);
app.Run();
