import { Component, inject } from '@angular/core';
import { EmbeddedText } from './embedded-text';
import { FlowLanguageStore, PreviewMode } from './flow-language.store';

// "Preview as: English / Arabic / Both" for the flow and promotion message views. One shared state
// (FlowLanguageStore.previewMode), so the panel, the viewer strips and the chips always agree.
@Component({
  selector: 'app-preview-lang-toggle',
  template: `
    @if (ready()) {
      <div class="plt" role="group" [attr.aria-label]="t('flowlang.mode.label')">
        @for (m of modes; track m) {
          <button type="button" class="plt-btn" [class.plt-on]="store.previewMode() === m" [attr.aria-pressed]="store.previewMode() === m" (click)="store.previewMode.set(m)">{{ t('flowlang.mode.' + m) }}</button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: inline-block; }
    .plt { display: inline-flex; border: 1px solid var(--border, #e2e8f0); border-radius: 8px; overflow: hidden; }
    .plt-btn { border: 0; background: var(--surface, #fff); padding-block: 4px; padding-inline: 10px; font: inherit; font-size: 12px; cursor: pointer; color: var(--text-muted, #64748b); }
    .plt-btn + .plt-btn { border-inline-start: 1px solid var(--border, #e2e8f0); }
    .plt-on { background: var(--primary, #3b82f6); color: #fff; }
    .plt-btn:focus-visible { outline: 2px solid var(--primary, #3b82f6); outline-offset: -2px; }
  `],
})
export class PreviewLangToggle extends EmbeddedText {
  readonly store = inject(FlowLanguageStore);
  readonly modes: PreviewMode[] = ['en', 'ar', 'both'];
}
