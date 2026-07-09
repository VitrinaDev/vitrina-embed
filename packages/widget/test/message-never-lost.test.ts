// X1 — a visitor's message is never lost.
//
// The live end-to-end that motivated this: a visitor typed a message, the
// post-send refetch 400'd, and their own text vanished off the screen while the
// widget reported success. Two defects combined.
//
//   1. The optimistic bubble was a DOM-only artifact (`data-optimistic="1"`,
//      never in the message list), so any `replaceChildren` repaint destroyed it.
//   2. `fetchHistory` returned `[]` on EVERY failure, so a broken refetch was
//      indistinguishable from an empty conversation — and the widget repainted
//      from nothing while setting its banner to 'none' (success).
//
// The since-cursor fix removed that day's trigger. It did not remove either
// mechanism. These tests pin the mechanisms.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { isLocalId, latestServerCursor, localIdFor, mergeMessages } from '../src/transport';

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

/** An SSE response whose frames this test can push at will. */
function controllableStream(signal?: AbortSignal): {
  res: Response;
  emit: (frame: string) => void;
} {
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
          /* already closed */
        }
      });
    },
  });
  return {
    res: { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response,
    emit: (frame: string) => {
      try {
        controller.enqueue(new TextEncoder().encode(frame));
      } catch {
        /* closed */
      }
    },
  };
}

interface Server {
  /** Status for POST /widget/messages. 202 = accepted. */
  postStatus: number;
  /** Status for GET /widget/messages. 200 = ok. */
  getStatus: number;
  /** Rows GET returns when getStatus is 200. */
  history: unknown[];
  /** Bodies of every POST /widget/messages, in order. */
  posts: Array<Record<string, unknown>>;
  /** When true, POST hangs until releaseHeldPost() is called. */
  holdPost: boolean;
  releaseHeldPost: (() => void) | null;
  emitSse: ((frame: string) => void) | null;
}

