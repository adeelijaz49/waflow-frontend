import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalFocus } from './modal-focus';

@Component({
  selector: 'app-modal-focus-host',
  imports: [ModalFocus],
  template: `
    <button type="button" id="opener" (click)="open.set(true)">open</button>
    @if (open()) {
      <div appModalFocus role="dialog" id="dlg">
        <input id="first" />
        <button type="button" id="last" (click)="open.set(false)">close</button>
      </div>
    }
  `,
})
class Host {
  readonly open = signal(false);
}

describe('ModalFocus', () => {
  let fixture: ComponentFixture<Host>;
  let root: HTMLElement;

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  };
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.detectChanges();
    q('#opener').focus();
    q('#opener').click();
    await settle();
  });

  afterEach(() => fixture.destroy());

  it('moves focus into the dialog when it opens', () => {
    expect(q('#dlg').contains(document.activeElement)).toBe(true);
  });

  it('does not steal focus from a field the dialog focused itself', async () => {
    q('#first').focus();
    await settle();
    expect(document.activeElement).toBe(q('#first'));
  });

  it('returns focus to the opener when the dialog is removed', async () => {
    q('#last').click();
    await settle();
    expect(q('#dlg')).toBeNull();
    expect(document.activeElement).toBe(q('#opener'));
  });

  it('keeps Tab inside the dialog', () => {
    // jsdom has no layout, so every control reports offsetParent null; only the focused one is counted.
    // The wrap logic itself is exercised through the single-control case: Tab never leaves the dialog.
    const last = q('#last');
    last.focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(q('#dlg').contains(document.activeElement)).toBe(true);
  });
});
