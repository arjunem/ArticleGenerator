using ArtGen.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<DirectConversionService>();

builder.Services.AddCors(opts => opts.AddPolicy("Frontend", p =>
    p.WithOrigins(builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
        ?? ["http://localhost:4200"])
     .AllowAnyHeader()
     .AllowAnyMethod()));

var app = builder.Build();
app.UseCors("Frontend");
app.MapControllers();
app.Run();
