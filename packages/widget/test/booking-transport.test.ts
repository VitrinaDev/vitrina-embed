// The booking half of the /widget contract.
//
// Three properties this file exists to pin:
//
//   1. NOTHING THROWS. Every method answers {ok,status[,reason]} — a dead
//      network, a 404 from a tenant with the agenda off, a 201 we cannot parse.
//      A dealer's chat widget must never take their page down for a calendar.
//   2. BOOKING IS NOT VISITOR-SCOPED. No X-Vitrina-Visitor, and no re-bootstrap
//      retry on 401. A 401 here means the key or the origin is wrong, which
//      minting a new visitor token cannot fix.
//   3. THE REFUSAL REASON IS STRUCTURED. `details.reason` is the contract; the
//      English sentence beside it is not, and must never be string-matched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport } from '../src/transport';
import type { TokenStore } from '../src/token-store';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';
const TOKEN = 'bkt_abcdefghijklmnopqrstuvwxyz012345';

function memStore(initial: string | null = 'vt_live'): TokenStore {
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
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
  } as unknown as Response;
}

function errorRes(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
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

function makeTransport(): VitrinaTransport {
  return new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
}

const SLOT = {
  startsAt: '2026-08-12T10:00:00-04:00',
  endsAt: '2026-08-12T10:30:00-04:00',
  label: '2026-08-12 10:00',
  labelLong: 'miércoles, 12 de agosto, 10:00',
  available: true,
};

const APPOINTMENT = {
  displayId: 'A-42',
  status: 'scheduled',
  startsAt: '2026-08-12T10:00:00-04:00',
  endsAt: '2026-08-12T10:30:00-04:00',
  vehicleId: 'veh_9',
  customerName: 'Camila Fuentes',
  notes: 'Contacto: +56 9 6543 2109',
};

describe('VitrinaTransport.fetchAvailability', () => {
  it('GETs the availability route with from/to/vehicle_id/include_taken + siteKey', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, { configured: true, timezone: 'America/Santiago', slots: [SLOT] }),
    );
    const t = makeTransport();
    const res = await t.fetchAvailability({
      from: '2026-08-01T00:00:00-04:00',
      to: '2026-08-31T23:59:59-04:00',
      vehicleId: 'veh_9',
      includeTaken: true,
    });

    expect(res).toMatchObject({ ok: true });
    const [url, init] = lastCall();
    const parsed = new URL(url);
    expect(parsed.pathname.endsWith('/widget/appointments/availability')).toBe(true);
    expect(parsed.searchParams.get('from')).toBe('2026-08-01T00:00:00-04:00');
    expect(parsed.searchParams.get('to')).toBe('2026-08-31T23:59:59-04:00');
    expect(parsed.searchParams.get('vehicle_id')).toBe('veh_9');
    expect(parsed.searchParams.get('include_taken')).toBe('1');
    expect(parsed.searchParams.get('siteKey')).toBe(PK);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('carries the Bearer and NO visitor header (a booking is not visitor-scoped)', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { configured: true, timezone: null, slots: [] }));
    const t = makeTransport();
    await t.fetchAvailability({ from: 'a', to: 'b' });
    const headers = lastCall()[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PK}`);
    expect(Object.keys(headers)).toEqual(['Authorization']);
    expect((lastCall()[1] as { credentials?: string }).credentials).toBeUndefined();
  });

  it('omits vehicle_id and include_taken when not asked for', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { configured: true, timezone: null, slots: [] }));
    const t = makeTransport();
    await t.fetchAvailability({ from: 'a', to: 'b' });
    const parsed = new URL(lastCall()[0]);
    expect(parsed.searchParams.has('vehicle_id')).toBe(false);
    expect(parsed.searchParams.has('include_taken')).toBe(false);
  });

  it('accepts the horizon in EITHER casing (the schedule engine speaks snake_case)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, {
        configured: true,
        timezone: 'America/Santiago',
        slots: [],
        horizon_end: '2026-08-15T23:59:59-04:00',
        booking_horizon_days: 14,
      }),
    );
    const t = makeTransport();
    const res = await t.fetchAvailability({ from: 'a', to: 'b' });
    expect(res.ok && res.data.horizonEnd).toBe('2026-08-15T23:59:59-04:00');
    expect(res.ok && res.data.bookingHorizonDays).toBe(14);

    fetchMock.mockResolvedValueOnce(
      jsonRes(200, {
        configured: true,
        timezone: null,
        slots: [],
        horizonEnd: '2026-09-01T00:00:00-04:00',
      }),
    );
    const camel = await t.fetchAvailability({ from: 'a', to: 'b' });
    expect(camel.ok && camel.data.horizonEnd).toBe('2026-09-01T00:00:00-04:00');
  });

  // Graceful degradation against an older server: no `available` on the slots
  // means "this list is available-only", and the widget must be able to SEE
  // that rather than assume a dimmed grid it cannot draw.
  it('leaves `available` absent when the server did not answer include_taken', async () => {
    const { available: _drop, ...bare } = SLOT;
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, { configured: true, timezone: null, slots: [bare] }),
    );
    const t = makeTransport();
    const res = await t.fetchAvailability({ from: 'a', to: 'b' });
    expect(res.ok && res.data.slots[0]).not.toHaveProperty('available');
  });

  it('drops garbage slots instead of failing the whole read', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(200, { configured: true, timezone: null, slots: [SLOT, null, { label: 'x' }, 7] }),
    );
    const t = makeTransport();
    const res = await t.fetchAvailability({ from: 'a', to: 'b' });
    expect(res.ok && res.data.slots).toHaveLength(1);
  });

  it('never throws: 404 (tenant with booking off) and a dead network', async () => {
    const t = makeTransport();
    fetchMock.mockResolvedValueOnce(emptyRes(404));
    await expect(t.fetchAvailability({ from: 'a', to: 'b' })).resolves.toEqual({
      ok: false,
      status: 404,
    });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(t.fetchAvailability({ from: 'a', to: 'b' })).resolves.toEqual({
      ok: false,
      status: null,
    });
  });
});

describe('VitrinaTransport.bookAppointment', () => {
  it('POSTs a pure snake_case body with consent:true', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(201, { appointment: APPOINTMENT, managementToken: TOKEN }),
    );
    const t = makeTransport();
    const res = await t.bookAppointment({
      startsAt: SLOT.startsAt,
      endsAt: SLOT.endsAt,
      name: 'Camila Fuentes',
      phone: '+56 9 6543 2109',
      email: 'camila@example.cl',
      vehicleId: 'veh_9',
    });

    expect(res).toMatchObject({ ok: true });
    expect(res.ok && res.data.appointment.displayId).toBe('A-42');
    expect(res.ok && res.data.managementToken).toBe(TOKEN);

    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/widget/appointments?siteKey=${PK}`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      starts_at: SLOT.startsAt,
      ends_at: SLOT.endsAt,
      name: 'Camila Fuentes',
      consent: true,
      phone: '+56 9 6543 2109',
      email: 'camila@example.cl',
      vehicle_id: 'veh_9',
    });
    // The `.strict()` body schema 400s on an unknown key, so camelCase leakage
    // is not a cosmetic problem here — it is a rejected booking.
    expect(Object.keys(body)).not.toContain('startsAt');
    expect(Object.keys(body)).not.toContain('vehicleId');
  });

  it('omits every optional field the visitor left blank', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes(201, { appointment: APPOINTMENT, managementToken: TOKEN }),
    );
    const t = makeTransport();
    await t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' });
    const body = JSON.parse(lastCall()[1].body as string);
    expect(body).toEqual({ starts_at: 'a', ends_at: 'b', name: 'Ana', consent: true });
  });

  it('sends no visitor header and does NOT re-bootstrap on 401', async () => {
    fetchMock.mockResolvedValueOnce(emptyRes(401));
    const t = makeTransport();
    const res = await t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' });
    expect(res).toEqual({ ok: false, status: 401 });
    // Exactly one call: no /widget/conversations recovery round-trip.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = lastCall()[1].headers as Record<string, string>;
    expect(headers['X-Vitrina-Visitor']).toBeUndefined();
  });

  it('surfaces the ledger refusal from details.reason, never from the message', async () => {
    const t = makeTransport();
    for (const reason of ['slot_taken', 'vehicle_taken', 'not_configured', 'blocked', 'invalid']) {
      fetchMock.mockResolvedValueOnce(
        errorRes(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: `Could not book appointment: ${reason}`,
            details: { reason },
          },
        }),
      );
      const res = await t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' });
      expect(res).toEqual({ ok: false, status: 400, reason });
    }
  });

  it('degrades to a bare failure when the refusal carries no details (older server)', async () => {
    fetchMock.mockResolvedValueOnce(
      errorRes(400, { error: { code: 'VALIDATION_ERROR', message: 'Could not book' } }),
    );
    const t = makeTransport();
    await expect(
      t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' }),
    ).resolves.toEqual({ ok: false, status: 400 });
  });

  it('ignores a reason outside the known vocabulary', async () => {
    fetchMock.mockResolvedValueOnce(
      errorRes(400, { error: { details: { reason: 'the_moon_was_full' } } }),
    );
    const t = makeTransport();
    await expect(
      t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' }),
    ).resolves.toEqual({ ok: false, status: 400 });
  });

  // A 201 whose token we cannot read is NOT a booking: reporting success would
  // tell the visitor their visit is confirmed while dropping the only thing
  // that could ever cancel it.
  it('treats a 201 without a usable token as a failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(201, { appointment: APPOINTMENT }));
    const t = makeTransport();
    await expect(
      t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' }),
    ).resolves.toEqual({ ok: false, status: 201 });
  });

  it('never throws on a dead network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const t = makeTransport();
    await expect(
      t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' }),
    ).resolves.toEqual({ ok: false, status: null });
  });
});

