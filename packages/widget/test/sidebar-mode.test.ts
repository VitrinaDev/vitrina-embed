// Sidebar / inline layout (embed#25): the DOM contract, the chips, demo mode,
// the CTA, the WhatsApp continuation, the peek card and the bottom-bar slot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import type { WidgetConfig, WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_sidebar';

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
  vi.restoreAllMocks();
});

/** Past the 1 s auto-open delay, counted from page load (performance.now). */
const pastDelay = async (): Promise<void> => {
  const wait = Math.max(0, 1_000 - performance.now()) + 30;
  await flush(wait);
};

const flush = async (ms = 0): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};

function tomas(extra: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    publicKey: PK,
    apiBaseUrl: BASE,
    remoteConfig: false,
    layout: 'sidebar',
    preset: 'cream',
    welcomeMessage: '¡Hola! Soy Tomás.',
    agent: { name: 'Tomás', label: 'Asistente IA de Vitrina', status: 'Responde al instante' },
    chips: [
      { label: '¿Cuánto cuesta?' },
      { label: 'Pruébalo', action: 'demo', message: 'Quiero probar' },
      { label: 'Agendar', action: 'booking' },
    ],
    whatsapp: { number: '+56 9 0000 0000', text: 'Hola Tomás (ref {ref})' },
    cta: { label: 'Agendar demo' },
    pageContext: { page_id: 'automotoras' },
    ...extra,
  };
}

const shadow = (): ShadowRoot => document.querySelector('[data-vitrina-widget]')!.shadowRoot!;
const $ = <T extends Element = HTMLElement>(sel: string): T | null => shadow().querySelector<T>(sel);

describe('backwards compatibility', () => {
  it('a bubble install gets no sidebar stylesheet, attribute or element', () => {
    instance = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false });
    expect(shadow().querySelectorAll('style')).toHaveLength(1);
    expect($('.vtr-root')!.hasAttribute('data-layout')).toBe(false);
    expect($('.vtr-peek')).toBeNull();
    expect($('.vtr-sb-cta')).toBeNull();
  });
});

