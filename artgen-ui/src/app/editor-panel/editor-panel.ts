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
import { EditorTab, ViewMode } from '../models/converter.models';
import { ChatPanel } from '../chat-panel/chat-panel';

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
  imports: [CommonModule, DecimalPipe, TitleCasePipe, ChatPanel],
  templateUrl: './editor-panel.html',
  styleUrl: './editor-panel.scss'
})
export class EditorPanel implements AfterViewInit, OnDestroy {
  @ViewChild('editorHost')    editorHost!: ElementRef<HTMLElement>;
  @ViewChild('generatedHost') generatedHost!: ElementRef<HTMLElement>;
  @ViewChild('previewHost')   previewHost!: ElementRef<HTMLElement>;
  @ViewChild('editorBody')    editorBody!: ElementRef<HTMLElement>;

  stateService = inject(ConverterStateService);

  // Input editor (existing)
  private view?: EditorView;
  private editableCompartment = new Compartment();

  // Generated editor (LLM output)
  private generatedView?: EditorView;
  private generatedEditableCompartment = new Compartment();

  readonly splitRatio = signal(0.5);
  isDragging = false;
  chatVisible = signal(false);

  readonly ACCEPTED_FORMATS = ['md', 'txt', 'html', 'json', 'docx', 'pdf'];
  readonly selectedFormat = signal('md');

  // Scroll-sync state
  private isSyncing = false;
  private editorScrollListener?: () => void;
  private previewScrollListener?: () => void;

  private readonly fullHeightTheme = EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { overflow: 'auto' },
  });

  constructor() {
    // Keep input CodeMirror in sync with state
    effect(() => {
      const content = this.stateService.state().markdownContent;
      if (this.view && this.view.state.doc.toString() !== content) {
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: content }
        });
      }
    });

    // Keep generated CodeMirror in sync with state (streaming appends here)
    effect(() => {
      const content = this.stateService.state().generatedContent;
      if (this.generatedView && this.generatedView.state.doc.toString() !== content) {
        this.generatedView.dispatch({
          changes: { from: 0, to: this.generatedView.state.doc.length, insert: content }
        });
        // Scroll to bottom while streaming
        if (this.stateService.state().status === 'converting') {
          this.generatedView.dispatch({
            selection: { anchor: this.generatedView.state.doc.length }
          });
          this.generatedView.scrollDOM.scrollTop = this.generatedView.scrollDOM.scrollHeight;
        }
      }
    });

    // Generated editor is read-only while streaming, editable otherwise
    effect(() => {
      const s = this.stateService.state();
      const editable = !(s.engine === 'llm' && s.status === 'converting');
      if (this.generatedView) {
        this.generatedView.dispatch({
          effects: this.generatedEditableCompartment.reconfigure(EditorView.editable.of(editable))
        });
      }
    });

    // Preview shows content of the active tab
    effect(() => {
      const s = this.stateService.state();
      const content = (s.engine === 'llm' && s.activeEditorTab === 'generated')
        ? s.generatedContent
        : s.markdownContent;
      if (this.previewHost?.nativeElement) {
        this.previewHost.nativeElement.innerHTML = marked.parse(content) as string;
      }
    });

    // In LLM mode: auto-switch to Generated tab when input content is cleared,
    // and back to Input when a file is loaded.
    effect(() => {
      const s = this.stateService.state();
      if (s.engine !== 'llm') return;
      if (!s.markdownFileName && s.activeEditorTab === 'input') {
        this.stateService.setActiveEditorTab('generated');
      }
      if (s.markdownFileName && s.activeEditorTab === 'generated' && !s.generatedContent && s.status !== 'converting') {
        this.stateService.setActiveEditorTab('input');
      }
    });

    // Trigger CodeMirror remeasure when switching tabs (hidden → visible)
    effect(() => {
      const tab = this.stateService.state().activeEditorTab;
      setTimeout(() => {
        if (tab === 'input') this.view?.requestMeasure();
        else this.generatedView?.requestMeasure();
      }, 0);
    });

    effect(() => { this.applyRatio(this.splitRatio()); });

    // Auto-select format based on the active tab and opened file
    effect(() => {
      const s = this.stateService.state();
      if (s.engine === 'llm' && s.activeEditorTab === 'generated') {
        this.selectedFormat.set('md');
        return;
      }
      const ext = s.markdownFileName?.split('.').pop()?.toLowerCase() ?? '';
      this.selectedFormat.set(this.ACCEPTED_FORMATS.includes(ext) ? ext : 'md');
    });
  }

  private applyRatio(ratio: number): void {
    this.editorBody?.nativeElement.style.setProperty('--split', String(ratio));
  }

  ngAfterViewInit(): void {
    // Input editor
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
              // If user manually edits, the original file no longer matches —
              // clear it so convert() sends the edited markdown blob instead.
              if (update.transactions.some(tr => tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
                this.stateService.setInputFile(null);
              }
            }
          }),
          this.editableCompartment.of(EditorView.editable.of(this.stateService.state().editMode))
        ]
      }),
      parent: this.editorHost.nativeElement
    });

    // Generated editor
    this.generatedView = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          markdown(),
          this.fullHeightTheme,
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              this.stateService.setGeneratedContent(update.state.doc.toString());
            }
          }),
          this.generatedEditableCompartment.of(EditorView.editable.of(false))
        ]
      }),
      parent: this.generatedHost.nativeElement
    });

    this.setupScrollSync();
  }

  /** Sync editor scroll → preview, and preview scroll → editor. */
  private setupScrollSync(): void {
    const editorScroller = this.view!.scrollDOM;
    const preview = this.previewHost.nativeElement;

    this.editorScrollListener = () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      const ratio = editorScroller.scrollTop /
        (editorScroller.scrollHeight - editorScroller.clientHeight || 1);
      preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
      requestAnimationFrame(() => { this.isSyncing = false; });
    };

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
    this.generatedView?.destroy();
  }

  setViewMode(mode: ViewMode): void { this.stateService.setViewMode(mode); }

  toggleChat(): void { this.chatVisible.update(v => !v); }

  setActiveTab(tab: EditorTab): void { this.stateService.setActiveEditorTab(tab); }

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
}
