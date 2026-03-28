import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sidebar } from '../sidebar/sidebar';
import { EditorPanel } from '../editor-panel/editor-panel';
import { ConverterStateService } from '../services/converter-state.service';

@Component({
  selector: 'app-converter-shell',
  standalone: true,
  imports: [CommonModule, Sidebar, EditorPanel],
  template: `
    <div class="shell">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="sidebar-toggle"
            (click)="toggleSidebar()"
            [title]="sidebarVisible() ? 'Hide sidebar' : 'Show sidebar'">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
              <rect x="1" y="1" width="4" height="14" rx="1" opacity="0.45"/>
              <rect x="7" y="1" width="8" height="14" rx="1"/>
            </svg>
          </button>
          <div class="logo">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="white">
              <path d="M2 2h5v2H4v8h2v2H2V2zm7 0h5v12h-4v-2h2V4h-3V2z"/>
            </svg>
          </div>
          <span class="app-name">Article Generator</span>
        </div>
        <div class="topbar-right">
          <div class="api-status">
            <span class="status-dot"></span>
            <span>API running</span>
          </div>
          <button class="theme-toggle" (click)="toggleTheme()" [title]="isDark() ? 'Switch to light' : 'Switch to dark'">
            @if (isDark()) {
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 1a5 5 0 1 1 0-10A5 5 0 0 1 8 13zM8 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1a.5.5 0 0 1 .5.5zM2 8a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1A.5.5 0 0 1 2 8zm10.95-4.95a.5.5 0 0 1 0 .707l-.707.707a.5.5 0 0 1-.707-.707l.707-.707a.5.5 0 0 1 .707 0zm-9.9 9.9a.5.5 0 0 1 0 .707l-.707.707a.5.5 0 0 1-.707-.707l.707-.707a.5.5 0 0 1 .707 0zm9.9 0a.5.5 0 0 1-.707 0l-.707-.707a.5.5 0 0 1 .707-.707l.707.707a.5.5 0 0 1 0 .707zM3.05 3.05a.5.5 0 0 1-.707 0L1.636 2.343a.5.5 0 0 1 .707-.707l.707.707a.5.5 0 0 1 0 .707z"/>
              </svg>
            } @else {
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/>
              </svg>
            }
          </button>
        </div>
      </header>

      <div class="workspace" [class.resizing]="sidebarDragging">
        @if (sidebarVisible()) {
          <app-sidebar [style.flex]="'0 0 ' + sidebarWidth() + 'px'" />
          <div class="sidebar-resize"
               (mousedown)="startSidebarResize($event)">
            <div class="sidebar-grip"></div>
          </div>
        }
        <app-editor-panel />
      </div>
    </div>
  `,
  styles: [`
    .shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .topbar {
      height: 44px;
      border-bottom: 0.5px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      flex-shrink: 0;
      background: var(--surface);
    }

    .topbar-left { display: flex; align-items: center; gap: 8px; }

    .sidebar-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      border-radius: 5px;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }
    .sidebar-toggle:hover {
      background: var(--bg);
      color: var(--text);
    }

    .logo {
      width: 22px;
      height: 22px;
      background: #e8673a;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .app-name { font-size: 14px; font-weight: 500; }

    .badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 20px;
      font-weight: 500;
    }
    .badge-blue {
      background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
      color: var(--accent-blue);
    }
    .badge-green {
      background: color-mix(in srgb, #10b981 15%, transparent);
      color: #10b981;
    }

    .topbar-right { display: flex; align-items: center; gap: 8px; }
    .theme-toggle {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: none; background: transparent;
      color: var(--muted); cursor: pointer; border-radius: 5px;
      transition: background 0.15s, color 0.15s;
    }
    .theme-toggle:hover { background: var(--bg); color: var(--text); }

    .api-status {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--bg);
      border: 0.5px solid var(--border);
      border-radius: 20px;
      padding: 3px 10px;
      font-size: 11px;
      color: var(--muted);
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
    }

    .workspace {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .workspace.resizing {
      cursor: col-resize;
      user-select: none;
    }

    /* Sidebar resize handle */
    .sidebar-resize {
      width: 6px;
      flex-shrink: 0;
      background: transparent;
      cursor: col-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
    .sidebar-resize:hover .sidebar-grip,
    .workspace.resizing .sidebar-grip {
      opacity: 1;
      background: var(--accent);
    }
    .sidebar-grip {
      width: 3px;
      height: 36px;
      background: var(--border);
      border-radius: 2px;
      opacity: 0.4;
      transition: opacity 0.15s, background 0.15s;
    }

    @media (max-width: 768px) {
      .topbar { padding: 0 10px; }
      .badge { display: none; }
      .workspace { flex-direction: column; }
      .sidebar-resize { display: none; }
    }
  `]
})
export class ConverterShell {
  sidebarVisible = signal(true);
  sidebarWidth = signal(220);
  sidebarDragging = false;

  private readonly STORAGE_KEY = 'artgen-theme';
  isDark = signal(this.loadTheme());

  private stateService = inject(ConverterStateService);

  private loadTheme(): boolean {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  toggleTheme(): void {
    const next = !this.isDark();
    this.isDark.set(next);
    this.stateService.setIsDark(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem(this.STORAGE_KEY, next ? 'dark' : 'light');
  }

  constructor() {
    const dark = this.isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    this.stateService.setIsDark(dark);
  }

  toggleSidebar(): void {
    this.sidebarVisible.update(v => !v);
  }

  startSidebarResize(event: MouseEvent): void {
    event.preventDefault();
    this.sidebarDragging = true;
    const startX = event.clientX;
    const startWidth = this.sidebarWidth();

    const onMove = (e: MouseEvent) => {
      const next = Math.min(400, Math.max(160, startWidth + (e.clientX - startX)));
      this.sidebarWidth.set(next);
    };

    const onUp = () => {
      this.sidebarDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
}
