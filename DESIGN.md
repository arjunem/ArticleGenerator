# MarkFlow — Design Document

## 1. Overview

MarkFlow is a web application for converting Markdown files to HTML and PDF, with optional Claude LLM-assisted formatting and an optional CSS/HTML template layer. It is built on **Angular 17+ (standalone components)** for the frontend and **ASP.NET Core 8 Web API** for the backend.

---

## 2. Goals

- Upload a `.md` file and view / edit it in the browser
- Toggle between a raw markdown editor and a live rendered preview
- Optionally upload a CSS/HTML template to style the output
- Convert to HTML, PDF, or both via a single button
- Switch the conversion engine between **Direct** (Pandoc) and **LLM-assisted** (Claude API)
- Download the generated files immediately after conversion

---

## 3. Non-Goals (v1)

- User authentication / multi-tenancy
- Cloud storage of uploaded files
- Batch conversion of multiple files at once
- DOCX or other output formats (planned for v2)

---

## 4. Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser                                        │
│                                                 │
│  Angular 17 SPA (standalone components)         │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  Sidebar     │  │  Editor / Preview Panel  │ │
│  │  - Upload MD │  │  - CodeMirror editor     │ │
│  │  - Upload TPL│  │  - Marked.js preview     │ │
│  │  - Engine    │  │  - Split / Tab view      │ │
│  │    toggle    │  │                          │ │
│  │  - Format    │  │                          │ │
│  │    selector  │  │                          │ │
│  │  - Convert   │  │                          │ │
│  └──────────────┘  └──────────────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │ HTTP (multipart/form-data)
┌────────────────────▼────────────────────────────┐
│  ASP.NET Core 8 Web API                         │
│                                                 │
│  POST /api/convert                              │
│  ┌────────────────────────────────────────────┐ │
│  │  ConvertController                         │ │
│  │       │                                    │ │
│  │  ┌────▼────────────────────────────────┐   │ │
│  │  │  IConversionService                 │   │ │
│  │  │  ├── DirectConversionService        │   │ │
│  │  │  │    └── Pandoc (CLI process)      │   │ │
│  │  │  └── LlmConversionService           │   │ │
│  │  │       └── Anthropic Claude API      │   │ │
│  │  └─────────────────────────────────────┘   │ │
│  │                                            │ │
│  │  GET /api/convert/download/{token}         │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 5. Frontend Design

### 5.1 Component Tree

```
AppComponent (root)
└── ConverterShellComponent        ← main layout
    ├── SidebarComponent           ← left panel, all controls
    │   ├── FileUploadComponent    ← MD file drop zone
    │   ├── TemplateUploadComponent← optional CSS/HTML/markdown template
    │   ├── EngineToggleComponent  ← Direct ↔ LLM switch
    │   ├── FormatSelectorComponent← HTML / PDF chips
    │   └── ConvertButtonComponent ← triggers conversion
    └── EditorPanelComponent       ← right panel
        ├── EditorTabsComponent    ← Editor / Preview / Split tabs
        ├── CodeEditorComponent    ← CodeMirror 6 (raw markdown)
        ├── PreviewComponent       ← marked.js rendered HTML
        └── StatusBarComponent     ← status, word count, engine info
```

### 5.2 State Management

Use Angular signals (no NgRx needed for v1). A single `ConverterStateService` holds:

```typescript
interface ConverterState {
  markdownContent: string;         // current editor content
  markdownFileName: string;
  templateFile: File | null;
  engine: 'direct' | 'llm';
  llmModel: string;                // e.g. 'claude-sonnet-4-6'
  outputFormats: OutputFormat[];   // ['html', 'pdf']
  viewMode: 'editor' | 'preview' | 'split';
  editMode: boolean;
  conversionStatus: ConversionStatus;
  lastResult: ConversionResult | null;
}
```

### 5.3 Editor Panel Behaviour