let server: Server;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  server = {
    postStatus: 202,
    getStatus: 200,
    history: [],
    posts: [],
    holdPost: false,
    releaseHeldPost: null,
    emitSse: null,
  };

  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';

    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }

    if (u.includes('/widget/messages') && method === 'POST') {
      server.posts.push(JSON.parse(opts?.body as string));
      const respond = (): Response =>
        server.postStatus === 202
          ? jsonRes(202, {
              status: 'accepted',
              visitorToken: 'vt_srv',
              conversationExternalId: 'web:a',
            })
          : emptyRes(server.postStatus);
      if (server.holdPost) {
        // Hold the POST open so a mid-send SSE poke can interleave.
        return new Promise<Response>((resolve) => {
          server.releaseHeldPost = () => resolve(respond());
        });
      }
      return Promise.resolve(respond());
    }

    if (u.includes('/widget/messages') && method === 'GET') {
      if (server.getStatus !== 200) return Promise.resolve(emptyRes(server.getStatus));
      return Promise.resolve(
        jsonRes(200, {
          messages: server.history,
          conversation: server.history.length ? { externalId: 'web:a' } : null,
        }),
      );
    }

    if (u.includes('/widget/stream')) {
      const { res, emit } = controllableStream(opts?.signal ?? undefined);
      server.emitSse = emit;
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

function shadowOf(): ShadowRoot {
  const host = document.querySelector('[data-vitrina-widget]') as HTMLElement | null;
  if (!host?.shadowRoot) throw new Error('widget not mounted');
  return host.shadowRoot;
}

function submit(shadow: ShadowRoot, text: string): void {
  const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
  const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;
  input.value = text;
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

const inboundBubbles = (shadow: ShadowRoot): Element[] =>
  [...shadow.querySelectorAll('.vtr-msg[data-dir="inbound"]')];

describe('X1: a visitor’s message is never lost', () => {
  it('survives a 500 on the post-send refetch — and is NOT marked failed, because the send succeeded', async () => {
    // The exact shape of the original bug: POST is accepted, the refetch that
    // follows it fails. The old widget repainted from `[]` and ate the message.
    server.postStatus = 202;
    server.getStatus = 500;

    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    const shadow = shadowOf();
    submit(shadow, 'tienen el Corolla 2020?');

    await vi.waitFor(() => {
      expect(server.posts.length).toBe(1);
    });

    await vi.waitFor(() => {
      const bubbles = inboundBubbles(shadow);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0].textContent).toBe('tienen el Corolla 2020?');
      // Accepted (202) — pending cleared. A failed REFETCH is not a failed SEND;
      // marking it failed would be a lie and would offer a pointless retry.
      expect(bubbles[0].getAttribute('data-status')).toBeNull();
    });
    expect(shadow.querySelector('.vtr-retry')).toBeNull();

    w.destroy();
  });

  it('a failed SEND leaves the message on screen, marked failed, with a retry', async () => {
    server.postStatus = 500;

    // Locale pinned: the widget otherwise sniffs navigator.language, which the
    // test DOM reports as 'en'. The retry copy is the thing under test.
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    const shadow = shadowOf();
    submit(shadow, 'hola');

    await vi.waitFor(() => {
      const bubbles = inboundBubbles(shadow);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0].textContent).toBe('hola');
      expect(bubbles[0].getAttribute('data-status')).toBe('failed');
    });
    const retry = shadow.querySelector('.vtr-retry') as HTMLButtonElement;
    expect(retry).toBeTruthy();
    expect(retry.textContent).toBe('Reintentar');
    expect(retry.dataset.retry).toBeTruthy();

    w.destroy();
  });

  it('retry re-sends with the SAME client message id, so a message that did land is not double-posted', async () => {
    server.postStatus = 500;

    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    const shadow = shadowOf();
    submit(shadow, 'me interesa');

    await vi.waitFor(() => {
      expect(shadow.querySelector('.vtr-retry')).toBeTruthy();
    });
    const firstId = server.posts[0].client_message_id;
    expect(firstId).toBeTruthy();

    // The server recovers; the visitor taps retry.
    server.postStatus = 202;
    (shadow.querySelector('.vtr-retry') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(server.posts.length).toBe(2);
    });
    // Same idempotency key → the server's dedup key is identical → no duplicate.
    expect(server.posts[1].client_message_id).toBe(firstId);
    expect(server.posts[1].message).toBe('me interesa');

    // Recovered: no longer failed, retry control gone.
    await vi.waitFor(() => {
      const bubbles = inboundBubbles(shadow);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0].getAttribute('data-status')).toBeNull();
    });
    expect(shadow.querySelector('.vtr-retry')).toBeNull();

    w.destroy();
  });

  it('an SSE poke arriving MID-SEND does not eat the pending message', async () => {
    // The poke triggers refreshHistory while the POST is still in flight. The
    // server has not persisted the visitor's row yet, so history comes back
    // holding only the dealer's reply. The repaint that follows must keep the
    // visitor's own pending message.
    server.holdPost = true;

    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    const shadow = shadowOf();

    await vi.waitFor(() => {
      expect(server.emitSse).toBeTruthy();
    });

    submit(shadow, 'sigue disponible?');

    // The pending bubble is on screen while the POST hangs.
    await vi.waitFor(() => {
      const bubbles = inboundBubbles(shadow);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0].getAttribute('data-status')).toBe('pending');
    });

    // A dealer reply lands and pokes us. refreshHistory runs mid-send.
    server.history = [
      {
        id: 'srv_reply',
        createdAt: '2026-07-01T00:00:00.000Z',
        content: 'sí, disponible',
        direction: 'outbound',
        type: 'text',
      },
    ];
    server.emitSse!('event: message.created\nid: 2026-07-01T00:00:00.000Z\ndata: {}\n\n');

    // Both are on screen: the dealer's reply AND the visitor's pending message.
    await vi.waitFor(() => {
      expect(shadow.querySelectorAll('.vtr-msg[data-dir="outbound"]').length).toBe(1);
      const bubbles = inboundBubbles(shadow);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0].textContent).toBe('sigue disponible?');
      expect(bubbles[0].getAttribute('data-status')).toBe('pending');
    });

    // Now let the POST finish. The pending mark clears on the 202.
    server.releaseHeldPost!();
    await vi.waitFor(() => {
      expect(inboundBubbles(shadow)[0].getAttribute('data-status')).toBeNull();
    });

    w.destroy();
  });

  it('an unmatched local echo STAYS after a successful but empty refetch', async () => {
    // 202-before-persist: the inbound dispatcher coalesces, so the row may not
    // exist yet when the post-send refetch runs. The echo must not be swept up.
    server.postStatus = 202;
    server.getStatus = 200;
    server.history = []; // row not written yet

    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    const shadow = shadowOf();
    submit(shadow, 'quiero agendar');

    await vi.waitFor(() => {
      expect(server.posts.length).toBe(1);
    });
    await vi.waitFor(() => {
      const bubbles = inboundBubbles(shadow);
      expect(bubbles.length).toBe(1);
      expect(bubbles[0].textContent).toBe('quiero agendar');
      // Accepted, so no longer pending — but still local, and still on screen.
      expect(bubbles[0].getAttribute('data-status')).toBeNull();
      expect(bubbles[0].getAttribute('data-id')).toMatch(/^local:/);
    });

    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// The reconciliation rules, at the unit level.
// ---------------------------------------------------------------------------
describe('mergeMessages reconciles a local echo against its server row', () => {
  const localEcho = {
    id: localIdFor('cm_1'),
    createdAt: '2026-07-01T00:00:05.000Z',
    content: 'hola',
    direction: 'inbound' as const,
    type: 'text',
    clientMessageId: 'cm_1',
    status: 'pending' as const,
  };

  it('a server row carrying the clientMessageId REPLACES the echo (no duplicate)', () => {
    const serverRow = {
      id: 42,
      createdAt: '2026-07-01T00:00:06.000Z',
      content: 'hola',
      direction: 'inbound' as const,
      type: 'text',
      clientMessageId: 'cm_1',
    };
    const merged = mergeMessages([localEcho], [serverRow]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(42);
    // Server truth carries no local status.
    expect(merged[0].status).toBeUndefined();
  });

  it('an UNMATCHED echo stays, and keeps its status', () => {
    const otherRow = {
      id: 43,
      createdAt: '2026-07-01T00:00:07.000Z',
      content: 'te respondo',
      direction: 'outbound' as const,
      type: 'text',
    };
    const merged = mergeMessages([localEcho], [otherRow]);
    expect(merged).toHaveLength(2);
    const echo = merged.find((m) => m.clientMessageId === 'cm_1');
    expect(echo?.status).toBe('pending');
  });

  it('still dedupes server rows strictly by id (the INCLUSIVE since-boundary overlap)', () => {
    const row = {
      id: 7,
      createdAt: '2026-07-01T00:00:01.000Z',
      content: 'b',
      direction: 'outbound' as const,
      type: 'text',
    };
    const merged = mergeMessages([row], [row]);
    expect(merged).toHaveLength(1);
  });

  it('isLocalId distinguishes an echo from a server row', () => {
    expect(isLocalId(localIdFor('cm_1'))).toBe(true);
    expect(isLocalId(42)).toBe(false);
    expect(isLocalId('srv_1')).toBe(false);
  });

  it('latestServerCursor IGNORES local echoes (a fast client clock must not skip messages)', () => {
    const serverRow = {
      id: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      content: 'x',
      direction: 'outbound' as const,
      type: 'text',
    };
    // The echo's timestamp comes from the visitor's clock — here, wildly ahead.
    const skewed = { ...localEcho, createdAt: '2030-01-01T00:00:00.000Z' };
    expect(latestServerCursor([serverRow, skewed])).toBe('2026-07-01T00:00:00.000Z');
  });
});
