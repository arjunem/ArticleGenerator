# LLM Generation Feature — Design Specification

## Overview

When the user selects the **LLM engine**, the editor gains a second tab ("Generated") alongside the existing input tab. Clicking **Generate** sends the markdown content and optional template to the configured LLM provider via a streaming SSE endpoint. The generated article streams back in real-time, populating the Generated tab while a progress bar advances. The user can then edit, preview, and export the generated result.

---

## User Flow

```
1. User types/uploads markdown content → Input tab (existing editor)
2. User optionally uploads a template file (sidebar)
3. User selects LLM engine + provider + model (sidebar)
   → Editor gains [Input] [Generated] tabs
4. User clicks Generate
   → Progress bar appears (chunk-driven advance)
   → Active tab switches to Generated
   → Streamed tokens appear live in the Generated CodeMirror editor
5. Generation completes
   → Progress bar reaches 100% then disappears
   → User can edit generated content, switch to Preview, or export
```

---

## Architecture

### Communication Protocol: Server-Sent Events (SSE) over HTTP POST

We use `fetch` + `ReadableStream` (not `EventSource`) because:
- `EventSource` only supports GET; we need POST to send markdown + template
- `fetch` streaming works in all modern browsers and Angular

**SSE event format (camelCase JSON, null fields omitted):**

```
data: {"type":"progress","value":10}

data: {"type":"progress","value":15}

data: {"type":"progress","value":25}

data: {"type":"chunk","text":"## Introduction\n"}

data: {"type":"chunk","text":"This article explores..."}

data: {"type":"done"}

data: {"type":"error","message":"..."}    ← only on failure
```

---

## Backend Architecture

### Provider Abstraction Layer

The backend is structured in three layers so that adding a new LLM provider (e.g. Anthropic) requires creating one new class and one DI registration — nothing else changes.

```
LlmController
     │  iterates IAsyncEnumerable<LlmSseEvent>
     ▼
ILlmGenerationService  (LlmGenerationService)
     │  builds prompt, wraps tokens in SSE events
     │  resolves provider by name
     ▼
ILlmProviderFactory  (LlmProviderFactory)
     │  looks up registered providers by ProviderName
     ▼
ILlmProvider
     └── OllamaProvider      ✅ implemented
     └── AnthropicProvider   🔲 future
```

### `ILlmProvider` — the extension point

```csharp
public interface ILlmProvider
{
    string ProviderName { get; }   // "ollama" | "anthropic" | ...
    IAsyncEnumerable<string> StreamAsync(LlmProviderRequest request, CancellationToken ct);
}
```

Each provider handles its own HTTP transport and streaming protocol internally.
The rest of the application only depends on this interface.

### `ILlmProviderFactory` — automatic resolution

```csharp
public interface ILlmProviderFactory
{
    ILlmProvider Get(string providerName);
}
```

`LlmProviderFactory` receives all `ILlmProvider` registrations via DI and builds a
dictionary keyed by `ProviderName` (case-insensitive). Throws with a clear message
listing available providers if an unknown name is requested.

### `ILlmGenerationService` — prompt building + SSE event wrapping

```csharp
public interface ILlmGenerationService
{
    IAsyncEnumerable<LlmSseEvent> GenerateAsync(LlmGenerationRequest request, CancellationToken ct);
}
```

Responsibilities:
1. Resolve provider via factory
2. Build system prompt (with optional template content injected)
3. Yield `progress` milestones at key points (10 → 15 → 25)
4. Yield `chunk` events for every token from the provider
5. Yield `done` on completion

### `OllamaProvider` — current implementation

Uses Ollama's OpenAI-compatible streaming endpoint:

```
POST http://localhost:11434/v1/chat/completions
{ "model": "...", "messages": [...], "stream": true }
```

Response is SSE format:
```
data: {"choices":[{"delta":{"content":"token"},"finish_reason":null}]}
data: [DONE]
```

Uses a named `HttpClient` (`"ollama"`) registered via `IHttpClientFactory`.
Base URL is read from `appsettings.json → Llm:Ollama:BaseUrl`.

### `LlmController` — SSE framing only

```
POST /api/llm/generate
Content-Type: multipart/form-data
Fields: markdownContent, templateContent?, model, provider
```

Sets `Content-Type: text/event-stream`, iterates `ILlmGenerationService.GenerateAsync()`,
writes each event as `data: {json}\n\n` and flushes. No business logic here.

### Models (`Models/LlmModels.cs`)

```csharp
// From frontend → controller
public record LlmGenerationRequest(
    string MarkdownContent,
    string? TemplateContent,
    string Model,
    string Provider   // "ollama" | "anthropic" | ...
);

// Controller → provider (providers are unaware of templates)
public record LlmProviderRequest(string SystemPrompt, string UserMessage, string Model);

// Streamed to frontend
public record LlmSseEvent(string Type, string? Text, int? Value, string? Message);
```

### Adding Anthropic in future

1. Create `AnthropicProvider : ILlmProvider` with `ProviderName = "anthropic"`
2. Use `Anthropic.SDK` `StreamMessageAsync()` internally
3. Register in `Program.cs`: `builder.Services.AddSingleton<ILlmProvider, AnthropicProvider>()`
4. Add `Anthropic:ApiKey` to `appsettings.json`
5. Frontend sends `provider: "anthropic"` — **no other backend changes needed**

---

## Backend Files

