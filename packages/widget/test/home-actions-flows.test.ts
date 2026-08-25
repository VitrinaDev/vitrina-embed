// The three quick-action flows, end to end through init() against a mocked
// server.
//
// The properties worth a test, in the order they can hurt someone:
//
//   1. BUY AND SEARCH ARE MESSAGES. They go down the ordinary send pipeline —
//      so the composed text lands in the transcript, the visitor's name and
//      phone ride with it, and the visitor ends up looking at their own thread
//      where the reply will arrive. Not a silent lead form.
//   2. SELL IS AN INTAKE. Every field the consignment contract names reaches the
//      wire, including the consent trio, and it goes as multipart with the
//      photos — never as JSON with a Content-Type we set by hand.
//   3. A DUPLICATE IS A SUCCESS. The dealer already having the car is our
//      bookkeeping, never the visitor's problem.
//   4. THE PHOTO CAPS HOLD IN THE BROWSER. Eight files, ten megabytes each, and
//      a rejected file is SAID rather than silently dropped.
//   5. NOTHING THE VISITOR TYPED IS LOST on a refusal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_flows';

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

let configData: Record<string, unknown>;
let consignmentResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  configData = { home: { enabled: true, cards: { buy: true, sell: true, search: true } } };
  consignmentResponse = () => jsonRes(201, { status: 'received' });

  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, configData));
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/consignments')) return Promise.resolve(consignmentResponse());
    if (u.includes('/widget/messages')) {
      if (method === 'POST') {
        return Promise.resolve(
          jsonRes(202, { status: 'accepted', visitorToken: 'vt', conversationExternalId: 'web:a' }),
        );
      }
      return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    }
    if (u.includes('/widget/stream')) {
      return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    }
    return Promise.resolve(emptyRes(404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
});

