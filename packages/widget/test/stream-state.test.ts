// X7 — reconnection is visible.
//
// The offline banner used to fire only when the initial session bootstrap
// failed. A stream that dropped mid-conversation reconnected entirely
// invisibly, so a visitor waiting on a reply could not tell a recovering
// connection from a dealership ignoring them.
//
// The transport already knew: full backoff loop with jitter, re-mint on 401,
// longer backoff on 429. It simply never told the UI. Nothing new is computed
// here — the states are surfaced.
//
// Every assertion below drives fake timers. Backoff is exponential with jitter,
// so a test that waited on wall-clock durations would be flaky by construction.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport, type StreamState } from '../src/transport';
import type { TokenStore } from '../src/token-store';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

function memStore(initial: string | null = 'vt_1'): TokenStore {
  let value = initial;
  return {
    get: () => value,
    set: (t) => {
      value = t;
    },
    clear: () => {
      value = null;
    },
  };
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

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

/** A stream that stays open until the fetch signal aborts. */
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

/** A stream this test closes on demand, so "connected" and "dropped" are distinct moments. */
function holdableStreamRes(): { res: Response; drop: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(new TextEncoder().encode(': connected\n\n'));
    },
  });
  return {
    res: { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response,
    drop: () => {
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/** A stream that emits nothing and closes immediately (forces a reconnect). */
function closingStreamRes(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openStream reports its connection state', () => {
  it('connecting -> open on a successful first connect', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const states: StreamState[] = [];
    const close = t.openStream({ onInvalidation: () => {}, onState: (s) => states.push(s) });

    await vi.advanceTimersByTimeAsync(50);
    expect(states).toEqual(['connecting', 'open']);

    close();
  });

  it('open -> reconnecting -> open across a dropped stream', async () => {
    let n = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      n += 1;
      // First connection opens then immediately ends; the second stays up.
      return Promise.resolve(n === 1 ? closingStreamRes() : openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const states: StreamState[] = [];
    const close = t.openStream({ onInvalidation: () => {}, onState: (s) => states.push(s) });

    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'open']);

    close();
  });

  it('reports reconnecting on a network error, and recovers', async () => {
    let n = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      n += 1;
      if (n === 1) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const states: StreamState[] = [];
    const close = t.openStream({ onInvalidation: () => {}, onState: (s) => states.push(s) });

    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toEqual(['connecting', 'reconnecting', 'open']);

    close();
  });

  it('reports reconnecting on a 429 (the longer backoff path)', async () => {
    let n = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      n += 1;
      if (n === 1) return Promise.resolve(emptyRes(429));
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const states: StreamState[] = [];
    const close = t.openStream({ onInvalidation: () => {}, onState: (s) => states.push(s) });

    // The 429 path backs off from 5s, not 1s. Advance well past it.
    await vi.advanceTimersByTimeAsync(20000);
    expect(states).toEqual(['connecting', 'reconnecting', 'open']);

    close();
  });

  it('a 401 that re-mints successfully never announces reconnecting', async () => {
    // The token expired and was silently replaced. Nothing was wrong from the
    // visitor's point of view, so nothing is said.
    let streamHits = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      if (u.includes('/widget/conversations')) {
        return Promise.resolve(
          jsonRes(200, { visitorToken: 'vt_new', conversationExternalId: 'web:a', expiresAt: 'x' }),
        );
      }
      if (!u.includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      streamHits += 1;
      if (streamHits === 1) return Promise.resolve(emptyRes(401));
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const states: StreamState[] = [];
    const close = t.openStream({ onInvalidation: () => {}, onState: (s) => states.push(s) });

    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toEqual(['connecting', 'open']);

    close();
  });

  it('does not repeat a state it is already in (no banner flapping)', async () => {
    // Three consecutive failures = three backoffs. The visitor is told once.
    let n = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      n += 1;
      if (n <= 3) return Promise.resolve(emptyRes(500));
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const states: StreamState[] = [];
    const close = t.openStream({ onInvalidation: () => {}, onState: (s) => states.push(s) });

    await vi.advanceTimersByTimeAsync(60000);
    expect(states).toEqual(['connecting', 'reconnecting', 'open']);
    expect(n).toBeGreaterThanOrEqual(4);

    close();
  });

  it('the catch-up refetch on reconnect is unchanged', async () => {
    let n = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      n += 1;
      return Promise.resolve(n === 1 ? closingStreamRes() : openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const onInvalidation = vi.fn();
    const close = t.openStream({ onInvalidation, onState: () => {} });

    await vi.advanceTimersByTimeAsync(5000);
    // Reconnect fired exactly one catch-up poke — the behaviour X7 must not break.
    expect(onInvalidation).toHaveBeenCalledTimes(1);

    close();
  });

  it('a throwing onState never breaks the stream loop', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const onInvalidation = vi.fn();
    const close = t.openStream({
      onInvalidation,
      onState: () => {
        throw new Error('a UI callback exploded');
      },
    });

    await expect(vi.advanceTimersByTimeAsync(50)).resolves.not.toThrow();
    close();
  });
});

// ---------------------------------------------------------------------------
// The banner has ONE slot and TWO independent sources: connection health and
// send progress. They used to overwrite each other — a successful send called
// setBanner('none') and wiped an offline notice that was still true.
// ---------------------------------------------------------------------------
describe('the visitor SEES the reconnection', () => {
  function mountWithStream(
    streamPlan: (n: number, signal?: AbortSignal) => Response,
    opts: { postStatus?: number } = {},
  ) {
    const postStatus = opts.postStatus ?? 202;
    let n = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      if (u.includes('/widget/conversations')) {
        return Promise.resolve(
          jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
        );
      }
      if (u.includes('/widget/messages') && (opts?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
      }
      if (u.includes('/widget/messages')) {
        return Promise.resolve(
          postStatus === 202
            ? jsonRes(202, { status: 'accepted', visitorToken: 'vt_srv', conversationExternalId: 'web:a' })
            : emptyRes(postStatus),
        );
      }
      if (u.includes('/widget/stream')) {
        n += 1;
        return Promise.resolve(streamPlan(n, opts?.signal ?? undefined));
      }
      return Promise.resolve(emptyRes(404));
    });
  }

  const bannerOf = (): HTMLElement => {
    const host = document.querySelector('[data-vitrina-widget]') as HTMLElement;
    return host.shadowRoot!.querySelector('.vtr-banner') as HTMLElement;
  };

  afterEach(() => {
    document.querySelectorAll('[data-vitrina-widget]').forEach((el) => el.remove());
  });

  it('shows a reconnecting banner during backoff and clears it on reconnect', async () => {
    const { init } = await import('../src/index');
    // The first stream is held OPEN until this test drops it, so "connected"
    // and "dropped" are distinct moments rather than one tick.
    const first = holdableStreamRes();
    mountWithStream((n, signal) => (n === 1 ? first.res : openStreamRes(signal)));

    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();

    // Connected: no banner.
    await vi.advanceTimersByTimeAsync(50);
    expect(bannerOf().hidden).toBe(true);

    // The stream drops; we are in backoff. The visitor is told.
    first.drop();
    await vi.advanceTimersByTimeAsync(50);
    expect(bannerOf().hidden).toBe(false);
    expect(bannerOf().getAttribute('data-state')).toBe('reconnecting');
    expect(bannerOf().textContent).toBe('Reconectando…');

    // Reconnected: cleared.
    await vi.advanceTimersByTimeAsync(5000);
    expect(bannerOf().hidden).toBe(true);

    w.destroy();
  });

  it('a successful send does NOT clear a live reconnecting banner', async () => {
    const { init } = await import('../src/index');
    // The stream never comes back, so 'reconnecting' stays true throughout.
    mountWithStream(() => closingStreamRes());

    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.advanceTimersByTimeAsync(500);
    expect(bannerOf().getAttribute('data-state')).toBe('reconnecting');

    const shadow = (document.querySelector('[data-vitrina-widget]') as HTMLElement).shadowRoot!;
    const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
    const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;
    input.value = 'hola';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    // The send succeeds (202). Before this fix it called setBanner('none') and
    // erased a connection warning that was still true.
    await vi.advanceTimersByTimeAsync(100);
    expect(bannerOf().hidden).toBe(false);
    expect(bannerOf().getAttribute('data-state')).toBe('reconnecting');

    w.destroy();
  });

  it('a FAILED send outranks a reconnecting banner (it is the actionable one)', async () => {
    const { init } = await import('../src/index');
    mountWithStream(() => closingStreamRes(), { postStatus: 500 });

    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.advanceTimersByTimeAsync(500);
    expect(bannerOf().getAttribute('data-state')).toBe('reconnecting');

    const shadow = (document.querySelector('[data-vitrina-widget]') as HTMLElement).shadowRoot!;
    const input = shadow.querySelector('.vtr-input') as HTMLTextAreaElement;
    const form = shadow.querySelector('.vtr-composer') as HTMLFormElement;
    input.value = 'hola';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.advanceTimersByTimeAsync(100);
    expect(bannerOf().getAttribute('data-state')).toBe('error');

    w.destroy();
  });
});
