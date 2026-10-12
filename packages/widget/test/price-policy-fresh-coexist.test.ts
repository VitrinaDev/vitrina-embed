// 0.17.4: pricePolicy -> `price_policy`, freshConversation, two instances on one page,
// and a clean destroy() of an inline instance (landing-cro #35).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { resolvePricePolicy } from '../src/sidebar-config';
import { detectBusy } from '../src/auto-open';
import { createTokenStore } from '../src/token-store';
import type { WidgetConfig, WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_inline';
const PK2 = 'pk_test_tomas';

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

let posts: Array<{ key: string; body: Record<string, unknown> }>;
let conversationPosts: string[];
let instances: WidgetInstance[];

const flush = async (ms = 0): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};

beforeEach(() => {
  posts = [];
  conversationPosts = [];
  instances = [];
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, initArg: RequestInit = {}) => {
      const u = new URL(url);
      const path = u.pathname.replace('/api/v1', '');
      const method = (initArg.method ?? 'GET').toUpperCase();
      const headers = (initArg.headers ?? {}) as Record<string, string>;
      const key = (headers.Authorization ?? '').replace('Bearer ', '');
      if (path === '/widget/config') return jsonRes(200, {});
      if (path === '/widget/conversations') {
        conversationPosts.push(key);
        return jsonRes(200, { visitorToken: 'vt_new', conversationExternalId: 'web:new', expiresAt: '2030-01-01T00:00:00Z' });
      }
      if (path === '/widget/messages' && method === 'POST') {
        posts.push({ key, body: JSON.parse(String(initArg.body)) });
        return jsonRes(202, { status: 'accepted', visitorToken: 'vt_new', conversationExternalId: 'web:new' });
      }
      if (path === '/widget/messages') return jsonRes(200, { messages: [], conversation: null });
      return new Promise<Response>(() => {});
    }),
  );
});

afterEach(() => {
  for (const i of instances) i.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function start(extra: Partial<WidgetConfig> = {}): WidgetInstance {
  const i = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false, ...extra } as WidgetConfig);
  instances.push(i);
  return i;
}

describe('resolvePricePolicy', () => {
  it('keeps a valid mode', () => {
    for (const mode of ['first_ask', 'evaluation_only', 'never']) {
      expect(resolvePricePolicy({ mode })).toEqual({ mode });
    }
  });
  it('drops an unknown mode and non-objects', () => {
    expect(resolvePricePolicy({ mode: 'free' })).toBeNull();
    expect(resolvePricePolicy(undefined)).toBeNull();
    expect(resolvePricePolicy('never')).toBeNull();
    expect(resolvePricePolicy(['never'])).toBeNull();
  });
  it('trims the script and cuts it to 400 chars', () => {
    expect(resolvePricePolicy({ mode: 'script', script: '  Di el precio  ' })).toEqual({ mode: 'script', script: 'Di el precio' });
    const long = resolvePricePolicy({ mode: 'script', script: 'x'.repeat(500) });
    expect(long!.script).toHaveLength(400);
  });
  it("drops mode 'script' without a script", () => {
    expect(resolvePricePolicy({ mode: 'script' })).toBeNull();
    expect(resolvePricePolicy({ mode: 'script', script: '   ' })).toBeNull();
  });
});

describe('price_policy on the wire', () => {
  it('is sent on every message, snake_case', async () => {
    const w = start({ pricePolicy: { mode: 'script', script: ' Habla de la evaluación ' } });
    w.open();
    w.send('Hola');
    await flush(20);
    w.send('¿Cuánto cuesta?');
    await flush(20);
    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p.body.price_policy).toEqual({ mode: 'script', script: 'Habla de la evaluación' });
  });
  it('is absent when not configured or invalid', async () => {
    const w = start({ pricePolicy: { mode: 'bogus' as never } });
    w.open();
    w.send('Hola');
    await flush(20);
    expect(posts[0]!.body).not.toHaveProperty('price_policy');
  });
});

