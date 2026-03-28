import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConverterStateService } from '../services/converter-state.service';
import { ConversionApiService } from '../services/conversion-api.service';
import { LlmModelInfo, OutputFormat } from '../models/converter.models';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss'
})
export class Sidebar implements OnInit, OnDestroy {
  state = inject(ConverterStateService);
  api = inject(ConversionApiService);

  ollamaModels = signal<LlmModelInfo[]>([]);
  modelsLoading = signal(false);
  modelsError = signal(false);

  canDownloadGenerated = computed(() => {
    const s = this.state.state();
    return s.generatedContent.length > 0
      && s.outputFormats.length > 0
      && s.status !== 'converting';
  });

  private abortController?: AbortController;

  ngOnInit(): void {
    if (this.state.state().engine === 'llm') {
      this.loadModels();
    }
  }

  // ── File handling ────────────────────────────────────────────────────────────

  onMdFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.loadInputFile(file);
  }

  onTemplateFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.state.setTemplate(file);
  }

  removeTemplate(): void { this.state.setTemplate(null); }

  removeMd(): void {
    this.state.setMarkdown('', '');
    this.state.setInputFile(null);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) this.loadInputFile(file);
  }

  private readonly textExtensions = new Set(['.md', '.txt', '.html', '.htm', '.json']);

  private loadInputFile(file: File): void {
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');

    if (this.textExtensions.has(ext)) {
      const reader = new FileReader();
      reader.onload = () => {
        this.state.setMarkdown(reader.result as string, file.name);
        this.state.setInputFile(file);
      };
      reader.readAsText(file);
    } else {
      // Binary format (docx, pdf) — store file for conversion, no preview content
      this.state.setMarkdown('', file.name);
      this.state.setInputFile(file);
    }
  }

  /** Extension label shown in the file pill (e.g. "DOCX", "PDF") */
  fileTypeLabel(filename: string): string {
    return (filename.split('.').pop() ?? 'file').toUpperCase();
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.add('dragover');
  }

  onDragLeave(event: DragEvent): void {
    (event.currentTarget as HTMLElement).classList.remove('dragover');
  }

  // ── Engine / format controls ─────────────────────────────────────────────────

  toggleFormat(format: OutputFormat): void {
    const s = this.state.state();
    if (s.outputFormats.includes(format) && s.outputFormats.length === 1) return;
    this.state.toggleFormat(format);
  }

  toggleEngine(): void {
    const current = this.state.state().engine;
    const next = current === 'llm' ? 'direct' : 'llm';
    this.state.setEngine(next);
    if (next === 'llm') this.loadModels();
  }

  async loadModels(): Promise<void> {
    this.modelsLoading.set(true);
    this.modelsError.set(false);
    const models = await this.api.getOllamaModels();
    this.modelsLoading.set(false);
    if (models.length === 0) {
      this.modelsError.set(true);
      return;
    }
    this.ollamaModels.set(models);
    // Auto-select first model if current selection is not in the returned list
    const current = this.state.state().llmModel;
    if (!models.some(m => m.value === current)) {
      this.state.setLlmModel(models[0].value);
    }
  }

  onModelChange(event: Event): void {
    this.state.setLlmModel((event.target as HTMLSelectElement).value);
  }

  // ── Conversion / generation ──────────────────────────────────────────────────

  convert(): void {
    if (this.state.state().engine === 'llm') {
      this.generate();
    } else {
      this.api.convert();
    }
  }

  private generate(): void {
    const s = this.state.state();
    this.abortController = new AbortController();

    // Reset generated tab and switch to it
    this.state.setGeneratedContent('');
    this.state.setActiveEditorTab('generated');
    this.state.setGenerationProgress(5);
    this.state.setStatus('converting');

    // Read template file content if present
    const readTemplate = (): Promise<string | null> => {
      if (!s.templateFile) return Promise.resolve(null);
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsText(s.templateFile!);
      });
    };

    readTemplate().then(templateContent => {
      let chunkCount = 0;

      this.api.generateWithLlm(
        s.markdownContent,
        templateContent,
        s.templateFile?.name ?? null,
        s.llmModel,
        'ollama',
        // onChunk
        (text) => {
          this.state.appendGeneratedChunk(text);
          chunkCount++;
          // Advance progress from 25 → 90 smoothly
          const current = this.state.state().generationProgress;
          if (current < 90) {
            const step = Math.max(0.5, (90 - current) / 20);
            this.state.setGenerationProgress(Math.min(90, current + step));
          }
        },
        // onProgress
        (value) => this.state.setGenerationProgress(value),
        // onDone
        () => {
          this.state.setGenerationProgress(100);
          this.state.setStatus('success');
          setTimeout(() => this.state.setGenerationProgress(0), 600);
        },
        // onError
        (message) => {
          this.state.setStatus('error', message);
          this.state.setGenerationProgress(0);
        },
        this.abortController!.signal
      );
    });
  }

  downloadGenerated(): void { this.api.convertGenerated(); }

  cancelGeneration(): void {
    this.abortController?.abort();
    this.state.setStatus('idle');
    this.state.setGenerationProgress(0);
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
  }
}
