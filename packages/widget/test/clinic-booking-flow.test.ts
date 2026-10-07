// The CLINIC booking flow (vitrina-app#3707), end to end through init()
// against a mocked server.
//
// What it pins, in the order it can hurt someone:
//
//   1. THE FLOW IS THE TENANT'S CONFIGURATION. `clinicBooking` on
//      /widget/config runs service → professional → day → time → details →
//      summary → done against /widget/clinic/*, and never touches the dealer's
//      /widget/appointments routes.
//   2. THE AD CLICK TRAVELS WITH THE BOOKING: UTMs + fbclid from the landing
//      URL (remembered across pages of the tab) and the tag's anonymous id.
//   3. A SLOT TAKEN MID-FLOW bounces back to the hours with the details kept.
//   4. NO AD-PLATFORM TAG. The widget loads no Meta Pixel or any other
//      third-party script, and talks to nobody but the Vitrina API.
//   5. A deposit service shows the amount and the deadline on the
//      confirmation; without a Mercado Pago link the payment slot stays empty
//      (pay / resume / manage: clinic-pay-resume-manage.test.ts, embed#18).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_clinic';
const TZ = 'America/Santiago';

const SVC_EVAL = '11111111-1111-4111-8111-111111111111';
const SVC_DEPOSIT = '22222222-2222-4222-8222-222222222222';
const PRO_ANA = '33333333-3333-4333-8333-333333333333';
const PRO_LUIS = '44444444-4444-4444-8444-444444444444';

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
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

/** The agenda: two hours on the target day, Ana at 10:00, Luis at 10:00 and 11:00. */
function agenda(professionalId: string | null): unknown[] {
  const at = (hh: string) => `${target.key}T${hh}:00-03:00`;
  const all = [
    { pro: PRO_ANA, name: 'Ana Rojas', from: '10:00', to: '10:30' },
    { pro: PRO_LUIS, name: 'Luis Soto', from: '10:00', to: '10:30' },
    { pro: PRO_LUIS, name: 'Luis Soto', from: '11:00', to: '11:30' },
  ];
  return all
    .filter((s) => !professionalId || s.pro === professionalId)
    .map((s) => ({
      starts_at: at(s.from),
      ends_at: at(s.to),
      label: 'lunes 10:00',
      slot_ref: `ncl1_${s.pro.slice(0, 4)}_${s.from}`,
      professional_id: s.pro,
      professional_name: s.name,
    }));
}

const LANDING = {
  slug: 'agenda-web',
  name: 'Agenda web',
  title: 'Reserva tu hora',
  welcome_text: 'Kinesiología de suelo pélvico en Vitacura',
  primary_color: '#0E7C66',
  logo_url: null,
  clinic_name: null,
  timezone: TZ,
  allow_any_professional: true,
  require_document: false,
  horizon_days: 30,
  min_notice_hours: 2,
  location: { id: 'loc-1', name: 'Vitacura', address: 'Av. Vitacura 1234' },
  services: [
    {
      id: SVC_EVAL,
      name: 'Evaluación inicial',
      description: null,
      duration_minutes: 45,
      price_clp: 45000,
      is_telehealth: false,
      deposit_required: false,
      deposit_amount_clp: null,
    },
    {
      id: SVC_DEPOSIT,
      name: 'Sesión de tratamiento',
      description: null,
      duration_minutes: 30,
      price_clp: 35000,
      is_telehealth: false,
      deposit_required: true,
      deposit_amount_clp: 29000,
    },
  ],
  professionals: [
    { id: PRO_ANA, name: 'Ana Rojas', especialidad: 'Kinesióloga', service_ids: [SVC_EVAL, SVC_DEPOSIT] },
    { id: PRO_LUIS, name: 'Luis Soto', especialidad: 'Kinesiólogo', service_ids: [] },
  ],
};

let configData: Record<string, unknown>;
let landingData: Record<string, unknown>;
let bookResponse: (body: Record<string, unknown>) => Response;
let fetchMock: ReturnType<typeof vi.fn>;
const posted: Array<Record<string, unknown>> = [];
const availabilityQueries: URLSearchParams[] = [];

