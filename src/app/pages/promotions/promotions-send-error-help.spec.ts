import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from '../../shared/dialog.service';
import { Promotions } from './promotions';

// The red "failed to send" box keeps Meta's raw words (support staff need them) and adds, once per kind, what to do about them.
vi.setConfig({ testTimeout: 30000 });

const PROMO = { _id: 'p1', name: 'Eid sale', status: 'active', sentCount: 0, customerType: 'cash', entryNodeId: null };
const SETTINGS = { arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HELP_133010 = "WhatsApp refused this because the sending WhatsApp number is not registered with the WhatsApp Business Platform (error 133010). Nothing is wrong with your customer or your message. Ask the WaFlow team to check the number's status in Meta.";
const HELP_131030 = "WhatsApp only lets the test number message people on its allowed-recipient list, and the recipient's phone number is not on it yet. Add it in Meta (WhatsApp > API Setup), or ask the WaFlow team to.";

const pathOf = (req: TestRequest) => req.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '').replace(/^\/\//, '/').replace(/^.*?(\/api\/)/, '$1');
const isSend = (req: TestRequest) => req.request.method === 'POST' && /\/promotions\/p1\/send$/.test(req.request.url);

// The delivery check after a send is scheduled with real timers (3 s, 7 s, 15 s): swallow those so nothing fires after the test.
const realSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === 3000 || ms === 7000 || ms === 15000) return 0 as unknown as ReturnType<typeof setTimeout>;
    return realSetTimeout(fn, ms, ...rest);
  }) as typeof setTimeout);
});
afterEach(() => { vi.restoreAllMocks(); });

async function sendWith(sendAnswer: object) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Promotions);
  const comp = fixture.componentInstance;
  fixture.detectChanges();
  const settle = async (answerSend = false) => {
    for (let i = 0; i < 4; i++) {
      for (const req of http.match(() => true)) {
        const path = pathOf(req);
        if (answerSend && isSend(req)) req.flush(sendAnswer);
        else if (/localization\/settings/.test(path)) req.flush(SETTINGS);
        else if (/\/products\?/.test(path)) req.flush({ products: [], total: 0 });
        else req.flush([]);
      }
      fixture.componentRef.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      await fixture.whenStable();
      await sleep(0);
    }
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };
  await settle();
  vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
  comp.openCampaign(PROMO);
  comp.selectedCustomerIds.add('c1');
  comp.selectedCustomerIds.add('c2');
  await settle();
  await comp.sendCampaign();
  await settle(true);
  const el = fixture.nativeElement as HTMLElement;
  return { el, text: el.textContent || '', box: el.querySelector('.result-error') };
}

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('Promotions screen: help under the failed-to-send list', () => {
  it('shows both raw 133010 lines and the 133010 sentence exactly once', async () => {
    const { text, box } = await sendWith({ success: true, sentCount: 0, errors: [{ customer: 'c1', error: '(#133010) Account not registered' }, { customer: 'c2', error: '(#133010) Account not registered' }] });
    expect(countOf(text, '(#133010) Account not registered')).toBe(2);
    expect(countOf(text, HELP_133010)).toBe(1);
    expect(box?.textContent).toContain(`💡 ${HELP_133010}`); // inside the same red box, with the hint's light bulb
    expect(box?.querySelectorAll('li')).toHaveLength(2); // the raw list is untouched
  });

  it('shows the 131030 sentence', async () => {
    const { text } = await sendWith({ success: true, sentCount: 0, errors: [{ customer: 'c1', error: '(#131030) Recipient phone number not in allowed list' }] });
    expect(text).toContain('(#131030) Recipient phone number not in allowed list');
    expect(countOf(text, HELP_131030)).toBe(1);
    expect(text).not.toContain(HELP_133010);
  });

  it('shows two different sentences when the errors differ', async () => {
    const { text } = await sendWith({ success: true, sentCount: 0, errors: [{ customer: 'c1', error: '(#131030) x' }, { customer: 'c2', error: '(#133010) y' }] });
    expect(countOf(text, HELP_131030)).toBe(1);
    expect(countOf(text, HELP_133010)).toBe(1);
    expect(text.indexOf(HELP_131030)).toBeLessThan(text.indexOf(HELP_133010));
  });

  it('shows only the raw line for an error it has no help for', async () => {
    const { text, box } = await sendWith({ success: true, sentCount: 0, errors: [{ customer: 'c1', error: 'Something odd happened' }] });
    expect(box?.textContent).toContain('Something odd happened');
    expect(text).not.toContain('💡 WhatsApp');
    expect(box?.querySelectorAll('div')).toHaveLength(0);
  });

  it('shows no help for a send that went fine', async () => {
    const { text, box } = await sendWith({ success: true, sentCount: 2, errors: [] });
    expect(box).toBeNull();
    expect(text).not.toContain(HELP_133010);
    expect(text).not.toContain(HELP_131030);
  });
});
