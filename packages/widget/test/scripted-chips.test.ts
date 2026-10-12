// 0.18.0 — scripted chips (a local answer tree, no server call), typingOnSend
// (dots from the send until a reply lands) and the sidetab launcher.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AWAIT_GIVE_UP_MS, AWAIT_SLOW_MS, SCRIPT_BEAT_MAX_MS, init } from '../src/index';
import { MAX_CHIP_DEPTH, chipAt, resolveChips, resolveSidebar } from '../src/sidebar-config';
import type { WidgetChipConfig, WidgetConfig, WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_scripted';

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

function controllableStream(signal?: AbortSignal): { res: Response; emit: (frame: string) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(new TextEncoder().encode(': connected\n\n'));
      signal?.addEventListener('abort', () => {
        try {
          const err = new Error('aborted');
          err.name = 'AbortError';
          controller.error(err);
        } catch {
          /* closed */
        }
      });
    },
  });
  return {
    res: { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response,
    emit: (frame) => {
      try {
        controller.enqueue(new TextEncoder().encode(frame));
      } catch {
        /* closed */
      }
    },
  };
}

interface Row {
  id: string;
  createdAt: string;
  content: string;
  direction: 'inbound' | 'outbound';
  type: string | null;
  clientMessageId?: string;
}

let posts: Array<Record<string, unknown>>;
let history: Row[];
let emitSse: ((frame: string) => void) | null;
let instance: WidgetInstance | null;
let seq: number;

beforeEach(() => {
  posts = [];
  history = [];
  emitSse = null;
  instance = null;
  seq = 0;
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
      const path = new URL(url).pathname.replace('/api/v1', '');
      const method = (initArg.method ?? 'GET').toUpperCase();
      if (path === '/widget/config') return jsonRes(200, {});
      if (path === '/widget/conversations') {
        return jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:conv-1', expiresAt: '2030-01-01T00:00:00Z' });
      }
      if (path === '/widget/messages' && method === 'POST') {
        const body = JSON.parse(String(initArg.body)) as Record<string, unknown>;
        posts.push(body);
        seq += 1;
        history.push({
          id: `in_${seq}`,
          createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, seq)).toISOString(),
          content: String(body.message),
          direction: 'inbound',
          type: 'text',
          clientMessageId: body.client_message_id as string,
        });
        return jsonRes(202, { status: 'accepted', visitorToken: 'vt', conversationExternalId: 'web:conv-1' });
      }
      if (path === '/widget/messages') return jsonRes(200, { messages: history, conversation: null });
      if (path === '/widget/stream') {
        const { res, emit } = controllableStream(initArg.signal ?? undefined);
        emitSse = emit;
        return res;
      }
      return new Promise<Response>(() => {});
    }),
  );
});

afterEach(() => {
  instance?.destroy();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = async (ms = 0): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};

const TREE: WidgetChipConfig[] = [
  {
    label: '¿Cuánto cuesta?',
    reply: 'El software es gratis. Pagas 0,012 UF por cliente atendido.',
    next: [
      {
        label: '¿Qué es un cliente atendido?',
        reply: 'Una persona que te escribe y recibe respuesta en el mes.',
        next: [{ label: 'Agendar demo', action: 'booking' }, { label: 'Preguntarle a Tomás', action: 'compose' }],
      },
      { label: 'Agendar demo', action: 'booking' },
    ],
  },
  { label: '¿Funciona con mi sistema?' },
];

function tomas(extra: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    publicKey: PK,
    apiBaseUrl: BASE,
    remoteConfig: false,
    layout: 'sidebar',
    preset: 'cream',
    welcomeMessage: '¡Hola! Soy Tomás.',
    agent: { name: 'Tomás', label: 'Asistente IA de Vitrina', status: 'Responde al instante' },
    chips: TREE,
    cta: { label: 'Agendar demo', target: 'host' },
    pageContext: { page_id: 'home' },
    ...extra,
  };
}

