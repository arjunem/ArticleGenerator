# MarkFlow — Implementation Guide

## Prerequisites

- Node.js 20+, Angular CLI 17+ (`npm install -g @angular/cli`)
- .NET 8 SDK
- Pandoc installed and on PATH
- wkhtmltopdf installed and on PATH
- An Anthropic API key

---

## Phase 1 — Backend (.NET 8 API)

### 1.1 Create the project

```bash
dotnet new webapi -n artgen-api --framework net8.0
cd artgen-api
dotnet add package Microsoft.Extensions.Caching.Memory
```

### 1.2 `Models/ConversionModels.cs`

```csharp
namespace MarkFlow.Models;

public enum OutputFormat { Html, Pdf }
public enum ConversionEngine { Direct, Llm }

public record ConversionRequest(
    string MarkdownContent,
    string? TemplateContent,
    string? TemplateFilename,
    ConversionEngine Engine,
    string LlmModel,
    IEnumerable<OutputFormat> OutputFormats
);

public record OutputFile(OutputFormat Format, byte[] Content, string Filename);
public record ConversionOutput(IEnumerable<OutputFile> Files);

public record ConversionResultItem(string Format, string DownloadToken, string Filename);
public record ConversionResponse(bool Success, IEnumerable<ConversionResultItem> Outputs);
```

### 1.3 `Services/IConversionService.cs`

```csharp
namespace MarkFlow.Services;

public interface IConversionService
{
    Task<ConversionOutput> ConvertAsync(ConversionRequest request, CancellationToken ct = default);
}
```

### 1.4 `Services/DirectConversionService.cs`

```csharp
using System.Diagnostics;
using MarkFlow.Models;

namespace MarkFlow.Services;

public class DirectConversionService(IConfiguration config, ILogger<DirectConversionService> logger)
    : IConversionService
{
    private readonly string _pandoc = config["Conversion:PandocPath"] ?? "pandoc";
    private readonly string _wkhtmltopdf = config["Conversion:WkhtmltopdfPath"] ?? "wkhtmltopdf";

    public async Task<ConversionOutput> ConvertAsync(ConversionRequest request, CancellationToken ct = default)
    {
        var files = new List<OutputFile>();
        var tmpDir = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
        Directory.CreateDirectory(tmpDir);

        try
        {
            var mdPath = Path.Combine(tmpDir, "input.md");
            await File.WriteAllTextAsync(mdPath, request.MarkdownContent, ct);

            string? cssPath = null;
            if (!string.IsNullOrEmpty(request.TemplateContent))
            {
                var ext = Path.GetExtension(request.TemplateFilename ?? "template.html");
                cssPath = Path.Combine(tmpDir, $"template{ext}");
                await File.WriteAllTextAsync(cssPath, request.TemplateContent, ct);
            }

            foreach (var format in request.OutputFormats)
            {
                var outputPath = Path.Combine(tmpDir, format == OutputFormat.Html ? "output.html" : "output.pdf");
                await RunPandocAsync(mdPath, outputPath, cssPath, format, ct);
                var bytes = await File.ReadAllBytesAsync(outputPath, ct);
                files.Add(new OutputFile(format, bytes,
                    format == OutputFormat.Html ? "document.html" : "document.pdf"));
            }
        }
        finally
        {
            try { Directory.Delete(tmpDir, true); } catch { /* best-effort cleanup */ }
        }

        return new ConversionOutput(files);
    }

    private async Task RunPandocAsync(string input, string output, string? cssPath,
        OutputFormat format, CancellationToken ct)
    {
        var args = new List<string>
        {
            input, "-o", output,
            "--highlight-style=breezedark",
            "--standalone"
        };

        if (cssPath != null) args.AddRange(["--css", cssPath]);

        if (format == OutputFormat.Pdf)
            args.AddRange(["--pdf-engine", _wkhtmltopdf]);

        var psi = new ProcessStartInfo(_pandoc)
        {
            RedirectStandardError = true,
            UseShellExecute = false
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Could not start pandoc");
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);

        if (proc.ExitCode != 0)
        {
            logger.LogError("Pandoc failed: {Error}", stderr);
            throw new InvalidOperationException($"Pandoc conversion failed: {stderr}");
        }
    }
}
```