function shadow(): ShadowRoot {
  const host = document.querySelector('[data-vitrina-widget]');
  if (!host?.shadowRoot) throw new Error('widget not mounted');
  return host.shadowRoot;
}
function q(sel: string): Element | null {
  return shadow().querySelector(sel);
}
function must<T extends Element = HTMLElement>(sel: string): T {
  const el = q(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
}
function panel(): HTMLElement {
  return must<HTMLElement>('.vtr-panel');
}
function primary(): HTMLButtonElement {
  return must<HTMLButtonElement>('.vtr-ha-primary');
}
function fieldEl<T extends Element = HTMLInputElement>(name: string): T {
  return must<T>(`.vtr-ha [data-field="${name}"]`);
}
function typeInto(name: string, value: string): void {
  const el = fieldEl<HTMLInputElement>(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function choose(name: string, value: string): void {
  const el = fieldEl<HTMLSelectElement>(name);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function tickConsent(): void {
  const el = fieldEl<HTMLInputElement>('consent');
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Boot with the panel open and the three cards mounted. */
async function boot(): Promise<ReturnType<typeof init>> {
  const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
  w.open();
  await vi.waitFor(() => expect(q('.vtr-home-card[data-card="buy"]')).not.toBeNull());
  return w;
}

function openCard(kind: 'buy' | 'sell' | 'search'): void {
  must<HTMLButtonElement>(`.vtr-home-card[data-card="${kind}"]`).click();
}

function messagePosts(): RequestInit[] {
  return fetchMock.mock.calls
    .filter(([u, o]) => String(u).includes('/widget/messages') && (o as RequestInit)?.method === 'POST')
    .map(([, o]) => o as RequestInit);
}
function consignmentPosts(): Array<[string, RequestInit]> {
  return fetchMock.mock.calls
    .filter(([u]) => String(u).includes('/widget/consignments'))
    .map(([u, o]) => [String(u), o as RequestInit]);
}

/** A fake photo of a given size — no 11MB buffer is allocated to test a cap. */
function photo(name: string, bytes = 1024): File {
  const file = new File(['x'], name, { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}
function pick(files: File[]): void {
  const input = must<HTMLInputElement>('.vtr-ha-fileinput');
  (input as unknown as { files: File[] }).files = files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// 1. Buy — one screen, then the conversation.
// ---------------------------------------------------------------------------

describe('comprar un auto', () => {
  it('gates the send button on nombre + teléfono + el auto + consentimiento', async () => {
    const w = await boot();
    openCard('buy');
    expect(primary().disabled).toBe(true);
    typeInto('name', 'Camila Fuentes');
    expect(primary().disabled).toBe(true);
    typeInto('phone', '+56 9 6543 2109');
    typeInto('wanted', 'Toyota Yaris 2019');
    // Name, phone and the car are not enough: the consent box is real.
    expect(primary().disabled).toBe(true);
    tickConsent();
    expect(primary().disabled).toBe(false);
    w.destroy();
  });

  it('sends the composed message with the visitor attached, and lands in Mensajes', async () => {
    const w = await boot();
    openCard('buy');
    typeInto('name', 'Camila Fuentes');
    typeInto('phone', '+56 9 6543 2109');
    typeInto('email', 'camila@correo.cl');
    typeInto('wanted', 'Toyota Yaris 2019');
    typeInto('budget', '$8.000.000');
    tickConsent();
    // A bot filled the trap; a human never touches it.
    must<HTMLInputElement>('.vtr-ha .vtr-hp').value = 'http://spam.example';
    primary().click();

    await vi.waitFor(() => expect(messagePosts()).toHaveLength(1));
    const body = JSON.parse(messagePosts()[0].body as string);
    expect(body.message).toBe(
      '🚗 Quiero comprar un auto\nBusco: Toyota Yaris 2019\nPresupuesto: $8.000.000',
    );
    expect(body.name).toBe('Camila Fuentes');
    expect(body.phone).toBe('+56 9 6543 2109');
    expect(body.email).toBe('camila@correo.cl');
    expect(body.hp_website).toBe('http://spam.example');

    // The conversation IS the confirmation: the overlay gets out of the way and
    // the visitor is left looking at their own message.
    await vi.waitFor(() => expect(panel().hasAttribute('data-home-action')).toBe(false));
    expect(panel().getAttribute('data-active-view')).toBe('messages');
    expect(must('.vtr-msg[data-dir="inbound"]').textContent).toContain('Toyota Yaris 2019');
    w.destroy();
  });

  it('says "por definir" rather than leaving the budget line blank', async () => {
    const w = await boot();
    openCard('buy');
    typeInto('name', 'Ana');
    typeInto('phone', '+56 9 1111 1111');
    typeInto('wanted', 'Suzuki Swift');
    tickConsent();
    primary().click();
    await vi.waitFor(() => expect(messagePosts()).toHaveLength(1));
    expect(JSON.parse(messagePosts()[0].body as string).message).toBe(
      '🚗 Quiero comprar un auto\nBusco: Suzuki Swift\nPresupuesto: por definir',
    );
    w.destroy();
  });

  it('keeps the form, and everything typed, when there is no session to send into', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, configData));
      if (u.includes('/widget/conversations')) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(emptyRes(404));
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(q('.vtr-home-card[data-card="buy"]')).not.toBeNull());
    openCard('buy');
    typeInto('name', 'Ana');
    typeInto('phone', '+56 9 1111 1111');
    typeInto('wanted', 'Suzuki Swift');
    tickConsent();
    primary().click();

    await vi.waitFor(() => expect(must('.vtr-ha-error').textContent).toBe('No pudimos enviar. Reintenta.'));
    // Still on the form, with every word of it, and the button live again.
    expect(panel().getAttribute('data-home-action')).toBe('buy');
    expect(fieldEl<HTMLInputElement>('wanted').value).toBe('Suzuki Swift');
    expect(primary().disabled).toBe(false);
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. Search — the same skeleton, a different sentence.
// ---------------------------------------------------------------------------

describe('lo buscamos por ti', () => {
  it('composes the search message with year and notes when they are there', async () => {
    const w = await boot();
    openCard('search');
    expect(must('.vtr-ha-title').textContent).toBe('Lo buscamos por ti');
    typeInto('name', 'Pedro Soto');
    typeInto('phone', '+56 9 2222 2222');
    typeInto('wanted', 'Mazda CX-5');
    typeInto('year', '2020');
    typeInto('budget', '$14.000.000');
    typeInto('notes', 'Que sea automático');
    tickConsent();
    primary().click();

    await vi.waitFor(() => expect(messagePosts()).toHaveLength(1));
    const body = JSON.parse(messagePosts()[0].body as string);
    expect(body.message).toBe(
      '🔎 Lo buscamos por ti\nAuto: Mazda CX-5 2020\nPresupuesto: $14.000.000\nNotas: Que sea automático',
    );
    expect(body.name).toBe('Pedro Soto');
    expect(body.phone).toBe('+56 9 2222 2222');
    await vi.waitFor(() => expect(panel().getAttribute('data-active-view')).toBe('messages'));
    w.destroy();
  });

  it('drops the notes line entirely when there are none', async () => {
    const w = await boot();
    openCard('search');
    typeInto('name', 'Pedro');
    typeInto('phone', '+56 9 2222 2222');
    typeInto('wanted', 'Mazda 3');
    tickConsent();
    primary().click();
    await vi.waitFor(() => expect(messagePosts()).toHaveLength(1));
    expect(JSON.parse(messagePosts()[0].body as string).message).toBe(
      '🔎 Lo buscamos por ti\nAuto: Mazda 3\nPresupuesto: por definir',
    );
    w.destroy();
  });

  it('remembers who the visitor is when they open another flow', async () => {
    const w = await boot();
    openCard('search');
    typeInto('name', 'Pedro Soto');
    typeInto('phone', '+56 9 2222 2222');
    must<HTMLButtonElement>('.vtr-ha-close').click();
    openCard('buy');
    // Their own name and phone survive; the previous flow's answers do not.
    expect(fieldEl<HTMLInputElement>('name').value).toBe('Pedro Soto');
    expect(fieldEl<HTMLInputElement>('phone').value).toBe('+56 9 2222 2222');
    expect(fieldEl<HTMLInputElement>('wanted').value).toBe('');
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Sell — the four-step consignment intake.
// ---------------------------------------------------------------------------

/** Walk step 1 → 2 with a valid car. */
function fillCar(): void {
  typeInto('plate', 'BCDF12');
  typeInto('make', 'Toyota');
  typeInto('model', 'Yaris');
  typeInto('year', '2019');
  typeInto('km', '42.000');
}

describe('vender tu auto', () => {
  it('walks all four steps and posts the whole contract as multipart', async () => {
    const w = await boot();
    openCard('sell');
    expect(must('.vtr-ha-step').textContent).toBe('Paso 1 de 4');

    fillCar();
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 2 de 4'));

    typeInto('version', 'XLI 1.5');
    typeInto('price', '$8.500.000');
    choose('deadline', '15d');
    choose('region', '13');
    typeInto('notes', 'Mantenciones al día');
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 3 de 4'));

    pick([photo('frente.jpg'), photo('lateral.jpg')]);
    expect(shadow().querySelectorAll('.vtr-ha-file')).toHaveLength(2);
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 4 de 4'));

    typeInto('name', 'Camila Fuentes');
    typeInto('phone', '+56 9 6543 2109');
    tickConsent();
    must<HTMLInputElement>('.vtr-ha .vtr-hp').value = '';
    primary().click();

    await vi.waitFor(() => expect(consignmentPosts()).toHaveLength(1));
    const [url, opts] = consignmentPosts()[0];
    // The publishable key rides both ways, and the browser owns Content-Type.
    expect(url).toContain(`siteKey=${PK}`);
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${PK}`);
    expect(headers['Content-Type']).toBeUndefined();
    expect(opts.method).toBe('POST');

    const body = opts.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('patente')).toBe('BCDF12');
    expect(body.get('marca')).toBe('Toyota');
    expect(body.get('modelo')).toBe('Yaris');
    expect(body.get('version')).toBe('XLI 1.5');
    expect(body.get('anio')).toBe('2019');
    // Typed with a Chilean thousands separator; sent as a number.
    expect(body.get('kilometros')).toBe('42000');
    expect(body.get('precio_esperado_clp')).toBe('8500000');
    expect(body.get('plazo_venta')).toBe('15d');
    expect(body.get('region_code')).toBe('13');
    expect(body.get('nombre')).toBe('Camila Fuentes');
    expect(body.get('telefono')).toBe('+56 9 6543 2109');
    expect(body.get('comentarios')).toBe('Mantenciones al día');
    // The consent trio travels together or the record is not auditable.
    expect(body.get('consent_granted')).toBe('true');
    expect(body.get('consent_text_version')).toBe('widget-0.9');
    expect(String(body.get('consent_source_url'))).toContain('http');
    expect(body.get('hp_website')).toBe('');
    // The photos ride under one repeated field.
    expect(body.getAll('fotos')).toHaveLength(2);

    // And the visitor gets a confirmation screen, because there is no message
    // in a transcript to be the confirmation for them.
    await vi.waitFor(() => expect(q('.vtr-ha-done')).not.toBeNull());
    expect(must('.vtr-ha-title').textContent).toBe('Datos recibidos');
    expect(must('.vtr-ha-oktitle').textContent).toBe(
      'Recibimos los datos de tu auto — te contactaremos pronto.',
    );
    // "Listo" closes it, leaving the conversation exactly where it was.
    must<HTMLButtonElement>('.vtr-ha-primary').click();
    expect(panel().hasAttribute('data-home-action')).toBe(false);
    w.destroy();
  });

  it('normalizes the patente and omits every optional field left blank', async () => {
    const w = await boot();
    openCard('sell');
    typeInto('plate', 'bcdf12');
    typeInto('make', 'Kia');
    typeInto('model', 'Rio');
    typeInto('year', '2015');
    typeInto('km', '90000');
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 2 de 4'));
    choose('deadline', 'cotizando');
    choose('region', '05');
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 3 de 4'));
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 4 de 4'));
    typeInto('name', 'Ana');
    typeInto('email', 'ana@correo.cl');
    tickConsent();
    primary().click();

    await vi.waitFor(() => expect(consignmentPosts()).toHaveLength(1));
    const body = consignmentPosts()[0][1].body as FormData;
    expect(body.get('patente')).toBe('BCDF12');
    // Email alone is a valid way back — no phone was invented for the wire.
    expect(body.get('email')).toBe('ana@correo.cl');
    expect(body.get('telefono')).toBeNull();
    expect(body.get('version')).toBeNull();
    expect(body.get('precio_esperado_clp')).toBeNull();
    expect(body.get('comentarios')).toBeNull();
    expect(body.getAll('fotos')).toHaveLength(0);
    w.destroy();
  });

  it('treats a duplicate exactly like a fresh intake', async () => {
    consignmentResponse = () => jsonRes(200, { status: 'duplicate' });
    const w = await boot();
    await walkToContact();
    primary().click();
    await vi.waitFor(() => expect(q('.vtr-ha-done')).not.toBeNull());
    // The dealer already having this car is our bookkeeping, not their problem.
    expect(must('.vtr-ha-title').textContent).toBe('Datos recibidos');
    expect(q('.vtr-ha-error')?.textContent).toBe('');
    w.destroy();
  });

  it('names the photos when the server refuses them, and keeps the form', async () => {
    consignmentResponse = () => emptyRes(415);
    const w = await boot();
    await walkToContact();
    primary().click();
    await vi.waitFor(() =>
      expect(must('.vtr-ha-error').textContent).toBe(
        'No pudimos subir esas fotos. Prueba con imágenes JPG o PNG.',
      ),
    );
    expect(must('.vtr-ha-step').textContent).toBe('Paso 4 de 4');
    expect(fieldEl<HTMLInputElement>('name').value).toBe('Camila');
    expect(primary().disabled).toBe(false);
    w.destroy();
  });

  it('offers a plain retry for any other refusal', async () => {
    consignmentResponse = () => emptyRes(400);
    const w = await boot();
    await walkToContact();
    primary().click();
    await vi.waitFor(() =>
      expect(must('.vtr-ha-error').textContent).toBe('No pudimos enviar los datos. Reintenta.'),
    );
    w.destroy();
  });

  it('refuses to advance past a year or a mileage that cannot be real, and says why', async () => {
    const w = await boot();
    openCard('sell');
    typeInto('plate', 'BCDF12');
    typeInto('make', 'Toyota');
    typeInto('model', 'Yaris');
    typeInto('year', '3050');
    typeInto('km', '42000');
    primary().click();
    expect(must('.vtr-ha-error').textContent).toBe('Revisa el año.');
    expect(must('.vtr-ha-step').textContent).toBe('Paso 1 de 4');

    typeInto('year', '2019');
    typeInto('km', '9000000');
    primary().click();
    expect(must('.vtr-ha-error').textContent).toBe('Revisa el kilometraje.');

    typeInto('plate', 'AB');
    typeInto('km', '42000');
    primary().click();
    expect(must('.vtr-ha-error').textContent).toBe('Revisa la patente.');

    typeInto('plate', 'BCDF12');
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 2 de 4'));
    w.destroy();
  });

  it('asks for a phone or an email rather than dimming the button in silence', async () => {
    const w = await boot();
    await walkToContact({ phone: '' });
    primary().click();
    expect(must('.vtr-ha-error').textContent).toBe('Déjanos un teléfono o un correo.');
    expect(consignmentPosts()).toHaveLength(0);
    w.destroy();
  });

  it('walks back through the steps without losing a field', async () => {
    const w = await boot();
    openCard('sell');
    fillCar();
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 2 de 4'));
    must<HTMLButtonElement>('.vtr-ha-back').click();
    expect(must('.vtr-ha-step').textContent).toBe('Paso 1 de 4');
    expect(fieldEl<HTMLInputElement>('plate').value).toBe('BCDF12');
    expect(fieldEl<HTMLInputElement>('km').value).toBe('42.000');
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. The photo caps, enforced in the browser.
// ---------------------------------------------------------------------------

describe('photos', () => {
  async function reachPhotos(): Promise<void> {
    openCard('sell');
    fillCar();
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 2 de 4'));
    choose('deadline', '7d');
    choose('region', '13');
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 3 de 4'));
  }

  it('keeps eight and says so rather than silently dropping the ninth', async () => {
    const w = await boot();
    await reachPhotos();
    pick(Array.from({ length: 9 }, (_, i) => photo(`foto${i}.jpg`)));
    expect(shadow().querySelectorAll('.vtr-ha-file')).toHaveLength(8);
    expect(must('.vtr-ha-error').textContent).toBe('Puedes enviar hasta 8 fotos.');
    w.destroy();
  });

  it('refuses a photo over 10 MB and keeps the ones that fit', async () => {
    const w = await boot();
    await reachPhotos();
    pick([photo('ok.jpg'), photo('enorme.jpg', 11 * 1024 * 1024)]);
    expect(shadow().querySelectorAll('.vtr-ha-filename')).toHaveLength(1);
    expect(must('.vtr-ha-filename').textContent).toBe('ok.jpg');
    expect(must('.vtr-ha-error').textContent).toBe('Cada foto debe pesar menos de 10 MB.');
    w.destroy();
  });

  it('removes one photo without touching the others', async () => {
    const w = await boot();
    await reachPhotos();
    pick([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    must<HTMLButtonElement>('[data-ha-photo="1"]').click();
    const names = Array.from(shadow().querySelectorAll('.vtr-ha-filename')).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['a.jpg', 'c.jpg']);
    w.destroy();
  });

  it('is skippable — the photos step never blocks the intake', async () => {
    const w = await boot();
    await reachPhotos();
    expect(primary().disabled).toBe(false);
    expect(must('.vtr-ha-note').textContent).toBe('También puedes enviarlas después por chat.');
    primary().click();
    await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 4 de 4'));
    w.destroy();
  });
});

/** Walk the sell flow to its last step with a valid car and no photos. */
async function walkToContact(overrides: { phone?: string } = {}): Promise<void> {
  openCard('sell');
  fillCar();
  primary().click();
  await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 2 de 4'));
  choose('deadline', '30d');
  choose('region', '08');
  primary().click();
  await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 3 de 4'));
  primary().click();
  await vi.waitFor(() => expect(must('.vtr-ha-step').textContent).toBe('Paso 4 de 4'));
  typeInto('name', 'Camila');
  typeInto('phone', overrides.phone ?? '+56 9 6543 2109');
  tickConsent();
}
