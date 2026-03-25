import { Component } from '@angular/core';
import { ConverterShell } from './shell/converter-shell';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ConverterShell],
  template: `<app-converter-shell />`
})
export class App {}