| View Mode | Left pane | Right pane |
|---|---|---|
| `editor` | CodeMirror (full width) | — |
| `preview` | Marked.js render (full width) | — |
| `split` | CodeMirror | Marked.js render (live) |

Edit mode toggle controls whether CodeMirror is read-only or editable. The switch is visible in all view modes.

### 5.4 Sidebar Controls

**File upload zone** — drag-and-drop or click-to-browse. Accepts `.md` only. On load, reads file as text → sets `markdownContent`. Shows filename pill with remove button.

**Template upload** — same pattern, optional. Accepts `.html`, `.md`, or `.pdf`. Tagged as "optional". When present, sent as `templateFile` in the API request.

**Engine toggle** — slide toggle. Off = Direct (Pandoc), On = LLM (Claude). When LLM is on, shows a model selector dropdown (`claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`).

**Format selector** — two chips: HTML and PDF. Both active by default. Clicking deselects. At least one must remain selected (Convert button disabled otherwise).

**Convert button** — disabled when no file loaded or no format selected. On click, posts to `/api/convert`.

### 5.5 Download Behaviour

On successful conversion, the API returns download tokens for each format. The frontend triggers a file download for each automatically via a hidden `<a download>` element.

---

## 6. Backend Design

### 6.1 API Endpoints

#### `POST /api/convert`

**Request** — `multipart/form-data`:

| Field | Type | Required | Description |
|---|---|---|---|
| `markdownFile` | File | Yes | The `.md` file |
| `templateFile` | File | No | `.html`, `.md`, or `.pdf` template |
| `engine` | string | Yes | `"direct"` or `"llm"` |
| `llmModel` | string | No | Claude model string |
| `outputFormats` | string[] | Yes | `["html"]`, `["pdf"]`, or `["html","pdf"]` |

**Response** `200 OK`:
```json
{
  "success": true,
  "outputs": [
    { "format": "html", "downloadToken": "abc123", "filename": "document.html" },
    { "format": "pdf",  "downloadToken": "def456", "filename": "document.pdf" }
  ]
}
```

#### `GET /api/convert/download/{token}`

Returns the file as a binary stream with `Content-Disposition: attachment`. Tokens expire after 10 minutes and are stored in memory (`IMemoryCache`).

### 6.2 Conversion Service Design

```csharp
public interface IConversionService
{
    Task<ConversionOutput> ConvertAsync(ConversionRequest request);
}

public record ConversionRequest(
    string MarkdownContent,
    string? TemplateContent,
    string? TemplateFilename,
    ConversionEngine Engine,
    string? LlmModel,
    IEnumerable<OutputFormat> OutputFormats
);

public record ConversionOutput(
    IEnumerable<OutputFile> Files
);

public record OutputFile(
    OutputFormat Format,
    byte[] Content,
    string Filename
);
```

**DirectConversionService** — wraps Pandoc CLI:
- Uses `System.Diagnostics.Process` to invoke `pandoc`
- Injects CSS via `--css` flag or via `--template` if an HTML template is provided
- For PDF: `--pdf-engine=wkhtmltopdf`

**LlmConversionService** — uses the Anthropic .NET SDK (or raw `HttpClient`):
- Sends markdown content to Claude with a system prompt instructing it to return a complete, styled HTML document
- Optionally injects the template content into the prompt as a CSS/HTML reference
- For PDF: takes Claude's HTML output and passes it through wkhtmltopdf locally

### 6.3 LLM Prompt Design

**System prompt (HTML conversion):**
```
You are a document formatter. Convert the provided Markdown content into a 
complete, standalone HTML document. Apply clean, professional styling inline 
or in a <style> block. The output must be valid HTML5 with no external 
dependencies. Return only the HTML document — no explanation, no markdown 
fences.
```

If a template is provided:
```
Use the following CSS/HTML template as the styling basis for the document:
<template>
{templateContent}
</template>
```

### 6.4 Configuration (`appsettings.json`)

