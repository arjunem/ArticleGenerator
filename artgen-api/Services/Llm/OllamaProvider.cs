using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ArtGen.Models;

namespace ArtGen.Services.Llm;

/// <summary>
/// Streams tokens from a locally running Ollama instance using its
/// OpenAI-compatible endpoint (POST /v1/chat/completions, stream: true).
///
/// Ollama SSE line format:
///   data: {"choices":[{"delta":{"content":"token"},"finish_reason":null}]}
///   data: [DONE]
/// </summary>
public class OllamaProvider(IHttpClientFactory httpClientFactory, IConfiguration config) : ILlmProvider
{
    public string ProviderName => "ollama";

    private string BaseUrl => config["Llm:Ollama:BaseUrl"] ?? "http://localhost:11434";

    public async IAsyncEnumerable<string> StreamAsync(
        LlmProviderRequest request,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var payload = new OllamaChatRequest(
            request.Model,
            [
                new OllamaMessage("system", request.SystemPrompt),
                new OllamaMessage("user",   request.UserMessage)
            ],
            Stream: true
        );

        var body = new StringContent(
            JsonSerializer.Serialize(payload, SerializerOptions),
            Encoding.UTF8,
            "application/json");

        var httpClient = httpClientFactory.CreateClient("ollama");

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/v1/chat/completions")
        {
            Content = body
        };

        using var response = await httpClient.SendAsync(
            httpRequest, HttpCompletionOption.ResponseHeadersRead, ct);

        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);

            if (string.IsNullOrWhiteSpace(line) || !line.StartsWith("data: "))
                continue;

            var json = line["data: ".Length..];

            if (json == "[DONE]")
                yield break;

            string? token = null;
            try
            {
                var chunk = JsonSerializer.Deserialize<OllamaChunk>(json, SerializerOptions);
                token = chunk?.Choices?[0]?.Delta?.Content;
            }
            catch (JsonException)
            {
                // Skip any malformed SSE chunks — Ollama occasionally emits status lines
                continue;
            }

            if (!string.IsNullOrEmpty(token))
                yield return token;
        }
    }

    // -------------------------------------------------------------------------
    // Request / response shapes for Ollama's OpenAI-compatible API
    // -------------------------------------------------------------------------

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private record OllamaChatRequest(
        string Model,
        IEnumerable<OllamaMessage> Messages,
        bool Stream
    );

    private record OllamaMessage(string Role, string Content);

    // Deserialisation targets — only the fields we care about
    private record OllamaChunk(
        [property: JsonPropertyName("choices")] List<OllamaChoice>? Choices
    );

    private record OllamaChoice(
        [property: JsonPropertyName("delta")] OllamaDelta? Delta
    );

    private record OllamaDelta(
        [property: JsonPropertyName("content")] string? Content
    );
}
