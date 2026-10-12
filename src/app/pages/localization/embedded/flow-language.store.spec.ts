import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { FlowLanguageStore } from './flow-language.store';
import type { FlowTreeItem, OwnerTree } from './flow-language.util';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const tree = (ownerId: string): OwnerTree => ({ ownerType: 'promotion', ownerId, messageSource: 'promotion', nodes: [] });
const flowRow = (flowId: string): FlowTreeItem => ({
  flowId, flowName: flowId, triggerType: 'inactive_customer', status: 'active', promotionId: null, promotionName: null,
  messageSource: 'promotion', nodes: [],
});

function setup(api: Record<string, unknown>) {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [{ provide: LocalizationApiService, useValue: api }] });
  return TestBed.inject(FlowLanguageStore);
}

describe('FlowLanguageStore', () => {
  it('caches one tree per owner and reloads on demand', () => {
    const api = { getFlowOwnerTree: vi.fn((_t: string, id: string) => of(tree(id))), listFlowTrees: vi.fn() };
    const store = setup(api);
    const a = store.ownerTree('promotion', 'p1');
    expect(a().state).toBe('idle');
    store.ensureOwner('promotion', 'p1');
    store.ensureOwner('promotion', 'p1');
    expect(api.getFlowOwnerTree).toHaveBeenCalledTimes(1);
    expect(a().state).toBe('ready');
    expect(a().tree?.ownerId).toBe('p1');
    store.ensureOwner('promotion', 'p2');
    expect(api.getFlowOwnerTree).toHaveBeenCalledTimes(2);
    store.reloadOwner('promotion', 'p1');
    expect(api.getFlowOwnerTree).toHaveBeenCalledTimes(3);
    expect(api.getFlowOwnerTree).toHaveBeenLastCalledWith('promotion', 'p1');
  });

  it('keeps the old tree on screen while reloading and ignores a stale answer', () => {
    const first = new Subject<OwnerTree>();
    const second = new Subject<OwnerTree>();
    const api = { getFlowOwnerTree: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second), listFlowTrees: vi.fn() };
    const store = setup(api);
    const s = store.ownerTree('flow', 'f1');
    store.reloadOwner('flow', 'f1');
    first.next(tree('f1'));
    expect(s().state).toBe('ready');
    store.reloadOwner('flow', 'f1');
    expect(s().state).toBe('loading');
    expect(s().tree).not.toBeNull();
    second.next({ ...tree('f1'), messageSource: 'custom_entry' });
    expect(s().tree?.messageSource).toBe('custom_entry');
    first.next({ ...tree('f1'), messageSource: 'default_template' }); // late answer of an older request
    expect(s().tree?.messageSource).toBe('custom_entry');
  });

  it.each([[402], [404]])('treats %s as unavailable (nothing is shown) and other failures as error', (status) => {
    const api = { getFlowOwnerTree: vi.fn(() => throwError(() => ({ status }))), listFlowTrees: vi.fn(() => throwError(() => ({ status }))) };
    const store = setup(api);
    store.ensureOwner('promotion', 'p1');
    expect(store.ownerTree('promotion', 'p1')().state).toBe('unavailable');
    store.ensureAll();
    expect(store.all().state).toBe('unavailable');
  });

  it('reports a 500 as error so the panel can offer a retry', () => {
    const api = { getFlowOwnerTree: vi.fn(() => throwError(() => ({ status: 500 }))), listFlowTrees: vi.fn(() => throwError(() => ({ status: 500 }))) };
    const store = setup(api);
    store.ensureOwner('promotion', 'p1');
    expect(store.ownerTree('promotion', 'p1')().state).toBe('error');
    store.ensureAll();
    expect(store.all().state).toBe('error');
  });

  it('shares ONE preview-language toggle (default Both)', () => {
    const store = setup({ getFlowOwnerTree: vi.fn(), listFlowTrees: vi.fn() });
    expect(store.previewMode()).toBe('both');
    store.previewMode.set('ar');
    expect(TestBed.inject(FlowLanguageStore).previewMode()).toBe('ar');
  });

  it('makes one listFlowTrees call for any number of chips', () => {
    const api = { getFlowOwnerTree: vi.fn(), listFlowTrees: vi.fn(() => of({ items: [flowRow('f1'), flowRow('f2')] })) };
    const store = setup(api);
    for (let i = 0; i < 5; i++) store.ensureAll();
    expect(api.listFlowTrees).toHaveBeenCalledTimes(1);
    expect(store.flowRow('f2')()?.flowId).toBe('f2');
    expect(store.flowRow('nope')()).toBeNull();
  });

  it('forgets every cached answer when the login token changes', () => {
    const api = { getFlowOwnerTree: vi.fn((_t: string, id: string) => of(tree(id))), listFlowTrees: vi.fn(() => of({ items: [flowRow('f1')] })) };
    localStorage.setItem('waflow_auth_token', 'A');
    TestBed.configureTestingModule({ providers: [{ provide: LocalizationApiService, useValue: api }] });
    const store = TestBed.inject(FlowLanguageStore);
    store.ensureOwner('promotion', 'p1');
    store.ensureAll();
    expect(store.ownerTree('promotion', 'p1')().state).toBe('ready');
    localStorage.setItem('waflow_auth_token', 'B');
    store.ensureOwner('promotion', 'p1'); // guardToken resets, then reloads
    expect(api.getFlowOwnerTree).toHaveBeenCalledTimes(2);
    store.ensureAll();
    expect(api.listFlowTrees).toHaveBeenCalledTimes(2);
  });
});

describe('FlowLanguageStore without the API client methods (HTTP fallback)', () => {
  it('reads the same two read-only URLs itself', async () => {
    const { provideHttpClient } = await import('@angular/common/http');
    const { HttpTestingController, provideHttpClientTesting } = await import('@angular/common/http/testing');
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: LocalizationApiService, useValue: {} }] });
    const store = TestBed.inject(FlowLanguageStore);
    const http = TestBed.inject(HttpTestingController);
    store.ensureOwner('promotion', 'p 1');
    const owner = http.expectOne((r) => r.url.endsWith('/api/localization/flows/owners/promotion/p%201/tree'));
    owner.flush(tree('p 1'));
    expect(store.ownerTree('promotion', 'p 1')().state).toBe('ready');
    store.ensureAll();
    http.expectOne((r) => r.url.endsWith('/api/localization/flows/tree')).flush({ items: [flowRow('f1')] });
    expect(store.all().items.length).toBe(1);
    store.reloadOwner('flow', 'f9');
    http.expectOne((r) => r.url.endsWith('/owners/flow/f9/tree')).flush({ code: 'ARABIC_NOT_ENABLED' }, { status: 402, statusText: 'x' });
    expect(store.ownerTree('flow', 'f9')().state).toBe('unavailable');
  });

});
