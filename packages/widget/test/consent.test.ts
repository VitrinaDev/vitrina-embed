import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentConsent, onTrackingAllowed } from '../src/consent';

beforeEach(() => {
  delete (window as { __vitrinaConsent?: unknown }).__vitrinaConsent;
  delete (window as { dataLayer?: unknown }).dataLayer;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('currentConsent', () => {
  it('is null (unknown) with no signal at all', () => {
    expect(currentConsent()).toBeNull();
  });

  it('honors an explicit boolean __vitrinaConsent hook', () => {
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    expect(currentConsent()).toBe(true);
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = false;
    expect(currentConsent()).toBe(false);
  });

  it('honors a function __vitrinaConsent hook', () => {
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = () => true;
    expect(currentConsent()).toBe(true);
  });

  it('never throws when the hook itself throws', () => {
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = () => {
      throw new Error('boom');
    };
    expect(() => currentConsent()).not.toThrow();
    expect(currentConsent()).toBeNull();
  });

  it('reads Google Consent Mode v2 granted from dataLayer', () => {
    (window as { dataLayer?: unknown[] }).dataLayer = [
      ['consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' }],
      ['consent', 'update', { ad_storage: 'granted', analytics_storage: 'denied' }],
    ];
    expect(currentConsent()).toBe(true);
  });

  it('reads Google Consent Mode v2 denied from dataLayer', () => {
    (window as { dataLayer?: unknown[] }).dataLayer = [
      ['consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' }],
    ];
    expect(currentConsent()).toBe(false);
  });

  it('ignores malformed dataLayer entries instead of throwing', () => {
    (window as { dataLayer?: unknown[] }).dataLayer = [
      'not-an-array' as unknown as unknown[],
      ['consent'],
      ['not-consent', 'update', {}],
      ['consent', 'update', null],
    ];
    expect(() => currentConsent()).not.toThrow();
    expect(currentConsent()).toBeNull();
  });

  it('the explicit hook takes priority over Consent Mode', () => {
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    (window as { dataLayer?: unknown[] }).dataLayer = [
      ['consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' }],
    ];
    expect(currentConsent()).toBe(true);
  });
});

describe('onTrackingAllowed', () => {
  it('fires immediately with no signal and no dataLayer', async () => {
    const cb = vi.fn();
    onTrackingAllowed(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('reads gtag()-style Arguments entries and denies when both keys are denied', async () => {
    const { currentConsent: cc } = await import('../src/consent');
    (function push(..._a: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      (window as { dataLayer?: unknown[] }).dataLayer = [arguments];
    })('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied' });
    expect(cc()).toBe(false);
  });

  const deny = (): void => {
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = false;
  };

  it('calls back immediately when consent is already granted', () => {
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    const cb = vi.fn();
    onTrackingAllowed(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('while denied, polls until consent is granted, then fires once', () => {
    vi.useFakeTimers();
    deny();
    const cb = vi.fn();
    onTrackingAllowed(cb);
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('gives up after the poll budget on a page that stays denied', () => {
    vi.useFakeTimers();
    deny();
    const cb = vi.fn();
    onTrackingAllowed(cb);
    vi.advanceTimersByTime(500 * 100);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancel() stops further polling', () => {
    vi.useFakeTimers();
    deny();
    const cb = vi.fn();
    const cancel = onTrackingAllowed(cb);
    cancel();
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    vi.advanceTimersByTime(500 * 10);
    expect(cb).not.toHaveBeenCalled();
  });
});
