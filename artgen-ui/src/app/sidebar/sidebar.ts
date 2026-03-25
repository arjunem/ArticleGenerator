import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConverterStateService } from '../services/converter-state.service';
import { ConversionApiService } from '../services/conversion-api.service';
import { OutputFormat, LLM_MODELS } from '../models/converter.models';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss'
})
export class Sidebar {
  state = inject(ConverterStateService);
  api = inject(ConversionApiService);
  readonly llmModels = LLM_MODELS;

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

  removeTemplate(): void {
    this.state.setTemplate(null);
  }

  removeMd(): void {
    this.state.setMarkdown('', '');
  }

  toggleFormat(format: OutputFormat): void {
    const s = this.state.state();
    if (s.outputFormats.includes(format) && s.outputFormats.length === 1) return;
    this.state.toggleFormat(format);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file?.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = () => this.state.setMarkdown(reader.result as string, file.name);
      reader.readAsText(file);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.add('dragover');
  }

  onDragLeave(event: DragEvent): void {
    (event.currentTarget as HTMLElement).classList.remove('dragover');
  }

  toggleEngine(): void {
    const current = this.state.state().engine;
    this.state.setEngine(current === 'llm' ? 'direct' : 'llm');
  }

  onModelChange(event: Event): void {
    this.state.setLlmModel((event.target as HTMLSelectElement).value);
  }

  convert(): void { this.api.convert(); }
}
