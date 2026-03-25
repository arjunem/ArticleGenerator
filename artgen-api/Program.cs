using ArtGen.Services;
using PuppeteerSharp;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<ChromiumState>();
builder.Services.AddSingleton<IConversionService, DirectConversionService>();

builder.Services.AddCors(opts => opts.AddPolicy("Frontend", p =>
    p.WithOrigins(builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
        ?? ["http://localhost:4200"])
     .AllowAnyHeader()
     .AllowAnyMethod()));

var app = builder.Build();

// Download Chromium at startup (cached after first run)
var chromiumCachePath = builder.Configuration["Conversion:ChromiumCachePath"];
if (string.IsNullOrEmpty(chromiumCachePath))
    chromiumCachePath = Path.Combine(Path.GetTempPath(), "artgen-chromium");

var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
startupLogger.LogInformation("Ensuring Chromium is available at {Path}...", chromiumCachePath);

var fetcher = new BrowserFetcher(new BrowserFetcherOptions
{
    Browser = SupportedBrowser.Chrome,
    Path = chromiumCachePath
});
var installed = await fetcher.DownloadAsync();
var executablePath = installed.GetExecutablePath();
startupLogger.LogInformation("Chromium ready: {Executable}", executablePath);

app.Services.GetRequiredService<ChromiumState>().ExecutablePath = executablePath;

app.UseCors("Frontend");
app.MapControllers();
app.Run();
