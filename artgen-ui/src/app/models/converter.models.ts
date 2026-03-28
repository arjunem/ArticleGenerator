export type OutputFormat = 'html' | 'pdf';
export type ConversionEngine = 'direct' | 'llm';
export type ViewMode = 'editor' | 'preview' | 'split';
export type EditorTab = 'input' | 'generated';

export interface ConverterState {
  markdownContent: string;
  markdownFileName: string;
  inputFile: File | null;       // original uploaded input file (null when content is typed)
  templateFile: File | null;
  engine: ConversionEngine;
  llmModel: string;
  outputFormats: OutputFormat[];
  viewMode: ViewMode;
  editMode: boolean;
  status: 'idle' | 'converting' | 'success' | 'error';
  errorMessage: string | null;
  // LLM generation state
  generatedContent: string;
  activeEditorTab: EditorTab;
  generationProgress: number;   // 0–100
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

export interface InputParseResponse {
  markdown: string;
  originalFilename: string;
}

export interface LlmModelInfo {
  value: string;   // exact model name passed to the provider (e.g. "llama3.2:latest")
  label: string;   // display name with :latest stripped (e.g. "llama3.2")
}

export interface LlmModelsResponse {
  models: LlmModelInfo[];
}

export interface LlmSseEvent {
  type: 'progress' | 'chunk' | 'done' | 'error';
  text?: string;
  value?: number;
  message?: string;
}

// ── Chat panel ──────────────────────────────────────────────────────────────

export type ChatScope = 'full' | 'selection';

export interface ChatMessage {
  role: 'ai' | 'user';
  text: string;
  streaming?: boolean;
}

// ── Ollama fallback list ─────────────────────────────────────────────────────

// Models available in Ollama (user must have pulled these locally)
export const OLLAMA_MODELS = [
  { label: 'Llama 3.2',  value: 'llama3.2' },
  { label: 'Mistral',    value: 'mistral' },
  { label: 'Phi 4',      value: 'phi4' },
  { label: 'Gemma 3',    value: 'gemma3' },
];
