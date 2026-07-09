import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport, parseSseFrame } from '../src/transport';
import type { TokenStore } from '../src/token-store';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

function memStore(initial: string | null = null): TokenStore {
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

/**
 * Response whose body is an OPEN ReadableStream: it emits `chunks` then stays
 * open until the fetch signal aborts (which errors the stream so the reader
 * loop exits cleanly). Mirrors how widget.ts holds the SSE connection open.
 */
function streamRes(chunks: string[], signal?: AbortSignal): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
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
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseSseFrame', () => {
  it('drops pure-comment frames (: connected, : ping)', () => {
    expect(parseSseFrame(': connected')).toBeNull();
    expect(parseSseFrame(': ping')).toBeNull();
    expect(parseSseFrame('')).toBeNull();
  });

  it('parses a message.created event with id + data', () => {
    const frame = parseSseFrame('id: 2026-07-01T00:00:01.000Z\nevent: message.created\ndata: {"at":"x"}');
    expect(frame).toEqual({
      id: '2026-07-01T00:00:01.000Z',
      event: 'message.created',
      data: '{"at":"x"}',
    });
  });

  it('strips exactly one leading space after the colon', () => {
    expect(parseSseFrame('data: value')?.data).toBe('value');
    expect(parseSseFrame('data:value')?.data).toBe('value');
    expect(parseSseFrame('data:  value')?.data).toBe(' value');
  });

  it('parses retry as a number', () => {
    expect(parseSseFrame('retry: 3000')?.retry).toBe(3000);
  });

  it('concatenates multiple data lines with newline', () => {
    expect(parseSseFrame('data: a\ndata: b')?.data).toBe('a\nb');
  });
});

describe('VitrinaTransport.openStream', () => {
  it('fires onInvalidation per message.created, ignores comments, reassembles split frames', async () => {
    const store = memStore('vt_1');
    // First event is split ACROSS the chunk boundary; comments precede it.
    const chunk1 =
      'retry: 3000\n\n: connected\n\n: ping\n\nid: 2026-07-01T00:00:01.000Z\nevent: mess';
    const chunk2 = 'age.created\ndata: {"at":"2026-07-01T00:00:01.000Z"}\n\n';
    const chunk3 = 'id: 2026-07-01T00:00:02.000Z\nevent: message.created\ndata: {}\n\n';

    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(streamRes([chunk1, chunk2, chunk3], init.signal ?? undefined)),
    );

    const seen: Array<string | undefined> = [];
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const close = t.openStream((c) => seen.push(c));

    await vi.waitFor(() => expect(seen.length).toBe(2));
    // Comments produced NO invalidation; cursors captured from id: lines.
    expect(seen).toEqual(['2026-07-01T00:00:01.000Z', '2026-07-01T00:00:02.000Z']);

    // Verify the stream request headers: Bearer + visitor, no Content-Type.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PK}`);
    expect(headers['X-Vitrina-Visitor']).toBe('vt_1');
    expect(headers['Content-Type']).toBeUndefined();
    expect((init as { credentials?: string }).credentials).toBeUndefined();

    close();
  });

  it('recovers from a stream 401 by re-bootstrapping then reconnecting', async () => {
    const store = memStore('vt_stale');
    let streamCalls = 0;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.includes('/widget/stream')) {
        streamCalls += 1;
        if (streamCalls === 1) return Promise.resolve(emptyRes(401));
        return Promise.resolve(
          streamRes(['id: t1\nevent: message.created\ndata: {}\n\n'], init.signal ?? undefined),
        );
      }
      if (url.includes('/widget/conversations')) {
        return Promise.resolve(
          jsonRes(200, { visitorToken: 'vt_new', conversationExternalId: 'web:z', expiresAt: 'x' }),
        );
      }
      return Promise.resolve(emptyRes(404));
    });

    const seen: Array<string | undefined> = [];
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const close = t.openStream((c) => seen.push(c));

    await vi.waitFor(() => expect(seen).toContain('t1'));
    // The recovery bootstrap POSTed /widget/conversations and refreshed the token.
    expect(store.get()).toBe('vt_new');
    expect(fetchMock.mock.calls.some(([u]) => (u as string).includes('/widget/conversations'))).toBe(true);

    close();
  });

  it('close() aborts the in-flight fetch (AbortController)', async () => {
    const store = memStore('vt_1');
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      return Promise.resolve(streamRes([': connected\n\n'], init.signal ?? undefined));
    });
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const close = t.openStream(() => {});
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);
    close();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
