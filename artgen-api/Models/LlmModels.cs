namespace ArtGen.Models;

/// <summary>
/// Incoming request from the frontend to generate content via LLM.
/// </summary>
public record LlmGenerationRequest(
    string MarkdownContent,
    string? TemplateContent,
    string? TemplateFilename,   // used to tailor the system prompt (.html / .md / .css)
    string Model,
    string Provider   // "ollama" | "anthropic" | any future provider key
);

/// <summary>
/// Normalised request passed to an ILlmProvider implementation.
/// Providers only see a system prompt, a user message, and a model name —
/// they are unaware of templates or markdown formatting concerns.
/// </summary>
public record LlmProviderRequest(
    string SystemPrompt,
    string UserMessage,
    string Model
);

/// <summary>
/// A single model entry returned by GET /api/llm/models.
/// </summary>
public record LlmModelInfo(
    string Value,   // exact name to pass to the provider (e.g. "llama3.2:latest")
    string Label    // display name with :latest stripped (e.g. "llama3.2")
);

public record LlmModelsResponse(IEnumerable<LlmModelInfo> Models);

// Internal: Ollama /api/tags response shapes
internal record OllamaTagsResponse(List<OllamaTagModel>? Models);
internal record OllamaTagModel(string Name);

/// <summary>
/// SSE event emitted to the Angular frontend over the streaming response.
/// Types:
///   progress  – generation milestone (value 0-100)
///   chunk     – a streamed token or text fragment (text field)
///   done      – generation complete
///   error     – unrecoverable failure (message field)
/// </summary>
/// <summary>
/// Request body for POST /api/llm/chat
/// </summary>
public record LlmChatRequest(
    string UserMessage,
    string Context,   // document content for AI context
    string Model,
    string Provider
);

public record LlmSseEvent(
    string Type,
    string? Text = null,
    int? Value = null,
    string? Message = null
);
