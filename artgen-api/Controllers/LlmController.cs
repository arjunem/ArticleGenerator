using System.Text.Json;
using System.Text.Json.Serialization;
using ArtGen.Models;
using ArtGen.Services;
using ArtGen.Services.Llm;
using Microsoft.AspNetCore.Mvc;

namespace ArtGen.Controllers;

[ApiController]
[Route("api/[controller]")]
public class LlmController(
    ILlmGenerationService generationService,
    ILlmProviderFactory providerFactory,
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
        [FromForm] string inputContent,
        [FromForm] string inputFormat,
        [FromForm] string? templateContent,
        [FromForm] string? templateFilename,
        [FromForm] string model,
        [FromForm] string provider,
        CancellationToken ct)
    {
        Response.Headers.ContentType  = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection   = "keep-alive";

        // HTML content arrives as raw markup when loaded directly from the editor.
        // Convert to Markdown before sending to the LLM.
        if (inputFormat == "html")
        {
            inputContent = InputParserService.ParseHtmlString(inputContent);
            inputFormat  = "markdown";
        }

        var request = new LlmGenerationRequest(inputContent, inputFormat, templateContent, templateFilename, model, provider);

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

    /// <summary>
    /// POST /api/llm/chat
    ///
    /// Accepts a user message + document context and streams SSE responses.
    /// Uses the same event format as /api/llm/generate.
    /// </summary>
    [HttpPost("chat")]
    public async Task Chat([FromBody] LlmChatRequest request, CancellationToken ct)
    {
        Response.Headers.ContentType  = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection   = "keep-alive";

        try
        {
            var provider = providerFactory.Get(request.Provider);
            var systemPrompt = BuildChatSystemPrompt(request.Context);
            var llmRequest = new LlmProviderRequest(systemPrompt, request.UserMessage, request.Model);

            await foreach (var token in provider.StreamAsync(llmRequest, ct))
            {
                await WriteSseEventAsync(new LlmSseEvent("chunk", Text: token), ct);
            }

            await WriteSseEventAsync(new LlmSseEvent("done"), ct);
        }
        catch (OperationCanceledException)
        {
            // Client disconnected — not an error
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "LLM chat failed for provider={Provider} model={Model}", request.Provider, request.Model);
            try
            {
                await WriteSseEventAsync(new LlmSseEvent("error", Message: ex.Message), ct);
            }
            catch { /* response may already be gone */ }
        }
    }

    private static string BuildChatSystemPrompt(string? context)
    {
        if (string.IsNullOrWhiteSpace(context))
            return "You are an AI assistant helping the user with their document. Format your responses as Markdown.";

        return $"""
            You are an AI assistant helping the user edit and improve their document.
            Here is the document content for context:

            {context}

            Help the user with their specific request. Provide concrete, actionable suggestions
            or make the requested edits directly. Format your response as Markdown.
            """;
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
