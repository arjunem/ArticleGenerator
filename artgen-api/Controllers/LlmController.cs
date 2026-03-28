using System.Text.Json;
using System.Text.Json.Serialization;
using ArtGen.Models;
using ArtGen.Services.Llm;
using Microsoft.AspNetCore.Mvc;

namespace ArtGen.Controllers;

[ApiController]
[Route("api/[controller]")]
public class LlmController(
    ILlmGenerationService generationService,
    IHttpClientFactory httpClientFactory,
    IConfiguration config,
    ILogger<LlmController> logger) : ControllerBase
{
    /// <summary>
    /// GET /api/llm/models
    ///
    /// Returns the list of models currently installed in the local Ollama instance.
    /// Proxies Ollama's GET /api/tags so the frontend never talks to Ollama directly.
    /// Returns 503 if Ollama is not reachable.
    /// </summary>
    [HttpGet("models")]
    public async Task<IActionResult> GetModels(CancellationToken ct)
    {
        var baseUrl = config["Llm:Ollama:BaseUrl"] ?? "http://localhost:11434";

        try
        {
            var client = httpClientFactory.CreateClient("ollama");
            var response = await client.GetAsync($"{baseUrl}/api/tags", ct);
            response.EnsureSuccessStatusCode();

            var body = await response.Content.ReadAsStringAsync(ct);
            var tags = JsonSerializer.Deserialize<OllamaTagsResponse>(body, CamelCaseOptions);

            var models = (tags?.Models ?? []).Select(m => new LlmModelInfo(
                Value: m.Name,
                Label: m.Name.EndsWith(":latest", StringComparison.OrdinalIgnoreCase)
                    ? m.Name[..^7]
                    : m.Name
            ));

            return Ok(new LlmModelsResponse(models));
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning("Ollama not reachable at {BaseUrl}: {Message}", baseUrl, ex.Message);
            return StatusCode(503, new { error = "Ollama is not running. Start it with: ollama serve" });
        }
    }

    private static readonly JsonSerializerOptions CamelCaseOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    /// <summary>
    /// POST /api/llm/generate
    ///
    /// Accepts markdown content + optional template, streams SSE events back:
    ///   data: {"type":"progress","value":10}
    ///   data: {"type":"chunk","text":"Hello "}
    ///   data: {"type":"done"}
    ///   data: {"type":"error","message":"..."}   ← only on failure
    /// </summary>
    [HttpPost("generate")]
    public async Task Generate(
        [FromForm] string markdownContent,
        [FromForm] string? templateContent,
        [FromForm] string? templateFilename,
        [FromForm] string model,
        [FromForm] string provider,
        CancellationToken ct)
    {
        Response.Headers.ContentType  = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection   = "keep-alive";

        var request = new LlmGenerationRequest(markdownContent, templateContent, templateFilename, model, provider);

        try
        {
            await foreach (var evt in generationService.GenerateAsync(request, ct))
            {
                await WriteSseEventAsync(evt, ct);
            }
        }
        catch (OperationCanceledException)
        {
            // Client disconnected or user cancelled — not an error
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "LLM generation failed for provider={Provider} model={Model}", provider, model);

            // Best-effort: try to send the error event before the connection closes
            try
            {
                await WriteSseEventAsync(new LlmSseEvent("error", Message: ex.Message), ct);
            }
            catch { /* response may already be gone */ }
        }
    }

    private async Task WriteSseEventAsync(LlmSseEvent evt, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(evt, SseJsonOptions);
        await Response.WriteAsync($"data: {json}\n\n", ct);
        await Response.Body.FlushAsync(ct);
    }

    // camelCase + omit null fields — keeps SSE payloads small
    private static readonly JsonSerializerOptions SseJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}
