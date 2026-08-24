// Booking, end to end through init() against a mocked server.
//
// The properties worth a test, in the order they can hurt someone:
//
//   1. A TENANT WITHOUT THE AGENDA GETS TODAY'S WIDGET. Not a hidden chip, not
//      an empty overlay — the nodes are never constructed at all.
//   2. THE VISITOR NEVER LOSES WHAT THEY TYPED. A slot taken while the form was
//      open bounces them back to the hour grid with every field intact.
//   3. THE CONSENT BOX IS REAL. It gates the button and it is sent.
//   4. THE bkt_ IS A CAPABILITY. It lands in the keyring and NEVER in the DOM.
//   5. A DEAD KEY IS DROPPED. A token the server 404s is litter, not a booking.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';
const BOOKINGS_KEY = `vtr:widget:${PK}:bookings`;
const TZ = 'America/Santiago';
const TOKEN = 'bkt_zzzzyyyyxxxxwwwwvvvvuuuuttttssss';

function jsonRes(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
  } as unknown as Response;
}
function errorRes(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
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

interface WireSlot {
  startsAt: string;
  endsAt: string;
  label: string;
  labelLong: string;
  available: boolean;
}

/** One 30-minute block on a given day of the requested month. */
function slot(ym: string, day: string, from: string, to: string, available: boolean): WireSlot {
  return {
    startsAt: `${ym}-${day}T${from}:00-04:00`,
    endsAt: `${ym}-${day}T${to}:00-04:00`,
    label: `${ym}-${day} ${from}`,
    labelLong: `${ym}-${day} ${from}`,
    available,
  };
}

// --- The agenda, generated RELATIVE TO TODAY ---------------------------------
//
// This fixture used to pin day 12 of the current month, which made the suite
// green for eleven days a month and red for the rest: after the 11th the visit
// the happy path books lands in the PAST, so the visits badge counts zero
// upcoming and "Mis visitas · 1" never arrives. Nothing about the widget was
// wrong — the calendar the test drove was.
//
// Everything below is computed from `now`, so the booked slot is always a real
// future hour. Two properties the rest of the suite leans on are preserved by
// construction:
//
//   · BOTH free days live in ONE month, because the grid shows one month and
//     the happy path asserts "2 días con horas" on it. Late in a month that
//     means the second day steps BACK (still tomorrow-or-later) rather than
//     forward into a month nobody is looking at.
//   · EVERY OTHER month still offers one day, so any grid the suite opens has
//     a `.vtr-bk-count` to wait on — including the current month on the few
//     days a year when the agenda itself has moved into the next one.

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function daysInMonthOf(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function buildAgenda(now: Date): {
  ym: string;
  first: string;
  second: string;
  firstKey: string;
  nextMonth: boolean;
} {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
  const forward = first.getDate() + 2 <= daysInMonthOf(first);
  const second = new Date(
    first.getFullYear(),
    first.getMonth(),
    first.getDate() + (forward ? 2 : -2),
  );
  const ym = monthKeyOf(first);
  return {
    ym,
    first: pad2(first.getDate()),
    second: pad2(second.getDate()),
    firstKey: `${ym}-${pad2(first.getDate())}`,
    // today + 3 crossed a month boundary: the grid opens on the current month
    // and the tests have to page forward once to reach the agenda.
    nextMonth: ym !== monthKeyOf(now),
  };
}

const AGENDA = buildAgenda(new Date());

/** The one day any month OUTSIDE the agenda offers. Never clicked, only counted. */
const FILLER_DAY = '15';

/**
 * The agenda's wire for one month. `taken` names the hours that come back
 * unavailable, which is how the dimmed grid and the lost-slot race are driven.
 */
function agendaMonth(ym: string, taken: string[] = ['10:30']): WireSlot[] {
  if (ym !== AGENDA.ym) return [slot(ym, FILLER_DAY, '09:00', '09:30', true)];
  const free = (time: string): boolean => !taken.includes(time);
  return [
    slot(ym, AGENDA.first, '10:00', '10:30', free('10:00')),
    slot(ym, AGENDA.first, '10:30', '11:00', free('10:30')),
    slot(ym, AGENDA.first, '11:00', '11:30', free('11:00')),
    slot(ym, AGENDA.second, '09:00', '09:30', true),
  ];
}

/** Two free days, with one already-taken hour so the dimmed grid is exercised. */
function defaultMonth(ym: string): WireSlot[] {
  return agendaMonth(ym);
}

const APPOINTMENT = {
  displayId: 'A-42',
  status: 'scheduled',
  startsAt: '',
  endsAt: '',
  vehicleId: null,
  customerName: 'Camila Fuentes',
  notes: null,
};

// --- Mutable per-test server behaviour ---------------------------------------
let configData: Record<string, unknown>;
let horizonEnd: string | null;
let monthSlots: (ym: string) => WireSlot[];
let bookResponse: () => Response;
let getBookingResponse: () => Response;
let cancelResponse: () => Response;
let availabilityMonths: string[];
let configGate: Promise<void> | null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  configData = { bookingEnabled: true };
  horizonEnd = null;
  monthSlots = defaultMonth;
  availabilityMonths = [];
  configGate = null;
  bookResponse = () =>
    jsonRes(201, {
      appointment: { ...APPOINTMENT, startsAt: lastPostedStart, endsAt: lastPostedEnd },
      managementToken: TOKEN,
    });
  getBookingResponse = () => emptyRes(404);
  cancelResponse = () => jsonRes(200, { ...APPOINTMENT, status: 'cancelled' });

  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.includes('/widget/config')) {
      const res = jsonRes(200, configData);
      // `configGate` lets a test hold the appearance answer open, which is the
      // only way to exercise what a host page's booking button does during the
      // first few hundred milliseconds of a cold load.
      return configGate ? configGate.then(() => res) : Promise.resolve(res);
    }
    if (u.includes('/widget/appointments/availability')) {
      const from = new URL(u).searchParams.get('from') ?? '';
      const ym = from.slice(0, 7);
      availabilityMonths.push(ym);
      const body: Record<string, unknown> = {
        configured: true,
        timezone: TZ,
        slots: monthSlots(ym),
      };
      if (horizonEnd) body.horizon_end = horizonEnd;
      return Promise.resolve(jsonRes(200, body));
    }
    if (u.includes('/widget/appointments')) {
      if (method === 'POST') {
        const body = JSON.parse(String(opts?.body ?? '{}')) as {
          starts_at?: string;
          ends_at?: string;
        };
        lastPostedStart = body.starts_at ?? '';
        lastPostedEnd = body.ends_at ?? '';
        return Promise.resolve(bookResponse());
      }
      if (method === 'DELETE') return Promise.resolve(cancelResponse());
      return Promise.resolve(getBookingResponse());
    }
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages')) {
      if (method === 'POST') {
        return Promise.resolve(
          jsonRes(202, { status: 'accepted', visitorToken: 'vt_srv', conversationExternalId: 'web:a' }),
        );
      }
      return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    }
    if (u.includes('/widget/stream')) return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    return Promise.resolve(emptyRes(404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

let lastPostedStart = '';
let lastPostedEnd = '';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
});