function bookedFor(body: Record<string, unknown>, deposit = false): Response {
  return jsonRes(201, {
    display_id: 'A-77',
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    professional_name: body.professional_id === PRO_ANA ? 'Ana Rojas' : 'Luis Soto',
    service_name: body.service_id === SVC_EVAL ? 'Evaluación inicial' : 'Sesión de tratamiento',
    location_name: 'Vitacura',
    manage_url: 'https://api.example.com/api/v1/public/clinic/appt/eyJ.a.b',
    deposit: deposit
      ? {
          required: true,
          amount_clp: 29000,
          deadline: `${target.key}T09:00:00-03:00`,
          accounts: [
            {
              alias: 'principal',
              bank: 'Banco de Chile',
              account_type: 'Cuenta corriente',
              account_number: '00-123-45678-09',
              holder_name: 'Clínica Suelo Pélvico SpA',
              holder_rut: '76.123.456-7',
            },
          ],
          // Written for the AI agent; a patient must never see it.
          instructions: 'This booking requires an abono. Dictate EXACTLY ONE of the accounts.',
        }
      : { required: false, amount_clp: null, deadline: null, accounts: [], instructions: null },
    confirmation: { sent: true, reason: null },
  });
}

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
  } catch {
    /* ignore */
  }
  window.history.replaceState({}, '', '/');
  configData = { clinicBooking: { enabled: true }, theme: { accent: '#0E7C66' } };
  landingData = { ...LANDING };
  posted.length = 0;
  availabilityQueries.length = 0;
  bookResponse = (body) => bookedFor(body);
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, configData));
    if (u.includes('/widget/clinic/landing')) return Promise.resolve(jsonRes(200, landingData));
    if (u.includes('/widget/clinic/availability')) {
      const qs = new URL(u).searchParams;
      availabilityQueries.push(qs);
      const inMonth = (qs.get('from') ?? '').slice(0, 7) === target.ym;
      return Promise.resolve(
        jsonRes(200, { timezone: TZ, slots: inMonth ? agenda(qs.get('professional_id')) : [] }),
      );
    }
    if (u.includes('/widget/clinic/bookings') && method === 'POST') {
      const body = JSON.parse(String(opts?.body ?? '{}')) as Record<string, unknown>;
      posted.push(body);
      return Promise.resolve(bookResponse(body));
    }
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }));
    }
    if (u.includes('/widget/messages')) return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
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

async function boot(config: Record<string, unknown> = {}) {
  const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es', ...config } as never);
  w.open();
  await vi.waitFor(() => expect(q('.vtr-chip-book')).not.toBeNull());
  return w;
}

async function openServices(): Promise<void> {
  must<HTMLButtonElement>('.vtr-chip-book').click();
  await vi.waitFor(() => expect(shadowOf().querySelectorAll('[data-bk-service]').length).toBe(2));
}

async function pickToCalendar(service: string, professional: string): Promise<void> {
  await openServices();
  must<HTMLButtonElement>(`[data-bk-service="${service}"]`).click();
  await vi.waitFor(() => expect(q(`[data-bk-professional="${professional}"]`)).not.toBeNull());
  must<HTMLButtonElement>(`[data-bk-professional="${professional}"]`).click();
  await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-day').length).toBeGreaterThan(0));
  if (target.nextMonth) {
    await vi.waitFor(() => expect(q('.vtr-bk-navnext')).not.toBeNull());
    must<HTMLButtonElement>('.vtr-bk-navnext').click();
  }
  await vi.waitFor(() => {
    const day = q<HTMLButtonElement>(`[data-bk-day="${target.key}"]`);
    expect(day?.disabled).toBe(false);
  });
}

async function pickHour(time: string): Promise<void> {
  must<HTMLButtonElement>(`[data-bk-day="${target.key}"]`).click();
  await clickSlot(time);
}

