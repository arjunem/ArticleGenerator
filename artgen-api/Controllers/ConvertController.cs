using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using ArtGen.Models;
using ArtGen.Services;

namespace ArtGen.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ConvertController(
    DirectConversionService directService,
    IMemoryCache cache,
    ILogger<ConvertController> logger) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Convert(
        [FromForm] IFormFile markdownFile,
        [FromForm] IFormFile? templateFile,
        [FromForm] string? outputFormats,
        CancellationToken ct)
    {
        if (markdownFile is null || markdownFile.Length == 0)
            return BadRequest("No markdown file provided.");

        using var mdReader = new StreamReader(markdownFile.OpenReadStream());
        var mdContent = await mdReader.ReadToEndAsync(ct);

        string? templateContent = null;
        string? templateFilename = null;
        if (templateFile is { Length: > 0 })
        {
            using var tplReader = new StreamReader(templateFile.OpenReadStream());
            templateContent = await tplReader.ReadToEndAsync(ct);
            templateFilename = templateFile.FileName;
        }

        var formats = (outputFormats ?? "html")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(f => Enum.Parse<OutputFormat>(f.Trim(), ignoreCase: true))
            .ToList();

        var request = new ConversionRequest(
            mdContent, templateContent, templateFilename,
            ConversionEngine.Direct, "claude-sonnet-4-6", formats);

        try
        {
            var output = await directService.ConvertAsync(request, ct);

            var results = output.Files.Select(file =>
            {
                var token = Guid.NewGuid().ToString("N");
                cache.Set(token, file, TimeSpan.FromMinutes(10));
                return new ConversionResultItem(
                    file.Format.ToString().ToLower(), token, file.Filename);
            }).ToList();

            return Ok(new ConversionResponse(true, results));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Conversion failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("download/{token}")]
    public IActionResult Download(string token)
    {
        if (!cache.TryGetValue<OutputFile>(token, out var file) || file is null)
            return NotFound("Download token expired or not found.");

        var contentType = file.Format == OutputFormat.Html ? "text/html" : "application/pdf";
        return File(file.Content, contentType, file.Filename);
    }
}