describe('sidebar chrome', () => {
  it('paints the named assistant with its disclosure, on the cream preset', () => {
    instance = init(tomas());
    const root = $('.vtr-root')!;
    expect(root.getAttribute('data-layout')).toBe('sidebar');
    expect(root.getAttribute('data-preset')).toBe('cream');
    expect($('.vtr-sb-head')!.hasAttribute('data-agent')).toBe(true);
    expect($('.vtr-sb-namerow')!.textContent).toBe('TomásIA');
    expect($('.vtr-sb-role')!.textContent).toBe('Asistente IA de Vitrina');
    // Under 40 px the portrait carries the IA badge.
    expect($('.vtr-launcher .vtr-pt-ia')!.textContent).toBe('IA');
    expect($('.vtr-launcher .vtr-pt')!.getAttribute('aria-label')).toBe('Tomás, asistente IA de Vitrina');
    expect($('.vtr-launcher')!.getAttribute('aria-label')).toBe('Chatear con Tomás, Asistente IA de Vitrina');
    expect($('.vtr-footer-note')!.textContent).toBe('Tomás es una IA y puede equivocarse');
    // The cream preset brings the darkened ember when nothing else is set.
    expect(root.style.getPropertyValue('--vtr-accent')).toBe('#AD4E00');
  });

  it('without a disclosure label there is no named assistant at all', () => {
    instance = init(tomas({ agent: { name: 'Tomás' } }));
    expect($('.vtr-sb-head')!.hasAttribute('data-agent')).toBe(false);
    expect($('.vtr-sb-who')).toBeNull();
  });

  it('chips under the greeting send their message with the page context', async () => {
    instance = init(tomas());
    const events: string[] = [];
    instance.on('chip', (p) => events.push(`chip:${p.index}`));
    instance.open();
    const chips = shadow().querySelectorAll<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip');
    expect(chips).toHaveLength(3);
    chips[0]!.click();
    await flush(10);
    expect(posts[0]).toMatchObject({ message: '¿Cuánto cuesta?', page_context: { page_id: 'automotoras' } });
    expect(posts[0]!.mode).toBeUndefined();
    expect(events).toEqual(['chip:0']);
  });

  it('a demo chip enters demo mode: framing, flagged messages, and an exit', async () => {
    instance = init(tomas());
    const events: string[] = [];
    instance.on('demo_enter', (p) => events.push(`enter:${p.entry}`));
    instance.on('demo_exit', (p) => events.push(`exit:${p.reason}`));
    instance.open();
    shadow().querySelectorAll<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[1]!.click();
    await flush(10);
    expect(posts[0]).toMatchObject({ message: 'Quiero probar', mode: 'demo' });
    expect($('.vtr-panel')!.hasAttribute('data-demo')).toBe(true);
    expect($<HTMLTextAreaElement>('.vtr-input')!.placeholder).toBe('Escribe como cliente…');
    const exit = $<HTMLButtonElement>('.vtr-sb-exit')!;
    expect(exit.hidden).toBe(false);
    exit.click();
    expect($('.vtr-panel')!.hasAttribute('data-demo')).toBe(false);
    expect(events).toEqual(['enter:chip', 'exit:visitor']);
  });

  it('the pinned CTA hands the host a `cta` event when the in-widget agenda is off', () => {
    instance = init(tomas());
    const cta = vi.fn();
    instance.on('cta', cta);
    instance.open();
    $<HTMLButtonElement>('.vtr-sb-cta')!.click();
    shadow().querySelectorAll<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[2]!.click();
    expect(cta.mock.calls.map((c) => c[0].source)).toEqual(['pinned', 'chip']);
  });

  it('the WhatsApp link carries the conversation reference once there is one', async () => {
    instance = init(tomas());
    expect(instance.whatsappUrl()).toBe('https://wa.me/56900000000?text=Hola%20Tom%C3%A1s');
    instance.open();
    await flush(10);
    const url = instance.whatsappUrl()!;
    expect(url).toMatch(/^https:\/\/wa\.me\/56900000000\?text=Hola%20Tom%C3%A1s%20\(ref%20[0-9A-Z]{6}\)$/);
    const handoff = vi.fn();
    instance.on('handoff_whatsapp', handoff);
    const link = $<HTMLAnchorElement>('.vtr-sb-walink a')!;
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(link.href).toBe(url);
    expect(handoff).toHaveBeenCalledWith({ ref: expect.stringMatching(/^[0-9A-Z]{6}$/) });
  });

  it('prefill puts text in the composer without sending', () => {
    instance = init(tomas());
    instance.prefill('Tengo 30 autos');
    expect($<HTMLTextAreaElement>('.vtr-input')!.value).toBe('Tengo 30 autos');
    expect(posts).toHaveLength(0);
  });
});

describe('auto-open', () => {
  it('desktop: opens the panel without stealing focus; a visitor close is a dismiss', async () => {
    document.body.innerHTML = '<input id="page-field">';
    instance = init(tomas({ autoOpen: { enabled: true, delaySeconds: 1 } }));
    const seen: string[] = [];
    instance.on('autoopen', (p) => seen.push(`auto:${p.mode}:${p.device}`));
    instance.on('dismiss', (p) => seen.push(`dismiss:${p.surface}`));
    await pastDelay();
    expect($('.vtr-panel')!.hidden).toBe(false);
    expect(shadow().activeElement).toBeNull();
    $<HTMLButtonElement>('.vtr-close')!.click();
    expect(seen).toEqual(['auto:panel:desktop', 'dismiss:panel']);
    expect(sessionStorage.getItem(`vtr:widget:${PK}:autoopen`)).toBe('dismissed');
  });

  it('mobile: shows the peek card, hides it while a page field has focus, × dismisses it', async () => {
    mockMatchMedia(true);
    document.body.innerHTML = '<input id="page-field">';
    instance = init(tomas({ autoOpen: { enabled: true, delaySeconds: 1 } }));
    await pastDelay();
    const peek = $('.vtr-peek')!;
    expect(peek.hidden).toBe(false);
    expect($('.vtr-panel')!.hidden).toBe(true);
    expect(peek.querySelector('.vtr-peek-g')!.textContent).toBe('¡Hola! Soy Tomás.');
    expect(peek.querySelectorAll('.vtr-sb-chip')).toHaveLength(3);

    (document.getElementById('page-field') as HTMLInputElement).focus();
    await flush(5);
    expect(peek.hidden).toBe(true);
    (document.getElementById('page-field') as HTMLInputElement).blur();
    await flush(5);
    expect(peek.hidden).toBe(false);

    const dismissed = vi.fn();
    instance.on('dismiss', dismissed);
    peek.querySelector<HTMLButtonElement>('.vtr-peek-x')!.click();
    expect(peek.hidden).toBe(true);
    expect(dismissed).toHaveBeenCalledWith({ surface: 'teaser' });
    expect(sessionStorage.getItem(`vtr:widget:${PK}:autoopen`)).toBe('dismissed');
  });

  it('tapping the peek card opens the full panel', async () => {
    mockMatchMedia(true);
    instance = init(tomas({ autoOpen: { enabled: true, delaySeconds: 1 } }));
    await pastDelay();
    $('.vtr-peek')!.click();
    expect($('.vtr-panel')!.hidden).toBe(false);
    expect($('.vtr-peek')!.hidden).toBe(true);
  });
});

