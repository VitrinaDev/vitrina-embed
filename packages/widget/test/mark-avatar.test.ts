// The brand-mark avatar (agent.avatar 'mark', 0.23.0): the pyramid instead of a
// portrait, no presence dot and no «IA» badge, the accessible AI name kept, and
// the core bobbing while the assistant types.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { portrait } from '../src/sidebar-ui';
import { resolveAgent, coerceRemoteSidebar } from '../src/sidebar-config';
import type { WidgetConfig, WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_mark';

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

let posts: Array<Record<string, unknown>>;
let instance: WidgetInstance | null;

function mockMatchMedia(mobile: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: mobile && q.includes('max-width'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  posts = [];
  instance = null;
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  mockMatchMedia(false);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, initArg: RequestInit = {}) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      const method = (initArg.method ?? 'GET').toUpperCase();
      if (path === '/widget/config') return jsonRes(200, {});
      if (path === '/widget/conversations') {
        return jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:conv-1', expiresAt: '2030-01-01T00:00:00Z' });
      }
      if (path === '/widget/messages' && method === 'POST') {
        posts.push(JSON.parse(String(initArg.body)));
        return jsonRes(202, { status: 'accepted', visitorToken: 'vt', conversationExternalId: 'web:conv-1' });
      }
      if (path === '/widget/messages') return jsonRes(200, { messages: [], conversation: null });
      // The stream: never resolves — no SSE in these tests.
      return new Promise<Response>(() => {});
    }),
  );
});

afterEach(() => {
  instance?.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = async (ms = 0): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};

function amber(extra: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    publicKey: PK,
    apiBaseUrl: BASE,
    remoteConfig: false,
    layout: 'sidebar',
    preset: 'cream',
    welcomeMessage: '¡Hola! Soy Ámbar.',
    agent: { name: 'Ámbar', label: 'Asistente IA de Vitrina', avatar: 'mark' },
    chips: [{ label: '¿Cuánto cuesta?' }],
    typingOnSend: true,
    ...extra,
  };
}

const shadow = (): ShadowRoot => document.querySelector('[data-vitrina-widget]')!.shadowRoot!;
const $ = <T extends Element = HTMLElement>(sel: string): T | null => shadow().querySelector<T>(sel);
const AGENT = { name: 'Ámbar', label: 'Asistente IA de Vitrina', status: null, avatarUrl: null, avatar: 'mark' as const };

describe('config', () => {
  it('resolves avatar mark, and drops anything else', () => {
    expect(resolveAgent({ name: 'Ámbar', label: 'Asistente IA', avatar: 'mark' })!.avatar).toBe('mark');
    expect(resolveAgent({ name: 'Ámbar', label: 'Asistente IA' })!.avatar).toBeNull();
    expect(resolveAgent({ name: 'Ámbar', label: 'Asistente IA', avatar: 'face' as 'mark' })!.avatar).toBeNull();
  });

  it('the server config can ask for the mark', () => {
    expect(coerceRemoteSidebar({ agent: { name: 'Ámbar', avatar: 'mark' } }).agent).toEqual({ name: 'Ámbar', avatar: 'mark' });
    expect(coerceRemoteSidebar({ agent: { name: 'Ámbar', avatar: 'x' } }).agent).toEqual({ name: 'Ámbar' });
  });
});

