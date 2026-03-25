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
