// W6-review gap: the SSE RECONNECT backfill branch of openStream.
//
// When the fetch-based SSE reader loses the stream and reconnects, openStream
// must fire a catch-up onInvalidation(lastCursor) at the START of the new
// connection (NOT on the very first connect — the widget already painted history
// on bootstrap). The widget answers that poke by re-fetching /widget/messages
// with `since=<lastCursor>`, and mergeMessages dedupes the INCLUSIVE-gte overlap
// by id — so nothing is dropped or duplicated across the publish-before-persist
// race. This exercises that branch end-to-end at the transport layer, plus the
// dedupe that absorbs the boundary row.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport, mergeMessages, type WidgetMessageDto } from '../src/transport';
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

/** A stream that emits `chunks` in order then CLOSES (reader gets done). */
function closingStreamRes(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response;
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

describe('openStream reconnect backfill', () => {
  it('re-invokes onInvalidation with the last cursor on reconnect (catch-up refetch)', async () => {
    const cursorA = '2026-07-01T00:00:05.000Z';
    let streamCount = 0;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      streamCount += 1;
      if (streamCount === 1) {
        // First connection: advance the cursor via an id-ONLY frame (no
        // `message.created`), so it does NOT itself trigger onInvalidation. Then
        // close the stream to force a reconnect.
        return Promise.resolve(closingStreamRes([`id: ${cursorA}\n\n`]));
      }
      // Reconnect: stay open. The backfill onInvalidation must fire here.
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const onInvalidation = vi.fn();
    const close = t.openStream(onInvalidation);

    // Flush: first read, stream close, backoff sleep (~2s + jitter), reconnect.
    await vi.advanceTimersByTimeAsync(5000);

    expect(streamCount).toBeGreaterThanOrEqual(2);
    // The id-only frame did NOT invalidate; the reconnect backfill did — exactly
    // once, carrying the cursor the widget will pass as `since`.
    expect(onInvalidation).toHaveBeenCalledTimes(1);
    expect(onInvalidation).toHaveBeenCalledWith(cursorA);

    close();
  });

  it('does NOT backfill on the FIRST connect (history was already painted on bootstrap)', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      // Single connection that just stays open — no reconnect ever happens.
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const onInvalidation = vi.fn();
    const close = t.openStream(onInvalidation);

    await vi.advanceTimersByTimeAsync(5000);

    // First connect never fires a catch-up poke.
    expect(onInvalidation).not.toHaveBeenCalled();

    close();
  });

  it('backfill refetch dedupes the INCLUSIVE-gte boundary row by id (no drop, no dup)', () => {
    // Model the publish-before-persist race the backfill absorbs: the client
    // already holds a boundary row `b`; the since=<cursor of b> refetch re-returns
    // `b` (INCLUSIVE gte) alongside a genuinely new `c`. mergeMessages must keep
    // exactly one `b` (server truth wins) and add `c`, sorted ascending.
    const existing: WidgetMessageDto[] = [
      { id: 'a', createdAt: '2026-07-01T00:00:01.000Z', content: 'one', direction: 'inbound', type: null },
      { id: 'b', createdAt: '2026-07-01T00:00:05.000Z', content: 'two-optimistic', direction: 'inbound', type: null },
    ];
    const backfill: WidgetMessageDto[] = [
      { id: 'b', createdAt: '2026-07-01T00:00:05.000Z', content: 'two-server', direction: 'inbound', type: null },
      { id: 'c', createdAt: '2026-07-01T00:00:06.000Z', content: 'three', direction: 'outbound', type: null },
    ];
    const merged = mergeMessages(existing, backfill);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(merged.filter((m) => m.id === 'b')).toHaveLength(1);
    expect(merged.find((m) => m.id === 'b')?.content).toBe('two-server');
  });
});