const shadow = (): ShadowRoot => document.querySelector('[data-vitrina-widget]')!.shadowRoot!;
const $ = <T extends Element = HTMLElement>(sel: string): T | null => shadow().querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string): T[] => Array.from(shadow().querySelectorAll<T>(sel));
const lines = (): string[] => $$('.vtr-msg').map((m) => `${m.getAttribute('data-dir')}:${m.textContent}`);
const typingShown = (): boolean => !$('.vtr-typing')!.hidden;

describe('scripted chip config', () => {
  it('keeps reply/next, allows 3 scripted replies in a row, and drops a link without a valid url', () => {
    const deep: WidgetChipConfig[] = [
      {
        label: 'a',
        reply: 'A',
        next: [{ label: 'b', reply: 'B', next: [{ label: 'c', reply: 'C', next: [{ label: 'd', reply: 'D', next: [{ label: 'e' }] }] }] }],
      },
      { label: 'bad link', action: 'link', url: 'javascript:alert(1)' },
      { label: 'good link', action: 'link', url: 'https://www.vitrinadev.com/precios' },
      { label: 'demo with reply', action: 'demo', reply: 'ignored' },
    ];
    const r = resolveChips(deep);
    expect(MAX_CHIP_DEPTH).toBe(3);
    expect(r.map((c) => c.label)).toEqual(['a', 'good link', 'demo with reply']);
    expect(chipAt(r, '0.0.0')?.reply).toBe('C');
    // Under the third reply the chip stays, but it goes to the assistant.
    expect(chipAt(r, '0.0.0.0')).toEqual({ label: 'd', message: 'd', action: 'message' });
    expect(chipAt(r, '1')?.url).toBe('https://www.vitrinadev.com/precios');
    expect(chipAt(r, '2')?.reply).toBeUndefined();
    expect(chipAt(r, '9')).toBeNull();
    expect(chipAt(r, 'x')).toBeNull();
  });

  it('plain chips resolve exactly as before', () => {
    expect(resolveSidebar({ chips: [{ label: 'Hola' }] }, null).chips).toEqual([
      { label: 'Hola', message: 'Hola', action: 'message' },
    ]);
  });
});