describe('freshConversation', () => {
  it('clears the stored visitor token before bootstrapping', async () => {
    createTokenStore(PK).set('vt_old');
    const other = createTokenStore(PK2);
    other.set('vt_other');
    const w = start({ freshConversation: true });
    expect(createTokenStore(PK).get()).toBeNull();
    expect(other.get()).toBe('vt_other');
    w.open();
    await flush(30);
    expect(conversationPosts.length).toBeGreaterThan(0);
  });
  it('without the flag the stored token survives init', () => {
    createTokenStore(PK).set('vt_old');
    start();
    expect(createTokenStore(PK).get()).toBe('vt_old');
  });
});

describe('two instances on one page', () => {
  it('keep separate shadow roots, tokens and messages', async () => {
    document.body.innerHTML = '<section id="live"></section>';
    const tomas = start({ publicKey: PK2, layout: 'sidebar', preset: 'cream' });
    const inline = start({ layout: 'inline', container: '#live', preset: 'cream', pricePolicy: { mode: 'never' } });
    const hosts = document.querySelectorAll<HTMLElement>('[data-vitrina-widget]');
    expect(hosts).toHaveLength(2);
    expect(hosts[0]!.shadowRoot).not.toBe(hosts[1]!.shadowRoot);
    expect(document.querySelectorAll('#live [data-vitrina-widget]')).toHaveLength(1);

    inline.send('Hola');
    await flush(20);
    tomas.send('Hola Tomás');
    await flush(20);
    const byKey = (k: string) => posts.filter((p) => p.key === k);
    expect(byKey(PK)).toHaveLength(1);
    expect(byKey(PK)[0]!.body.price_policy).toEqual({ mode: 'never' });
    expect(byKey(PK2)).toHaveLength(1);
    expect(byKey(PK2)[0]!.body).not.toHaveProperty('price_policy');
    expect(createTokenStore(PK).get()).toBe('vt_new');
    expect(createTokenStore(PK2).get()).toBe('vt_new');

    // Destroying one leaves the other mounted and working.
    inline.destroy();
    expect(document.querySelectorAll('[data-vitrina-widget]')).toHaveLength(1);
    tomas.open();
    expect(document.querySelector('[data-vitrina-widget]')!.shadowRoot!.querySelector<HTMLElement>('.vtr-panel')!.hidden).toBe(false);
  });

  it('a focused composer in the other widget keeps this one from auto-opening over it', () => {
    document.body.innerHTML = '<section id="live"></section>';
    const a = document.createElement('div');
    a.setAttribute('data-vitrina-widget', '');
    const sr = a.attachShadow({ mode: 'open' });
    sr.innerHTML = '<textarea></textarea>';
    document.body.appendChild(a);
    sr.querySelector('textarea')!.focus();
    const own = document.createElement('div');
    own.setAttribute('data-vitrina-widget', '');
    document.body.appendChild(own);
    expect(detectBusy(document, own)).toBe('input');
    // Own composer focused: not busy (widget's own focus never blocks it).
    expect(detectBusy(document, a)).toBeNull();
  });
});

describe('inline destroy()', () => {
  it('removes its DOM from the container and a re-init in the same container works', async () => {
    document.body.innerHTML = '<section id="live"></section>';
    const container = document.querySelector('#live')!;
    const first = start({ layout: 'inline', container: '#live' });
    expect(container.querySelectorAll('[data-vitrina-widget]')).toHaveLength(1);
    first.destroy();
    expect(container.children).toHaveLength(0);
    expect(container.innerHTML).toBe('');

    const second = start({ layout: 'inline', container: '#live', freshConversation: true, pricePolicy: { mode: 'evaluation_only' } });
    expect(container.querySelectorAll('[data-vitrina-widget]')).toHaveLength(1);
    second.send('Hola');
    await flush(20);
    expect(posts[posts.length - 1]!.body.price_policy).toEqual({ mode: 'evaluation_only' });
    second.destroy();
    expect(container.children).toHaveLength(0);
  });
});
