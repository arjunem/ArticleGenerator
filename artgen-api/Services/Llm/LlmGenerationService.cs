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
        var systemPrompt = BuildSystemPrompt(request.InputFormat, request.TemplateContent, request.TemplateFilename);
        var providerRequest = new LlmProviderRequest(systemPrompt, request.InputContent, request.Model);

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

    private static string BuildSystemPrompt(string inputFormat, string? templateContent, string? templateFilename)
    {
        var contentHint = inputFormat == "plain"
            ? "based on the plain text notes or content provided by the user."
            : "based on the Markdown notes or outline provided by the user.";

        var Base =
        "You are an expert technical writer. Using the content provided below as your "+
        "source material, write a detailed, polished, publication-ready technical article. "+ 
        "Use simple language with analogies, clear H2/H3 headings, short paragraphs, "+
        "code snippets with explanations, blockquotes for key insights, and 💡 Pro Tip "+
        "callouts where relevant. Preserve all technical accuracy, expand on brief points, "+ 
        "and output clean Markdown directly without any preamble. "+
        $"{contentHint} ";

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
