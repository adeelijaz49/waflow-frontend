import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Demo } from './demo';

// Step 0 of the demo offers to create WaFlow's default templates. Those are created in the WhatsApp account the server lets this
// person manage (canManageWhatsApp on /auth/me - the rule the server enforces on the create calls); for anyone else the template list
// holds only their own templates, so "default templates missing" would be wrong and every click on the button would be refused (403).
vi.setConfig({ testTimeout: 30000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = {
  user: { id: 'u1', name: 'A', phone: '', email: 'a@example.com' },
  workspace: { id: 'w1', name: 'Home', onboarding: { completed: true, currentStep: 5 } },
  role: 'owner',
};

async function boot(session: Record<string, unknown>) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const posts: string[] = [];
  const answer = () => {
    for (const req of http.match(() => true)) {
      const url = req.request.urlWithParams;
      if (req.request.method === 'POST') posts.push(url);
      if (/auth\/me/.test(url)) req.flush(session);
      else if (/whatsapp\/templates/.test(url)) req.flush({ templates: [{ name: 'my_own_template', status: 'APPROVED', category: 'MARKETING', language: 'en' }] });
      else if (/customers/.test(url)) req.flush({ customers: [] });
      else if (/products/.test(url)) req.flush({ products: [] });
      else req.flush([]);
    }
  };
  const fixture: ComponentFixture<Demo> = TestBed.createComponent(Demo);
  fixture.detectChanges();
  for (let i = 0; i < 4; i++) {
    answer();
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
  }
  return { el: fixture.nativeElement as HTMLElement, posts, fixture };
}

const hint = (el: HTMLElement) => Array.from(el.querySelectorAll('.hint-box')).map((h) => (h.textContent || '').trim()).find((t) => /default templates/.test(t)) || '';
const createButton = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).find((b) => /Create Missing Templates/.test(b.textContent || ''));

describe('Demo page, step 0: "Create Missing Templates" is for the people who may manage the WhatsApp account', () => {
  afterEach(() => localStorage.clear());

  it('hides the box and the button from an ordinary owner (and nothing is ever posted)', async () => {
    const { el, posts } = await boot(base);
    expect(el.textContent).toContain('my_own_template'); // the page itself still works: their own templates are listed
    expect(hint(el)).toBe('');
    expect(createButton(el)).toBeUndefined();
    expect(posts).toEqual([]);
  });

  it('hides them when canManageWhatsApp is false (a super admin working inside a customer on the shared number, for one)', async () => {
    const { el } = await boot({ ...base, superAdmin: true, canManageWhatsApp: false, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    expect(hint(el)).toBe('');
    expect(createButton(el)).toBeUndefined();
  });

  it('hides them from an older server that does not send the field', async () => {
    const { el } = await boot({ ...base, superAdmin: true });
    expect(createButton(el)).toBeUndefined();
  });

  it('shows them to the people the server names, and the button creates the six default templates', async () => {
    const { el, posts, fixture } = await boot({ ...base, superAdmin: true, canManageWhatsApp: true });
    expect(hint(el)).toMatch(/^6 of Waflow's default templates haven't been created yet\./);
    const button = createButton(el) as HTMLButtonElement;
    expect(button).toBeTruthy();
    button.click();
    fixture.detectChanges();
    await sleep(0);
    const http = TestBed.inject(HttpTestingController);
    for (const req of http.match(() => true)) { if (req.request.method === 'POST') posts.push(req.request.urlWithParams); req.flush({}); }
    expect(posts.filter((p) => /create-.*-template/.test(p)).length).toBe(6);
  });
});
