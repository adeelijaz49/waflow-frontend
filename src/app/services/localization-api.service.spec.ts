import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LocalizationApiService } from './localization-api.service';

describe('LocalizationApiService URLs', () => {
  let api: LocalizationApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(LocalizationApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const urlOf = (): string => {
    const req = http.expectOne(() => true);
    req.flush({});
    return req.request.url;
  };

  it('encodes ids and keys that are placed in the path', () => {
    api.getCampaign('a/b?c#d').subscribe();
    expect(urlOf()).toMatch(/\/api\/localization\/campaigns\/a%2Fb%3Fc%23d$/);
    api.aiModeSession('s 1/../x').subscribe();
    expect(urlOf()).toMatch(/\/ai-mode\/session\/s%201%2F..%2Fx$/);
    api.saveCatalogTranslation('product', 'x/y', { name: 'n' }).subscribe();
    expect(urlOf()).toMatch(/\/catalog\/product\/x%2Fy\/translation$/);
    api.saveVariant('t1', 'ar', { body: 'b' } as never).subscribe();
    expect(urlOf()).toMatch(/\/templates\/t1\/variants\/ar$/);
  });

  it('leaves normal ObjectIds untouched', () => {
    api.setCustomerLanguage('64b0c0ffee0123456789abcd', 'ar').subscribe();
    expect(urlOf()).toMatch(/\/customers\/64b0c0ffee0123456789abcd\/language$/);
  });

  it('calls the flow tree and follow-up endpoints with encoded ids, the right verbs and bodies', () => {
    const last = (): { url: string; method: string; body: unknown } => {
      const req = http.expectOne(() => true);
      req.flush({});
      return { url: req.request.url, method: req.request.method, body: req.request.body };
    };
    api.listFlowTrees().subscribe();
    expect(last()).toMatchObject({ method: 'GET', url: expect.stringMatching(/\/api\/localization\/flows\/tree$/) });
    api.listPromotionTrees().subscribe();
    expect(last()).toMatchObject({ method: 'GET', url: expect.stringMatching(/\/api\/localization\/flows\/promotion-trees$/) });
    api.getFlowOwnerTree('promotion', 'p/1').subscribe();
    expect(last()).toMatchObject({ method: 'GET', url: expect.stringMatching(/\/flows\/owners\/promotion\/p%2F1\/tree$/) });
    api.getFollowUp('n 1').subscribe();
    expect(last()).toMatchObject({ method: 'GET', url: expect.stringMatching(/\/flows\/followups\/n%201$/) });
    const input = { body: 'مرحباً', buttons: [{ position: 0, text: 'نعم' }], source: 'ai' as const };
    api.saveFollowUp('n1', input).subscribe();
    expect(last()).toMatchObject({ method: 'PUT', url: expect.stringMatching(/\/flows\/followups\/n1\/variants\/ar$/), body: input });
    api.reviewFollowUp('n1', 'reviewed', 7).subscribe();
    expect(last()).toMatchObject({
      method: 'POST', url: expect.stringMatching(/\/flows\/followups\/n1\/variants\/ar\/review$/), body: { status: 'reviewed', contentVersion: 7 },
    });
  });
});
