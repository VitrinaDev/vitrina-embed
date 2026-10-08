// The clinic widget finishes the booking the way the hosted page does
// (vitrina-embed#18), end to end through init() against a mocked server.
//
// What it pins:
//
//   1. PAY. A deposit booking shows the clinic's own Mercado Pago link (new
//      tab, https only), and the confirmation re-reads the booking until the
//      payment flips it from «Pendiente de pago» to confirmed.
//   2. RESUME. The details step saves a booking draft carrying the unchecked
//      WhatsApp box, the page to come back to and the ad click; the booking
//      sends the draft token; `?vt_draft=` on the page reopens the widget at
//      the draft (details filled in, or the hours when the slot went).
//   3. MANAGE. Change and cancel run from the confirmation through the
//      booking's manage token, and only through the widget's own routes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_clinic';
const TZ = 'America/Santiago';
const MANAGE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJwIjoibWFuYWdlIn0.c2lnbmF0dXJl';
const DRAFT_TOKEN = 'drft_0123456789abcdefghijklmnopqrstuv';
const CHECKOUT = 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc';

const SVC_EVAL = '11111111-1111-4111-8111-111111111111';
const SVC_DEPOSIT = '22222222-2222-4222-8222-222222222222';
const PRO_ANA = '33333333-3333-4333-8333-333333333333';

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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
const target = (() => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
  return {
    ym: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
    key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    nextMonth: d.getMonth() !== now.getMonth(),
  };
})();
const at = (hh: string) => `${target.key}T${hh}:00-03:00`;

function slot(from: string, to: string) {
  return {
    starts_at: at(from),
    ends_at: at(to),
    label: `lunes ${from}`,
    slot_ref: `ncl1_${from}`,
    professional_id: PRO_ANA,
    professional_name: 'Ana Rojas',
  };
}

const LANDING = {
  slug: 'agenda-web',
  title: 'Reserva tu hora',
  welcome_text: null,
  primary_color: '#0E7C66',
  logo_url: null,
  timezone: TZ,
  allow_any_professional: false,
  require_document: false,
  horizon_days: 30,
  location: { id: 'loc-1', name: 'Vitacura', address: null },
  services: [
    { id: SVC_EVAL, name: 'Evaluación inicial', duration_minutes: 45, price_clp: 45000, deposit_required: false, deposit_amount_clp: null },
    { id: SVC_DEPOSIT, name: 'Sesión de tratamiento', duration_minutes: 30, price_clp: 35000, deposit_required: true, deposit_amount_clp: 29000 },
  ],
  professionals: [{ id: PRO_ANA, name: 'Ana Rojas', especialidad: 'Kinesióloga', service_ids: [] }],
};

let fetchMock: ReturnType<typeof vi.fn>;
let checkoutUrl: string | null;
let apptStatus: string;
let apptStartsAt: string;
let draftResume: Record<string, unknown> | null;
const bookings: Array<Record<string, unknown>> = [];
const drafts: Array<Record<string, unknown>> = [];
const actions: Array<Record<string, unknown>> = [];

