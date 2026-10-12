import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import { CaptionsTab } from './captions-tab';
import { captionStats, collapseCaption, copyText, limitState, tokenize } from './caption-tokens';

describe('caption tokeniser', () => {
  it('isolates Arabic hashtags with underscores, Latin hashtags, mentions and urls', () => {
    const segs = tokenize('خصم #عروض_اليوم و #SaudiNationalDay مع @brand.sa زوروا https://waflow.app/x.');
    expect(segs.filter((s) => s.kind !== 'plain').map((s) => [s.kind, s.text])).toEqual([
      ['hashtag', '#عروض_اليوم'],
      ['hashtag', '#SaudiNationalDay'],
      ['mention', '@brand.sa'],
      ['url', 'https://waflow.app/x'],
    ]);
    expect(segs.map((s) => s.text).join('')).toBe('خصم #عروض_اليوم و #SaudiNationalDay مع @brand.sa زوروا https://waflow.app/x.');
  });

  it('handles emoji and adjacent punctuation', () => {
    const segs = tokenize('Sale🎉#deal! (@shop), #عرض؟ www.a.com،');
    expect(segs.filter((s) => s.kind !== 'plain').map((s) => s.text)).toEqual(['#deal', '@shop', '#عرض', 'www.a.com']);
  });

  it('ignores numeric-only hashtags, emails and lone @', () => {
    expect(tokenize('#123 me@mail.com @ x').every((s) => s.kind === 'plain')).toBe(true);
  });
});

describe('caption counters and limits', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(captionStats('😀😀').chars).toBe(2);
    const s = captionStats('a #x #y @m https://a.b\nline2');
    expect([s.hashtags, s.mentions, s.urls, s.lines]).toEqual([2, 1, 1, 2]);
    expect(captionStats('').lines).toBe(0);
  });

  it('limit states', () => {
    expect(limitState(10, 2200)).toBe('ok');
    expect(limitState(2000, 2200)).toBe('near');
    expect(limitState(2201, 2200)).toBe('over');
  });

  it('folds after 3 lines or 125 characters', () => {
    expect(collapseCaption('short').truncated).toBe(false);
    expect(collapseCaption('a\nb\nc\nd').text).toBe('a\nb\nc');
    const long = collapseCaption('x'.repeat(300));
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBe(125);
  });
});

describe('copyText', () => {
  it('uses the clipboard API when available', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('hi')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hi');
  });

  it('falls back to execCommand when the clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText('hi')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });
});

function fakeApi(over: Partial<Record<string, unknown>> = {}) {
  return {
    aiTranslate: vi.fn(() => of({ text: 'مرحبا #عروض', warnings: [] })),
    aiSaudiFriendly: vi.fn(() => of({ text: 'أهلا', warnings: [] })),
    ...over,
  };
}

async function setup(api: ReturnType<typeof fakeApi>, lang: 'en' | 'ar' = 'en', draft = '') {
  localStorage.clear();
  if (draft) localStorage.setItem('waflow_caption_draft', draft);
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }],
  });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  await i18n.use(lang, false);
  const fixture = TestBed.createComponent(CaptionsTab);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const type = (value: string) => {
    const ta = el.querySelector<HTMLTextAreaElement>('#cap-text')!;
    ta.value = value;
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const click = (re: RegExp) => {
    const b = Array.from(el.querySelectorAll<HTMLElement>('button, a')).find((x) => re.test(x.textContent ?? ''))!;
    b.click();
    fixture.detectChanges();
  };
  return { fixture, el, i18n, type, click };
}

