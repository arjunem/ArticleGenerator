using ArtGen.Models;

namespace ArtGen.Services.Llm;

/// <summary>
/// Abstracts a single LLM backend (Ollama, Anthropic, OpenAI, etc.).
/// Each implementation handles its own HTTP transport and streaming protocol.
/// The rest of the application only depends on this interface.
///
/// To add a new provider:
///   1. Create a class that implements ILlmProvider
///   2. Set ProviderName to a unique key (e.g. "anthropic")
///   3. Register it with AddSingleton&lt;ILlmProvider, YourProvider&gt;() in Program.cs
///   4. The factory picks it up automatically — no other changes needed.
/// </summary>
public interface ILlmProvider
{
    /// <summary>
    /// Unique key used to select this provider (case-insensitive).
    /// Matches the "provider" field sent by the frontend.
    /// </summary>
    string ProviderName { get; }

    /// <summary>
    /// Streams raw text tokens from the LLM for the given request.
    /// Each yielded string is one token or small text fragment.
    /// Throws on unrecoverable errors; honours cancellation.
    /// </summary>
    IAsyncEnumerable<string> StreamAsync(LlmProviderRequest request, CancellationToken ct);
}