function appointment() {
  return {
    display_id: 'A-91',
    starts_at: apptStartsAt,
    ends_at: apptStartsAt,
    status: apptStatus,
    professional_name: 'Ana Rojas',
    clinic_name: 'Clínica Suelo Pélvico',
    location_name: 'Vitacura',
    timezone: TZ,
    can_manage: apptStatus !== 'cancelled',
    reason: apptStatus === 'cancelled' ? 'Esta hora ya fue cancelada.' : null,
  };
}

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
  } catch {
    /* ignore */
  }
  window.history.replaceState({}, '', '/');
  checkoutUrl = CHECKOUT;
  apptStatus = 'pending_hold';
  apptStartsAt = at('10:00');
  draftResume = null;
  bookings.length = 0;
  drafts.length = 0;
  actions.length = 0;
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    const body = opts?.body ? (JSON.parse(String(opts.body)) as Record<string, unknown>) : {};
    if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, { clinicBooking: { enabled: true } }));
    if (u.includes('/widget/clinic/landing')) return Promise.resolve(jsonRes(200, LANDING));
    if (u.includes('/widget/clinic/availability')) {
      const inMonth = (new URL(u).searchParams.get('from') ?? '').slice(0, 7) === target.ym;
      return Promise.resolve(
        jsonRes(200, { timezone: TZ, slots: inMonth ? [slot('10:00', '10:30'), slot('11:00', '11:30')] : [] }),
      );
    }
    if (u.includes('/widget/clinic/bookings') && method === 'POST') {
      bookings.push(body);
      const deposit = body.service_id === SVC_DEPOSIT;
      apptStartsAt = String(body.starts_at);
      apptStatus = deposit ? 'pending_hold' : 'confirmed';
      return Promise.resolve(
        jsonRes(201, {
          display_id: 'A-91',
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          professional_name: 'Ana Rojas',
          service_name: deposit ? 'Sesión de tratamiento' : 'Evaluación inicial',
          location_name: 'Vitacura',
          manage_url: `https://api.example.com/api/v1/public/clinic/appt/${MANAGE_TOKEN}`,
          deposit: deposit
            ? {
                required: true,
                amount_clp: 29000,
                deadline: at('09:00'),
                accounts: [
                  {
                    bank: 'Banco de Chile',
                    account_type: 'Cuenta corriente',
                    account_number: '00-123-45678-09',
                    holder_name: 'Clínica Suelo Pélvico SpA',
                    holder_rut: '76.123.456-7',
                  },
                ],
                instructions: 'agent-only text',
                checkout_url: checkoutUrl,
              }
            : { required: false, amount_clp: null, deadline: null, accounts: [], instructions: null, checkout_url: null },
          confirmation: { sent: true, reason: null },
        }),
      );
    }
    if (u.includes('/widget/clinic/drafts/') && method === 'GET') {
      return Promise.resolve(draftResume ? jsonRes(200, draftResume) : emptyRes(404));
    }
    if (u.includes('/widget/clinic/drafts') && method === 'POST') {
      drafts.push(body);
      return Promise.resolve(jsonRes(200, { draft_token: DRAFT_TOKEN, status: 'open', consent_whatsapp: body.consent_whatsapp }));
    }
    if (u.includes(`/widget/clinic/appointments/${MANAGE_TOKEN}/availability`)) {
      return Promise.resolve(jsonRes(200, { timezone: TZ, slots: [slot('11:00', '11:30'), slot('12:00', '12:30')] }));
    }
    if (u.includes(`/widget/clinic/appointments/${MANAGE_TOKEN}`)) {
      if (method === 'POST') {
        actions.push(body);
        if (body.action === 'cancel') apptStatus = 'cancelled';
        if (body.action === 'reschedule') apptStartsAt = String(body.starts_at);
      }
      return Promise.resolve(jsonRes(200, appointment()));
    }
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }));
    }
    if (u.includes('/widget/messages')) return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    return Promise.resolve(emptyRes(404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

const instances: Array<{ destroy(): void }> = [];

afterEach(() => {
  // A live instance keeps its payment watch; tear every one down so no test
  // reads another's polling.
  for (const w of instances.splice(0)) w.destroy();
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
function step(): string | null {
  return shadowOf().querySelector('.vtr-booking')?.getAttribute('data-step') ?? null;
}
function typeInto(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function check(el: HTMLInputElement, value: boolean): void {
  el.checked = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function inputs(): HTMLInputElement[] {
  return Array.from(shadowOf().querySelectorAll<HTMLInputElement>('.vtr-bk-form .vtr-bk-input'));
}
function dataConsent(): HTMLInputElement {
  return must<HTMLInputElement>('.vtr-bk-check:not([data-bk-consent-whatsapp])');
}
function whatsappConsent(): HTMLInputElement {
  return must<HTMLInputElement>('[data-bk-consent-whatsapp]');
}

function start() {
  const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' } as never);
  instances.push(w);
  return w;
}

async function boot() {
  const w = start();
  w.open();
  await vi.waitFor(() => expect(q('.vtr-chip-book')).not.toBeNull());
  return w;
}

/** On the calendar: next month if needed, then the target day enabled. */
async function onTargetDay(): Promise<void> {
  if (target.nextMonth) {
    await vi.waitFor(() => expect(q('.vtr-bk-navnext')).not.toBeNull());
    must<HTMLButtonElement>('.vtr-bk-navnext').click();
  }
  await vi.waitFor(() => expect(q<HTMLButtonElement>(`[data-bk-day="${target.key}"]`)?.disabled).toBe(false));
}

async function clickSlot(time: string): Promise<void> {
  await vi.waitFor(() => expect(q('.vtr-bk-slot')).not.toBeNull());
  const btn = Array.from(shadowOf().querySelectorAll<HTMLButtonElement>('.vtr-bk-slot')).find(
    (b) => b.textContent === time,
  );
  if (!btn) throw new Error(`no ${time} slot`);
  btn.click();
}

async function toDetails(service: string): Promise<void> {
  must<HTMLButtonElement>('.vtr-chip-book').click();
  await vi.waitFor(() => expect(q(`[data-bk-service="${service}"]`)).not.toBeNull());
  must<HTMLButtonElement>(`[data-bk-service="${service}"]`).click();
  await onTargetDay();
  must<HTMLButtonElement>(`[data-bk-day="${target.key}"]`).click();
  await clickSlot('10:00');
  await vi.waitFor(() => expect(step()).toBe('datos'));
}

async function book(service: string): Promise<void> {
  await toDetails(service);
  const [name, phone] = inputs();
  typeInto(name, 'Camila Fuentes');
  typeInto(phone, '+56 9 8765 4321');
  check(dataConsent(), true);
  must<HTMLButtonElement>('.vtr-bk-primary').click();
  await vi.waitFor(() => expect(step()).toBe('resumen'));
  must<HTMLButtonElement>('.vtr-bk-primary').click();
  await vi.waitFor(() => expect(step()).toBe('ok'));
}

describe('clinic widget: pay (embed#18)', () => {
  it('shows the Mercado Pago link for a deposit and flips to confirmed once the payment lands', async () => {
    await boot();
    await book(SVC_DEPOSIT);

    expect(must('.vtr-bk-title').textContent).toBe('Hora reservada');
    expect(must('[data-bk-status]').textContent).toBe('Pendiente de pago');
    const pay = must<HTMLAnchorElement>('[data-bk-pay]');
    expect(pay.textContent).toBe('Pagar con Mercado Pago');
    expect(pay.href).toBe(CHECKOUT);
    expect(pay.target).toBe('_blank');
    expect(pay.rel).toContain('noopener');
    // The transfer stays as the alternative, and the agent's text never shows.
    expect(must('.vtr-bk-or').textContent).toBe('O transfiere:');
    expect(must('.vtr-bk-account').textContent).toContain('00-123-45678-09');
    expect(must('.vtr-bk-deposit').textContent).not.toContain('agent-only');

    // Still unpaid on the first re-read: nothing changes.
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith(`/widget/clinic/appointments/${MANAGE_TOKEN}`) || String(u).includes(`/widget/clinic/appointments/${MANAGE_TOKEN}?`))).toBe(true),
    );
    // Let that read settle before the payment lands.
    await new Promise((r) => setTimeout(r, 30));
    expect(must('[data-bk-status]').textContent).toBe('Pendiente de pago');

    // Mercado Pago's notification confirmed the hold server-side; the patient
    // comes back to the tab.
    apptStatus = 'confirmed';
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(must('[data-bk-status]').textContent).toBe('Confirmada'));
    expect(must('.vtr-bk-title').textContent).toBe('Reserva confirmada');
    expect(must('.vtr-bk-notice').textContent).toBe('Recibimos tu pago. Tu hora está confirmada.');
    expect(q('[data-bk-pay]')).toBeNull();
    expect(q('.vtr-bk-deposit')).toBeNull();
  });

  it('never renders a non-https checkout link as the pay button', async () => {
    checkoutUrl = 'javascript:alert(1)';
    await boot();
    await book(SVC_DEPOSIT);
    expect(q('[data-bk-pay]')).toBeNull();
    // The transfer accounts are still there to pay with.
    expect(must('.vtr-bk-account').textContent).toContain('Banco de Chile');
  });

  it('a booking with no deposit is confirmed at once and is never polled', async () => {
    await boot();
    await book(SVC_EVAL);
    expect(must('[data-bk-status]').textContent).toBe('Confirmada');
    expect(q('.vtr-bk-deposit')).toBeNull();
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 30));
    expect(
      fetchMock.mock.calls.some(([u, o]) => String(u).includes('/widget/clinic/appointments/') && (o?.method ?? 'GET') === 'GET'),
    ).toBe(false);
  });
});

