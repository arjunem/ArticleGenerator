import { Injectable, signal, computed } from '@angular/core';
import { ConverterState, EditorTab, OutputFormat, ViewMode } from '../models/converter.models';

@Injectable({ providedIn: 'root' })
export class ConverterStateService {
  private _state = signal<ConverterState>({
    markdownContent: '',
    markdownFileName: '',
    inputFile: null,
    templateFile: null,
    engine: 'llm',
    llmModel: 'llama3.2',
    outputFormats: ['html', 'pdf'],
    viewMode: 'split',
    editMode: true,
    status: 'idle',
    errorMessage: null,
    generatedContent: '',
    activeEditorTab: 'input',
    generationProgress: 0,
  });

  state = this._state.asReadonly();

  canConvert = computed(() => {
    const s = this._state();
    const notBusy = s.status !== 'converting';
    if (s.engine === 'llm') {
      // Generate requires an uploaded input file (markdownFileName set)
      return !!s.markdownFileName && notBusy;
    }
    // Direct: needs content in the editor and at least one output format
    return s.markdownContent.length > 0 && notBusy && s.outputFormats.length > 0;
  });

  setMarkdown(content: string, filename: string) {
    this._state.update(s => ({ ...s, markdownContent: content, markdownFileName: filename }));
  }

  setInputFile(file: File | null) {
    this._state.update(s => ({ ...s, inputFile: file }));
  }

  setTemplate(file: File | null) {
    this._state.update(s => ({ ...s, templateFile: file }));
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

  setEngine(engine: ConverterState['engine']) {
    this._state.update(s => ({ ...s, engine }));
  }

  setLlmModel(llmModel: string) {
    this._state.update(s => ({ ...s, llmModel }));
  }

  // ── LLM generation ──────────────────────────────────────────────────────────

  setGeneratedContent(content: string) {
    this._state.update(s => ({ ...s, generatedContent: content }));
  }

  appendGeneratedChunk(chunk: string) {
    this._state.update(s => ({ ...s, generatedContent: s.generatedContent + chunk }));
  }

  setActiveEditorTab(activeEditorTab: EditorTab) {
    this._state.update(s => ({ ...s, activeEditorTab }));
  }

  setGenerationProgress(generationProgress: number) {
    this._state.update(s => ({ ...s, generationProgress }));
  }
}
