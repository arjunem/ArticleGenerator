using System.Runtime.CompilerServices;
using ArtGen.Models;

namespace ArtGen.Services.Llm;

public interface ILlmGenerationService
{
    /// <summary>
    /// Generates article content by streaming LLM tokens.
    /// Yields LlmSseEvent records — progress milestones, text chunks, and a final done/error event.
    /// </summary>
    IAsyncEnumerable<LlmSseEvent> GenerateAsync(LlmGenerationRequest request, CancellationToken ct);
}

/// <summary>
/// Orchestrates LLM generation:
///   1. Builds the system prompt (incorporating any template)
///   2. Resolves the correct provider via the factory
///   3. Wraps streamed tokens in SSE events with progress milestones
///
/// This service is the only place that knows about prompt structure.
/// It is intentionally unaware of HTTP — the controller handles SSE framing.
/// </summary>
public class LlmGenerationService(ILlmProviderFactory providerFactory) : ILlmGenerationService
{
    public async IAsyncEnumerable<LlmSseEvent> GenerateAsync(
        LlmGenerationRequest request,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // Signal: request accepted
        yield return new LlmSseEvent("progress", Value: 10);

        var provider = providerFactory.Get(request.Provider);
        var systemPrompt = BuildSystemPrompt(request.TemplateContent, request.TemplateFilename);
        var providerRequest = new LlmProviderRequest(systemPrompt, request.MarkdownContent, request.Model);

        // Signal: about to start streaming
        yield return new LlmSseEvent("progress", Value: 15);

        var firstChunk = true;

        await foreach (var token in provider.StreamAsync(providerRequest, ct))
        {
            if (firstChunk)
            {
                // Signal: first token received from LLM
                yield return new LlmSseEvent("progress", Value: 25);
                firstChunk = false;
            }

            yield return new LlmSseEvent("chunk", Text: token);
        }

        yield return new LlmSseEvent("done");
    }

    // -------------------------------------------------------------------------
    // Prompt construction
    // Template content is injected into the system prompt so providers
    // remain unaware of the template concept.
    // -------------------------------------------------------------------------

    private static string BuildSystemPrompt(string? templateContent, string? templateFilename)
    {
        const string Base =
            "You are a technical writer. " +
            "Generate a well-structured, complete article in Markdown format " +
            "based on the notes or outline provided by the user. " +
            "Use clear headings, concise paragraphs, and code blocks where appropriate.";

        if (string.IsNullOrWhiteSpace(templateContent))
            return Base;

        var ext = Path.GetExtension(templateFilename ?? "").ToLowerInvariant();

        var templateHint = ext switch
        {
            ".md"   => "Follow the structure, tone, and section layout of this Markdown template:",
            ".html" => "Follow the section structure and content organisation of this HTML template (output Markdown, not HTML):",
            ".css"  => null,   // CSS conveys no content structure — skip injecting it into the prompt
            _       => "Follow the structure and style of this template:"
        };

        if (templateHint is null)
            return Base;

        return $"{Base}\n\n{templateHint}\n\n{templateContent}";
    }
}