```json
{
  "Anthropic": {
    "ApiKey": "",
    "DefaultModel": "claude-sonnet-4-6"
  },
  "Conversion": {
    "PandocPath": "pandoc",
    "WkhtmltopdfPath": "wkhtmltopdf",
    "TempFileLifetimeMinutes": 10
  },
  "Cors": {
    "AllowedOrigins": ["http://localhost:4200"]
  }
}
```

API key should be set via environment variable `Anthropic__ApiKey` in production.

---

## 7. Project Structure

```
artgen/
├── artgen-api/                    ← ASP.NET Core 8 Web API
│   ├── Controllers/
│   │   └── ConvertController.cs
│   ├── Services/
│   │   ├── IConversionService.cs
│   │   ├── DirectConversionService.cs
│   │   └── LlmConversionService.cs
│   ├── Models/
│   │   ├── ConversionRequest.cs
│   │   └── ConversionOutput.cs
│   ├── appsettings.json
│   └── Program.cs
│
└── artgen-ui/                     ← Angular 17+ standalone
    ├── src/
    │   ├── app/
    │   │   ├── shell/
    │   │   │   └── converter-shell.component.ts
    │   │   ├── sidebar/
    │   │   │   ├── sidebar.component.ts
    │   │   │   ├── file-upload/
    │   │   │   ├── template-upload/
    │   │   │   ├── engine-toggle/
    │   │   │   ├── format-selector/
    │   │   │   └── convert-button/
    │   │   ├── editor-panel/
    │   │   │   ├── editor-panel.component.ts
    │   │   │   ├── code-editor/
    │   │   │   ├── preview/
    │   │   │   └── status-bar/
    │   │   ├── services/
    │   │   │   ├── converter-state.service.ts
    │   │   │   └── conversion-api.service.ts
    │   │   └── models/
    │   │       └── converter.models.ts
    │   ├── environments/
    │   │   ├── environment.ts
    │   │   └── environment.prod.ts
    │   └── styles.scss
    ├── angular.json
    └── package.json
```

---

## 8. Key Dependencies

### Frontend

| Package | Purpose |
|---|---|
| `@codemirror/lang-markdown` | Markdown syntax highlighting in editor |
| `marked` | Markdown → HTML for live preview |
| `@angular/cdk` | Drag-and-drop for file uploads |

### Backend

| Package | Purpose |
|---|---|
| `Anthropic` (unofficial) or raw `HttpClient` | Claude API calls |
| `Microsoft.Extensions.Caching.Memory` | Token-based download cache |
| `Pandoc` (system CLI) | Direct markdown conversion |
| `wkhtmltopdf` (system CLI) | HTML → PDF |

---

## 9. Data Flow — Conversion Request

```
User clicks Convert
       │
       ▼
ConvertButtonComponent
  → calls ConversionApiService.convert(state)
       │
       ▼
POST /api/convert  (multipart/form-data)
       │
       ▼
ConvertController.Convert()
  → reads engine from request
  → resolves IConversionService via factory
       │
       ├─ engine = 'direct' ──► DirectConversionService
       │                          └─ pandoc → html/pdf bytes
       │
       └─ engine = 'llm' ────► LlmConversionService
                                  └─ Claude API → html string
                                  └─ wkhtmltopdf → pdf bytes (if needed)
       │
       ▼
  stores output bytes in IMemoryCache with token
  returns ConversionResponse (tokens)
       │
       ▼
Angular receives tokens
  → triggers browser download per format via hidden <a> tag
```

---

## 10. UI Decisions

- **No modal dialogs** — all configuration lives in the sidebar, always visible
- **Optimistic UI** — Convert button shows a spinner inline; sidebar remains interactive
- **Error handling** — inline error message below Convert button, not a toast/overlay
- **Responsiveness** — sidebar collapses to a drawer on narrow viewports (< 768px)
- **Theme** — follows system dark/light preference via `prefers-color-scheme`