describe('anchors and inline', () => {
  it('anchor bottom-bar: the launcher renders into the host slot', () => {
    document.body.innerHTML = '<div data-vtr-bar><span id="slot"></span></div>';
    instance = init(tomas({ anchor: 'bottom-bar', launcherSlot: '#slot' }));
    const slotHost = document.querySelector('#slot [data-vitrina-widget-slot]') as HTMLElement;
    expect(slotHost).not.toBeNull();
    const btn = slotHost.shadowRoot!.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Chatear con Tomás, Asistente IA de Vitrina');
    expect(btn.querySelector('.vtr-pt-ia')).not.toBeNull();
    expect($('.vtr-root')!.hasAttribute('data-slotted')).toBe(true);
    btn.click();
    expect($('.vtr-panel')!.hidden).toBe(false);
  });

  it('inline: the open chat renders inside the container', () => {
    document.body.innerHTML = '<section id="live"></section>';
    instance = init(tomas({ layout: 'inline', container: '#live' }));
    const host = document.querySelector('#live [data-vitrina-widget]');
    expect(host).not.toBeNull();
    expect($('.vtr-root')!.getAttribute('data-layout')).toBe('inline');
    expect($('.vtr-panel')!.hidden).toBe(false);
  });

  it('inline without a container falls back to the sidebar', () => {
    instance = init(tomas({ layout: 'inline', container: '#missing' }));
    expect($('.vtr-root')!.getAttribute('data-layout')).toBe('sidebar');
  });
});

describe('sidebar with a tenant whose bubble uses tabs and booking', () => {
  function serverSays(config: Record<string, unknown>): void {
    const base = fetch as unknown as ReturnType<typeof vi.fn>;
    const inner = base.getMockImplementation()! as (url: string, initArg?: RequestInit) => Promise<Response>;
    base.mockImplementation(async (url: string, initArg?: RequestInit) =>
      new URL(url).pathname.endsWith('/widget/config') ? jsonRes(200, config) : inner(url, initArg),
    );
  }

  it('keeps Home/Help off, the preset ember over the server accent, and `target: host` emits cta', async () => {
    serverSays({
      theme: { accent: '#C15A00' },
      home: { enabled: true, cards: { buy: true } },
      help: { enabled: true, faqs: [{ q: '¿?', a: 'sí' }] },
      bookingEnabled: true,
    });
    instance = init(tomas({ remoteConfig: true, cta: { label: 'Agendar demo', target: 'host' } }));
    await flush(10);
    expect($('.vtr-panel')!.hasAttribute('data-tabs')).toBe(false);
    expect($('.vtr-tabs')).toBeNull();
    expect($('.vtr-root')!.style.getPropertyValue('--vtr-accent')).toBe('#AD4E00');
    const cta = vi.fn();
    instance.on('cta', cta);
    instance.open();
    $<HTMLButtonElement>('.vtr-sb-cta')!.click();
    expect(cta).toHaveBeenCalledWith({ source: 'pinned' });
    expect($('.vtr-panel')!.hasAttribute('data-booking')).toBe(false);
  });
});
