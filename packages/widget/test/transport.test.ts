import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport, mergeMessages, type WidgetMessageDto } from '../src/transport';
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

/** Minimal Response-shaped mock — avoids env Response-class quirks. */
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

type FetchArgs = [string, RequestInit];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): FetchArgs {
  const calls = fetchMock.mock.calls;
  return calls[calls.length - 1] as FetchArgs;
}
function callAt(i: number): FetchArgs {
  return fetchMock.mock.calls[i] as FetchArgs;
}

describe('VitrinaTransport.bootstrap', () => {
  it('POSTs /widget/conversations with {} body + Bearer, persists the token', async () => {
    const store = memStore();
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, {
        visitorToken: 'vt_new',
        conversationExternalId: 'web:abc',
        expiresAt: '2026-08-01T00:00:00.000Z',
      }),
    );
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const res = await t.bootstrap();

    expect(res?.visitorToken).toBe('vt_new');
    const [url, init] = callAt(0);
    expect(url).toBe(`${BASE}/widget/conversations`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PK}`);
    expect(headers['Content-Type']).toBe('application/json');
    // No stray headers, no credentials.
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type']);
    expect((init as { credentials?: string }).credentials).toBeUndefined();
    // Token persisted (sliding).
    expect(store.get()).toBe('vt_new');
  });

  it('slides an existing token by presenting it in X-Vitrina-Visitor', async () => {
    const store = memStore('vt_old');
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, { visitorToken: 'vt_slid', conversationExternalId: 'web:abc', expiresAt: 'x' }),
    );
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    await t.bootstrap();
    const [, init] = callAt(0);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Vitrina-Visitor']).toBe('vt_old');
    expect(store.get()).toBe('vt_slid');
  });

  it('re-bootstraps WITHOUT the visitor header on a present-stale-token 401', async () => {
    const store = memStore('vt_stale');
    fetchMock
      .mockResolvedValueOnce(emptyRes(401)) // stale token 401
      .mockResolvedValueOnce(
        jsonRes(200, { visitorToken: 'vt_fresh', conversationExternalId: 'web:z', expiresAt: 'x' }),
      );
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const res = await t.bootstrap();

    expect(res?.visitorToken).toBe('vt_fresh');
    // Second (recovery) call must NOT carry a visitor header.
    const [, init2] = callAt(1);
    const headers2 = init2.headers as Record<string, string>;
    expect(headers2['X-Vitrina-Visitor']).toBeUndefined();
    expect(store.get()).toBe('vt_fresh');
  });

  it('returns null (no throw) on network failure', async () => {
    const store = memStore();
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    await expect(t.bootstrap()).resolves.toBeNull();
  });
});

describe('VitrinaTransport.send', () => {
  it('POSTs pure snake_case body with honeypot + Bearer + visitor headers', async () => {
    const store = memStore('vt_1');
    fetchMock.mockResolvedValueOnce(
      jsonRes(202, { status: 'accepted', visitorToken: 'vt_2', conversationExternalId: 'web:a' }),
    );
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const res = await t.send({ message: 'hola', clientMessageId: 'cm_1' });

    expect(res).toMatchObject({ status: 'accepted' });
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/widget/messages`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ message: 'hola', hp_website: '', client_message_id: 'cm_1' });
    // No camelCase leakage.
    expect(Object.keys(body)).not.toContain('clientMessageId');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PK}`);
    expect(headers['X-Vitrina-Visitor']).toBe('vt_1');
    expect((init as { credentials?: string }).credentials).toBeUndefined();
    // Rotated token re-persisted.
    expect(store.get()).toBe('vt_2');
  });

  it('always sends hp_website (empty string) even without a honeypot value', async () => {
    const store = memStore('vt_1');
    fetchMock.mockResolvedValueOnce(
      jsonRes(202, { status: 'accepted', visitorToken: 'vt_1', conversationExternalId: 'web:a' }),
    );
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    await t.send({ message: 'hi' });
    const body = JSON.parse(lastCall()[1].body as string);
    expect(body.hp_website).toBe('');
  });

  it('includes a speculative vehicle_id (snake_case) when a vehicleId is set', async () => {
    const store = memStore('vt_1');
    fetchMock.mockResolvedValueOnce(
      jsonRes(202, { status: 'accepted', visitorToken: 'vt_1', conversationExternalId: 'web:a' }),
    );
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    await t.send({ message: 'hi', vehicleId: 'veh_9' });
    const body = JSON.parse(lastCall()[1].body as string);
    expect(body.vehicle_id).toBe('veh_9');
    expect(body).not.toHaveProperty('vehicleId');
  });

  it('re-bootstraps once and retries on 401', async () => {
    const store = memStore('vt_stale');
    fetchMock
      .mockResolvedValueOnce(emptyRes(401)) // first send 401
      .mockResolvedValueOnce(
        jsonRes(200, { visitorToken: 'vt_fresh', conversationExternalId: 'web:z', expiresAt: 'x' }),
      ) // freshBootstrap
      .mockResolvedValueOnce(
        jsonRes(202, { status: 'accepted', visitorToken: 'vt_fresh2', conversationExternalId: 'web:z' }),
      ); // retry send
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const res = await t.send({ message: 'hi' });

    expect(res).toMatchObject({ status: 'accepted' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Recovery bootstrap carried no visitor header.
    const bootHeaders = callAt(1)[1].headers as Record<string, string>;
    expect(bootHeaders['X-Vitrina-Visitor']).toBeUndefined();
    // Retry send used the fresh token.
    const retryHeaders = callAt(2)[1].headers as Record<string, string>;
    expect(retryHeaders['X-Vitrina-Visitor']).toBe('vt_fresh');
    expect(store.get()).toBe('vt_fresh2');
  });

  it('returns a typed error (no throw) on 403 and on network failure', async () => {
    const store = memStore('vt_1');
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    fetchMock.mockResolvedValueOnce(emptyRes(403));
    await expect(t.send({ message: 'x' })).resolves.toEqual({ error: true, status: 403 });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(t.send({ message: 'x' })).resolves.toEqual({ error: true, status: null });
  });
});

describe('VitrinaTransport.fetchHistory', () => {
  it('GETs /widget/messages?since=<ISO> with Bearer + visitor and unwraps .data.messages', async () => {
    const store = memStore('vt_1');
    const messages: WidgetMessageDto[] = [
      { id: 1, createdAt: '2026-07-01T00:00:00.000Z', content: 'hi', direction: 'inbound', type: null },
    ];
    fetchMock.mockResolvedValueOnce(jsonRes(200, { messages, conversation: { externalId: 'web:a' } }));
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    const since = '2026-07-01T00:00:00.000Z';
    const out = await t.fetchHistory(since);

    expect(out).toEqual(messages);
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/widget/messages?since=${encodeURIComponent(since)}`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PK}`);
    expect(headers['X-Vitrina-Visitor']).toBe('vt_1');
    // GET carries no Content-Type.
    expect(headers['Content-Type']).toBeUndefined();
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'X-Vitrina-Visitor']);
  });

  it('omits the since query when no cursor is given', async () => {
    const store = memStore('vt_1');
    fetchMock.mockResolvedValueOnce(jsonRes(200, { messages: [], conversation: null }));
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    await t.fetchHistory();
    expect(lastCall()[0]).toBe(`${BASE}/widget/messages`);
  });

  it('treats conversation:null + [] as an empty history, not an error', async () => {
    const store = memStore('vt_1');
    fetchMock.mockResolvedValueOnce(jsonRes(200, { messages: [], conversation: null }));
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    await expect(t.fetchHistory()).resolves.toEqual([]);
  });

  it('returns [] (no throw) on 401 when re-bootstrap also fails, and on network error', async () => {
    const store = memStore('vt_1');
    const t = new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, store);
    fetchMock
      .mockResolvedValueOnce(emptyRes(401)) // history 401
      .mockResolvedValueOnce(emptyRes(500)); // freshBootstrap fails
    await expect(t.fetchHistory()).resolves.toEqual([]);
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(t.fetchHistory()).resolves.toEqual([]);
  });
});

describe('mergeMessages', () => {
  it('dedupes strictly by id (incoming wins) and sorts createdAt ascending', () => {
    const existing: WidgetMessageDto[] = [
      { id: 'b', createdAt: '2026-07-01T00:00:02.000Z', content: 'two', direction: 'inbound', type: null },
      { id: 'a', createdAt: '2026-07-01T00:00:01.000Z', content: 'one', direction: 'inbound', type: null },
    ];
    // Overlapping boundary row 'b' (the INCLUSIVE since re-returns it) + a new 'c'.
    const incoming: WidgetMessageDto[] = [
      { id: 'b', createdAt: '2026-07-01T00:00:02.000Z', content: 'two-server', direction: 'inbound', type: null },
      { id: 'c', createdAt: '2026-07-01T00:00:03.000Z', content: 'three', direction: 'outbound', type: null },
    ];
    const merged = mergeMessages(existing, incoming);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    // Exactly one 'b', and incoming (server truth) won.
    expect(merged.filter((m) => m.id === 'b')).toHaveLength(1);
    expect(merged.find((m) => m.id === 'b')?.content).toBe('two-server');
  });

  it('is idempotent when the same message id arrives twice', () => {
    const row: WidgetMessageDto = {
      id: 42,
      createdAt: '2026-07-01T00:00:00.000Z',
      content: 'dup',
      direction: 'outbound',
      type: null,
    };
    const merged = mergeMessages([row], [row]);
    expect(merged).toHaveLength(1);
  });
});
