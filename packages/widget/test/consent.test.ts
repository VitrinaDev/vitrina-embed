import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentConsent, onTrackingConsentGranted } from '../src/consent';

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

describe('onTrackingConsentGranted', () => {
  it('calls back immediately when consent is already granted', () => {
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    const cb = vi.fn();
    onTrackingConsentGranted(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('polls until consent is granted', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    onTrackingConsentGranted(cb);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();

    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);

    // Does not keep firing once granted.
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('gives up after the poll budget on a page that never grants', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    onTrackingConsentGranted(cb);
    vi.advanceTimersByTime(500 * 100);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancel() stops further polling', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const cancel = onTrackingConsentGranted(cb);
    cancel();
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    vi.advanceTimersByTime(500 * 10);
    expect(cb).not.toHaveBeenCalled();
  });
});
