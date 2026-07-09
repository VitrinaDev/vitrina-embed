import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import type { WidgetMessageDto } from '../src/transport';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';
const TOKEN_KEY = `vtr:widget:${PK}:visitorToken`;

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
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

/** An SSE Response that stays open until the fetch signal aborts. */
function openStreamRes(signal?: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(': connected\n\n'));
      signal?.addEventListener('abort', () => {
        try {
          const err = new Error('aborted');
          err.name = 'AbortError';
          controller.error(err);
        } catch {
          /* already closed */
        }
      });
    },
  });
  return { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response;
}

interface MockState {
  history: WidgetMessageDto[];
  streamSignals: AbortSignal[];
  seq: number;
}

let state: MockState;
let fetchMock: ReturnType<typeof vi.fn>;

function makeInboundFromBody(bodyJson: string): WidgetMessageDto {
  const body = JSON.parse(bodyJson) as { message: string };
  state.seq += 1;
  return {
    id: `srv_${state.seq}`,
    createdAt: new Date(2026, 6, 1, 0, 0, state.seq).toISOString(),
    content: body.message,
    direction: 'inbound',
    type: 'text',
  };
}

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  state = { history: [], streamSignals: [], seq: 0 };
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.endsWith('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages') && method === 'GET') {
      return Promise.resolve(
        jsonRes(200, {
          messages: state.history,
          conversation: state.history.length ? { externalId: 'web:a' } : null,
        }),
      );
    }
    if (u.endsWith('/widget/messages') && method === 'POST') {
      // Simulate persistence: the visitor's own inbound now shows in history.
      state.history = [...state.history, makeInboundFromBody(opts?.body as string)];
      return Promise.resolve(
        jsonRes(202, { status: 'accepted', visitorToken: 'vt_srv', conversationExternalId: 'web:a' }),
      );
    }
    if (u.endsWith('/widget/stream')) {
      const signal = opts?.signal ?? undefined;
      if (signal) state.streamSignals.push(signal);
      return Promise.resolve(openStreamRes(signal ?? undefined));
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

function getHost(): HTMLElement {
  const host = document.querySelector('[data-vitrina-widget]') as HTMLElement | null;
  if (!host) throw new Error('host not mounted');
  return host;
}
function getShadow(): ShadowRoot {
  const sr = getHost().shadowRoot;
  if (!sr) throw new Error('no shadow root');
  return sr;
}

describe('init() mount + shadow isolation', () => {
  it('mounts the launcher INSIDE a shadow root (isolated from host CSS)', () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    // Host page can see the host element but NOT the launcher (it's in the shadow).
    expect(document.querySelector('.vtr-launcher')).toBeNull();
    expect(getShadow().querySelector('.vtr-launcher')).not.toBeNull();
    w.destroy();
  });

  it('throws on missing config (frozen contract)', () => {
    expect(() => init({ publicKey: '', apiBaseUrl: BASE })).toThrow();
  });

  it('open()/close() toggle the panel visibility', () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    const panel = getShadow().querySelector('.vtr-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);
    w.open();
    expect(panel.hidden).toBe(false);
    w.close();
    expect(panel.hidden).toBe(true);
    w.destroy();
  });

  it('honors theme position and accent', () => {
    const w = init({
      publicKey: PK,
      apiBaseUrl: BASE,
      theme: { position: 'bl', accent: '#ff0000' },
    });
    const root = getShadow().querySelector('.vtr-root') as HTMLElement;
    expect(root.getAttribute('data-pos')).toBe('bl');
    expect(root.style.getPropertyValue('--vtr-accent')).toBe('#ff0000');
    w.destroy();
  });

  it('falls back to the default accent on an injection attempt', () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, theme: { accent: 'red; evil' } });
    const root = getShadow().querySelector('.vtr-root') as HTMLElement;
    expect(root.style.getPropertyValue('--vtr-accent')).not.toContain('evil');
    w.destroy();
  });
});

describe('init() send flow', () => {
  it('sends a message with an empty honeypot and renders server truth', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    const shadow = getShadow();
    const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
    const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;
    input.value = 'hola mundo';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    // The POST fired with a pure snake_case body + empty honeypot.
    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, o]) => String(u).endsWith('/widget/messages') && (o as RequestInit)?.method === 'POST',
      );
      expect(post).toBeTruthy();
    });
    const post = fetchMock.mock.calls.find(
      ([u, o]) => String(u).endsWith('/widget/messages') && (o as RequestInit)?.method === 'POST',
    )!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.message).toBe('hola mundo');
    expect(body.hp_website).toBe('');
    expect(body.client_message_id).toBeTruthy();
    expect(Object.keys(body)).not.toContain('clientMessageId');

    // Server truth rendered (via textContent) after the post-send refetch.
    await vi.waitFor(() => {
      const bubbles = shadow.querySelectorAll('.vtr-msg[data-dir="inbound"]:not([data-optimistic])');
      expect(bubbles.length).toBe(1);
      expect(bubbles[0].textContent).toBe('hola mundo');
    });
    w.destroy();
  });

  it('renders message content as TEXT, never HTML (XSS-safe)', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    const shadow = getShadow();
    const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
    const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;
    input.value = payload;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.waitFor(() => {
      const bubble = shadow.querySelector('.vtr-msg[data-dir="inbound"]:not([data-optimistic])');
      expect(bubble?.textContent).toBe(payload);
    });
    // The injected <img> was NOT parsed into a real element anywhere in the shadow.
    expect(shadow.querySelector('img')).toBeNull();
    w.destroy();
  });
});

describe('init() resume + setVehicle + destroy', () => {
  it('resumes with an existing token from localStorage', async () => {
    globalThis.localStorage.setItem(TOKEN_KEY, 'vt_seed');
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    // The bootstrap POST presented the seeded token (session resume, not fresh).
    await vi.waitFor(() => {
      const boot = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/widget/conversations'));
      expect(boot).toBeTruthy();
      const headers = (boot![1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-Vitrina-Visitor']).toBe('vt_seed');
    });
    w.destroy();
  });

  it('setVehicle(id) attaches the vehicle to the next send', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    w.setVehicle('veh_42');
    const shadow = getShadow();
    const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
    const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;
    input.value = 'quiero este auto';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, o]) => String(u).endsWith('/widget/messages') && (o as RequestInit)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.vehicle_id).toBe('veh_42');
    });
    w.destroy();
  });

  it('destroy() removes the host and aborts the SSE stream', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    // Let the stream connect so there is a signal to abort.
    await vi.waitFor(() => expect(state.streamSignals.length).toBeGreaterThan(0));
    expect(document.querySelector('[data-vitrina-widget]')).not.toBeNull();

    w.destroy();

    expect(document.querySelector('[data-vitrina-widget]')).toBeNull();
    expect(state.streamSignals.every((s) => s.aborted)).toBe(true);
  });

  it('degrades gracefully (no throw) when bootstrap 401/403s repeatedly', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith('/widget/conversations')) return Promise.resolve(emptyRes(403));
      return Promise.resolve(emptyRes(403));
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    // open + send must not throw even though every call 403s.
    expect(() => w.open()).not.toThrow();
    const shadow = getShadow();
    const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
    const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;
    input.value = 'hi';
    expect(() => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))).not.toThrow();
    await vi.waitFor(() => {
      const banner = shadow.querySelector('.vtr-banner') as HTMLElement;
      expect(banner.hidden).toBe(false);
    });
    w.destroy();
  });
});
