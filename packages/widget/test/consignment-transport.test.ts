// The consignment half of the /widget contract — the one MULTIPART call.
//
// Four properties this file exists to pin:
//
//   1. THE BROWSER OWNS Content-Type. We send Authorization and nothing else;
//      a hand-written multipart header has no boundary, and a body without a
//      boundary is a body the server cannot parse.
//   2. 201 AND 200 ARE BOTH SUCCESSES. A duplicate is the dealer already having
//      the car — the visitor's ask, satisfied.
//   3. 415 IS ITS OWN ANSWER. It is the only refusal with a different thing to
//      say to the visitor, so it is the only one with its own reason.
//   4. NOTHING THROWS. A dead network is `{ok:false, reason:'network'}`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport } from '../src/transport';
import type { TokenStore } from '../src/token-store';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_consign';

function memStore(): TokenStore {
  let value: string | null = 'vt_live';
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

let fetchMock: ReturnType<typeof vi.fn>;

function transport(): VitrinaTransport {
  return new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
}

function lastCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return [String(call[0]), call[1] as RequestInit];
}

const FIELDS = {
  patente: 'BCDF12',
  marca: 'Toyota',
  modelo: 'Yaris',
  anio: '2019',
  kilometros: '42000',
  plazo_venta: '15d',
  region_code: '13',
  nombre: 'Camila Fuentes',
  consent_granted: 'true',
  consent_source_url: 'https://alport.cl/usados/yaris',
  consent_text_version: 'widget-0.9',
  hp_website: '',
};

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(jsonRes(201, { status: 'received' })));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('submitConsignment', () => {
  it('posts multipart with the key on both the header and the query', async () => {
    await transport().submitConsignment(FIELDS, []);
    const [url, opts] = lastCall();
    expect(url).toBe(`${BASE}/widget/consignments?siteKey=${PK}`);
    expect(opts.method).toBe('POST');
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PK}`);
    // The two headers that must NOT be here: one would break the body, the
    // other is not part of this call's authorisation at all.
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['X-Vitrina-Visitor']).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('carries every field, and the photos under one repeated name', async () => {
    const photos = [
      new File(['a'], 'frente.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'lateral.jpg', { type: 'image/jpeg' }),
    ];
    await transport().submitConsignment(FIELDS, photos);
    const body = lastCall()[1].body as FormData;
    for (const [key, value] of Object.entries(FIELDS)) {
      expect(body.get(key), key).toBe(value);
    }
    const sent = body.getAll('fotos');
    expect(sent).toHaveLength(2);
    expect((sent[0] as File).name).toBe('frente.jpg');
  });

  it('reads a 201 as received', async () => {
    await expect(transport().submitConsignment(FIELDS, [])).resolves.toEqual({
      ok: true,
      status: 'received',
    });
  });

  it('reads a 200 as a duplicate, which is still a success', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { status: 'duplicate' }));
    await expect(transport().submitConsignment(FIELDS, [])).resolves.toEqual({
      ok: true,
      status: 'duplicate',
    });
  });

  it('believes the body over the status code when they disagree', async () => {
    // A server that answers 200 for a fresh row and says so.
    fetchMock.mockResolvedValue(jsonRes(200, { status: 'received' }));
    await expect(transport().submitConsignment(FIELDS, [])).resolves.toEqual({
      ok: true,
      status: 'received',
    });
  });

  it('still succeeds when the success has no readable body', async () => {
    fetchMock.mockResolvedValue(emptyRes(201));
    await expect(transport().submitConsignment(FIELDS, [])).resolves.toEqual({
      ok: true,
      status: 'received',
    });
  });

  it('reports a 415 as a photo problem, and everything else as retryable', async () => {
    fetchMock.mockResolvedValue(emptyRes(415));
    await expect(transport().submitConsignment(FIELDS, [])).resolves.toEqual({
      ok: false,
      reason: 'photos',
    });
    for (const status of [400, 404, 429, 500]) {
      fetchMock.mockResolvedValue(emptyRes(status));
      await expect(transport().submitConsignment(FIELDS, [])).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('never throws on a dead network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(transport().submitConsignment(FIELDS, [])).resolves.toEqual({
      ok: false,
      reason: 'network',
    });
  });
});