/** On the hours grid already: tap one. */
async function clickSlot(time: string): Promise<void> {
  await vi.waitFor(() => expect(q('.vtr-bk-slot')).not.toBeNull());
  const slot = Array.from(shadowOf().querySelectorAll<HTMLButtonElement>('.vtr-bk-slot')).find(
    (b) => b.textContent === time,
  );
  if (!slot) throw new Error(`no ${time} slot`);
  slot.click();
  await vi.waitFor(() => expect(q('.vtr-bk-form')).not.toBeNull());
}

function fillDetails(): void {
  const [name, phone, email, rut] = inputs();
  // No RUT unless the landing asks for one.
  expect((rut.closest('label') as HTMLElement).hidden).toBe(true);
  typeInto(name, 'Camila Fuentes');
  typeInto(phone, '+56 9 8765 4321');
  typeInto(email, 'camila@example.cl');
  check(must<HTMLInputElement>('.vtr-bk-check'), true);
  must<HTMLButtonElement>('.vtr-bk-primary').click();
}

describe('clinic booking flow (vitrina-app#3707)', () => {
  it('books service → professional → day → time → details → summary → done, with the landing’s services', async () => {
    await boot();
    expect(must('.vtr-chip-book').textContent).toBe('Reservar hora');
    await openServices();

    // The landing's own heading and intro, and each service with its facts.
    expect(must('.vtr-bk-title').textContent).toBe('Reserva tu hora');
    expect(must('.vtr-bk-step').textContent).toBe('Paso 1 de 6');
    expect(must('.vtr-bk-intro').textContent).toBe('Kinesiología de suelo pélvico en Vitacura');
    const deposit = must(`[data-bk-service="${SVC_DEPOSIT}"]`).textContent ?? '';
    expect(deposit).toContain('Sesión de tratamiento');
    expect(deposit).toMatch(/Abono\s+\$\s?29\.000/);
    expect(must(`[data-bk-service="${SVC_EVAL}"]`).textContent).toContain('45 min');

    must<HTMLButtonElement>(`[data-bk-service="${SVC_EVAL}"]`).click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 2 de 6'));
    expect(q('[data-bk-professional="any"]')).not.toBeNull();
    must<HTMLButtonElement>(`[data-bk-professional="${PRO_ANA}"]`).click();
    if (target.nextMonth) {
      await vi.waitFor(() => expect(q('.vtr-bk-navnext')).not.toBeNull());
      must<HTMLButtonElement>('.vtr-bk-navnext').click();
    }
    await vi.waitFor(() =>
      expect(q<HTMLButtonElement>(`[data-bk-day="${target.key}"]`)?.disabled).toBe(false),
    );
    const last = availabilityQueries[availabilityQueries.length - 1];
    expect(last.get('service_id')).toBe(SVC_EVAL);
    expect(last.get('professional_id')).toBe(PRO_ANA);

    await pickHour('10:00');
    fillDetails();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 6 de 6'));
    const summary = must('.vtr-bk-card').textContent ?? '';
    expect(summary).toContain('Evaluación inicial');
    expect(summary).toContain('Ana Rojas');
    expect(summary).toContain('Vitacura');
    expect(summary).toMatch(/\$\s?45\.000/);

    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(q('.vtr-bk-code')).not.toBeNull());
    expect(must('.vtr-bk-code').textContent).toBe('A-77');
    // Change and cancel run inline through the manage token (embed#18).
    expect(q('[data-bk-manage="reschedule"]')).not.toBeNull();
    expect(q('[data-bk-manage="cancel"]')).not.toBeNull();
    expect(must('[data-bk-status]').textContent).toBe('Confirmada');
    // No deposit asked, no deposit box.
    expect(q('.vtr-bk-deposit')).toBeNull();

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      service_id: SVC_EVAL,
      professional_id: PRO_ANA,
      slot_ref: `ncl1_${PRO_ANA.slice(0, 4)}_10:00`,
      starts_at: `${target.key}T10:00:00-03:00`,
      name: 'Camila Fuentes',
      phone: '+56 9 8765 4321',
      email: 'camila@example.cl',
    });
    // Never the dealer's booking routes.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/widget/appointments'))).toBe(false);
  });

  it('sends the ad click: UTMs + fbclid from the landing URL, kept across pages, and the tag’s anonymous id', async () => {
    window.history.replaceState(
      {},
      '',
      '/suelo-pelvico?utm_source=facebook&utm_medium=paid&utm_campaign=octubre&fbclid=IwAR_abc-123',
    );
    window.localStorage.setItem('atribu_anon_id', 'anon_widget_3707');
    const w = await boot();
    // The patient reads another page before booking: the URL carries nothing now.
    window.history.replaceState({}, '', '/equipo');
    await pickToCalendar(SVC_EVAL, PRO_ANA);
    await pickHour('10:00');
    fillDetails();
    await vi.waitFor(() => expect(q('.vtr-bk-turnstile, .vtr-bk-card')).not.toBeNull());
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].attribution).toEqual({
      utm_source: 'facebook',
      utm_medium: 'paid',
      utm_campaign: 'octubre',
      fbclid: 'IwAR_abc-123',
      anonymous_id: 'anon_widget_3707',
    });
    // Nothing that names the page (a clinic path can name a treatment).
    expect(JSON.stringify(posted[0])).not.toMatch(/suelo-pelvico|equipo|https?:/);
    w.destroy();
  });

  it('with "any professional", reads everyone’s hours, shows one 10:00 and books whoever’s hour it is', async () => {
    await boot();
    await pickToCalendar(SVC_EVAL, 'any');
    const last = availabilityQueries[availabilityQueries.length - 1];
    expect(last.has('professional_id')).toBe(false);

    must<HTMLButtonElement>(`[data-bk-day="${target.key}"]`).click();
    await vi.waitFor(() => expect(q('.vtr-bk-slot')).not.toBeNull());
    const times = Array.from(shadowOf().querySelectorAll('.vtr-bk-slot')).map((b) => b.textContent);
    expect(times).toEqual(['10:00', '11:00']);

    await clickSlot('11:00');
    fillDetails();
    await vi.waitFor(() => expect(must('.vtr-bk-card').textContent).toContain('Luis Soto'));
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].professional_id).toBe(PRO_LUIS);
    expect(posted[0].slot_ref).toBe(`ncl1_${PRO_LUIS.slice(0, 4)}_11:00`);
  });

  it('bounces a slot taken mid-flow back to the hours, keeping every typed detail', async () => {
    bookResponse = () =>
      errorRes(409, {
        error: {
          code: 'CONFLICT',
          message: 'booking_failed',
          details: { code: 'slot_taken', message: 'Alguien acaba de tomar esa hora.' },
        },
      });
    await boot();
    await pickToCalendar(SVC_EVAL, PRO_ANA);
    await pickHour('10:00');
    fillDetails();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 6 de 6'));
    must<HTMLButtonElement>('.vtr-bk-primary').click();

    await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-booking')?.getAttribute('data-step')).toBe('hora'));
    await vi.waitFor(() => expect(must('.vtr-bk-error').textContent).toBe('Esa hora se acaba de tomar.'));
    // The hours were re-read for the bounce.
    expect(availabilityQueries.length).toBeGreaterThanOrEqual(2);

    // Pick another hour: the form is exactly as the patient left it.
    bookResponse = (body) => bookedFor(body);
    await clickSlot('10:00');
    const [name, phone, email] = inputs();
    expect(name.value).toBe('Camila Fuentes');
    expect(phone.value).toBe('+56 9 8765 4321');
    expect(email.value).toBe('camila@example.cl');
  });

  it('shows the deposit and the transfer accounts, and no pay button without a checkout link', async () => {
    bookResponse = (body) => bookedFor(body, true);
    await boot();
    await pickToCalendar(SVC_DEPOSIT, PRO_ANA);
    await pickHour('10:00');
    fillDetails();
    await vi.waitFor(() => expect(must('.vtr-bk-card').textContent).toMatch(/Abono para reservar\s*\$\s?29\.000/));
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(q('.vtr-bk-deposit')).not.toBeNull());
    expect(must('.vtr-bk-deposit-amount').textContent).toMatch(/\$\s?29\.000/);
    expect(must('.vtr-bk-deposit').textContent).toContain('Paga el abono antes del');
    const account = must('.vtr-bk-account').textContent ?? '';
    expect(account).toContain('Banco de Chile · Cuenta corriente');
    expect(account).toContain('00-123-45678-09');
    expect(account).toContain('Clínica Suelo Pélvico SpA · 76.123.456-7');
    expect(must('.vtr-bk-deposit').textContent).not.toMatch(/Dictate|abono\. /);
    const slot = must('[data-bk-payment]');
    expect(slot.childNodes.length).toBe(0);
  });

  it('asks for the RUT only when the landing requires it, and sends it', async () => {
    landingData = { ...LANDING, require_document: true };
    await boot();
    await pickToCalendar(SVC_EVAL, PRO_ANA);
    await pickHour('10:00');
    const [name, phone, , rut] = inputs();
    expect((rut.closest('label') as HTMLElement).hidden).toBe(false);
    typeInto(name, 'Camila Fuentes');
    typeInto(phone, '+56 9 8765 4321');
    check(must<HTMLInputElement>('.vtr-bk-check'), true);
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(true);
    typeInto(rut, '12.345.678-5');
    expect(must<HTMLButtonElement>('.vtr-bk-primary').disabled).toBe(false);
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(must('.vtr-bk-step').textContent).toBe('Paso 6 de 6'));
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].document).toBe('12.345.678-5');
  });

  it('a landing that failed to load says so with a retry, never "no services"', async () => {
    let fail = true;
    const base = fetchMock.getMockImplementation() as (u: string, o?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((u: string, o?: RequestInit) =>
      fail && String(u).includes('/widget/clinic/landing') ? Promise.resolve(emptyRes(503)) : base(u, o),
    );
    await boot();
    must<HTMLButtonElement>('.vtr-chip-book').click();
    await vi.waitFor(() => expect(must('.vtr-bk-error').textContent).toContain('No pudimos cargar'));
    expect(shadowOf().querySelector('.vtr-bk-body')?.textContent).not.toContain('no hay servicios');
    fail = false;
    must<HTMLButtonElement>('[data-bk-retry]').click();
    await vi.waitFor(() => expect(shadowOf().querySelectorAll('[data-bk-service]').length).toBe(2));
  });

  it('passes the snippet’s landing slug to every clinic call', async () => {
    await boot({ landing: 'convenio-isapre' });
    await pickToCalendar(SVC_EVAL, PRO_ANA);
    const clinicCalls = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes('/widget/clinic/'));
    expect(clinicCalls.length).toBeGreaterThanOrEqual(2);
    for (const u of clinicCalls) expect(new URL(u).searchParams.get('landing')).toBe('convenio-isapre');
  });

  it('loads no Meta Pixel or other ad-platform tag, and calls nobody but the Vitrina API', async () => {
    window.history.replaceState({}, '', '/?fbclid=IwAR_zz&utm_source=facebook');
    await boot();
    await pickToCalendar(SVC_EVAL, PRO_ANA);
    await pickHour('10:00');
    fillDetails();
    must<HTMLButtonElement>('.vtr-bk-primary').click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    for (const [u] of fetchMock.mock.calls) expect(String(u).startsWith(BASE)).toBe(true);
    const scripts = Array.from(document.querySelectorAll('script')).map((s) => s.src);
    expect(scripts.filter((src) => /facebook|fbevents|googletagmanager|gtag|tiktok|doubleclick/i.test(src))).toEqual([]);
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
    expect(Array.from(document.querySelectorAll('img')).filter((i) => /facebook/i.test(i.src))).toEqual([]);
  });

  it('a dealer config keeps the dealer flow: no clinic call, the test-drive calendar opens', async () => {
    configData = { bookingEnabled: true };
    await boot();
    expect(must('.vtr-chip-book').textContent).toBe('Agendar visita');
    must<HTMLButtonElement>('.vtr-chip-book').click();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/widget/appointments/availability'))).toBe(true),
    );
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/widget/clinic/'))).toBe(false);
    expect(q('[data-bk-service]')).toBeNull();
  });
});
