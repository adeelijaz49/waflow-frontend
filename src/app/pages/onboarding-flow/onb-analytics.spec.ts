import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { OnbAnalyticsService } from './onb-analytics.service';
import { OnbApiService } from './onb-api.service';
import { OnbStateService } from './onb-state.service';
import type { OnbEventBody, OnbState } from './onb.types';

function rig(state: OnbState | null = { enrolled: true, subscription: { state: 'active' } }) {
  const event = vi.fn((_b: OnbEventBody) => of({}));
  TestBed.configureTestingModule({ providers: [{ provide: OnbApiService, useValue: { event, getState: () => new Subject() } }] });
  const svc = TestBed.inject(OnbAnalyticsService);
  TestBed.inject(OnbStateService).state.set(state);
  return { svc, event };
}

const ALLOWED_KEYS = ['type', 'step', 'code', 'durationMs'];

describe('OnbAnalyticsService', () => {
  afterEach(() => vi.useRealTimers());

  it('posts exactly the whitelisted body', () => {
    const { svc, event } = rig();
    expect(svc.track('step_enter', 'connect')).toBe(true);
    expect(event).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledWith({ type: 'step_enter', step: 'connect' });
  });

  it('never carries anything outside type, step, code and durationMs (no PII keys)', () => {
    const { svc, event } = rig();
    svc.track('step_enter', 'business');
    svc.track('step_complete', 'business', undefined, 4200);
    svc.track('step_skip', 'customers', 'customers_skipped');
    svc.track('help_opened', 'connect', 'CONNECT_PARTIAL');
    svc.track('step_fail', 'connect', 'ONB_SDK_BLOCKED');
    for (const [body] of event.mock.calls) {
      expect(Object.keys(body).every((k) => ALLOWED_KEYS.includes(k))).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/@|\+?\d{7,}|token|phone|email|name/i);
    }
    expect(event).toHaveBeenCalledTimes(5);
  });

  it('is de-duplicated per (type, step); failures and help openings are told apart by code', () => {
    const { svc, event } = rig();
    expect(svc.track('step_enter', 'number')).toBe(true);
    expect(svc.track('step_enter', 'number')).toBe(false);
    expect(svc.track('step_enter', 'connect')).toBe(true);
    expect(svc.track('step_fail', 'connect', 'ONB_SDK_BLOCKED')).toBe(true);
    expect(svc.track('step_fail', 'connect', 'ONB_SDK_BLOCKED')).toBe(false);
    expect(svc.track('step_fail', 'connect', 'ONB_POPUP_BLOCKED')).toBe(true);
    expect(svc.track('help_opened', 'connect', 'META_ERROR')).toBe(true);
    expect(svc.track('help_opened', 'connect', 'META_ERROR')).toBe(false);
    expect(event).toHaveBeenCalledTimes(5);
  });

  it('another login in the same tab starts a new funnel: the events of the first merchant do not hide the second one\'s (R6-13)', () => {
    localStorage.setItem('waflow_auth_token', 'token-A');
    try {
      const { svc, event } = rig();
      const state = TestBed.inject(OnbStateService);
      state.load();
      expect(svc.track('step_enter', 'business')).toBe(true);
      expect(svc.track('step_enter', 'business')).toBe(false); // the same page session
      localStorage.setItem('waflow_auth_token', 'token-B');
      state.ensureLoaded();
      state.state.set({ enrolled: true, subscription: { state: 'active' } }); // the second merchant's own answer
      expect(svc.track('step_enter', 'business')).toBe(true);
      expect(event).toHaveBeenCalledTimes(2);
    } finally {
      localStorage.clear();
    }
  });

  it.each(['none', 'pending', 'past_due', 'cancelled'] as const)('is skipped (gate A) when the subscription is %s', (sub) => {
    const { svc, event } = rig({ enrolled: true, subscription: { state: sub } });
    expect(svc.track('step_enter', 'business')).toBe(false);
    expect(event).not.toHaveBeenCalled();
  });

  it('is skipped when not enrolled or without a state', () => {
    for (const st of [null, { enrolled: false } as OnbState]) {
      TestBed.resetTestingModule();
      const { svc, event } = rig(st);
      expect(svc.track('step_enter', 'business')).toBe(false);
      expect(event).not.toHaveBeenCalled();
    }
  });

  it('drops values outside the whitelist', () => {
    const { svc, event } = rig();
    expect(svc.track('page_view' as never, 'business')).toBe(false);
    expect(svc.track('step_enter', 'secret' as never)).toBe(false);
    expect(svc.track('step_fail', 'connect', 'NOT_A_CLIENT_CODE')).toBe(false);
    expect(svc.track('step_fail', 'connect')).toBe(false);
    expect(event).not.toHaveBeenCalled();
  });

  it('keeps only a fixed set of skip codes and only code-shaped help codes', () => {
    const { svc, event } = rig();
    svc.track('step_skip', 'customers', '+966501234567');
    svc.track('help_opened', 'billing', 'some free text with spaces');
    svc.track('step_skip', 'number', 'number_paused');
    expect(event.mock.calls[0][0]).toEqual({ type: 'step_skip', step: 'customers' });
    expect(event.mock.calls[1][0]).toEqual({ type: 'help_opened', step: 'billing' });
    expect(event.mock.calls[2][0]).toEqual({ type: 'step_skip', step: 'number', code: 'number_paused' });
  });

  it('step_complete carries the time since step_enter on this device; negative or silly durations are dropped or clamped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { svc, event } = rig();
    svc.track('step_enter', 'connect');
    vi.setSystemTime(1_000_000 + 12_345);
    svc.track('step_complete', 'connect');
    expect(event.mock.calls[1][0]).toEqual({ type: 'step_complete', step: 'connect', durationMs: 12345 });
    svc.track('step_complete', 'number', undefined, -5);
    svc.track('step_complete', 'approvals', undefined, Number.NaN);
    svc.track('step_complete', 'promotion', undefined, 10 ** 12);
    expect(event.mock.calls[2][0]).toEqual({ type: 'step_complete', step: 'number' });
    expect(event.mock.calls[3][0]).toEqual({ type: 'step_complete', step: 'approvals' });
    expect(event.mock.calls[4][0].durationMs).toBe(86_400_000);
  });

  it('fire-and-forget: an erroring POST never throws and never rejects', () => {
    const event = vi.fn(() => throwError(() => ({ status: 500 })));
    TestBed.configureTestingModule({ providers: [{ provide: OnbApiService, useValue: { event, getState: () => new Subject() } }] });
    TestBed.inject(OnbStateService).state.set({ enrolled: true, subscription: { state: 'active' } });
    const svc = TestBed.inject(OnbAnalyticsService);
    expect(() => svc.track('step_enter', 'business')).not.toThrow();
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('fire-and-forget: a synchronous throw in the api is swallowed', () => {
    const event = vi.fn(() => { throw new Error('boom'); });
    TestBed.configureTestingModule({ providers: [{ provide: OnbApiService, useValue: { event, getState: () => new Subject() } }] });
    TestBed.inject(OnbStateService).state.set({ enrolled: true, subscription: { state: 'active' } });
    const svc = TestBed.inject(OnbAnalyticsService);
    expect(svc.track('step_enter', 'business')).toBe(false);
  });

  it('a slow request does not block the caller (the observable is only subscribed, never awaited)', () => {
    const slow = new Subject<unknown>();
    const event = vi.fn(() => slow);
    TestBed.configureTestingModule({ providers: [{ provide: OnbApiService, useValue: { event, getState: () => new Subject() } }] });
    TestBed.inject(OnbStateService).state.set({ enrolled: true, subscription: { state: 'active' } });
    const svc = TestBed.inject(OnbAnalyticsService);
    expect(svc.track('step_enter', 'business')).toBe(true);
    expect(slow.observed).toBe(true);
  });
});
