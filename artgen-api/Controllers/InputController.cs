using ArtGen.Models;
using ArtGen.Services;
using Microsoft.AspNetCore.Mvc;

namespace ArtGen.Controllers;

[ApiController]
[Route("api/[controller]")]
public class InputController(
    IInputParserService parserService,
    ILogger<InputController> logger) : ControllerBase
{
    /// <summary>
    /// POST /api/input/parse
    ///
    /// Accepts a single input file (md, txt, html, json, docx, pdf) and returns
    /// its content as Markdown text. The Angular editor sets this as the input content.
    /// </summary>
    [HttpPost("parse")]
    public async Task<IActionResult> Parse(
        [FromForm] IFormFile file,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "No file provided." });

        try
        {
            var markdown = await parserService.ParseToMarkdownAsync(file, ct);
            return Ok(new InputParseResponse(markdown, file.FileName));
        }
        catch (NotSupportedException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to parse input file {Filename}", file.FileName);
            return StatusCode(500, new { error = $"Could not parse file: {ex.Message}" });
        }
    }
}
