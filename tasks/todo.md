# LLM Generation Feature — Implementation Plan

---

## Phase 1 — Backend: Provider Abstraction + Ollama ✅ DONE

- [x] Create `artgen-api/Models/LlmModels.cs`
  - `LlmGenerationRequest` (MarkdownContent, TemplateContent?, Model, **Provider**)
  - `LlmProviderRequest` (SystemPrompt, UserMessage, Model)
  - `LlmSseEvent` (Type, Text?, Value?, Message?)
- [x] Create `artgen-api/Services/Llm/ILlmProvider.cs`
  - `ProviderName` property + `IAsyncEnumerable<string> StreamAsync()`
- [x] Create `artgen-api/Services/Llm/LlmProviderFactory.cs`
  - `ILlmProviderFactory` interface
  - `LlmProviderFactory` — resolves provider by name from all registered `ILlmProvider` instances
- [x] Create `artgen-api/Services/Llm/OllamaProvider.cs`
  - Streams from `POST /v1/chat/completions` (Ollama OpenAI-compatible endpoint)
  - Uses named `HttpClient` via `IHttpClientFactory`
  - Reads base URL from `appsettings.json → Llm:Ollama:BaseUrl`
- [x] Create `artgen-api/Services/Llm/LlmGenerationService.cs`
  - `ILlmGenerationService` interface
  - Builds system prompt (injects template content if provided)
  - Yields `progress` milestones (10 → 15 → 25) + `chunk` events + `done`
- [x] Create `artgen-api/Controllers/LlmController.cs`
  - `POST /api/llm/generate` — accepts `[FromForm]` fields
  - Sets SSE headers, iterates `ILlmGenerationService`, flushes each event
  - Handles `OperationCanceledException` (client disconnect) gracefully
- [x] Update `Program.cs` — register `HttpClient("ollama")`, `OllamaProvider`, `LlmProviderFactory`, `LlmGenerationService`
- [x] Update `appsettings.json` — add `Llm:Ollama:BaseUrl`
- [ ] Verify: test `POST /api/llm/generate` with Postman/curl, confirm tokens stream correctly

---

## Phase 2 — Frontend: State & API Service

- [ ] Extend `ConverterState` in `converter.models.ts`
  - Add `generatedContent: string`
  - Add `activeEditorTab: 'input' | 'generated'`
  - Add `generationProgress: number` (0–100)
  - Add `LlmSseEvent` interface
- [ ] Update `ConverterStateService` default state (new fields: `''`, `'input'`, `0`)
- [ ] Add mutator methods to `ConverterStateService`
  - `setGeneratedContent(content: string)`
  - `appendGeneratedChunk(chunk: string)`
  - `setActiveEditorTab(tab: 'input' | 'generated')`
  - `setGenerationProgress(value: number)`
- [ ] Update `canConvert` — allow LLM generation without output formats selected
- [ ] Add `generateWithLlm()` to `ConversionApiService`
  - POST to `/api/llm/generate` via `fetch` (not Angular `HttpClient`)
  - Parse SSE lines from `response.body.getReader()`
  - Dispatch to `onChunk`, `onProgress`, `onDone`, `onError` callbacks
  - Accept `AbortSignal` for cancellation support

---

## Phase 3 — Editor Panel: Dual Tabs + Progress Bar

- [ ] Add `[Input] [Generated]` tab bar in `editor-panel.html` (hidden unless `engine === 'llm'`)
- [ ] Create a second CodeMirror instance for the Generated tab
  - Read-only during streaming (`status === 'converting'`)
  - Editable after generation completes
  - Show/hide based on `activeEditorTab`
- [ ] Wire `appendGeneratedChunk` → `EditorView.dispatch` to update Generated editor live
- [ ] Add progress bar markup in `editor-panel.html`
  - Visible when `status === 'converting' && engine === 'llm'`
  - Width bound to `generationProgress`
- [ ] Style tabs + progress bar in `editor-panel.scss`
  - Tabs: consistent with existing view-mode buttons
  - Progress bar: 3–4px thin bar, accent colour, smooth CSS `width` transition

---

## Phase 4 — Sidebar: Wire Generate + Cancel

- [ ] Branch `convert()` in `sidebar.ts` on `engine`
  - `'direct'` → existing flow (unchanged)
  - `'llm'` → new LLM flow below
- [ ] LLM generate flow
  - Create `AbortController`, switch to Generated tab, clear content, set `'converting'`
  - Call `generateWithLlm()` passing `provider` and `model` from state
  - `onProgress` → `setGenerationProgress(value)`
  - `onChunk` → `appendGeneratedChunk(text)` + frontend progress increment
  - `onDone` → `setStatus('success')`, `setGenerationProgress(100)`
  - `onError` → `setStatus('error', message)`
- [ ] Add Cancel button to `sidebar.html` (visible when `status === 'converting' && engine === 'llm'`)
  - Calls `abortController.abort()` → `setStatus('idle')`

---

## Phase 5 — Polish & Error Handling

- [ ] Progress bar auto-hides 600ms after reaching 100%
- [ ] If Ollama is not running, show actionable error (not generic failure)
- [ ] If `done` received but `generatedContent` is empty, show warning in status bar
- [ ] Test cancellation mid-stream — partial content retained in Generated tab
- [ ] Test with template file — verify template is injected into system prompt
- [ ] Verify Direct mode is fully unaffected

---

## Review Checklist

- [ ] Backend flushes after every SSE event (no buffering)
- [ ] No LLM credentials in frontend code or browser network logs
- [ ] Cancellation cleans up properly (no zombie requests)
- [ ] Input tab remains editable after generation (user can tweak and re-generate)
- [ ] Direct conversion mode unchanged

---

## Future: Add Anthropic Provider

When ready:
1. Create `artgen-api/Services/Llm/AnthropicProvider.cs` implementing `ILlmProvider`
   - `ProviderName = "anthropic"`
   - Use `Anthropic.SDK` NuGet → `StreamMessageAsync()`
2. Register in `Program.cs`: `builder.Services.AddSingleton<ILlmProvider, AnthropicProvider>()`
3. Add `Llm:Anthropic:ApiKey` to `appsettings.json` (populate via env var in prod)
4. Frontend sends `provider: "anthropic"` — no other changes needed

---

## Lessons Log

_(Updated after corrections during implementation)_
