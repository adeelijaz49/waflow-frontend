import { Component, computed, input, output } from '@angular/core';
import { I18N_PIPES } from '../../../i18n';
import { collapseCaption, lineSegments } from './caption-tokens';

// Instagram-post-like card. Caption paragraphs use dir="auto" (like Instagram);
// hashtags, mentions and links are LTR isolates so they never reorder inside
// Arabic text. Built from tokens, never innerHTML.
@Component({
  selector: 'app-caption-preview',
  imports: [...I18N_PIPES],
  templateUrl: './caption-preview.html',
  styleUrl: './caption-preview.css',
})
export class CaptionPreview {
  readonly text = input.required<string>();
  readonly viewerDir = input<'ltr' | 'rtl'>('ltr');
  readonly expanded = input<boolean>(false);
  readonly toggled = output<void>();

  readonly fold = computed(() => collapseCaption(this.text()));
  readonly canFold = computed(() => this.fold().truncated);
  readonly lines = computed(() => lineSegments(this.canFold() && !this.expanded() ? this.fold().text : this.text()));
}