describe('VitrinaTransport.fetchBooking', () => {
  it('GETs /widget/appointments/:token with the token URL-encoded', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, APPOINTMENT));
    const t = makeTransport();
    const res = await t.fetchBooking('bkt_a/b+c');
    expect(res).toMatchObject({ ok: true });
    const [url, init] = lastCall();
    expect(url).toBe(
      `${BASE}/widget/appointments/${encodeURIComponent('bkt_a/b+c')}?siteKey=${PK}`,
    );
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers)).toEqual(['Authorization']);
  });

  it('reports 404 (the only miss signal) so the caller can drop a dead key', async () => {
    fetchMock.mockResolvedValueOnce(emptyRes(404));
    const t = makeTransport();
    await expect(t.fetchBooking(TOKEN)).resolves.toEqual({ ok: false, status: 404 });
  });
});

describe('VitrinaTransport.cancelBooking', () => {
  it('sends a real DELETE and carries no Content-Type (there is no body)', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { ...APPOINTMENT, status: 'cancelled' }));
    const t = makeTransport();
    const res = await t.cancelBooking(TOKEN);
    expect(res.ok && res.data.status).toBe('cancelled');
    const [url, init] = lastCall();
    expect(url).toBe(`${BASE}/widget/appointments/${TOKEN}?siteKey=${PK}`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(Object.keys(headers)).toEqual(['Authorization']);
  });

  it('never throws on 404 or a dead network', async () => {
    const t = makeTransport();
    fetchMock.mockResolvedValueOnce(emptyRes(404));
    await expect(t.cancelBooking(TOKEN)).resolves.toEqual({ ok: false, status: 404 });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(t.cancelBooking(TOKEN)).resolves.toEqual({ ok: false, status: null });
  });
});
