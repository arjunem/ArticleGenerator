import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConversionResponse } from '../models/converter.models';
import { ConverterStateService } from './converter-state.service';

@Injectable({ providedIn: 'root' })
export class ConversionApiService {
  private http = inject(HttpClient);
  private stateService = inject(ConverterStateService);

  async convert(): Promise<void> {
    const s = this.stateService.state();
    this.stateService.setStatus('converting');

    const form = new FormData();
    form.append(
      'markdownFile',
      new Blob([s.markdownContent], { type: 'text/markdown' }),
      s.markdownFileName || 'document.md'
    );

    if (s.templateFile) {
      form.append('templateFile', s.templateFile);
    }

    form.append('outputFormats', s.outputFormats.join(','));

    try {
      const result = await firstValueFrom(
        this.http.post<ConversionResponse>(`${environment.apiUrl}/api/convert`, form)
      );

      if (result?.success) {
        result.outputs.forEach(o => this.triggerDownload(o.downloadToken, o.filename));
        this.stateService.setStatus('success');
      } else {
        throw new Error('Conversion returned unsuccessful');
      }
    } catch (err: any) {
      this.stateService.setStatus('error', err?.error?.error ?? err?.message ?? 'Conversion failed');
    }
  }

  private triggerDownload(token: string, filename: string): void {
    const a = document.createElement('a');
    a.href = `${environment.apiUrl}/api/convert/download/${token}`;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