describe('scripted chips in the panel', () => {
  it('answers locally after a typing beat, with the next chips, and never posts', async () => {
    instance = init(tomas());
    const events: string[] = [];
    instance.on('chip', (p) => events.push(`${p.path}:${p.scripted}`));
    instance.open();
    await flush();
    $$<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[0]!.click();
    await flush();
    expect(lines()).toEqual(['inbound:¿Cuánto cuesta?']);
    expect(typingShown()).toBe(true);
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    expect(typingShown()).toBe(false);
    expect(lines()).toEqual([
      'inbound:¿Cuánto cuesta?',
      'outbound:El software es gratis. Pagas 0,012 UF por cliente atendido.',
    ]);
    const next = $$<HTMLButtonElement>('.vtr-sb-chips-reply .vtr-sb-chip');
    expect(next.map((b) => b.textContent)).toEqual(['¿Qué es un cliente atendido?', 'Agendar demo']);

    // Second level.
    next[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    expect(lines()).toHaveLength(4);
    // Only the LAST reply carries chips.
    expect($$('.vtr-sb-chips-reply')).toHaveLength(1);
    expect($$<HTMLButtonElement>('.vtr-sb-chips-reply .vtr-sb-chip').map((b) => b.textContent)).toEqual([
      'Agendar demo',
      'Preguntarle a Tomás',
    ]);
    expect(posts).toHaveLength(0);
    expect(events).toEqual(['0:true', '0.0:true']);
  });

  it('a booking chip in the tree hands off to the host (cta), a compose chip focuses the composer', async () => {
    instance = init(tomas());
    const cta = vi.fn();
    instance.on('cta', cta);
    instance.open();
    await flush();
    $$<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    $$<HTMLButtonElement>('.vtr-sb-chips-reply .vtr-sb-chip')[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    const [book, ask] = $$<HTMLButtonElement>('.vtr-sb-chips-reply .vtr-sb-chip');
    book!.click();
    expect(cta).toHaveBeenCalledWith({ source: 'chip' });
    ask!.click();
    expect(shadow().activeElement?.tagName).toBe('TEXTAREA');
    expect(posts).toHaveLength(0);
  });

  it('the next typed message carries the scripted taps as chips_seen page context', async () => {
    instance = init(tomas());
    instance.open();
    await flush();
    $$<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    $$<HTMLButtonElement>('.vtr-sb-chips-reply .vtr-sb-chip')[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    await instance.send('¿Y si tengo 3 sucursales?');
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.message).toBe('¿Y si tengo 3 sucursales?');
    expect(posts[0]!.page_context).toEqual({
      page_id: 'home',
      chips_seen: '¿Cuánto cuesta? › ¿Qué es un cliente atendido?',
    });
    // The local exchange stays on screen above the server's rows.
    await flush();
    expect(lines().slice(0, 4).map((l) => l.split(':')[0])).toEqual(['inbound', 'outbound', 'inbound', 'outbound']);
    expect(lines()).toContain('inbound:¿Y si tengo 3 sucursales?');
  });

  it('a chip without a reply still goes to the assistant, with no chips_seen when nothing was scripted', async () => {
    instance = init(tomas());
    instance.open();
    await flush();
    $$<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[1]!.click();
    await flush();
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.message).toBe('¿Funciona con mi sistema?');
    expect(posts[0]!.page_context).toEqual({ page_id: 'home' });
  });

  it('cuts a long trail from the left to 80 chars', async () => {
    const long = 'x'.repeat(55);
    instance = init(
      tomas({
        chips: [{ label: long, reply: 'r', next: [{ label: `y${long}`, reply: 'r2' }] }],
      }),
    );
    instance.open();
    await flush();
    $$<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    $$<HTMLButtonElement>('.vtr-sb-chips-reply .vtr-sb-chip')[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    await instance.send('hola');
    await flush();
    const trail = (posts[0]!.page_context as Record<string, string>).chips_seen!;
    expect(trail.length).toBe(80);
    expect(trail.startsWith('…')).toBe(true);
    expect(trail.endsWith(`y${long}`)).toBe(true);
  });
});

describe('typingOnSend', () => {
  it('off by default: no dots after a send', async () => {
    instance = init(tomas());
    instance.open();
    await flush();
    await instance.send('hola');
    await flush();
    expect(posts).toHaveLength(1);
    expect(typingShown()).toBe(false);
  });

  it('dots from the accepted send, «Sigue escribiendo…» after 12 s, gone at 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    instance = init(tomas({ typingOnSend: true }));
    instance.open();
    await vi.advanceTimersByTimeAsync(0);
    await instance.send('hola');
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toHaveLength(1);
    expect(typingShown()).toBe(true);
    expect($('.vtr-typing-note')).toBeNull();
    // The server's 6 s typing event does not cut the wait short.
    emitSse?.('event: agent.typing\nid: 2030-01-01T00:00:01.000Z\ndata: {"ttlMs":6000}\n\n');
    await vi.advanceTimersByTimeAsync(7_000);
    expect(typingShown()).toBe(true);
    await vi.advanceTimersByTimeAsync(AWAIT_SLOW_MS - 7_000);
    expect($('.vtr-typing-note')?.textContent).toBe('Sigue escribiendo…');
    expect($('.vtr-typing-note')?.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(AWAIT_GIVE_UP_MS - AWAIT_SLOW_MS);
    expect(typingShown()).toBe(false);
  });

  it('the dots go away the moment the reply lands', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    instance = init(tomas({ typingOnSend: true }));
    instance.open();
    await vi.advanceTimersByTimeAsync(0);
    await instance.send('hola');
    await vi.advanceTimersByTimeAsync(0);
    expect(typingShown()).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    const at = new Date(Date.UTC(2030, 0, 1, 0, 1, 0)).toISOString();
    history.push({ id: 'out_1', createdAt: at, content: 'Hola, ¿en qué te ayudo?', direction: 'outbound', type: 'text' });
    emitSse!(`event: message.created\nid: ${at}\ndata: {}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toContain('outbound:Hola, ¿en qué te ayudo?');
    expect(typingShown()).toBe(false);
    expect($('.vtr-typing-note')?.hidden ?? true).toBe(true);
  });
});

describe('launcherStyle: sidetab', () => {
  it('portrait + chat icon, no IA badge and no visible text; aria-label keeps the AI disclosure', () => {
    instance = init(tomas({ launcherStyle: 'sidetab' }));
    const l = $<HTMLButtonElement>('.vtr-launcher.vtr-sb-tab.vtr-sb-sidetab')!;
    expect(l).not.toBeNull();
    expect($('.vtr-root')!.getAttribute('data-launcher')).toBe('sidetab');
    expect(l.querySelector('.vtr-pt-face')).not.toBeNull();
    expect(l.querySelector('.vtr-pt-on')).not.toBeNull();
    expect(l.querySelector('.vtr-sbtab-chat svg')).not.toBeNull();
    expect(l.querySelector('.vtr-pt-ia')).toBeNull();
    expect(l.querySelector('.vtr-sbtab-label')).toBeNull();
    expect(l.querySelector('.vtr-sbtab-tip')?.textContent).toBe('Pregúntale a Tomás');
    expect(l.getAttribute('aria-label')).toContain('Asistente IA de Vitrina');
    l.click();
    expect($('.vtr-panel')!.hasAttribute('hidden')).toBe(false);
    // The disclosure stays in the sheet header.
    expect($('.vtr-sb-namerow')?.textContent).toContain('IA');
    expect($('.vtr-sb-head')?.textContent).toContain('Asistente IA de Vitrina');
  });

  it('is opt-in: resolve accepts sidetab, the default stays tab', () => {
    expect(resolveSidebar({ launcherStyle: 'sidetab' }, null).launcherStyle).toBe('sidetab');
    expect(resolveSidebar({}, null).launcherStyle).toBe('tab');
  });

  it('has its own reduced-motion rule and a right-centre position', () => {
    instance = init(tomas({ launcherStyle: 'sidetab' }));
    const css = Array.from(shadow().querySelectorAll('style')).map((s) => s.textContent).join('\n');
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*vtr-sb-sidetab/);
    expect(css).toContain('.vtr-sb-sidetab:focus-visible');
  });
});

describe('auto-open requireScroll in the browser', () => {
  it('stays shut on the first screen and opens a beat after a real page scroll', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
    instance = init(tomas({ autoOpen: { enabled: true, delaySeconds: 1, requireScroll: true } }));
    await flush(Math.max(0, 1_000 - performance.now()) + 1_500);
    expect($('.vtr-panel')!.hasAttribute('hidden')).toBe(true);
    (window as unknown as { scrollY: number }).scrollY = 900;
    window.dispatchEvent(new Event('scroll'));
    await flush(1_400);
    expect($('.vtr-panel')!.hasAttribute('hidden')).toBe(false);
  });
});

describe('link chips', () => {
  it('close the panel and navigate, without posting', async () => {
    instance = init(
      tomas({
        chips: [{ label: 'Precio', reply: 'Gratis.', next: [{ label: 'Calculadora', action: 'link', url: 'https://example.com/precios#calculadora' }] }],
      }),
    );
    const events: string[] = [];
    instance.on('chip', (p) => events.push(`${p.path}:${p.action}`));
    instance.open();
    await flush();
    $$<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')[0]!.click();
    await flush(SCRIPT_BEAT_MAX_MS + 50);
    $$<HTMLButtonElement>('.vtr-sb-chips-reply .vtr-sb-chip')[0]!.click();
    expect($('.vtr-panel')!.hasAttribute('hidden')).toBe(true);
    expect(events).toEqual(['0:message', '0.0:link']);
    expect(posts).toHaveLength(0);
  });
});
