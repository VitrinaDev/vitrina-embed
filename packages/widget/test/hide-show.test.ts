// hide() / show() (0.17.3): the host page takes the widget off the screen and gets it back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { createAutoOpenScheduler } from '../src/auto-open';
import type { WidgetConfig, WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
let instance: WidgetInstance | null;

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

beforeEach(() => {
  instance = null;
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      if (path === '/widget/config') return jsonRes(200, {});
      if (path === '/widget/conversations') {
        return jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:c', expiresAt: '2030-01-01T00:00:00Z' });
      }
      if (path === '/widget/messages') return jsonRes(200, { messages: [], conversation: null });
      return new Promise<Response>(() => {});
    }),
  );
});

afterEach(() => {
  instance?.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function start(extra: Partial<WidgetConfig> = {}): WidgetInstance {
  instance = init({ publicKey: 'pk_test_hide', apiBaseUrl: BASE, ...extra } as WidgetConfig);
  return instance;
}
const host = (): HTMLElement => document.querySelector('[data-vitrina-widget]') as HTMLElement;
const panel = (): HTMLElement => host().shadowRoot!.querySelector('.vtr-panel') as HTMLElement;
const launcher = (): HTMLElement => host().shadowRoot!.querySelector('.vtr-launcher') as HTMLElement;

describe('hide() / show()', () => {
  for (const layout of ['bubble', 'sidebar'] as const) {
    it(`hides the host and restores a closed launcher (${layout})`, () => {
      const w = start({ layout });
      const events: string[] = [];
      w.on('hide', () => events.push('hide'));
      w.on('show', (e) => events.push(`show:${e.restored}`));
      w.hide();
      expect(host().style.getPropertyValue('display')).toBe('none');
      expect(host().style.getPropertyPriority('display')).toBe('important');
      w.show();
      expect(host().style.getPropertyValue('display')).toBe('block');
      expect(launcher().hidden).toBe(false);
      expect(events).toEqual(['hide', 'show:launcher']);
    });

    it(`closes an open panel and reopens it on show (${layout})`, () => {
      const w = start({ layout });
      const events: string[] = [];
      w.on('open', (e) => events.push(`open:${e.source}`));
      w.on('close', (e) => events.push(`close:${e.source}`));
      w.on('show', (e) => events.push(`show:${e.restored}`));
      w.open();
      w.hide();
      expect(panel().hidden).toBe(true);
      w.show();
      expect(panel().hidden).toBe(false);
      expect(events).toEqual(['open:api', 'close:api', 'open:api', 'show:panel']);
    });
  }

  it('is idempotent', () => {
    const w = start();
    const events: string[] = [];
    w.on('hide', () => events.push('hide'));
    w.on('show', () => events.push('show'));
    w.show();
    w.hide();
    w.hide();
    w.show();
    w.show();
    expect(events).toEqual(['hide', 'show']);
  });

  it('open() while hidden shows nothing, show() then opens the panel', () => {
    const w = start();
    w.hide();
    w.open();
    expect(panel().hidden).toBe(true);
    w.show();
    expect(panel().hidden).toBe(false);
  });

  it('hides the bottom-bar slot launcher too', () => {
    const bar = document.createElement('div');
    bar.setAttribute('data-vtr-bar', '');
    bar.innerHTML = '<span id="tomas-slot"></span>';
    document.body.appendChild(bar);
    const w = start({ layout: 'sidebar', anchor: 'bottom-bar', launcherSlot: '#tomas-slot' } as Partial<WidgetConfig>);
    const slot = document.querySelector('[data-vitrina-widget-slot]') as HTMLElement | null;
    expect(slot).not.toBeNull();
    w.hide();
    expect(slot!.style.getPropertyValue('display')).toBe('none');
    w.show();
    expect(slot!.style.getPropertyValue('display')).toBe('inline-block');
  });

  it('does nothing after destroy()', () => {
    const w = start();
    w.destroy();
    expect(() => {
      w.hide();
      w.show();
    }).not.toThrow();
  });
});

describe('auto-open while hidden', () => {
  it('waits while the page is busy with hidden and fires once it is quiet', () => {
    vi.useFakeTimers();
    let hidden = true;
    const fired: string[] = [];
    const store = new Map<string, string>();
    const sched = createAutoOpenScheduler({
      publicKey: 'pk',
      config: {
        enabled: true, delayMs: 100, mobileDelayMs: 100, desktop: 'panel', mobile: 'teaser', excludePaths: [], variant: null,
      } as never,
      env: {
        now: () => 0,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as never),
        isMobile: () => false,
        pathname: () => '/',
        busy: () => (hidden ? 'hidden' : null),
        session: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
      },
      onFire: (mode) => fired.push(mode),
    });
    sched.start();
    vi.advanceTimersByTime(5_000);
    expect(fired).toEqual([]);
    hidden = false;
    vi.advanceTimersByTime(1_500);
    expect(fired).toEqual(['panel']);
    vi.useRealTimers();
  });
});
