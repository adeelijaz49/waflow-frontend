import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../../i18n';
import { LocUiHost } from './loc-ui-host';
import { LocUiService } from './loc-ui.service';

describe('LocUiHost confirmation dialog', () => {
  let fixture: ComponentFixture<LocUiHost>;
  let ui: LocUiService;
  let trigger: HTMLButtonElement;

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  };
  const buttons = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('.lui-actions button'));
  const tab = (shiftKey = false): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    return e;
  };

  beforeEach(async () => {
    await TestBed.inject(I18nService).init();
    trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    fixture = TestBed.createComponent(LocUiHost);
    document.body.appendChild(fixture.nativeElement);
    ui = TestBed.inject(LocUiService);
  });

  afterEach(() => {
    fixture.destroy();
    trigger.remove();
  });

  const open = async (): Promise<{ result: Promise<boolean> }> => {
    const result = ui.confirm({ title: 'Send?', message: 'Sends now.', confirmLabel: 'Send', cancelLabel: 'Cancel' });
    await settle();
    return { result };
  };

  it('moves focus to the safe (cancel) button and describes the dialog by its message', async () => {
    await open();
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons()[0].textContent?.trim()).toBe('Cancel');
    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(fixture.nativeElement.querySelector(`#${dialog.getAttribute('aria-describedby')}`)?.textContent).toContain('Sends now.');
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    await open();
    const [cancel, confirm] = buttons();
    confirm.focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
    trigger.focus(); // focus that escaped behind the dialog is pulled back in
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it('returns focus to the control that opened it, and Escape cancels', async () => {
    const { result } = await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await result).toBe(false);
    await settle();
    expect(document.activeElement).toBe(trigger);
  });
});
