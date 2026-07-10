// ADR 0035 ¶4 — forward compatibility of the visitor realtime channel.
//
// This widget is installed on dealer sites we cannot force-upgrade. A copy
// built today may still be running when the server starts publishing event
// types that did not exist when it was compiled. The contract is therefore:
//
//   an unrecognised event type is IGNORED — never an error, never a refetch,
//   and never allowed to advance the history cursor.
//
// Without it, shipping any new visitor event (a typing indicator, a handoff
// announcement) breaks every widget already deployed in the field.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport } from '../src/transport';
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

/** A stream that emits `chunks` then stays open until the fetch signal aborts. */
function streamRes(chunks: string[], signal?: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
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

describe('openStream tolerates unknown visitor event types (ADR 0035)', () => {
  it('ignores event types it does not recognise and does not throw', async () => {
    const cursor = '2026-07-09T10:00:00.000Z';
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      return Promise.resolve(
        streamRes(
          [
            ': connected\n\n',
            // Three event types this build has never heard of, one of them
            // carrying a payload shape it cannot parse into anything it knows.
            'event: agent.typing\ndata: {"type":"agent.typing","at":"2026-07-09T09:59:00.000Z","ttlMs":5000}\n\n',
            'event: conversation.handoff\ndata: {"type":"conversation.handoff","at":"2026-07-09T09:59:30.000Z","to":"human"}\n\n',
            'event: something.from.the.future\ndata: not-even-json\n\n',
            // ...followed by a frame it DOES understand.
            `event: message.created\nid: ${cursor}\ndata: {"type":"message.created","at":"${cursor}"}\n\n`,
          ],
          opts?.signal ?? undefined,
        ),
      );
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const onInvalidation = vi.fn();
    const close = t.openStream({ onInvalidation });

    await vi.advanceTimersByTimeAsync(100);

    // Exactly one refetch: the three unknown events were silently dropped, and
    // the known one still worked. A widget that errored, or that treated an
    // unknown frame as a message, would fail here.
    expect(onInvalidation).toHaveBeenCalledTimes(1);
    expect(onInvalidation).toHaveBeenCalledWith(cursor);

    close();
  });

  it('keeps working after an unknown event — the stream is not torn down', async () => {
    const c1 = '2026-07-09T10:00:00.000Z';
    const c2 = '2026-07-09T10:00:10.000Z';
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
      return Promise.resolve(
        streamRes(
          [
            `event: message.created\nid: ${c1}\ndata: {}\n\n`,
            'event: agent.typing\ndata: {"ttlMs":5000}\n\n',
            `event: message.created\nid: ${c2}\ndata: {}\n\n`,
          ],
          opts?.signal ?? undefined,
        ),
      );
    });

    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
    const onInvalidation = vi.fn();
    const close = t.openStream({ onInvalidation });

    await vi.advanceTimersByTimeAsync(100);

    // An unknown event sandwiched between two known ones is a no-op: both real
    // messages still invalidate, in order, with their own cursors.
    expect(onInvalidation).toHaveBeenCalledTimes(2);
    expect(onInvalidation).toHaveBeenNthCalledWith(1, c1);
    expect(onInvalidation).toHaveBeenNthCalledWith(2, c2);

    close();
  });
});