describe('portrait() with the mark', () => {
  it.each([28, 40, 64])('at %i px: the pyramid on a tile, no dot, no badge, named as an AI', (size) => {
    const pt = portrait(AGENT, size, { online: true, aiTag: 'IA', badge: true });
    expect(pt.classList.contains('vtr-pt-mark')).toBe(true);
    expect(pt.style.width).toBe(`${size}px`);
    expect(pt.querySelector('svg.vtr-mk')).not.toBeNull();
    expect(pt.querySelector('.vtr-mk-core')!.children).toHaveLength(3);
    expect(pt.querySelector('img')).toBeNull();
    expect(pt.querySelector('.vtr-pt-on')).toBeNull();
    expect(pt.querySelector('.vtr-pt-ia')).toBeNull();
    expect(pt.getAttribute('role')).toBe('img');
    expect(pt.getAttribute('aria-label')).toBe('Ámbar, asistente IA de Vitrina');
  });

  it('wins over avatarUrl', () => {
    const pt = portrait({ ...AGENT, avatarUrl: 'https://cdn.example.com/a.jpg' }, 40, { aiTag: 'IA' });
    expect(pt.querySelector('img')).toBeNull();
    expect(pt.querySelector('svg.vtr-mk')).not.toBeNull();
  });

  it('without it the portrait is unchanged: face, dot and badge', () => {
    const pt = portrait({ ...AGENT, avatar: null }, 36, { online: true, aiTag: 'IA' });
    expect(pt.classList.contains('vtr-pt-mark')).toBe(false);
    expect(pt.querySelector('.vtr-pt-face')).not.toBeNull();
    expect(pt.querySelector('.vtr-pt-on')).not.toBeNull();
    expect(pt.querySelector('.vtr-pt-ia')!.textContent).toBe('IA');
  });
});

describe('the widget with the mark', () => {
  it('header, launcher and peek card all carry the mark, never the dot or the badge', () => {
    instance = init(amber());
    const marks = shadow().querySelectorAll('.vtr-pt');
    expect(marks.length).toBeGreaterThanOrEqual(3);
    for (const m of marks) expect(m.classList.contains('vtr-pt-mark')).toBe(true);
    expect(shadow().querySelector('.vtr-pt-on')).toBeNull();
    expect(shadow().querySelector('.vtr-pt-ia')).toBeNull();
    expect($('.vtr-sb-head .vtr-pt-mark')!.getAttribute('aria-label')).toBe('Ámbar, asistente IA de Vitrina');
    // The visible disclosure stays in the header.
    expect($('.vtr-sb-role')!.textContent).toBe('Asistente IA de Vitrina');
  });

  it('the bottom-bar slot gets the mark too', () => {
    document.body.innerHTML = '<div data-vtr-bar><span id="slot"></span></div>';
    instance = init(amber({ anchor: 'bottom-bar', launcherSlot: '#slot' }));
    const sr = (document.querySelector('#slot [data-vitrina-widget-slot]') as HTMLElement).shadowRoot!;
    expect(sr.querySelector('.vtr-pt-mark svg.vtr-mk')).not.toBeNull();
    expect(sr.querySelector('.vtr-pt-ia')).toBeNull();
    expect(sr.querySelector('style')!.textContent).toContain('vtr-mk-bob');
  });

  it('the core bobs while the assistant is typing', async () => {
    instance = init(amber());
    instance.open();
    const head = $('.vtr-sb-head .vtr-pt-mark')!;
    expect(head.classList.contains('vtr-pt-typing')).toBe(false);
    shadow().querySelector<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')!.click();
    await flush(10);
    expect(posts).toHaveLength(1);
    expect($('.vtr-typing')!.hidden).toBe(false);
    expect(head.classList.contains('vtr-pt-typing')).toBe(true);
    expect(shadow().querySelector('.vtr-sb-tab .vtr-pt-mark')!.classList.contains('vtr-pt-typing')).toBe(true);
    instance.destroy();
    instance = null;
  });

  it('the stylesheet honours reduced motion', () => {
    instance = init(amber());
    const css = [...shadow().querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.vtr-pt-typing \.vtr-mk-core \{ animation: none/);
  });

  it('a portrait install never gets the bob class', async () => {
    instance = init(amber({ agent: { name: 'Tomás', label: 'Asistente IA de Vitrina' } }));
    instance.open();
    shadow().querySelector<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')!.click();
    await flush(10);
    expect(shadow().querySelector('.vtr-pt-typing')).toBeNull();
    expect($('.vtr-sb-head .vtr-pt-on')).not.toBeNull();
  });
});
