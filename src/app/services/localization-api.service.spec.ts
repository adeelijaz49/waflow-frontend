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
});