### 1.5 `Services/LlmConversionService.cs`

```csharp
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using MarkFlow.Models;

namespace MarkFlow.Services;

public class LlmConversionService(
    IConfiguration config,
    IHttpClientFactory httpFactory,
    ILogger<LlmConversionService> logger) : IConversionService
{
    private readonly string _apiKey = config["Anthropic:ApiKey"]
        ?? throw new InvalidOperationException("Anthropic:ApiKey not configured");
    private readonly string _wkhtmltopdf = config["Conversion:WkhtmltopdfPath"] ?? "wkhtmltopdf";

    public async Task<ConversionOutput> ConvertAsync(ConversionRequest request, CancellationToken ct = default)
    {
        var html = await GenerateHtmlWithClaudeAsync(request, ct);
        var files = new List<OutputFile>();

        foreach (var format in request.OutputFormats)
        {
            if (format == OutputFormat.Html)
            {
                files.Add(new OutputFile(OutputFormat.Html,
                    Encoding.UTF8.GetBytes(html), "document.html"));
            }
            else
            {
                var pdfBytes = await HtmlToPdfAsync(html, ct);
                files.Add(new OutputFile(OutputFormat.Pdf, pdfBytes, "document.pdf"));
            }
        }

        return new ConversionOutput(files);
    }

    private async Task<string> GenerateHtmlWithClaudeAsync(ConversionRequest request, CancellationToken ct)
    {
        var systemPrompt = """
            You are a document formatter. Convert the provided Markdown content into a 
            complete, standalone HTML5 document. Apply clean, professional styling using 
            a <style> block — no external stylesheet dependencies. The result must be 
            valid, self-contained HTML. Return only the HTML — no explanation, no 
            markdown code fences.
            """;

        if (!string.IsNullOrEmpty(request.TemplateContent))
        {
            systemPrompt += $"""

                Use the following as the base CSS/HTML template for styling:
                <template>
                {request.TemplateContent}
                </template>
                """;
        }

        var body = new
        {
            model = request.LlmModel,
            max_tokens = 8192,
            system = systemPrompt,
            messages = new[]
            {
                new { role = "user", content = request.MarkdownContent }
            }
        };

        var client = httpFactory.CreateClient("Anthropic");
        var json = JsonSerializer.Serialize(body);
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        httpRequest.Headers.Add("x-api-key", _apiKey);
        httpRequest.Headers.Add("anthropic-version", "2023-06-01");

        var response = await client.SendAsync(httpRequest, ct);
        response.EnsureSuccessStatusCode();

        var responseJson = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(responseJson);
        return doc.RootElement
            .GetProperty("content")[0]
            .GetProperty("text")
            .GetString() ?? throw new InvalidOperationException("Empty response from Claude");
    }

    private async Task<byte[]> HtmlToPdfAsync(string html, CancellationToken ct)
    {
        var tmpDir = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
        Directory.CreateDirectory(tmpDir);
        try
        {
            var htmlPath = Path.Combine(tmpDir, "input.html");
            var pdfPath = Path.Combine(tmpDir, "output.pdf");
            await File.WriteAllTextAsync(htmlPath, html, ct);

            var psi = new ProcessStartInfo(_wkhtmltopdf)
            {
                UseShellExecute = false,
                RedirectStandardError = true
            };
            psi.ArgumentList.Add("--quiet");
            psi.ArgumentList.Add(htmlPath);
            psi.ArgumentList.Add(pdfPath);

            using var proc = Process.Start(psi)!;
            await proc.WaitForExitAsync(ct);

            return await File.ReadAllBytesAsync(pdfPath, ct);
        }
        finally
        {
            try { Directory.Delete(tmpDir, true); } catch { /* ignore */ }
        }
    }
}
```

### 1.6 `Controllers/ConvertController.cs`

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using MarkFlow.Models;
using MarkFlow.Services;

