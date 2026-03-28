import {
  Component, inject, signal, computed, ViewChild, ElementRef,
  AfterViewInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConverterStateService } from '../services/converter-state.service';
import { ConversionApiService } from '../services/conversion-api.service';
import { ChatMessage, ChatScope } from '../models/converter.models';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.scss'
})
export class ChatPanel implements AfterViewInit, OnDestroy {
  @ViewChild('messagesEl') messagesEl!: ElementRef<HTMLElement>;
  @ViewChild('textareaEl') textareaEl!: ElementRef<HTMLTextAreaElement>;

  stateService = inject(ConverterStateService);
  private api = inject(ConversionApiService);

  messages = signal<ChatMessage[]>([]);

  inputText = '';
  scope = signal<ChatScope>('full');
  streaming = signal(false);
  panelHeight = signal(220);
  isDragging = false;
  copiedIndex = signal<number | null>(null);

  private abortController?: AbortController;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  readonly suggestions = [
    'Make tone more conversational',
    'Add a code example',
    'Shorten the intro',
    'Add TL;DR callout'
  ];

  readonly hasContext = computed(() => {
    const s = this.stateService.state();
    return !!(s.generatedContent || s.markdownContent);
  });

  readonly contextLabel = computed(() => {
    const s = this.stateService.state();
    return (s.engine === 'llm' && s.generatedContent) ? 'generated doc' : 'input doc';
  });

  readonly lineCount = computed(() =>
    this.getContext().split('\n').filter(l => l.trim().length > 0).length
  );

  ngAfterViewInit(): void {}

  sendMessage(): void {
    const text = this.inputText.trim();
    if (!text || this.streaming()) return;

    this.messages.update(msgs => [...msgs, { role: 'user', text }]);
    this.inputText = '';
    this.resetTextareaHeight();

    const context = this.getContext();
    const s = this.stateService.state();

    this.messages.update(msgs => [...msgs, { role: 'ai', text: '', streaming: true }]);
    this.streaming.set(true);
    this.scrollToBottom();

    this.abortController = new AbortController();

    this.api.chatWithLlm(
      text,
      context,
      s.llmModel,
      'ollama',
      (chunk) => {
        this.messages.update(msgs => {
          const copy = [...msgs];
          const last = copy[copy.length - 1];
          if (last?.streaming) copy[copy.length - 1] = { ...last, text: last.text + chunk };
          return copy;
        });
        this.scrollToBottom();
      },
      () => {
        this.messages.update(msgs => {
          const copy = [...msgs];
          const last = copy[copy.length - 1];
          if (last?.streaming) copy[copy.length - 1] = { ...last, streaming: false };
          return copy;
        });
        this.streaming.set(false);
      },
      (msg) => {
        this.messages.update(msgs => {
          const copy = [...msgs];
          const last = copy[copy.length - 1];
          if (last?.streaming) copy[copy.length - 1] = { role: 'ai', text: `Error: ${msg}`, streaming: false };
          return copy;
        });
        this.streaming.set(false);
      },
      this.abortController.signal
    );
  }

  useSuggestion(sug: string): void {
    this.inputText = sug;
    setTimeout(() => this.textareaEl?.nativeElement.focus(), 0);
  }

  clearMessages(): void {
    this.abortController?.abort();
    this.streaming.set(false);
    this.messages.set(this.hasContext() ? [{
      role: 'ai',
      text: 'Hi! I have the document in context. Ask me to rewrite sections, adjust tone, add examples, or restructure anything.'
    }] : []);
  }

  cancelStreaming(): void {
    this.abortController?.abort();
    this.streaming.set(false);
    this.messages.update(msgs => {
      const copy = [...msgs];
      const last = copy[copy.length - 1];
      if (last?.streaming) copy[copy.length - 1] = { ...last, streaming: false };
      return copy;
    });
  }

  copyMessage(text: string, index: number): void {
    navigator.clipboard.writeText(text).then(() => {
      this.copiedIndex.set(index);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedIndex.set(null), 1500);
    });
  }

  setScope(s: ChatScope): void { this.scope.set(s); }

  onTextareaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  onTextareaInput(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  }

  startDrag(event: MouseEvent): void {
    event.preventDefault();
    this.isDragging = true;
    const startY = event.clientY;
    const startH = this.panelHeight();

    const onMove = (e: MouseEvent) => {
      const next = Math.min(500, Math.max(120, startH + (startY - e.clientY)));
      this.panelHeight.set(next);
    };

    const onUp = () => {
      this.isDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private getContext(): string {
    const s = this.stateService.state();
    return (s.engine === 'llm' && s.generatedContent)
      ? s.generatedContent
      : s.markdownContent;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.messagesEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  private resetTextareaHeight(): void {
    const el = this.textareaEl?.nativeElement;
    if (el) { el.style.height = 'auto'; }
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
    clearTimeout(this.copiedTimer);
  }
}
