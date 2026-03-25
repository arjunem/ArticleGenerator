import {
  Component, inject, AfterViewInit, OnDestroy,
  ElementRef, ViewChild, effect, signal
} from '@angular/core';
import { CommonModule, DecimalPipe, TitleCasePipe } from '@angular/common';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { ConverterStateService } from '../services/converter-state.service';
import { ViewMode } from '../models/converter.models';

// Configure marked with syntax highlighting once at module level
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  }
}));

@Component({
  selector: 'app-editor-panel',
  standalone: true,
  imports: [CommonModule, DecimalPipe, TitleCasePipe],
  templateUrl: './editor-panel.html',
  styleUrl: './editor-panel.scss'
})
export class EditorPanel implements AfterViewInit, OnDestroy {
  @ViewChild('editorHost') editorHost!: ElementRef<HTMLElement>;
  @ViewChild('previewHost') previewHost!: ElementRef<HTMLElement>;
  @ViewChild('editorBody') editorBody!: ElementRef<HTMLElement>;

  stateService = inject(ConverterStateService);
  private view?: EditorView;
  private editableCompartment = new Compartment();

  readonly splitRatio = signal(0.5);
  isDragging = false;

  // Scroll-sync state
  private isSyncing = false;
  private editorScrollListener?: () => void;
  private previewScrollListener?: () => void;

  constructor() {
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

    effect(() => {
      this.applyRatio(this.splitRatio());
    });
  }

  private applyRatio(ratio: number): void {
    this.editorBody?.nativeElement.style.setProperty('--split', String(ratio));
  }

  startDrag(event: MouseEvent | TouchEvent): void {
    event.preventDefault();
    this.isDragging = true;
    const isMobile = window.innerWidth <= 768;

    const onMove = (e: MouseEvent | TouchEvent) => {
      const rect = this.editorBody.nativeElement.getBoundingClientRect();
      const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
      const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
      const raw = isMobile
        ? (clientY - rect.top) / rect.height
        : (clientX - rect.left) / rect.width;
      const clamped = Math.min(0.8, Math.max(0.2, raw));
      this.splitRatio.set(clamped);
      this.applyRatio(clamped);
      this.view?.requestMeasure();
    };

    const onUp = () => {
      this.isDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove as EventListener);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove as EventListener, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
  }

  private readonly fullHeightTheme = EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { overflow: 'auto' },
  });

  ngAfterViewInit(): void {
    this.view = new EditorView({
      state: EditorState.create({
        doc: this.stateService.state().markdownContent,
        extensions: [
          basicSetup,
          markdown(),
          this.fullHeightTheme,
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const s = this.stateService.state();
              this.stateService.setMarkdown(update.state.doc.toString(), s.markdownFileName);
            }
          }),
          this.editableCompartment.of(EditorView.editable.of(this.stateService.state().editMode))
        ]
      }),
      parent: this.editorHost.nativeElement
    });

    this.setupScrollSync();
  }

  /** Sync editor scroll → preview, and preview scroll → editor. */
  private setupScrollSync(): void {
    const editorScroller = this.view!.scrollDOM;
    const preview = this.previewHost.nativeElement;

    // Editor scrolled → update preview
    this.editorScrollListener = () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      const ratio = editorScroller.scrollTop /
        (editorScroller.scrollHeight - editorScroller.clientHeight || 1);
      preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    // Preview scrolled → update editor
    this.previewScrollListener = () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      const ratio = preview.scrollTop /
        (preview.scrollHeight - preview.clientHeight || 1);
      editorScroller.scrollTop = ratio * (editorScroller.scrollHeight - editorScroller.clientHeight);
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

    editorScroller.addEventListener('scroll', this.editorScrollListener, { passive: true });
    preview.addEventListener('scroll', this.previewScrollListener, { passive: true });
  }

  ngOnDestroy(): void {
    if (this.view && this.editorScrollListener) {
      this.view.scrollDOM.removeEventListener('scroll', this.editorScrollListener);
    }
    if (this.previewScrollListener) {
      this.previewHost?.nativeElement.removeEventListener('scroll', this.previewScrollListener);
    }
  }

  setViewMode(mode: ViewMode): void { this.stateService.setViewMode(mode); }

  toggleEditMode(): void {
    const s = this.stateService.state();
    const next = !s.editMode;
    this.stateService.setEditMode(next);
    if (this.view) {
      this.view.dispatch({
        effects: this.editableCompartment.reconfigure(EditorView.editable.of(next))
      });
    }
  }
}
