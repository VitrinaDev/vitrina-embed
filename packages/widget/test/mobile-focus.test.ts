// Phones: opening the panel must not summon the keyboard, and no field may be
// under 16px (iOS zooms the page into it on focus). Desktop keeps autofocus.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { STYLES } from '../src/styles';
import type { WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_mobile_focus';

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

let instance: WidgetInstance | null = null;

beforeEach(() => {
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

describe('composer focus on open', () => {
  it('a fine pointer (desktop) lands in the composer', () => {
    mockPointer(false);
    instance = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false, locale: 'es' });
    $<HTMLButtonElement>('.vtr-launcher').click();
    expect($('.vtr-panel').hidden).toBe(false);
    expect(shadow().activeElement).toBe($('.vtr-input'));
  });

  it('a coarse pointer (phone) opens the panel without focusing, so no keyboard pops up', () => {
    mockPointer(true);
    instance = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false, locale: 'es' });
    $<HTMLButtonElement>('.vtr-launcher').click();
    expect($('.vtr-panel').hidden).toBe(false);
    expect(shadow().activeElement).toBeNull();
  });
});

describe('no iOS focus zoom', () => {
  it('every field is 16px on a coarse pointer, overriding the smaller desktop sizes', () => {
    const block = STYLES.slice(STYLES.indexOf('@media (pointer: coarse)'));
    expect(block).toMatch(/input, textarea, select \{ font-size: 16px !important; \}/);
  });
});