namespace MarkFlow.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ConvertController(
    DirectConversionService directService,
    LlmConversionService llmService,
    IMemoryCache cache,
    ILogger<ConvertController> logger) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Convert(
        [FromForm] IFormFile markdownFile,
        [FromForm] IFormFile? templateFile,
        [FromForm] string engine,
        [FromForm] string? llmModel,
        [FromForm] string outputFormats,
        CancellationToken ct)
    {
        if (markdownFile.Length == 0)
            return BadRequest("No markdown file provided.");

        using var mdReader = new StreamReader(markdownFile.OpenReadStream());
        var mdContent = await mdReader.ReadToEndAsync(ct);

        string? templateContent = null;
        if (templateFile is { Length: > 0 })
        {
            using var tplReader = new StreamReader(templateFile.OpenReadStream());
            templateContent = await tplReader.ReadToEndAsync(ct);
        }

        var formats = outputFormats.Split(',')
            .Select(f => Enum.Parse<OutputFormat>(f, ignoreCase: true))
            .ToList();

        var conversionEngine = Enum.Parse<ConversionEngine>(engine, ignoreCase: true);

        var request = new ConversionRequest(
            mdContent, templateContent, templateFile?.FileName,
            conversionEngine, llmModel ?? "claude-sonnet-4-6", formats);

        try
        {
            IConversionService service = conversionEngine == ConversionEngine.Llm
                ? llmService : directService;

            var output = await service.ConvertAsync(request, ct);

            var results = output.Files.Select(file =>
            {
                var token = Guid.NewGuid().ToString("N");
                cache.Set(token, file, TimeSpan.FromMinutes(10));
                return new ConversionResultItem(
                    file.Format.ToString().ToLower(), token, file.Filename);
            });

            return Ok(new ConversionResponse(true, results));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Conversion failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("download/{token}")]
    public IActionResult Download(string token)
    {
        if (!cache.TryGetValue<OutputFile>(token, out var file) || file is null)
            return NotFound("Download token expired or not found.");

        var contentType = file.Format == OutputFormat.Html ? "text/html" : "application/pdf";
        return File(file.Content, contentType, file.Filename);
    }
}
```

### 1.7 `Program.cs`

```csharp
using MarkFlow.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("Anthropic");
builder.Services.AddSingleton<DirectConversionService>();
builder.Services.AddSingleton<LlmConversionService>();

builder.Services.AddCors(opts => opts.AddPolicy("Frontend", p =>
    p.WithOrigins(builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
        ?? ["http://localhost:4200"])
     .AllowAnyHeader()
     .AllowAnyMethod()));

var app = builder.Build();
app.UseCors("Frontend");
app.MapControllers();
app.Run();
```

---

## Phase 2 — Frontend (Angular 17+)

### 2.1 Create the project

```bash
ng new artgen-ui --standalone --style=scss --routing=false
cd artgen-ui
npm install marked codemirror @codemirror/lang-markdown @codemirror/view @codemirror/state
```

### 2.2 `src/app/models/converter.models.ts`

```typescript
export type OutputFormat = 'html' | 'pdf';
export type ConversionEngine = 'direct' | 'llm';
export type ViewMode = 'editor' | 'preview' | 'split';

export interface ConverterState {
  markdownContent: string;
  markdownFileName: string;
  templateFile: File | null;
  engine: ConversionEngine;
  llmModel: string;
  outputFormats: OutputFormat[];
  viewMode: ViewMode;
  editMode: boolean;
  status: 'idle' | 'converting' | 'success' | 'error';
  errorMessage: string | null;
}

export interface ConversionResultItem {
  format: OutputFormat;
  downloadToken: string;
  filename: string;
}

export interface ConversionResponse {
  success: boolean;
  outputs: ConversionResultItem[];
}

export const LLM_MODELS = [
  { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'Claude Opus 4.6',   value: 'claude-opus-4-6' },
  { label: 'Claude Haiku 4.5',  value: 'claude-haiku-4-5-20251001' },
];
```

### 2.3 `src/app/services/converter-state.service.ts`

```typescript
import { Injectable, signal, computed } from '@angular/core';
import { ConverterState, OutputFormat, ConversionEngine, ViewMode } from '../models/converter.models';

