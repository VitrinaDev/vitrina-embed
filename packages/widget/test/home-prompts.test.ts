// The Home prompt cards (0.21.0): «Ver propiedades», «Agendar una visita»,
// «Publicar mi propiedad». Conversation starters, not forms: a tap lands in the
// transcript and sends a fixed, localized visitor message through the
// composer's own send path (honeypot included), so there is one way a visitor
// message leaves the widget.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig, resolveHomePrompts } from '../src/config';
import { init } from '../src/index';
import { coerceRemoteConfig } from '../src/remote-config';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_prompts';

function jsonRes(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
  } as unknown as Response;
}
function emptyRes(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('no body');
    },
  } as unknown as Response;
}

let configData: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  configData = {};
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, configData));
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages') && method === 'POST') {
      return Promise.resolve(
        jsonRes(202, { status: 'accepted', visitorToken: 'vt', conversationExternalId: 'web:a' }),
      );
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    }
    return Promise.resolve(emptyRes(404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
});

function shadow(): ShadowRoot {
  const host = document.querySelector('[data-vitrina-widget]');
  if (!host?.shadowRoot) throw new Error('widget not mounted');
  return host.shadowRoot;
}
function q(sel: string): Element | null {
  return shadow().querySelector(sel);
}
function must<T extends Element = HTMLElement>(sel: string): T {
  const el = q(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
}
function cards(): (string | undefined)[] {
  return Array.from(shadow().querySelectorAll('.vtr-home-card')).map(
    (el) => (el as HTMLElement).dataset.card,
  );
}
async function settled(): Promise<void> {
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length,
    ).toBe(1),
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
function posts(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([u, o]) => String(u).includes('/widget/messages') && (o as RequestInit)?.method === 'POST')
    .map(([, o]) => JSON.parse((o as RequestInit).body as string) as Record<string, unknown>);
}

describe('home.prompts coercion and resolution', () => {
  it('keeps known ids in order and drops unknown ids and repeats', () => {
    expect(resolveHomePrompts(['visit', 'buy', 'properties', 'visit', 3, 'list_property'])).toEqual([
      'visit',
      'properties',
      'list_property',
    ]);
    expect(resolveHomePrompts('properties')).toEqual([]);
    expect(resolveHomePrompts(null)).toEqual([]);
  });

  it('coerces the remote key, and drops it when nothing usable is left', () => {
    expect(
      coerceRemoteConfig({ home: { enabled: true, prompts: ['list_property', 'nope', 'properties'] } })
        ?.home,
    ).toEqual({ enabled: true, prompts: ['list_property', 'properties'] });
    expect(coerceRemoteConfig({ home: { enabled: true, prompts: ['nope'] } })?.home).toEqual({
      enabled: true,
    });
    expect(coerceRemoteConfig({ home: { prompts: {} } })?.home).toBeUndefined();
  });

  it('resolves absent prompts to the old shape, and an inline list wins wholesale', () => {
    const base = { publicKey: PK, apiBaseUrl: BASE };
    expect(resolveConfig(base, { home: { enabled: true } }).home.prompts).toBeUndefined();
    expect(
      resolveConfig(
        { ...base, home: { prompts: ['visit'] } },
        { home: { enabled: true, prompts: ['properties', 'list_property'] } },
      ).home.prompts,
    ).toEqual(['visit']);
  });
});