| File | Status | Role |
|---|---|---|
| `Models/LlmModels.cs` | ✅ Done | Request/response records |
| `Services/Llm/ILlmProvider.cs` | ✅ Done | Provider contract |
| `Services/Llm/LlmProviderFactory.cs` | ✅ Done | Resolves provider by name |
| `Services/Llm/OllamaProvider.cs` | ✅ Done | Ollama streaming implementation |
| `Services/Llm/LlmGenerationService.cs` | ✅ Done | Prompt building + SSE events |
| `Controllers/LlmController.cs` | ✅ Done | SSE endpoint |
| `Program.cs` | ✅ Done | DI registrations |
| `appsettings.json` | ✅ Done | Ollama base URL config |

---

## Frontend Changes

### `converter.models.ts`

Add to `ConverterState`:
```typescript
generatedContent: string;               // LLM output accumulator
activeEditorTab: 'input' | 'generated'; // which tab is visible
generationProgress: number;             // 0–100
```

Add new type:
```typescript
export interface LlmSseEvent {
  type: 'progress' | 'chunk' | 'done' | 'error';
  text?: string;
  value?: number;
  message?: string;
}
```

### `converter-state.service.ts`

New methods:
```typescript
setGeneratedContent(content: string)
appendGeneratedChunk(chunk: string)
setActiveEditorTab(tab: 'input' | 'generated')
setGenerationProgress(value: number)
```

Update `canConvert`: allow generation in LLM mode even with no output formats selected
(generation doesn't produce downloadable files — user exports separately).

### `conversion-api.service.ts`

New method using `fetch` + `ReadableStream` (not Angular `HttpClient` — needs raw stream access):

```typescript
async generateWithLlm(
  markdownContent: string,
  templateContent: string | null,
  model: string,
  provider: string,
  onChunk: (text: string) => void,
  onProgress: (value: number) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  signal: AbortSignal
): Promise<void>
```

Parses SSE lines from `response.body.getReader()`, dispatches to callbacks.
Caller holds an `AbortController` to cancel mid-stream.

### `editor-panel.ts` / `editor-panel.html`

**Tab bar** (visible only when `engine === 'llm'`):
```html
@if (state().engine === 'llm') {
  <div class="editor-tabs">
    <button [class.active]="state().activeEditorTab === 'input'"
            (click)="setActiveTab('input')">Input</button>
    <button [class.active]="state().activeEditorTab === 'generated'"
            (click)="setActiveTab('generated')">Generated</button>
  </div>
}
```

**Progress bar** (visible during generation):
```html
@if (state().status === 'converting' && state().engine === 'llm') {
  <div class="generation-progress">
    <div class="progress-bar" [style.width.%]="state().generationProgress"></div>
  </div>
}
```

Two CodeMirror instances (one per tab) — preferred over swapping content to preserve cursor/scroll position per tab.

| Tab | Content | Edit state |
|---|---|---|
| `input` | `markdownContent` | Always editable |
| `generated` | `generatedContent` | Read-only during streaming, editable after |

### `sidebar.ts` / `sidebar.html`

Generate button in LLM mode:
1. Create `AbortController`, switch to Generated tab, clear content, set status `'converting'`
2. Call `generateWithLlm()` with provider and model from state
3. `onDone` → `setStatus('success')`, `setGenerationProgress(100)`
4. `onError` → `setStatus('error', message)`

Add **Cancel** button (visible during generation) → calls `abortController.abort()`.

---

## Progress Bar Strategy

| Phase | Value | Trigger |
|---|---|---|
| Request sent | 5 | Immediately on submit (frontend) |
| Backend accepted | 10 | First SSE `progress` event |
| Provider connected | 15 | Second SSE `progress` event |
| First token | 25 | Third SSE `progress` event |
| Streaming | 25 → 90 | Frontend increments per chunk: `min(2, (90 - current) / 10)` |
| Done | 100 | `done` SSE event |
| Bar hidden | — | 600ms after reaching 100 |

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Ollama not running | Provider throws `HttpRequestException`; SSE `error` event sent; frontend shows error status |
| Model not pulled | Ollama returns 404; `EnsureSuccessStatusCode()` throws; `error` event sent |
| User cancels | `AbortController.abort()` → fetch `AbortError` → status resets to `'idle'`; partial content retained in Generated tab |
| Network drop mid-stream | `reader.read()` throws → `onError` callback → status `'error'` |
| Unknown provider name | Factory throws with list of available providers; `error` event sent |
| Empty result | `done` received but `generatedContent` is empty → warning in status bar |

---

## Configuration

### `appsettings.json`
```json
{
  "Llm": {
    "Ollama": {
      "BaseUrl": "http://localhost:11434"
    }
  }
}
```

### Future Anthropic config
```json
{
  "Llm": {
    "Ollama": { "BaseUrl": "http://localhost:11434" },
    "Anthropic": { "ApiKey": "" }
  }
}
```

---

## Dependencies

| Package | Where | Purpose |
|---|---|---|
| `IHttpClientFactory` (built-in) | artgen-api | Named HttpClient for Ollama |
| `Anthropic.SDK` (future NuGet) | artgen-api | Anthropic streaming client |

No new frontend npm packages required.

---

## Frontend Files

| File | Status | Change |
|---|---|---|
| `models/converter.models.ts` | 🔲 Pending | Extend `ConverterState`, add `LlmSseEvent` |
| `services/converter-state.service.ts` | 🔲 Pending | Add new signals and mutators |
| `services/conversion-api.service.ts` | 🔲 Pending | Add `generateWithLlm()` |
| `editor-panel/editor-panel.ts` | 🔲 Pending | Dual CodeMirror, tab logic, progress bar |
| `editor-panel/editor-panel.html` | 🔲 Pending | Tab bar and progress bar markup |
| `editor-panel/editor-panel.scss` | 🔲 Pending | Tab and progress bar styles |
| `sidebar/sidebar.ts` | 🔲 Pending | Wire Generate/Cancel for LLM mode |
| `sidebar/sidebar.html` | 🔲 Pending | Cancel button |
