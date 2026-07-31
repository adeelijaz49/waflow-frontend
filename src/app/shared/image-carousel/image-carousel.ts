import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

// One-image-at-a-time gallery with left/right navigation — the standard
// e-commerce product-gallery pattern, used for browsing (Products table row /
// Services card). Editing which images are attached is a separate concern,
// handled by a plain thumbnail-grid in the add/edit modals, not this component.
@Component({
  selector: 'app-image-carousel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image-carousel.html',
  styleUrl: './image-carousel.css',
})
export class ImageCarousel implements OnChanges {
  @Input() images: string[] = [];
  @Input() size = 52; // px, square

  index = 0;
  brokenImages = new Set<string>();

  ngOnChanges(changes: SimpleChanges) {
    if (changes['images']) this.index = 0;
  }

  get validImages(): string[] {
    return (this.images || []).filter(u => !!u && !this.brokenImages.has(u));
  }

  get current(): string | undefined {
    return this.validImages[this.index];
  }

  onError(url: string) {
    this.brokenImages.add(url);
    if (this.index >= this.validImages.length) this.index = Math.max(0, this.validImages.length - 1);
  }

  prev(event: Event) {
    event.stopPropagation();
    const n = this.validImages.length;
    this.index = (this.index - 1 + n) % n;
  }

  next(event: Event) {
    event.stopPropagation();
    const n = this.validImages.length;
    this.index = (this.index + 1) % n;
  }

  goTo(event: Event, i: number) {
    event.stopPropagation();
    this.index = i;
  }
}