@Injectable({ providedIn: 'root' })
export class ConverterStateService {
  private _state = signal<ConverterState>({
    markdownContent: '',
    markdownFileName: '',
    templateFile: null,
    engine: 'direct',
    llmModel: 'claude-sonnet-4-6',
    outputFormats: ['html', 'pdf'],
    viewMode: 'split',
    editMode: false,
    status: 'idle',
    errorMessage: null,
  });

  state = this._state.asReadonly();

  canConvert = computed(() => {
    const s = this._state();
    return s.markdownContent.length > 0 &&
           s.outputFormats.length > 0 &&
           s.status !== 'converting';
  });

  setMarkdown(content: string, filename: string) {
    this._state.update(s => ({ ...s, markdownContent: content, markdownFileName: filename }));
  }

  setTemplate(file: File | null) {
    this._state.update(s => ({ ...s, templateFile: file }));
  }

  setEngine(engine: ConversionEngine) {
    this._state.update(s => ({ ...s, engine }));
  }

  setLlmModel(llmModel: string) {
    this._state.update(s => ({ ...s, llmModel }));
  }

  toggleFormat(format: OutputFormat) {
    this._state.update(s => {
      const has = s.outputFormats.includes(format);
      const next = has
        ? s.outputFormats.filter(f => f !== format)
        : [...s.outputFormats, format];
      return { ...s, outputFormats: next };
    });
  }

  setViewMode(viewMode: ViewMode) {
    this._state.update(s => ({ ...s, viewMode }));
  }

  setEditMode(editMode: boolean) {
    this._state.update(s => ({ ...s, editMode }));
  }

  setStatus(status: ConverterState['status'], errorMessage: string | null = null) {
    this._state.update(s => ({ ...s, status, errorMessage }));
  }
}
```

### 2.4 `src/app/services/conversion-api.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { ConversionResponse } from '../models/converter.models';
import { ConverterStateService } from './converter-state.service';

@Injectable({ providedIn: 'root' })
export class ConversionApiService {
  private http = inject(HttpClient);
  private stateService = inject(ConverterStateService);

  async convert(): Promise<void> {
    const s = this.stateService.state();
    this.stateService.setStatus('converting');

    const form = new FormData();
    form.append('markdownFile', new Blob([s.markdownContent], { type: 'text/markdown' }), s.markdownFileName || 'document.md');

    if (s.templateFile) {
      form.append('templateFile', s.templateFile);
    }

    form.append('engine', s.engine);
    form.append('llmModel', s.llmModel);
    form.append('outputFormats', s.outputFormats.join(','));

    try {
      const result = await this.http
        .post<ConversionResponse>(`${environment.apiUrl}/api/convert`, form)
        .toPromise();

      if (result?.success) {
        result.outputs.forEach(o => this.triggerDownload(o.downloadToken, o.filename));
        this.stateService.setStatus('success');
      } else {
        throw new Error('Conversion returned unsuccessful');
      }
    } catch (err: any) {
      this.stateService.setStatus('error', err?.error?.error ?? err?.message ?? 'Conversion failed');
    }
  }

  private triggerDownload(token: string, filename: string): void {
    const a = document.createElement('a');
    a.href = `${environment.apiUrl}/api/convert/download/${token}`;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
```

### 2.5 `src/app/shell/converter-shell.component.ts`

```typescript
import { Component } from '@angular/core';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { EditorPanelComponent } from '../editor-panel/editor-panel.component';

@Component({
  selector: 'app-converter-shell',
  standalone: true,
  imports: [SidebarComponent, EditorPanelComponent],
  template: `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="logo-mark">M</span>
          <span class="app-name">MarkFlow</span>
        </div>
      </header>
      <div class="workspace">
        <app-sidebar />
        <app-editor-panel />
      </div>
    </div>
  `,
  styles: [`
    .shell { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    .topbar { height: 48px; border-bottom: 1px solid var(--border); display: flex;
               align-items: center; padding: 0 16px; flex-shrink: 0; }
    .brand { display: flex; align-items: center; gap: 8px; }
    .logo-mark { width: 24px; height: 24px; background: #e8673a; border-radius: 5px;
                  color: white; font-weight: 700; font-size: 13px; display: flex;
                  align-items: center; justify-content: center; }
    .app-name { font-weight: 600; font-size: 15px; }
    .workspace { display: flex; flex: 1; overflow: hidden; }
  `]
})
export class ConverterShellComponent {}
```

### 2.6 `src/app/sidebar/sidebar.component.ts`

```typescript
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConverterStateService } from '../services/converter-state.service';
import { ConversionApiService } from '../services/conversion-api.service';
import { LLM_MODELS, OutputFormat } from '../models/converter.models';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent {
  state = inject(ConverterStateService);
  api = inject(ConversionApiService);
  llmModels = LLM_MODELS;

  onMdFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.state.setMarkdown(reader.result as string, file.name);
    reader.readAsText(file);
  }

  onTemplateFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.state.setTemplate(file);
  }

  toggleFormat(format: OutputFormat): void {
    const s = this.state.state();
    if (s.outputFormats.includes(format) && s.outputFormats.length === 1) return;
    this.state.toggleFormat(format);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file?.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = () => this.state.setMarkdown(reader.result as string, file.name);
      reader.readAsText(file);
    }
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); }

  convert(): void { this.api.convert(); }
}
```

### 2.7 `src/app/editor-panel/editor-panel.component.ts`

```typescript
import { Component, inject, OnInit, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { marked } from 'marked';
import { ConverterStateService } from '../services/converter-state.service';
import { ViewMode } from '../models/converter.models';

@Component({
  selector: 'app-editor-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor-panel.component.html',
  styleUrls: ['./editor-panel.component.scss']
})
export class EditorPanelComponent implements OnInit {
  @ViewChild('editorHost') editorHost!: ElementRef<HTMLElement>;
  @ViewChild('previewHost') previewHost!: ElementRef<HTMLElement>;

  stateService = inject(ConverterStateService);
  private view?: EditorView;

  ngOnInit(): void {
    effect(() => {
      const content = this.stateService.state().markdownContent;
      if (this.view && this.view.state.doc.toString() !== content) {
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: content }
        });
      }
      if (this.previewHost?.nativeElement) {
        this.previewHost.nativeElement.innerHTML = marked.parse(content) as string;
      }
    });
  }

  ngAfterViewInit(): void {
    this.view = new EditorView({
      state: EditorState.create({
        doc: this.stateService.state().markdownContent,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const s = this.stateService.state();
              this.stateService.setMarkdown(update.state.doc.toString(), s.markdownFileName);
            }
          }),
          EditorView.editable.of(this.stateService.state().editMode)
        ]
      }),
      parent: this.editorHost.nativeElement
    });
  }

  setViewMode(mode: ViewMode): void { this.stateService.setViewMode(mode); }
  toggleEditMode(): void {
    const s = this.stateService.state();
    this.stateService.setEditMode(!s.editMode);
    if (this.view) {
      this.view.dispatch({
        effects: EditorView.editable.reconfigure(!s.editMode)
      });
    }
  }
}
```

### 2.8 `src/environments/environment.ts`

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000'
};
```

### 2.9 `src/app/app.config.ts`

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient()]
};
```

### 2.10 `src/app/app.component.ts`

```typescript
import { Component } from '@angular/core';
import { ConverterShellComponent } from './shell/converter-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ConverterShellComponent],
  template: `<app-converter-shell />`
})
export class AppComponent {}
```

---

## Phase 3 — SCSS Styles

### `src/styles.scss`

```scss
:root {
  --bg: #fdfcf9;
  --surface: #f4f1ec;
  --border: #e2ddd6;
  --text: #1a1a2e;
  --muted: #555570;
  --accent: #e8673a;
  --accent-blue: #2e6fd9;
  --radius: 8px;
  --sidebar-width: 220px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1a2e;
    --surface: #222238;
    --border: #333355;
    --text: #e8e8f0;
    --muted: #9090b0;
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }

.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 14px;
  gap: 12px;
  overflow-y: auto;

  .sec-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
    margin-bottom: 4px;
  }

  .upload-zone {
    border: 1.5px dashed var(--border);
    border-radius: var(--radius);
    padding: 14px;
    text-align: center;
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
    transition: border-color 0.15s;

    &:hover, &.dragover { border-color: var(--accent); }
  }

  .format-chips {
    display: flex;
    gap: 6px;

    .chip {
      flex: 1;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 7px 4px;
      text-align: center;
      font-size: 11px;
      cursor: pointer;
      color: var(--muted);
      background: var(--bg);
      transition: all 0.15s;

      &.active {
        border-color: var(--accent-blue);
        background: color-mix(in srgb, var(--accent-blue) 10%, transparent);
        color: var(--accent-blue);
        font-weight: 500;
      }
    }
  }

  .convert-btn {
    margin-top: auto;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius);
    padding: 10px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;

    &:disabled { opacity: 0.5; cursor: not-allowed; }
    &:not(:disabled):hover { background: color-mix(in srgb, var(--accent) 85%, black); }

    &.converting {
      animation: pulse 1.2s ease-in-out infinite;
    }
  }
}

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }

.editor-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .editor-topbar {
    height: 42px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 12px;
    flex-shrink: 0;
    background: var(--surface);
  }

  .tab-group {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;

    button {
      padding: 4px 12px;
      font-size: 12px;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;

      &.active {
        background: var(--bg);
        color: var(--text);
        font-weight: 500;
      }
    }
  }

  .editor-body {
    flex: 1;
    display: flex;
    overflow: hidden;

    .code-pane, .preview-pane {
      flex: 1;
      overflow-y: auto;
      height: 100%;
    }

    .preview-pane {
      padding: 20px 24px;
      border-left: 1px solid var(--border);
      font-size: 14px;
      line-height: 1.8;

      h1 { font-size: 22px; margin-bottom: 12px; }
      h2 { font-size: 17px; margin: 20px 0 8px; padding-left: 10px;
           border-left: 3px solid var(--accent); }
      pre { background: #1e1e2e; color: #cdd6f4; padding: 12px;
             border-radius: 8px; font-size: 12px; overflow-x: auto; }
      code { font-family: monospace; }
      blockquote { border-left: 3px solid var(--accent-blue); padding: 8px 12px;
                   background: color-mix(in srgb, var(--accent-blue) 8%, transparent);
                   border-radius: 0 6px 6px 0; font-style: italic; color: var(--muted); }
    }
  }
}
```

---

## Phase 4 — Running Locally

### Backend

```bash
cd artgen-api
# Set API key in appsettings.Development.json or via env:
export Anthropic__ApiKey=sk-ant-...
dotnet run
# API on http://localhost:5000
```

### Frontend

```bash
cd artgen-ui
npm install
ng serve
# App on http://localhost:4200
```

---

## Phase 5 — VS Code Claude Extension Usage Tips

When using the VS Code Claude extension to generate each file:

- **Generate one component at a time.** Paste the component spec from this doc and ask Claude to generate the full `.ts`, `.html`, and `.scss` for it.
- **Inject this doc as context.** Open `IMPLEMENTATION.md` in VS Code and use it as the context reference when prompting.
- **Use the Design doc for architecture decisions.** If Claude suggests a different pattern, refer back to `DESIGN.md` to steer it.
- **Service first, then components.** Generate `converter-state.service.ts` and `conversion-api.service.ts` before any component so the DI tokens are established.
- **Prompt pattern that works well:**
  ```
  Using the MarkFlow IMPLEMENTATION.md as reference, generate the complete
  SidebarComponent (sidebar.component.ts + .html + .scss) for Angular 17
  standalone. State is managed via ConverterStateService using signals.
  No NgRx. Use the models from converter.models.ts.
  ```

---

## Phase 6 — Extension Points (v2)

- Add DOCX output via `python-docx` subprocess or a .NET library
- Add a history panel (last 10 conversions, stored in localStorage)
- Add a diff view showing before/after when LLM reformats content
- Support multiple file upload for batch conversion
- Add authentication (ASP.NET Identity or Azure AD B2C)
- Docker Compose setup (API + Angular nginx container)