describe('clinic widget: booking drafts and resume (embed#18)', () => {
  it('saves a draft at the details step with the unchecked WhatsApp box, and the booking closes it', async () => {
    window.history.replaceState({}, '', '/reservas?utm_source=facebook&fbclid=IwAR_draft#top');
    await boot();
    await toDetails(SVC_DEPOSIT);

    // The WhatsApp box: same words as the hosted page, unchecked by default.
    const wa = whatsappConsent();
    expect(wa.checked).toBe(false);
    expect(must('.vtr-bk-consent-wa').textContent).toContain(
      'Quiero recibir mensajes por WhatsApp sobre esta reserva',
    );
    expect(must('.vtr-bk-consent-wa').textContent).toContain(
      'Si no alcanzas a terminarla, te enviamos un solo mensaje con el enlace para retomarla.',
    );

    const [name, phone] = inputs();
    typeInto(name, 'Camila Fuentes');
    typeInto(phone, '+56 9 8765');
    // Too short to reach anybody: nothing saved yet.
    await new Promise((r) => setTimeout(r, 500));
    expect(drafts).toHaveLength(0);

    typeInto(phone, '+56 9 8765 4321');
    await vi.waitFor(() => expect(drafts).toHaveLength(1));
    expect(drafts[0]).toMatchObject({
      service_id: SVC_DEPOSIT,
      professional_id: PRO_ANA,
      slot_ref: 'ncl1_10:00',
      starts_at: at('10:00'),
      ends_at: at('10:30'),
      name: 'Camila Fuentes',
      phone: '+56 9 8765 4321',
      consent_whatsapp: false,
      attribution: { utm_source: 'facebook', fbclid: 'IwAR_draft' },
    });
    // The page to come back to, without its hash.
    expect(drafts[0].return_url).toBe(`${window.location.origin}/reservas?utm_source=facebook&fbclid=IwAR_draft`);
    expect(drafts[0]).not.toHaveProperty('draft_token');

    // Ticking the box re-saves, now under the draft's own token.
    check(whatsappConsent(), true);
    await vi.waitFor(() => expect(drafts).toHaveLength(2));
    expect(drafts[1]).toMatchObject({ draft_token: DRAFT_TOKEN, consent_whatsapp: true });

    // The WhatsApp box is optional: the data consent alone gates the button.
    check(dataConsent(), true);
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(step()).toBe('resumen'));
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(bookings).toHaveLength(1));
    expect(bookings[0].draft_token).toBe(DRAFT_TOKEN);
  });

  it('reopens the widget at the draft from the recovery link: details filled in, ready to book', async () => {
    draftResume = {
      status: 'open',
      surface: 'booking_widget',
      landing_slug: 'agenda-web',
      service_id: SVC_DEPOSIT,
      professional_id: PRO_ANA,
      starts_at: at('11:00'),
      ends_at: at('11:30'),
      slot_ref: 'ncl1_11:00',
      slot_available: true,
      name: 'Camila Fuentes',
      phone: '+56987654321',
      email: null,
      document: null,
      consent_whatsapp: true,
    };
    window.history.replaceState({}, '', `/reservas?vt_draft=${DRAFT_TOKEN}`);
    start();

    // Nobody clicked anything: the link itself opened the booking.
    await vi.waitFor(() => expect(step()).toBe('datos'));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`/widget/clinic/drafts/${DRAFT_TOKEN}`))).toBe(true);
    expect(must('.vtr-bk-form .vtr-bk-notice').textContent).toBe('Retomamos tu reserva donde la dejaste.');
    const [name, phone] = inputs();
    expect(name.value).toBe('Camila Fuentes');
    expect(phone.value).toBe('+56987654321');
    expect(whatsappConsent().checked).toBe(true);

    check(dataConsent(), true);
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(step()).toBe('resumen'));
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(bookings).toHaveLength(1));
    expect(bookings[0]).toMatchObject({
      service_id: SVC_DEPOSIT,
      professional_id: PRO_ANA,
      slot_ref: 'ncl1_11:00',
      starts_at: at('11:00'),
      draft_token: DRAFT_TOKEN,
    });
  });

  it('a draft whose hour went lands on that day’s hours with a note, details kept', async () => {
    draftResume = {
      status: 'open',
      service_id: SVC_EVAL,
      professional_id: PRO_ANA,
      starts_at: at('09:00'),
      ends_at: at('09:30'),
      slot_ref: 'ncl1_09:00',
      slot_available: false,
      name: 'Camila Fuentes',
      phone: '+56987654321',
      email: 'camila@example.cl',
      document: null,
      consent_whatsapp: false,
    };
    window.history.replaceState({}, '', `/?vt_draft=${DRAFT_TOKEN}`);
    start();
    await vi.waitFor(() => expect(step()).toBe('hora'));
    await vi.waitFor(() => expect(q('.vtr-bk-slot')).not.toBeNull());
    expect(must('.vtr-bk-notice').textContent).toContain('ya no está disponible');
    await clickSlot('10:00');
    await vi.waitFor(() => expect(step()).toBe('datos'));
    expect(inputs()[2].value).toBe('camila@example.cl');
  });

  it('an already-booked draft opens the start with a note, and a reload does not reopen it', async () => {
    draftResume = { status: 'completed', consent_whatsapp: true };
    window.history.replaceState({}, '', `/?vt_draft=${DRAFT_TOKEN}`);
    const w = start();
    await vi.waitFor(() => expect(q('.vtr-bk-notice')?.textContent).toBe(
      'Esa reserva ya está hecha. Si quieres otra hora, puedes reservarla aquí.',
    ));
    expect(step()).toBe('servicio');
    w.destroy();
    document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());

    const draftReads = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/widget/clinic/drafts/')).length;
    const before = draftReads();
    start();
    await vi.waitFor(() => expect(q('.vtr-chip-book')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(draftReads()).toBe(before);
  });
});

