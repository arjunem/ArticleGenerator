import { Injectable, signal, computed } from '@angular/core';
import { ConverterState, OutputFormat, ViewMode } from '../models/converter.models';

@Injectable({ providedIn: 'root' })
export class ConverterStateService {
  private _state = signal<ConverterState>({
    markdownContent: '',
    markdownFileName: '',
    templateFile: null,
    engine: 'llm',
    llmModel: 'claude-sonnet-4-6',
    outputFormats: ['html', 'pdf'],
    viewMode: 'split',
    editMode: true,
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
}
