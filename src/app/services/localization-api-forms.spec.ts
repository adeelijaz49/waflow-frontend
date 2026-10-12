import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LocalizationApiService } from './localization-api.service';

// Single-item lookups used by the existing Customers / Products / Services screens (D4).
describe('LocalizationApiService customer-data lookups', () => {
  let api: LocalizationApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(LocalizationApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('getCustomerLanguage is a GET on the customer language path', () => {
    let got: unknown;
    api.getCustomerLanguage('64b0c0ffee0123456789abcd').subscribe((r) => (got = r));
    const req = http.expectOne(() => true);
    expect(req.request.method).toBe('GET');
    expect(req.request.url).toMatch(/\/api\/localization\/customers\/64b0c0ffee0123456789abcd\/language$/);
    req.flush({ id: 'x', language: 'ar' });
    expect(got).toEqual({ id: 'x', language: 'ar' });
  });

  it('getCatalogTranslation is a GET on the item translation path and encodes the ids', () => {
    api.getCatalogTranslation('service', 'a/b?c').subscribe();
    const req = http.expectOne(() => true);
    expect(req.request.method).toBe('GET');
    expect(req.request.url).toMatch(/\/api\/localization\/catalog\/service\/a%2Fb%3Fc\/translation$/);
    req.flush({ translation: null });
  });

  it('ids that contain path characters can never change the route', () => {
    api.getCustomerLanguage('../settings').subscribe();
    const req = http.expectOne(() => true);
    expect(req.request.url).toMatch(/\/customers\/\.\.%2Fsettings\/language$/);
    req.flush({});
  });
});