function shadowOf(): ShadowRoot {
  const host = document.querySelector('[data-vitrina-widget]') as HTMLElement | null;
  if (!host?.shadowRoot) throw new Error('not mounted');
  return host.shadowRoot;
}
function q<T extends Element = HTMLElement>(sel: string): T | null {
  return shadowOf().querySelector(sel) as T | null;
}
function must<T extends Element = HTMLElement>(sel: string): T {
  const el = q<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}
function postCalls(): RequestInit[] {
  return fetchMock.mock.calls
    .filter(
      ([u, o]) =>
        String(u).includes('/widget/appointments') &&
        !String(u).includes('availability') &&
        (o as RequestInit)?.method === 'POST',
    )
    .map(([, o]) => o as RequestInit);
}
function typeInto(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function check(el: HTMLInputElement, value: boolean): void {
  el.checked = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Boot a widget with the panel open and the booking chip mounted.
 *
 * `locale: 'es'` is pinned deliberately: happy-dom's navigator says en-US, and
 * the copy this feature was designed against is es-CL. Asserting the Spanish
 * strings is asserting the design.
 */
async function boot(config: Record<string, unknown> = {}): Promise<ReturnType<typeof init>> {
  const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es', ...config } as never);
  w.open();
  await vi.waitFor(() => expect(q('.vtr-chip-book')).not.toBeNull());
  return w;
}

/** Open the overlay on the month the widget itself picks — always the current one. */
async function openCalendar(): Promise<void> {
  must<HTMLButtonElement>('.vtr-chip-book').click();
  await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-day').length).toBeGreaterThan(0));
  await vi.waitFor(() => expect(q('.vtr-bk-count')).not.toBeNull());
}

/**
 * Open the overlay ON THE AGENDA — the month that actually holds the two free
 * days. Identical to `openCalendar` on most days; near a month boundary it
 * pages forward once, exactly as a visitor would.
 */
async function openAgenda(): Promise<void> {
  await openCalendar();
  if (!AGENDA.nextMonth) return;
  must<HTMLButtonElement>('.vtr-bk-navnext').click();
  // The key carries the year and month, so finding it IS proof the grid moved…
  await vi.waitFor(() =>
    expect(shadowOf().querySelector(`[data-bk-day="${AGENDA.firstKey}"]`)).not.toBeNull(),
  );
  // …and the count is proof that month's availability landed.
  await vi.waitFor(() => expect(must('.vtr-bk-count').textContent).toBe('2 días con horas'));
}

function dayButton(day: string): HTMLButtonElement {
  const el = shadowOf().querySelector(`[data-bk-day$="-${day}"]`) as HTMLButtonElement | null;
  if (!el) throw new Error(`no day ${day}`);
  return el;
}
function slotButton(time: string): HTMLButtonElement {
  const all = [...shadowOf().querySelectorAll('.vtr-bk-slot')] as HTMLButtonElement[];
  const el = all.find((b) => b.textContent === time);
  if (!el) throw new Error(`no slot ${time}`);
  return el;
}

/** Walk fecha → hora → datos and fill the form. Assumes the agenda's month. */
async function fillForm(): Promise<void> {
  dayButton(AGENDA.first).click();
  await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-slot').length).toBe(3));
  slotButton('10:00').click();
  await vi.waitFor(() => expect(q('.vtr-bk-form')).not.toBeNull());
  typeInto(must<HTMLInputElement>('input[type="text"].vtr-bk-input'), 'Camila Fuentes');
  typeInto(must<HTMLInputElement>('input[type="tel"].vtr-bk-input'), '+56 9 6543 2109');
  check(must<HTMLInputElement>('.vtr-bk-check'), true);
}

// ---------------------------------------------------------------------------
// 1. The tenant-off state: today's widget, node for node.
// ---------------------------------------------------------------------------
describe('booking gate', () => {
  it('constructs NOTHING when the tenant has no agenda', async () => {
    configData = {};
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length).toBe(1),
    );
    await Promise.resolve();
    // Not hidden — absent. A tenant who never had booking must not gain a node
    // for having been asked about it.
    expect(q('.vtr-actions')).toBeNull();
    expect(q('.vtr-chip-book')).toBeNull();
    expect(q('.vtr-booking')).toBeNull();
    // …and the panel's children are exactly what they have always been.
    const panel = must('.vtr-panel');
    expect([...panel.children].map((c) => c.className)).toEqual([
      'vtr-header',
      'vtr-messages',
      'vtr-typing',
      'vtr-banner',
      'vtr-composer',
      'vtr-footer',
    ]);
    w.destroy();
  });

  it('never calls a booking route when the tenant has no agenda', async () => {
    configData = {};
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length).toBe(1),
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/widget/appointments'))).toBe(false);
    w.destroy();
  });

  it('mounts the chip when the server says bookingEnabled', async () => {
    const w = await boot();
    expect(must('.vtr-chip-book').textContent).toBe('Agendar visita');
    // "Mis visitas" stays away until this browser actually holds a booking.
    expect((q('.vtr-chip-visits') as HTMLElement).hidden).toBe(true);
    w.destroy();
  });

  it('takes the chip away if the dealer switches booking off mid-session', async () => {
    globalThis.localStorage.setItem(
      `vtr:widget:${PK}:config`,
      JSON.stringify({ bookingEnabled: true }),
    );
    configData = {};
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    // The cached config painted the chip on the first frame…
    expect(q('.vtr-chip-book')).not.toBeNull();
    // …and the live answer takes it back rather than leaving a chip that 404s.
    await vi.waitFor(() => expect((must('.vtr-actions') as HTMLElement).hidden).toBe(true));
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. The happy path.
// ---------------------------------------------------------------------------
describe('fecha → hora → datos → resumen → ok', () => {
  it('walks the whole flow and books', async () => {
    const w = await boot();
    await openAgenda();

    // The counter is the trust device on a thin agenda.
    expect(must('.vtr-bk-count').textContent).toBe('2 días con horas');
    expect(must('.vtr-bk-step').textContent).toBe('Paso 1 de 4');

    await fillForm();
    expect(must('.vtr-bk-step').textContent).toBe('Paso 3 de 4');

    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 4 de 4'));
    expect(must('.vtr-bk-time').textContent).toBe('10:00');

    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(q('.vtr-bk-code')).not.toBeNull());

    // The dealer's OWN reference, mono, labelled — never a second invented id.
    expect(must('.vtr-bk-code').textContent).toBe('A-42');
    expect(must('.vtr-bk-codelabel').textContent).toBe('código de reserva');

    const body = JSON.parse(postCalls()[0].body as string);
    expect(body.name).toBe('Camila Fuentes');
    expect(body.phone).toBe('+56 9 6543 2109');
    expect(body.consent).toBe(true);
    expect(body.starts_at).toContain('T10:00:00-04:00');
    expect(body.ends_at).toContain('T10:30:00-04:00');

    // The capability landed on the keyring…
    const ring = JSON.parse(globalThis.localStorage.getItem(BOOKINGS_KEY) ?? '[]');
    expect(ring).toHaveLength(1);
    expect(ring[0].token).toBe(TOKEN);
    expect(ring[0].displayId).toBe('A-42');
    // …and NOWHERE in the page. A bkt_ in a DOM attribute is a bkt_ in the HTML.
    expect(shadowOf().innerHTML).not.toContain(TOKEN);

    // The chip now offers the visitor their own booking back.
    await vi.waitFor(() => expect(must('.vtr-chip-visits').textContent).toBe('Mis visitas · 1'));
    w.destroy();
  });

  it('sends the host page vehicle with the booking, and shows its label on the summary', async () => {
    const w = await boot({ vehicleId: 'veh_9', vehicleLabel: 'Toyota Yaris 2021' });
    await openAgenda();
    await fillForm();
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 4 de 4'));
    expect(must('.vtr-bk-rowval').textContent).toBe('Toyota Yaris 2021');
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0].body as string).vehicle_id).toBe('veh_9');
    w.destroy();
  });

  it('renders no vehicle line when the page gave an id but no label', async () => {
    const w = await boot({ vehicleId: 'veh_9' });
    await openAgenda();
    await fillForm();
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 4 de 4'));
    // One row only: "tus datos". No placeholder card, no spinner, no empty box.
    expect(shadowOf().querySelectorAll('.vtr-bk-row').length).toBe(1);
    w.destroy();
  });

  it('shows a taken hour DIMMED and disabled rather than removing it', async () => {
    const w = await boot();
    await openAgenda();
    dayButton(AGENDA.first).click();
    await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-slot').length).toBe(3));
    const taken = slotButton('10:30');
    expect(taken.disabled).toBe(true);
    expect(taken.getAttribute('data-taken')).toBe('1');
    // Clicking it does nothing — the agenda looks real, and stays honest.
    taken.click();
    expect(q('.vtr-bk-form')).toBeNull();
    w.destroy();
  });

  it('gates the continue button on nombre + teléfono + consentimiento', async () => {
    const w = await boot();
    await openAgenda();
    dayButton(AGENDA.first).click();
    await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-slot').length).toBe(3));
    slotButton('10:00').click();
    await vi.waitFor(() => expect(q('.vtr-bk-form')).not.toBeNull());

    const primary = must<HTMLButtonElement>('.vtr-bk-primary');
    expect(primary.disabled).toBe(true);
    typeInto(must<HTMLInputElement>('input[type="text"].vtr-bk-input'), 'Camila');
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(true);
    typeInto(must<HTMLInputElement>('input[type="tel"].vtr-bk-input'), '+56 9 1111 1111');
    // Name + phone are not enough: the consent box is real, not decorative.
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(true);
    check(must<HTMLInputElement>('.vtr-bk-check'), true);
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(false);
    // …and unticking it takes the button away again.
    check(must<HTMLInputElement>('.vtr-bk-check'), false);
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(true);
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. The race: someone else booked the hour while the form was open.
// ---------------------------------------------------------------------------
describe('slot taken mid-form', () => {
  it('bounces back to the hour grid, refetches, and keeps every field', async () => {
    const w = await boot();
    await openAgenda();
    await fillForm();
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 4 de 4'));

    // The hour goes while they were reading the summary.
    bookResponse = () =>
      errorRes(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Could not book appointment: slot_taken',
          details: { reason: 'slot_taken' },
        },
      });
    monthSlots = (ym) => agendaMonth(ym, ['10:00', '10:30']);

    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 2 de 4'));
    expect(must('.vtr-bk-error').textContent).toBe('Esa hora se acaba de tomar.');
    // Availability was re-read, so the hour that just went shows as gone.
    await vi.waitFor(() => expect(slotButton('10:00').disabled).toBe(true));

    // Nothing they typed was lost.
    slotButton('11:00').click();
    await vi.waitFor(() => expect(q('.vtr-bk-form')).not.toBeNull());
    expect(must<HTMLInputElement>('input[type="text"].vtr-bk-input').value).toBe('Camila Fuentes');
    expect(must<HTMLInputElement>('input[type="tel"].vtr-bk-input').value).toBe('+56 9 6543 2109');
    expect(must<HTMLInputElement>('.vtr-bk-check').checked).toBe(true);
    // …so the button is live again with no retyping.
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(false);
    w.destroy();
  });

  it('says something different when it is the CAR that is taken', async () => {
    const w = await boot({ vehicleId: 'veh_9' });
    await openAgenda();
    await fillForm();
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 4 de 4'));

    bookResponse = () => errorRes(400, { error: { details: { reason: 'vehicle_taken' } } });
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() =>
      expect(must('.vtr-bk-error').textContent).toBe('Ese auto ya está reservado a esa hora.'),
    );
    w.destroy();
  });

  it('stays on the summary with generic copy for an unexplained refusal', async () => {
    const w = await boot();
    await openAgenda();
    await fillForm();
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 4 de 4'));

    bookResponse = () => errorRes(400, { error: { message: 'Could not book' } });
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() =>
      expect(must('.vtr-bk-error').textContent).toBe('No pudimos agendar. Reintenta.'),
    );
    // Still on the summary, and the button is live again for a retry.
    expect(must('.vtr-bk-step').textContent).toBe('Paso 4 de 4');
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(false);
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Mis visitas + cancel — the keyring is the whole identity.
// ---------------------------------------------------------------------------
describe('mis visitas', () => {
  function seedRing(startsAt: string): void {
    globalThis.localStorage.setItem(
      BOOKINGS_KEY,
      JSON.stringify([{ token: TOKEN, displayId: 'A-42', startsAt }]),
    );
  }
  function future(days = 7): string {
    return new Date(Date.now() + days * 86_400_000).toISOString();
  }

  it('resolves the ring against the server and offers a cancel', async () => {
    const startsAt = future();
    seedRing(startsAt);
    getBookingResponse = () =>
      jsonRes(200, { ...APPOINTMENT, startsAt, endsAt: startsAt, status: 'scheduled' });

    const w = await boot();
    await vi.waitFor(() => expect(must('.vtr-chip-visits').hidden).toBe(false));
    must<HTMLButtonElement>('.vtr-chip-visits').click();
    await vi.waitFor(() => expect(q('.vtr-bk-visit')).not.toBeNull());

    expect(must('.vtr-bk-section').textContent).toBe('Próximas');
    expect(must('.vtr-bk-code-inline').textContent).toBe('A-42');
    expect(must('.vtr-bk-visit-status').textContent).toBe('Agendada');
    expect(q('[data-bk-cancel]')).not.toBeNull();
    // The cancel control is addressed by an opaque ref, never by the token.
    expect(must('[data-bk-cancel]').getAttribute('data-bk-cancel')).not.toContain('bkt_');
    expect(shadowOf().innerHTML).not.toContain(TOKEN);
    w.destroy();
  });

  it('drops a token the server 404s instead of showing a phantom booking', async () => {
    seedRing(future());
    getBookingResponse = () => emptyRes(404);

    const w = await boot();
    must<HTMLButtonElement>('.vtr-chip-visits').click();
    await vi.waitFor(() => expect(must('.vtr-bk-body').textContent).toContain('Todavía no tienes'));
    expect(JSON.parse(globalThis.localStorage.getItem(BOOKINGS_KEY) ?? '[]')).toEqual([]);
    w.destroy();
  });

  it('keeps a booking on screen when the read fails transiently', async () => {
    const startsAt = future();
    seedRing(startsAt);
    getBookingResponse = () => emptyRes(500);

    const w = await boot();
    must<HTMLButtonElement>('.vtr-chip-visits').click();
    await vi.waitFor(() => expect(q('.vtr-bk-visit')).not.toBeNull());
    // A 500 is not a missing booking: the ring's own memory carries the row,
    // and the key survives for the next attempt.
    expect(must('.vtr-bk-code-inline').textContent).toBe('A-42');
    expect(JSON.parse(globalThis.localStorage.getItem(BOOKINGS_KEY) ?? '[]')).toHaveLength(1);
    w.destroy();
  });

  it('cancels with a destructive confirm whose soft path carries the weight', async () => {
    const startsAt = future();
    seedRing(startsAt);
    getBookingResponse = () =>
      jsonRes(200, { ...APPOINTMENT, startsAt, endsAt: startsAt, status: 'scheduled' });
    cancelResponse = () =>
      jsonRes(200, { ...APPOINTMENT, startsAt, endsAt: startsAt, status: 'cancelled' });

    const w = await boot();
    must<HTMLButtonElement>('.vtr-chip-visits').click();
    await vi.waitFor(() => expect(q('[data-bk-cancel]')).not.toBeNull());
    must<HTMLButtonElement>('[data-bk-cancel]').click();
    await vi.waitFor(() => expect(q('.vtr-bk-warn')).not.toBeNull());

    expect(must('.vtr-bk-warn').textContent).toBe(
      'Es permanente. La hora se libera para otra persona.',
    );
    // The PRIMARY button keeps the visit; cancelling is the quiet secondary.
    expect(must('.vtr-bk-primary').textContent).toBe('Mantener la visita');
    expect(must('.vtr-bk-secondary').textContent).toBe('Sí, cancelar');

    must<HTMLButtonElement>('.vtr-bk-secondary').click();
    await vi.waitFor(() =>
      expect(must('.vtr-bk-title').textContent).toBe('Visita cancelada'),
    );
    // The freed hour stays visible, struck through, and the only next step is
    // to book again.
    expect(must('.vtr-bk-when').getAttribute('data-struck')).toBe('1');
    expect(must('.vtr-bk-primary').textContent).toBe('Volver a agendar');

    const deletes = fetchMock.mock.calls.filter(
      ([, o]) => (o as RequestInit)?.method === 'DELETE',
    );
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0][0])).toContain(encodeURIComponent(TOKEN));
    // The receipt stays on the ring: it is the visitor's own history.
    expect(JSON.parse(globalThis.localStorage.getItem(BOOKINGS_KEY) ?? '[]')).toHaveLength(1);
    w.destroy();
  });

  it('backs out of the confirm without touching the server', async () => {
    const startsAt = future();
    seedRing(startsAt);
    getBookingResponse = () =>
      jsonRes(200, { ...APPOINTMENT, startsAt, endsAt: startsAt, status: 'scheduled' });

    const w = await boot();
    must<HTMLButtonElement>('.vtr-chip-visits').click();
    await vi.waitFor(() => expect(q('[data-bk-cancel]')).not.toBeNull());
    must<HTMLButtonElement>('[data-bk-cancel]').click();
    await vi.waitFor(() => expect(q('.vtr-bk-warn')).not.toBeNull());
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(q('.vtr-bk-visit')).not.toBeNull());
    expect(fetchMock.mock.calls.some(([, o]) => (o as RequestInit)?.method === 'DELETE')).toBe(false);
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Dead ends hand the visitor to a human, never to a wall.
// ---------------------------------------------------------------------------
describe('escape hatches', () => {
  it('offers the chat on an empty month and prefills the composer', async () => {
    monthSlots = () => [];
    const w = await boot();
    must<HTMLButtonElement>('.vtr-chip-book').click();
    await vi.waitFor(() => expect(q('.vtr-bk-empty')).not.toBeNull());
    expect(must('.vtr-bk-empty-title').textContent).toMatch(/^No hay horas en /);

    must<HTMLButtonElement>('[data-bk-fallback="writeUsDraft"]').click();
    // Overlay closed, transcript uncovered, words already typed.
    expect(must('.vtr-booking').hidden).toBe(true);
    expect(must('.vtr-panel').getAttribute('data-booking')).toBeNull();
    expect(must<HTMLTextAreaElement>('.vtr-input').value).toBe(
      'Hola, quiero agendar una visita. ¿Me avisan cuando haya horas?',
    );
    w.destroy();
  });

  it('offers the chat for the cross-device case on Mis visitas', async () => {
    globalThis.localStorage.setItem(
      BOOKINGS_KEY,
      JSON.stringify([{ token: TOKEN, displayId: 'A-1', startsAt: new Date().toISOString() }]),
    );
    getBookingResponse = () => emptyRes(404);
    const w = await boot();
    must<HTMLButtonElement>('.vtr-chip-visits').click();
    await vi.waitFor(() => expect(q('[data-bk-fallback="otherDeviceDraft"]')).not.toBeNull());
    expect(must('[data-bk-fallback="otherDeviceDraft"]').textContent).toContain(
      '¿Reservaste en otro dispositivo?',
    );
    must<HTMLButtonElement>('[data-bk-fallback="otherDeviceDraft"]').click();
    expect(must<HTMLTextAreaElement>('.vtr-input').value).toBe(
      'Hola, reservé una visita desde otro dispositivo y quiero verla.',
    );
    w.destroy();
  });

  it('offers a retry, not a dead screen, when availability fails', async () => {
    const w = await boot();
    fetchMock.mockImplementationOnce((url: string) => {
      if (String(url).includes('availability')) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(emptyRes(404));
    });
    must<HTMLButtonElement>('.vtr-chip-book').click();
    await vi.waitFor(() =>
      expect(must('.vtr-bk-error').textContent).toContain('No pudimos cargar la agenda.'),
    );
    must<HTMLButtonElement>('[data-bk-retry]').click();
    await vi.waitFor(() => expect(q('.vtr-bk-count')).not.toBeNull());
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 6. The horizon: never a month the agenda cannot answer for.
// ---------------------------------------------------------------------------
describe('booking horizon', () => {
  it('disables forward navigation past the horizon and says why', async () => {
    const now = new Date();
    horizonEnd = new Date(now.getFullYear(), now.getMonth(), 15, 23, 59, 59).toISOString();
    const w = await boot();
    await openCalendar();
    const next = must<HTMLButtonElement>('.vtr-bk-navnext');
    expect(next.disabled).toBe(true);
    // A disabled chevron with no explanation reads as a broken widget.
    expect(must('.vtr-bk-note').textContent).toMatch(/^El concesionario abre su agenda hasta el /);
    // …and it genuinely cannot be navigated past.
    next.click();
    expect(availabilityMonths).toHaveLength(1);
    w.destroy();
  });

  it('navigates freely when the server never sent a horizon (older API)', async () => {
    const w = await boot();
    await openCalendar();
    const next = must<HTMLButtonElement>('.vtr-bk-navnext');
    expect(next.disabled).toBe(false);
    next.click();
    await vi.waitFor(() => expect(availabilityMonths).toHaveLength(2));
    // One call per month change — never a prefetch.
    expect(availabilityMonths[1]).not.toBe(availabilityMonths[0]);
    // Coming back is free: the month is already cached.
    must<HTMLButtonElement>('[data-bk-nav="prev"]').click();
    await vi.waitFor(() => expect(q('.vtr-bk-count')).not.toBeNull());
    expect(availabilityMonths).toHaveLength(2);
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 7. The host page's own booking button: instance.openBooking().
// ---------------------------------------------------------------------------
describe('openBooking() on the public handle', () => {
  it('opens the calendar directly, without the visitor finding the chip', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' } as never);
    await vi.waitFor(() => expect(q('.vtr-chip-book')).not.toBeNull());
    expect(w.openBooking()).toBe(true);
    // The panel came with it — the overlay is laid OVER a conversation, never
    // floated on its own.
    expect(must('.vtr-panel').hidden).toBe(false);
    await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-day').length).toBeGreaterThan(0));
    w.destroy();
  });

  it('falls back to the panel and finishes the job when the gate answers late', async () => {
    let openGate = (): void => {};
    configGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' } as never);
    // The click lands before the server has said whether this tenant has an
    // agenda at all, so the honest answer is "not yet".
    expect(w.openBooking()).toBe(false);
    expect(q('.vtr-booking')).toBeNull();
    openGate();
    // …and the ask is honoured rather than dropped: the calendar arrives with
    // the answer, with nothing more asked of the visitor.
    await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-day').length).toBeGreaterThan(0));
    w.destroy();
  });

  it('withdraws a deferred open when the visitor closes the panel first', async () => {
    let openGate = (): void => {};
    configGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' } as never);
    expect(w.openBooking()).toBe(false);
    w.close();
    openGate();
    // The chip mounts, because the tenant does take bookings…
    await vi.waitFor(() => expect(q('.vtr-chip-book')).not.toBeNull());
    // …but nothing opens itself over a visitor who walked away.
    expect((q('.vtr-booking') as HTMLElement | null)?.hidden ?? true).toBe(true);
    expect(availabilityMonths).toHaveLength(0);
    w.destroy();
  });

  it('gives a booking-off tenant the conversation, and constructs no overlay', async () => {
    configData = {};
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' } as never);
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length).toBe(1),
    );
    expect(w.openBooking()).toBe(false);
    expect(must('.vtr-panel').hidden).toBe(false);
    expect(q('.vtr-booking')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/widget/appointments'))).toBe(false);
    w.destroy();
  });
});