describe('clinic widget: view, change and cancel from the confirmation (embed#18)', () => {
  it('moves the booking to another hour through the manage token', async () => {
    await boot();
    await book(SVC_EVAL);
    must<HTMLButtonElement>('[data-bk-manage="reschedule"]').click();
    await vi.waitFor(() => expect(must('.vtr-bk-title').textContent).toBe('Elige la hora nueva'));
    expect(q('.vtr-bk-step')?.hidden).toBe(true);
    await onTargetDay();
    must<HTMLButtonElement>(`[data-bk-day="${target.key}"]`).click();
    await vi.waitFor(() => expect(q('.vtr-bk-slot')).not.toBeNull());
    const times = Array.from(shadowOf().querySelectorAll('.vtr-bk-slot')).map((b) => b.textContent);
    expect(times).toEqual(['11:00', '12:00']);
    await clickSlot('12:00');
    await vi.waitFor(() => expect(step()).toBe('mover'));
    expect(must('.vtr-bk-card').textContent).toContain('12:00');
    must<HTMLButtonElement>('.vtr-bk-primary').click();

    await vi.waitFor(() => expect(step()).toBe('ok'));
    expect(actions).toEqual([
      { action: 'reschedule', starts_at: at('12:00'), ends_at: at('12:30'), slot_ref: 'ncl1_12:00' },
    ]);
    expect(must('.vtr-bk-notice').textContent).toBe('Listo, movimos tu hora.');
    expect(must('.vtr-bk-when').textContent).toContain('12:00');
    // Only the widget's own routes, never the hosted page's.
    for (const [u] of fetchMock.mock.calls) expect(String(u)).not.toContain('/public/clinic/');
  });

  it('cancels the booking after a confirmation step, and keeping it changes nothing', async () => {
    await boot();
    await book(SVC_EVAL);
    must<HTMLButtonElement>('[data-bk-manage="cancel"]').click();
    await vi.waitFor(() => expect(step()).toBe('cancelar'));
    expect(must('.vtr-bk-code').textContent).toBe('A-91');
    must<HTMLButtonElement>('.vtr-bk-primary').click(); // «Mantener la reserva»
    await vi.waitFor(() => expect(step()).toBe('ok'));
    expect(actions).toHaveLength(0);

    must<HTMLButtonElement>('[data-bk-manage="cancel"]').click();
    await vi.waitFor(() => expect(step()).toBe('cancelar'));
    must<HTMLButtonElement>('.vtr-bk-secondary').click(); // «Sí, cancelar»
    await vi.waitFor(() => expect(step()).toBe('cancelado'));
    expect(actions).toEqual([{ action: 'cancel' }]);
    expect(must('.vtr-bk-title').textContent).toBe('Hora cancelada');
  });
});
