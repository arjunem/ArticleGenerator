import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConversionResponse, InputParseResponse, LlmModelInfo, LlmModelsResponse, LlmSseEvent } from '../models/converter.models';
import { ConverterStateService } from './converter-state.service';

@Injectable({ providedIn: 'root' })
export class ConversionApiService {
  private http = inject(HttpClient);
  private stateService = inject(ConverterStateService);

  // ── Direct conversion (HTML / PDF download) ─────────────────────────────────

  async convert(): Promise<void> {
    const s = this.stateService.state();
    this.stateService.setStatus('converting');

    const form = new FormData();
    // Send the original file if available (backend parses natively),
    // otherwise send current editor content as a .md blob.
    if (s.inputFile) {
      form.append('inputFile', s.inputFile);
    } else {
      form.append(
        'inputFile',
        new Blob([s.markdownContent], { type: 'text/markdown' }),
        s.markdownFileName ? s.markdownFileName.replace(/\.[^.]+$/, '.md') : 'document.md'
      );
    }
    if (s.templateFile) form.append('templateFile', s.templateFile);
    form.append('outputFormats', s.outputFormats.join(','));

    try {
      const result = await firstValueFrom(
        this.http.post<ConversionResponse>(`${environment.apiUrl}/api/convert`, form)
      );

      if (result?.success) {
        const mdBase = s.markdownFileName.replace(/\.md$/i, '') || 'document';
        result.outputs.forEach((o, i) =>
          setTimeout(() => this.triggerDownload(o.downloadToken, o.filename, mdBase), i * 500)
        );
        this.stateService.setStatus('success');
      } else {
        throw new Error('Conversion returned unsuccessful');
      }
    } catch (err: any) {
      this.stateService.setStatus('error', err?.error?.error ?? err?.message ?? 'Conversion failed');
    }
  }

  // ── Input file parsing ───────────────────────────────────────────────────────

  async parseInputFile(file: File): Promise<InputParseResponse | null> {
    const form = new FormData();
    form.append('file', file);
    try {
      return await firstValueFrom(
        this.http.post<InputParseResponse>(`${environment.apiUrl}/api/input/parse`, form)
      );
    } catch (err: any) {
      console.error('[parseInputFile]', err?.status, err?.error);
      return null;
    }
  }

  // ── Convert generated content → HTML / PDF download ─────────────────────────

  async convertGenerated(): Promise<void> {
    const s = this.stateService.state();
    this.stateService.setStatus('converting');

    const baseName = (s.markdownFileName.replace(/\.md$/i, '') || 'document') + '_generated';

    const form = new FormData();
    form.append(
      'inputFile',
      new Blob([s.generatedContent], { type: 'text/markdown' }),
      `${baseName}.md`
    );
    if (s.templateFile) form.append('templateFile', s.templateFile);
    form.append('outputFormats', s.outputFormats.join(','));

    try {
      const result = await firstValueFrom(
        this.http.post<ConversionResponse>(`${environment.apiUrl}/api/convert`, form)
      );

      if (result?.success) {
        result.outputs.forEach((o, i) =>
          setTimeout(() => this.triggerDownload(o.downloadToken, o.filename, baseName), i * 500)
        );
        this.stateService.setStatus('success');
      } else {
        throw new Error('Conversion returned unsuccessful');
      }
    } catch (err: any) {
      this.stateService.setStatus('error', err?.error?.error ?? err?.message ?? 'Conversion failed');
    }
  }

  // ── LLM model discovery ─────────────────────────────────────────────────────

  async getOllamaModels(): Promise<LlmModelInfo[]> {
    try {
      const result = await firstValueFrom(
        this.http.get<LlmModelsResponse>(`${environment.apiUrl}/api/llm/models`)
      );
      return result?.models ?? [];
    } catch (err: any) {
      console.error('[getOllamaModels]', err?.status, err?.message, err?.error);
      return [];
    }
  }

  // ── LLM generation (SSE streaming) ──────────────────────────────────────────

  /**
   * Streams LLM-generated content from the backend SSE endpoint.
   * Uses the native fetch API (not Angular HttpClient) to access ReadableStream.
   * The caller manages AbortController for cancellation.
   */
  async generateWithLlm(
    markdownContent: string,
    templateContent: string | null,
    templateFilename: string | null,
    model: string,
    provider: string,
    onChunk: (text: string) => void,
    onProgress: (value: number) => void,
    onDone: () => void,
    onError: (message: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const form = new FormData();
    form.append('markdownContent', markdownContent);
    if (templateContent) form.append('templateContent', templateContent);
    if (templateFilename) form.append('templateFilename', templateFilename);
    form.append('model', model);
    form.append('provider', provider);

    let response: Response;
    try {
      response = await fetch(`${environment.apiUrl}/api/llm/generate`, {
        method: 'POST',
        body: form,
        signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;   // user cancelled before connect
      onError(err?.message ?? 'Failed to connect to generation service');
      return;
    }

    if (!response.ok) {
      onError(`Server error ${response.status}: ${response.statusText}`);
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE lines end with \n\n — process all complete events in the buffer
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';   // last part may be incomplete

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          const json = line.slice('data: '.length);
          let evt: LlmSseEvent;
          try { evt = JSON.parse(json); } catch { continue; }

          switch (evt.type) {
            case 'chunk':    if (evt.text) onChunk(evt.text); break;
            case 'progress': if (evt.value != null) onProgress(evt.value); break;
            case 'done':     onDone(); return;
            case 'error':    onError(evt.message ?? 'Generation failed'); return;
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;   // user cancelled mid-stream
      onError(err?.message ?? 'Stream interrupted');
    } finally {
      reader.releaseLock();
    }
  }

  // ── LLM chat (SSE streaming) ─────────────────────────────────────────────────

  async chatWithLlm(
    userMessage: string,
    context: string,
    model: string,
    provider: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (message: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${environment.apiUrl}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage, context, model, provider }),
        signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      onError(err?.message ?? 'Failed to connect to chat service');
      return;
    }

    if (!response.ok) {
      onError(`Server error ${response.status}: ${response.statusText}`);
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          const json = line.slice('data: '.length);
          let evt: LlmSseEvent;
          try { evt = JSON.parse(json); } catch { continue; }

          switch (evt.type) {
            case 'chunk': if (evt.text) onChunk(evt.text); break;
            case 'done':  onDone(); return;
            case 'error': onError(evt.message ?? 'Chat failed'); return;
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      onError(err?.message ?? 'Stream interrupted');
    } finally {
      reader.releaseLock();
    }
  }

  // ── Download helper ──────────────────────────────────────────────────────────

  private async triggerDownload(token: string, filename: string, mdBase: string): Promise<void> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = filename.slice(filename.lastIndexOf('.'));
    const stamped = `${mdBase}_${ts}${ext}`;
    const blob = await fetch(`${environment.apiUrl}/api/convert/download/${token}`).then(r => r.blob());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = stamped;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