describe('CaptionsTab', () => {
  it('renders English and Arabic without raw keys', async () => {
    const en = await setup(fakeApi());
    expect(en.el.querySelector('.cap-counters')?.getAttribute('aria-label')).toBe('Caption limits');
    expect(en.el.textContent).not.toMatch(/captions\.[a-z]/);
    TestBed.resetTestingModule();
    const ar = await setup(fakeApi(), 'ar');
    expect(ar.i18n.dir()).toBe('rtl');
    expect(ar.el.textContent).toContain('نصائح للتعليقات العربية');
    expect(ar.el.textContent).not.toMatch(/captions\.[a-z]/);
  });

  it('preview isolates tags/mentions/urls in LTR bdi and uses dir=auto lines', async () => {
    const { el, type } = await setup(fakeApi());
    type('عرض اليوم #عروض_اليوم مع @brand https://a.co');
    const bdis = Array.from(el.querySelectorAll('app-caption-preview bdi'));
    expect(bdis.map((b) => b.textContent)).toEqual(['#عروض_اليوم', '@brand', 'https://a.co']);
    expect(bdis.every((b) => b.getAttribute('dir') === 'ltr')).toBe(true);
    expect(el.querySelector('app-caption-preview p')!.getAttribute('dir')).toBe('auto');
    expect(el.textContent).toContain('Links in captions are not clickable');
  });

  it('folds long captions and expands/collapses; toggles the viewer direction', async () => {
    const { el, type, click } = await setup(fakeApi());
    type('word '.repeat(80));
    const card = () => el.querySelector('[data-testid=caption-card]')!;
    expect(card().textContent).toContain('... more');
    const collapsedLen = card().textContent!.length;
    click(/\.\.\. more/);
    expect(card().textContent!.length).toBeGreaterThan(collapsedLen);
    click(/^\s*less\s*$/);
    expect(card().textContent!.length).toBe(collapsedLen);
    click(/Arabic viewer/);
    expect(card().getAttribute('dir')).toBe('rtl');
    click(/English viewer/);
    expect(card().getAttribute('dir')).toBe('ltr');
  });

  it('shows limit warnings', async () => {
    const { el, type } = await setup(fakeApi());
    type('x'.repeat(2201));
    expect(el.querySelector('.loc-error')!.textContent).toContain('2200-character limit');
  });

  it('applies an AI draft only on click and supports one undo', async () => {
    const api = fakeApi();
    const { el, fixture, type, click } = await setup(api);
    type('Hello #deals');
    click(/Arabic/i);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.aiTranslate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello #deals', to: 'ar', context: 'caption', maxLength: 2200 }));
    expect(fixture.componentInstance.text()).toBe('Hello #deals');
    click(/Use this draft/i);
    expect(fixture.componentInstance.text()).toBe('مرحبا #عروض');
    click(/Undo last change/);
    expect(fixture.componentInstance.text()).toBe('Hello #deals');
    expect(el.textContent).not.toContain('Undo last change');
  });

  it('shows a localised error when the AI call fails', async () => {
    const api = fakeApi({ aiTranslate: vi.fn(() => throwError(() => ({ status: 0 }))) });
    const { el, fixture, type, click } = await setup(api);
    type('Hello');
    click(/Arabic/i);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.loc-error')).toBeTruthy();
  });

  it('copies the caption with a toast, clears it, and remembers/restores the draft', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture, el, type, click } = await setup(fakeApi(), 'en', 'old draft');
    expect(el.textContent).toContain('last draft was restored');
    type('new text');
    expect(localStorage.getItem('waflow_caption_draft')).toBe('new text');
    click(/^\s*Copy\s*$/);
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('new text');
    // the toast is added after the clipboard promise resolves, which whenStable() does not track
    await vi.waitFor(() => expect(TestBed.inject(LocUiService).toasts().length).toBe(1));
    click(/^\s*Clear\s*$/);
    expect(fixture.componentInstance.text()).toBe('');
    expect(localStorage.getItem('waflow_caption_draft')).toBeNull();
    expect(el.textContent).toContain('Write a caption to see the preview.');
  });

  it('links to the Instagram scheduler', async () => {
    const { el } = await setup(fakeApi());
    expect(el.querySelector('a[href="/instagram-promotions"]')).toBeTruthy();
  });
});
