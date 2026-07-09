// W6-review gap: the anti-spam HONEYPOT.
//
// Two guarantees the review flagged as untested:
//   (a) the widget RENDERS a hidden `hp_website` field that is VISUALLY hidden
//       (off-screen) and NOT `display:none` — bots skip display:none inputs, so
//       hiding that way would defeat the trap;
//   (b) the transport ALWAYS includes `hp_website` in POST /widget/messages —
//       empty for a real human, and (crucially) it round-trips a value a bot
//       would fill, so the server can reject it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { STYLES } from '../src/styles';
import { VitrinaTransport } from '../src/transport';
import type { TokenStore } from '../src/token-store';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.endsWith('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages') && method === 'GET') {
      return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    }
    if (u.endsWith('/widget/messages') && method === 'POST') {
      return Promise.resolve(
        jsonRes(202, { status: 'accepted', visitorToken: 'vt_srv', conversationExternalId: 'web:a' }),
      );
    }
    if (u.endsWith('/widget/stream')) {
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
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

function getShadow(): ShadowRoot {
  const host = document.querySelector('[data-vitrina-widget]') as HTMLElement | null;
  if (!host?.shadowRoot) throw new Error('host/shadow not mounted');
  return host.shadowRoot;
}

describe('honeypot field rendering', () => {
  it('renders a hidden hp_website input inside the composer (name + a11y opt-out)', () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    const shadow = getShadow();
    const hp = shadow.querySelector('.vtr-hp') as HTMLInputElement | null;
    expect(hp).not.toBeNull();
    // Submitted field name the server reads.
    expect(hp!.name).toBe('hp_website');
    // Kept out of a real human's reach: not tab-focusable, not autocompleted,
    // hidden from assistive tech.
    expect(hp!.tabIndex).toBe(-1);
    expect(hp!.getAttribute('autocomplete')).toBe('off');
    expect(hp!.getAttribute('aria-hidden')).toBe('true');
    // It lives in the composer form so it is submitted with the message.
    expect(hp!.parentElement?.classList.contains('vtr-composer')).toBe(true);
    w.destroy();
  });

  it('hides the honeypot VISUALLY (off-screen) and NEVER via display:none', () => {
    // Extract the `.vtr-hp { ... }` rule from the injected stylesheet.
    const match = STYLES.match(/\.vtr-hp\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const rule = match![1];
    // Off-screen positioning is the hiding mechanism.
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/left:\s*-9999px/);
    // display:none would let bots skip the field — it must NOT be used.
    expect(rule).not.toMatch(/display:\s*none/);
  });
});

describe('honeypot always submitted', () => {
  it('sends hp_website="" for a human who never touches it', () => {
    const store: TokenStore = {
      get: () => 'vt_1',
      set: () => {},
      clear: () => {},
    };
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    return t.send({ message: 'hola' }).then(() => {
      const post = fetchMock.mock.calls.find(
        ([u, o]) => String(u).endsWith('/widget/messages') && (o as RequestInit)?.method === 'POST',
      )!;
      const body = JSON.parse((post[1] as RequestInit).body as string);
      expect(body).toHaveProperty('hp_website', '');
    });
  });

  it('round-trips a bot-filled honeypot value through the POST body (spam signal)', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    const shadow = getShadow();
    const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
    const hp = shadow.querySelector('.vtr-hp') as HTMLInputElement;
    const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;

    // A bot fills BOTH the visible message and the hidden trap.
    input.value = 'cheap watches';
    hp.value = 'http://spam.example';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

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
    // The trap value reaches the server verbatim so it can be rejected there.
    expect(body.hp_website).toBe('http://spam.example');
    expect(body.message).toBe('cheap watches');
    w.destroy();
  });
});
