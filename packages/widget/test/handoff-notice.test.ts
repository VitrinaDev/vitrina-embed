// X4 — the visitor is told once when a person joins.
//
// A single centered line: "Un asesor se unió a la conversación". It names
// nobody. A workspace member's name must never reach an anonymous browser on a
// third-party origin — adding an opt-in operator name later is easy, and
// un-leaking one that has already been broadcast is not a change one can make.
//
// The line is a LIVE event, not a persisted row. It does not replay on reload,
// deliberately: persisting it would require relaxing the filter that drops
// system-authored rows from the browser-safe DTO, inverting that strict
// allowlist from opt-in to opt-out (ADR 0035 ¶2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

interface Row {
  id: string;
  createdAt: string;
  content: string;
  direction: 'inbound' | 'outbound';
  type: string | null;
}

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

function controllableStream(signal?: AbortSignal): { res: Response; emit: (f: string) => void } {
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
    emit: (f) => {
      try {
        controller.enqueue(new TextEncoder().encode(f));
      } catch {
        /* closed */
      }
    },
  };
}

let history: Row[];
let emitSse: ((frame: string) => void) | null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  history = [];
  emitSse = null;
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(
        jsonRes(200, { messages: history, conversation: history.length ? { externalId: 'web:a' } : null }),
      );
    }
    if (u.includes('/widget/stream')) {
      const { res, emit } = controllableStream(opts?.signal ?? undefined);
      emitSse = emit;
      return Promise.resolve(res);
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

const shadowOf = (): ShadowRoot =>
  (document.querySelector('[data-vitrina-widget]') as HTMLElement).shadowRoot!;
const systemLines = (): Element[] => [...shadowOf().querySelectorAll('.vtr-system')];

const handoff = (to: string) =>
  emitSse!(`event: conversation.handoff\ndata: {"to":"${to}"}\n\n`);

describe('X4: the visitor is told once when a person joins', () => {
  it('renders a single centered system line, naming nobody', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());
    expect(systemLines()).toHaveLength(0);

    handoff('human');
    await vi.waitFor(() => expect(systemLines()).toHaveLength(1));

    const line = systemLines()[0];
    expect(line.textContent).toBe('Un asesor se unió a la conversación');
    // Not a message bubble: no author, no direction, no avatar.
    expect(line.classList.contains('vtr-msg')).toBe(false);
    expect(line.getAttribute('data-dir')).toBeNull();
    expect(line.getAttribute('role')).toBe('status');

    w.destroy();
  });

  it('says it ONCE, however many handoff events arrive', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    handoff('human');
    await vi.waitFor(() => expect(systemLines()).toHaveLength(1));
    handoff('human');
    handoff('human');
    await new Promise((r) => setTimeout(r, 20));

    expect(systemLines()).toHaveLength(1);
    w.destroy();
  });

  it('says NOTHING when the conversation goes back to the AI', async () => {
    // The server publishes the honest projection of the handler transition. The
    // widget decides what a visitor should see — and announcing "the AI is back"
    // would keep score of who is on the other end, which is exactly what the
    // authorless contract exists to prevent.
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    handoff('bot');
    await new Promise((r) => setTimeout(r, 20));
    expect(systemLines()).toHaveLength(0);

    w.destroy();
  });

  it('survives a repaint — a refetch does not erase the line', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    handoff('human');
    await vi.waitFor(() => expect(systemLines()).toHaveLength(1));

    // A reply lands, forcing a full repaint of the transcript.
    history = [
      {
        id: 'srv_1',
        createdAt: new Date().toISOString(),
        content: 'hola, soy Ana',
        direction: 'outbound',
        type: 'text',
      },
    ];
    emitSse!(`event: message.created\nid: ${history[0].createdAt}\ndata: {}\n\n`);

    await vi.waitFor(() => {
      expect(shadowOf().querySelectorAll('.vtr-msg[data-dir="outbound"][data-id="srv_1"]')).toHaveLength(1);
    });
    expect(systemLines()).toHaveLength(1);

    w.destroy();
  });

  it('does not replay on reload — the notice is live-only, by design', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());
    handoff('human');
    await vi.waitFor(() => expect(systemLines()).toHaveLength(1));
    w.destroy();

    // A fresh widget on the same session: history replays, the courtesy does not.
    const w2 = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w2.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(systemLines()).toHaveLength(0);

    w2.destroy();
  });

  it('sorts into the transcript where it happened, not pinned to the bottom', async () => {
    // An older reply exists; the handoff happens now; both render in order.
    history = [
      {
        id: 'srv_old',
        createdAt: '2020-01-01T00:00:00.000Z',
        content: 'mensaje antiguo',
        direction: 'outbound',
        type: 'text',
      },
    ];
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());
    await vi.waitFor(() => {
      expect(shadowOf().querySelectorAll('.vtr-msg[data-id="srv_old"]')).toHaveLength(1);
    });

    handoff('human');
    await vi.waitFor(() => expect(systemLines()).toHaveLength(1));

    const children = [...shadowOf().querySelectorAll('.vtr-messages > *')];
    // The 2020 message precedes the just-now notice.
    expect(children[0].getAttribute('data-id')).toBe('srv_old');
    expect(children[1].classList.contains('vtr-system')).toBe(true);

    w.destroy();
  });
});
