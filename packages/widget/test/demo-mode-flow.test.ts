// Demo mode inside the widget (D60, app#4144): the frame, the tint that stays
// with the demo's own messages, the exits (button, product question, 12 turns,
// idle), the typed invitation, and a 429 showing the server's own words.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import type { WidgetConfig, WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_demo';

function jsonRes(status: number, data: unknown, error?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (error ? { error } : { data }),
  } as unknown as Response;
}

let posts: Array<Record<string, unknown>>;
let history: Array<Record<string, unknown>>;
let postStatus: { status: number; error?: unknown };
let instance: WidgetInstance | null;

beforeEach(() => {
  posts = [];
  history = [];
  postStatus = { status: 202 };
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
    vi.fn(async (url: string, initArg: RequestInit = {}) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      const method = (initArg.method ?? 'GET').toUpperCase();
      if (path === '/widget/config') return jsonRes(200, {});
      if (path === '/widget/conversations') {
        return jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:conv-1', expiresAt: '2030-01-01T00:00:00Z' });
      }
      if (path === '/widget/messages' && method === 'POST') {
        posts.push(JSON.parse(String(initArg.body)));
        if (postStatus.status !== 202) return jsonRes(postStatus.status, null, postStatus.error);
        return jsonRes(202, { status: 'accepted', visitorToken: 'vt', conversationExternalId: 'web:conv-1' });
      }
      if (path === '/widget/messages') return jsonRes(200, { messages: history, conversation: { externalId: 'web:conv-1' } });
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

function tomas(extra: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    publicKey: PK,
    apiBaseUrl: BASE,
    remoteConfig: false,
    layout: 'sidebar',
    preset: 'cream',
    welcomeMessage: '¡Hola! Soy Tomás.',
    agent: { name: 'Tomás', label: 'Asistente IA de Vitrina' },
    chips: [{ label: 'Pruébalo', action: 'demo', message: 'Quiero probar como cliente' }],
    cta: { label: 'Agendar demo' },
    pageContext: { page_id: 'automotoras', vertical: 'automotora' },
    demoWorld: 'Automotora Demo',
    ...extra,
  };
}

const shadow = (): ShadowRoot => document.querySelector('[data-vitrina-widget]')!.shadowRoot!;
const $ = <T extends Element = HTMLElement>(sel: string): T | null => shadow().querySelector<T>(sel);
const lines = (): string[] => [...shadow().querySelectorAll('.vtr-system')].map((n) => n.textContent ?? '');

async function say(text: string): Promise<void> {
  const input = $<HTMLTextAreaElement>('.vtr-input')!;
  input.value = text;
  $<HTMLElement>('.vtr-sendbtn')!.click();
  await flush(15);
}

describe('entering demo mode', () => {
  it('shows the framing line first, names the world, and tells the server which one', async () => {
    instance = init(tomas());
    const events: unknown[] = [];
    instance.on('demo_enter', (p) => events.push(p));
    instance.open();
    shadow().querySelector<HTMLButtonElement>('.vtr-sb-chips .vtr-sb-chip')!.click();
    await flush(15);
    expect(lines()[0]).toBe(
      'Voy a responder como el asistente de Automotora Demo, una automotora ficticia con autos de ejemplo. Escríbeme como si fueras un cliente. Para volver, toca «Salir del modo demo».',
    );
    expect(events).toEqual([{ entry: 'chip', world: 'automotora' }]);
    expect(posts[0]).toMatchObject({ mode: 'demo', demo_world: 'automotora' });
    expect(String(posts[0]!.demo_session)).toMatch(/^ds_/);
    expect($('.vtr-pill')!.textContent).toBe('Modo demo');
  });

  it('a clinic page frames a patient, and asks for no real health data', async () => {
    instance = init(tomas({ demoWorld: 'Clínica Demo' }));
    instance.open();
    instance.enterDemo();
    expect(lines()[0]).toContain('una clínica ficticia');
    expect(lines()[0]).toContain('No escribas datos reales de salud');
    expect($<HTMLTextAreaElement>('.vtr-input')!.placeholder).toBe('Escribe como paciente…');
  });

  it('keeps the greeting above the frame when nothing was said yet', () => {
    instance = init(tomas());
    instance.open();
    instance.enterDemo();
    expect($('[data-welcome]')).not.toBeNull();
    expect(lines()).toHaveLength(1);
  });

  it('one session id per stay: leaving and coming back mints a new one', async () => {
    instance = init(tomas());
    instance.open();
    instance.enterDemo();
    await say('hola');
    instance.exitDemo();
    instance.enterDemo();
    await say('hola otra vez');
    expect(posts[0]!.demo_session).not.toBe(posts[1]!.demo_session);
  });
});

describe('what stays tinted', () => {
  it('only the messages the server marks demo (and the local echoes sent in demo), not Tomás', async () => {
    history = [
      { id: 'h1', createdAt: '2026-10-11T10:00:00.000Z', content: 'Soy Tomás', direction: 'outbound', type: 'text' },
      { id: 'd1', createdAt: '2026-10-11T10:01:00.000Z', content: 'Tengo una RAV4', direction: 'outbound', type: 'text', mode: 'demo' },
    ];
    instance = init(tomas());
    instance.open();
    await flush(30);
    const bubbles = [...shadow().querySelectorAll<HTMLElement>('.vtr-msg')].filter((b) => b.dataset.id);
    const byId = Object.fromEntries(bubbles.map((b) => [b.dataset.id, b]));
    expect(byId.h1!.getAttribute('data-mode')).toBeNull();
    expect(byId.d1!.getAttribute('data-mode')).toBe('demo');
    // the demo business's reply carries its own «Demo» tag, Tomás's does not
    expect(byId.d1!.querySelector('.vtr-msg-tag')!.textContent).toBe('Demo');
    expect(byId.h1!.querySelector('.vtr-msg-tag')).toBeNull();
  });
});

describe('leaving demo mode', () => {
  async function inDemo(): Promise<void> {
    instance = init(tomas());
    instance.open();
    instance.enterDemo();
    await flush(5);
  }

  it('the button leaves with the exit line, an offer, and a way back', async () => {
    await inDemo();
    const events: unknown[] = [];
    instance!.on('demo_exit', (p) => events.push(p));
    await say('busco una SUV');
    $<HTMLButtonElement>('.vtr-sb-exit')!.click();
    expect(events).toEqual([{ reason: 'visitor', turns: 1 }]);
    const exit = lines().slice(-1)[0]!;
    expect(exit).toContain('Volví a ser Tomás.');
    expect(exit).toContain('con tus autos reales');
    expect(exit).toContain('demo de 30 minutos');
    expect($('.vtr-system-btn')!.textContent).toBe('Seguir probando');
  });

  it('«Seguir probando» goes back in with a fresh frame', async () => {
    await inDemo();
    $<HTMLButtonElement>('.vtr-sb-exit')!.click();
    $<HTMLButtonElement>('.vtr-system-btn')!.click();
    expect($('.vtr-panel')!.hasAttribute('data-demo')).toBe(true);
    expect(lines().filter((l) => l.startsWith('Voy a responder como')).length).toBe(2);
    expect(lines().some((l) => l.startsWith('Volví a ser'))).toBe(false);
  });

  it('a question about the product leaves first and then goes to Tomás as a normal message', async () => {
    await inDemo();
    const exits: unknown[] = [];
    instance!.on('demo_exit', (p) => exits.push(p));
    await say('¿y esto cuánto cuesta?');
    expect(lines().slice(-1)[0]).toBe('Salgo del modo demo para responderte como Tomás.');
    expect(exits).toEqual([{ reason: 'product', turns: 0 }]);
    expect(posts[0]!.mode).toBeUndefined();
    expect(posts[0]!.message).toBe('¿y esto cuánto cuesta?');
  });

  it('a customer question about a car stays in the demo', async () => {
    await inDemo();
    await say('¿cuánto cuesta la RAV4?');
    expect(posts[0]).toMatchObject({ mode: 'demo' });
    expect($('.vtr-panel')!.hasAttribute('data-demo')).toBe(true);
  });

  it('the 13th message leaves (12 turns), counts them, and is sent as Tomás', async () => {
    await inDemo();
    const events: Array<{ turns: number }> = [];
    const exits: unknown[] = [];
    instance!.on('demo_turn', (p) => events.push(p));
    instance!.on('demo_exit', (p) => exits.push(p));
    for (let i = 1; i <= 12; i += 1) await say(`mensaje ${i}`);
    expect(events.map((e) => e.turns)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(posts.every((p) => p.mode === 'demo')).toBe(true);
    await say('uno más');
    expect(exits).toEqual([{ reason: 'turns', turns: 12 }]);
    expect(lines().slice(-1)[0]).toContain('Se acabaron los 12 mensajes del modo demo.');
    expect(posts.slice(-1)[0]!.mode).toBeUndefined();
  });

  it('ten idle minutes leave on their own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    instance = init(tomas());
    instance.open();
    instance.enterDemo();
    const exits: unknown[] = [];
    instance!.on('demo_exit', (p) => exits.push(p));
    vi.advanceTimersByTime(9 * 60_000);
    expect(exits).toEqual([]);
    vi.advanceTimersByTime(61_000);
    expect(exits).toEqual([{ reason: 'idle', turns: 0 }]);
    expect(lines().slice(-1)[0]).toContain('Salí del modo demo por inactividad.');
  });
});

describe('typed invitation', () => {
  it('«quiero probar» asks before entering, and does not send yet', async () => {
    instance = init(tomas());
    instance.open();
    await say('quiero probar');
    expect(posts).toHaveLength(0);
    expect(lines().slice(-1)[0]).toContain('¿Entro en modo demo?');
    const buttons = [...shadow().querySelectorAll<HTMLButtonElement>('.vtr-system-btn')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Sí, entrar al modo demo', 'No, seguir con Tomás']);
  });

  it('yes enters (entry: typed); no sends the original text to Tomás', async () => {
    instance = init(tomas());
    const entries: unknown[] = [];
    instance.on('demo_enter', (p) => entries.push(p));
    instance.open();
    await say('quiero probar');
    shadow().querySelector<HTMLButtonElement>('[data-notice-action="demo_yes"]')!.click();
    expect(entries).toEqual([{ entry: 'typed', world: 'automotora' }]);

    instance.exitDemo();
    posts.length = 0;
    await say('quiero probar');
    shadow().querySelector<HTMLButtonElement>('[data-notice-action="demo_no"]')!.click();
    await flush(15);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ message: 'quiero probar' });
    expect(posts[0]!.mode).toBeUndefined();
  });

  it('is off where there is no demo world (home, otros rubros)', async () => {
    instance = init(tomas({ demoWorld: undefined }));
    instance.open();
    await say('quiero probar');
    expect(posts).toHaveLength(1);
  });
});

describe('a 429 shows the server words', () => {
  it('writes error.message in the transcript, keeps the message retryable, one line at a time', async () => {
    postStatus = {
      status: 429,
      error: { message: 'Estás escribiendo muy rápido. Espera unos segundos y vuelve a intentarlo.' },
    };
    instance = init(tomas());
    instance.open();
    await say('hola');
    expect(lines()).toEqual(['Estás escribiendo muy rápido. Espera unos segundos y vuelve a intentarlo.']);
    expect($('[data-status="failed"]')).not.toBeNull();
    await say('otra vez');
    expect(lines()).toHaveLength(1);
  });

  it('a 429 without a usable body is just a failed message, as before', async () => {
    postStatus = { status: 429, error: { message: 42 } };
    instance = init(tomas());
    instance.open();
    await say('hola');
    expect(lines()).toEqual([]);
    expect($('[data-status="failed"]')).not.toBeNull();
  });

  it('other failures stay generic', async () => {
    postStatus = { status: 500, error: { message: 'boom internals' } };
    instance = init(tomas());
    instance.open();
    await say('hola');
    expect(lines()).toEqual([]);
  });
});
