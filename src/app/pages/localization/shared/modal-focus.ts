import { Directive, ElementRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keyboard behaviour every dialog needs: focus moves into it when it opens (unless the
// dialog already focused a field itself), Tab/Shift+Tab cycle inside it, and focus goes
// back to the control that opened it when it closes. Put it on the element with role="dialog".
@Directive({ selector: '[appModalFocus]' })
export class ModalFocus implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    this.timer = setTimeout(() => {
      const host = this.el.nativeElement;
      if (host.contains(document.activeElement)) return;
      if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
      host.focus();
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    const back = this.returnTo;
    if (back && back.isConnected && back !== document.body) back.focus();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const host = this.el.nativeElement;
    const items = Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => e.offsetParent !== null || e === document.activeElement);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === host)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