describe('prompt cards on Home', () => {
  it('paints the three cards after chat/book and before buy/sell/search, with es copy', async () => {
    configData = {
      home: { enabled: true, prompts: ['properties', 'visit', 'list_property'], cards: { buy: true } },
      bookingEnabled: true,
    };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(cards()).toEqual(['chat', 'book', 'properties', 'visit', 'list_property', 'buy']);
    const copy = (kind: string): string[] => [
      must(`.vtr-home-card[data-card="${kind}"] .vtr-home-card-title`).textContent ?? '',
      must(`.vtr-home-card[data-card="${kind}"] .vtr-home-card-sub`).textContent ?? '',
    ];
    expect(copy('properties')).toEqual(['Ver propiedades', 'Te muestro las que calzan con lo que buscas']);
    expect(copy('visit')).toEqual(['Agendar una visita', 'Elige la propiedad y te ofrezco horarios']);
    expect(copy('list_property')).toEqual([
      'Publicar mi propiedad',
      'Cuéntame de tu propiedad y te contactamos',
    ]);
    w.destroy();
  });

  it('follows a config refresh in both directions', async () => {
    globalThis.localStorage.setItem(
      `vtr:widget:${PK}:config`,
      JSON.stringify({ home: { enabled: true, prompts: ['visit'] } }),
    );
    configData = { home: { enabled: true } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    expect(cards()).toContain('visit');
    await vi.waitFor(() => expect(cards()).toEqual(['chat']));
    w.destroy();
  });

  it('a tap opens the conversation and sends the localized message through the composer path', async () => {
    configData = { home: { enabled: true, prompts: ['properties', 'visit', 'list_property'] } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    must<HTMLButtonElement>('.vtr-launcher').click();
    // The honeypot rides along exactly as it does for a typed message: one path.
    must<HTMLInputElement>('.vtr-hp').value = 'trap';

    must<HTMLButtonElement>('.vtr-home-card[data-card="visit"]').click();
    expect(must('.vtr-panel').getAttribute('data-active-view')).toBe('messages');
    await vi.waitFor(() => expect(posts().length).toBe(1));
    expect(posts()[0]).toMatchObject({ message: 'Quiero agendar una visita', hp_website: 'trap' });
    w.destroy();
  });

  it('sends the English message under the en locale', async () => {
    configData = { home: { enabled: true, prompts: ['list_property'] } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'en' });
    await settled();
    must<HTMLButtonElement>('.vtr-launcher').click();
    expect(must('.vtr-home-card[data-card="list_property"] .vtr-home-card-title').textContent).toBe(
      'List my property',
    );
    must<HTMLButtonElement>('.vtr-home-card[data-card="list_property"]').click();
    await vi.waitFor(() => expect(posts().length).toBe(1));
    expect(posts()[0]).toMatchObject({ message: "I'd like to list my property" });
    w.destroy();
  });
});

// 0.22.0 — the store's two (vitrina-app#4419): «Ver productos» and «Estado de
// mi pedido», the same conversation-starter path as the real-estate cards.
describe('store prompt cards on Home', () => {
  it('keeps the store ids through coercion, in server order', () => {
    expect(resolveHomePrompts(['order_status', 'nope', 'products', 'order_status'])).toEqual([
      'order_status',
      'products',
    ]);
    expect(
      coerceRemoteConfig({ home: { enabled: true, prompts: ['products', 'order_status'] } })?.home,
    ).toEqual({ enabled: true, prompts: ['products', 'order_status'] });
  });

  it('paints both cards with es copy and sends each one’s message', async () => {
    configData = { home: { enabled: true, prompts: ['products', 'order_status'] } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(cards()).toEqual(['chat', 'products', 'order_status']);
    expect(must('.vtr-home-card[data-card="products"] .vtr-home-card-title').textContent).toBe(
      'Ver productos',
    );
    expect(must('.vtr-home-card[data-card="order_status"] .vtr-home-card-title').textContent).toBe(
      'Estado de mi pedido',
    );
    must<HTMLButtonElement>('.vtr-launcher').click();
    must<HTMLButtonElement>('.vtr-home-card[data-card="order_status"]').click();
    expect(must('.vtr-panel').getAttribute('data-active-view')).toBe('messages');
    await vi.waitFor(() => expect(posts().length).toBe(1));
    expect(posts()[0]).toMatchObject({ message: '¿Cuál es el estado de mi pedido?' });
    w.destroy();
  });

  it('sends the English product message under the en locale', async () => {
    configData = { home: { enabled: true, prompts: ['products'] } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'en' });
    await settled();
    must<HTMLButtonElement>('.vtr-launcher').click();
    must<HTMLButtonElement>('.vtr-home-card[data-card="products"]').click();
    await vi.waitFor(() => expect(posts().length).toBe(1));
    expect(posts()[0]).toMatchObject({ message: "I'd like to see products" });
    w.destroy();
  });
});
