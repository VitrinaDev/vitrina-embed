// Phones: the open panel follows the visual viewport, so the on-screen keyboard
// (which shrinks only the visual viewport on Android Chrome and iOS Safari)
// never covers the composer. Desktop and a closed panel stay untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { SIDEBAR_STYLES } from '../src/sidebar-styles';
import { STYLES } from '../src/styles';
import type { WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_keyboard_viewport';

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

function mockPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: coarse && q.includes('pointer: coarse'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
  set(h: number, top = 0, scale = 1): void {
    this.height = h;
    this.offsetTop = top;
    this.scale = scale;
    this.dispatchEvent(new Event('resize'));
  }
}

let instance: WidgetInstance | null = null;
let vv: FakeViewport;

beforeEach(() => {
  vv = new FakeViewport();
  vi.stubGlobal('visualViewport', vv);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    f(0);
    return 1;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      if (path === '/widget/config') return jsonRes(200, {});
      if (path === '/widget/messages') return jsonRes(200, { messages: [], conversation: null });
      return new Promise<Response>(() => {});
    }),
  );
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shadow = (): ShadowRoot => document.querySelector('[data-vitrina-widget]')!.shadowRoot!;
const $ = <T extends Element = HTMLElement>(sel: string): T => shadow().querySelector<T>(sel)!;
const vars = (): { top: string; h: string } => ({
  top: $('.vtr-panel').style.getPropertyValue('--vtr-vv-top'),
  h: $('.vtr-panel').style.getPropertyValue('--vtr-vv-h'),
});

describe('panel follows the visual viewport on phones', () => {
  it('sizes the open panel to the area above the keyboard, and back when it closes', () => {
    mockPointer(true);
    instance = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false, locale: 'es' });
    $<HTMLButtonElement>('.vtr-launcher').click();
    // Keyboard down: the plain 100dvh layout (iOS 26's visual viewport stops
    // above its floating toolbar; cutting the panel there would show the page).
    expect(vars()).toEqual({ top: '', h: '' });
    expect($('.vtr-panel').hasAttribute('data-kbd')).toBe(false);

    vv.set(740); // a toolbar's worth of difference is not a keyboard
    expect(vars()).toEqual({ top: '', h: '' });

    vv.set(420, 0); // keyboard up (Android: the visual viewport shrinks in place)
    expect(vars()).toEqual({ top: '0px', h: '420px' });
    expect($('.vtr-panel').hasAttribute('data-kbd')).toBe(true);

    vv.offsetTop = 260; // iOS pans the page under the keyboard
    vv.dispatchEvent(new Event('scroll'));
    expect(vars()).toEqual({ top: '260px', h: '420px' });

    vv.set(800, 0); // keyboard down
    expect(vars()).toEqual({ top: '', h: '' });
    expect($('.vtr-panel').hasAttribute('data-kbd')).toBe(false);

    instance.close();
    expect(vars()).toEqual({ top: '', h: '' });
  });

  it('keeps the latest message in view when the keyboard takes the bottom of the list', () => {
    mockPointer(true);
    instance = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false, locale: 'es' });
    $<HTMLButtonElement>('.vtr-launcher').click();
    const list = $('.vtr-messages');
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 1500 });
    list.scrollTop = 0;
    vv.set(420);
    expect(list.scrollTop).toBe(1500);
  });

  it('leaves a desktop panel and a pinch-zoomed page alone', () => {
    mockPointer(false);
    instance = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false, locale: 'es' });
    $<HTMLButtonElement>('.vtr-launcher').click();
    vv.set(420);
    expect(vars()).toEqual({ top: '', h: '' });
    instance.destroy();

    mockPointer(true);
    instance = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false, locale: 'es' });
    $<HTMLButtonElement>('.vtr-launcher').click();
    vv.set(400, 120, 2);
    expect(vars()).toEqual({ top: '', h: '' });
  });

  it('the phone layouts read the published area, falling back to the full screen', () => {
    const phone = STYLES.slice(STYLES.indexOf('@media (max-width: 480px)'));
    expect(phone).toMatch(/inset: var\(--vtr-vv-top, 0px\) 0 auto 0;/);
    expect(phone).toMatch(/height: var\(--vtr-vv-h, 100dvh\);/);
    const sheet = SIDEBAR_STYLES.slice(SIDEBAR_STYLES.indexOf('@media (max-width: 768px)'));
    expect(sheet).toMatch(/top: var\(--vtr-vv-top, 0px\); bottom: auto; height: var\(--vtr-vv-h, 100dvh\);/);
  });
});
