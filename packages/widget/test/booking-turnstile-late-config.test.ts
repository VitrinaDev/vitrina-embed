import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

/**
 * The gate must follow the LIVE config, not the config the controller was
 * born with.
 *
 * A returning visitor carries a cached remote config. When that cache predates
 * the site key (written by a widget < 0.9.2, or by a tenant that had no key
 * yet), `bookingEnabled: true` in it builds the booking controller at init —
 * before `GET /widget/config` answers with the key — and 0.9.2 gave that
 * controller no gate for the rest of the pageview. Every confirm then POSTed
 * tokenless against a server that refuses tokenless bookings: "No pudimos
 * agendar. Reintenta.", on every dealer site, for every returning visitor's
 * first session after the upgrade (lovende.cl, 2026-09-02).
 */

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_late';
const CONFIG_KEY = `vtr:widget:${PK}:config`;
const TZ = 'America/Santiago';

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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
// A bookable day three days out, and the month it lives in.
const FIRST = new Date();
FIRST.setDate(FIRST.getDate() + 3);
const YM = `${FIRST.getFullYear()}-${pad2(FIRST.getMonth() + 1)}`;
const DAY = pad2(FIRST.getDate());
const NEXT_MONTH = YM !== `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}`;

function slotsFor(ym: string): unknown[] {
  if (ym !== YM) return [];
  return [
    {
      startsAt: `${YM}-${DAY}T10:00:00-04:00`,
      endsAt: `${YM}-${DAY}T10:30:00-04:00`,
      label: '10:00',
      labelLong: `${YM}-${DAY} 10:00`,
      available: true,
    },
  ];
}

let releaseConfig: () => void = () => {};
let configData: Record<string, unknown>;
let postedBodies: Array<Record<string, unknown>>;
let fetchMock: ReturnType<typeof vi.fn>;
let turnstileRender: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalThis.localStorage.clear();
  postedBodies = [];
  configData = { bookingEnabled: true, turnstileSiteKey: '0x4AAAAAAA' };
  const gate = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.includes('/widget/config')) return gate.then(() => jsonRes(200, configData));
    if (u.includes('/widget/appointments/availability')) {
      const from = new URL(u).searchParams.get('from') ?? '';
      return Promise.resolve(
        jsonRes(200, { configured: true, timezone: TZ, slots: slotsFor(from.slice(0, 7)) }),
      );
    }
    if (u.includes('/widget/appointments')) {
      if (method === 'POST') {
        const body = JSON.parse(String(opts?.body ?? '{}')) as Record<string, unknown>;
        postedBodies.push(body);
        return Promise.resolve(
          jsonRes(201, {
            appointment: {
              displayId: 'A-7',
              status: 'scheduled',
              startsAt: body.starts_at,
              endsAt: body.ends_at,
              vehicleId: null,
              customerName: 'Camila Fuentes',
              notes: null,
            },
            managementToken: 'bkt_zzzzyyyyxxxxwwwwvvvvuuuuttttssss',
          }),
        );
      }
      return Promise.resolve(emptyRes(404));
    }
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    }
    if (u.includes('/widget/stream')) return Promise.resolve(openStreamRes(opts?.signal ?? undefined));
    return Promise.resolve(emptyRes(404));
  });
  vi.stubGlobal('fetch', fetchMock);
  // The challenge solves itself as soon as it is mounted, like the real one
  // does for a human with nothing to prove.
  turnstileRender = vi.fn((_el: HTMLElement, opts: { callback: (t: string) => void }): string => {
    setTimeout(() => opts.callback('tok_solved'), 0);
    return 'w1';
  });
  (window as unknown as { turnstile: unknown }).turnstile = {
    render: turnstileRender,
    remove: vi.fn(),
    reset: vi.fn(),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
});

function shadowOf(): ShadowRoot {
  const host = document.querySelector('[data-vitrina-widget]') as HTMLElement | null;
  if (!host?.shadowRoot) throw new Error('not mounted');
  return host.shadowRoot;
}
function must<T extends Element = HTMLElement>(sel: string): T {
  const el = shadowOf().querySelector(sel) as T | null;
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}
function typeInto(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function primary(): HTMLButtonElement {
  return must<HTMLButtonElement>('.vtr-bk-primary');
}

async function bookThroughTheUi(): Promise<void> {
  must<HTMLButtonElement>('.vtr-chip-book').click();
  await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-day').length).toBeGreaterThan(0));
  await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-bk-count')).not.toBeNull());
  if (NEXT_MONTH) {
    must<HTMLButtonElement>('.vtr-bk-navnext').click();
  }
  await vi.waitFor(() =>
    expect(shadowOf().querySelector(`[data-bk-day="${YM}-${DAY}"]`)).not.toBeNull(),
  );
  await vi.waitFor(() => expect(must('.vtr-bk-count').textContent).toMatch(/1 d[ií]a/));
  must<HTMLButtonElement>(`[data-bk-day="${YM}-${DAY}"]`).click();
  await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-slot').length).toBe(1));
  must<HTMLButtonElement>('.vtr-bk-slot').click();
  await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-bk-form')).not.toBeNull());
  typeInto(must<HTMLInputElement>('input[type="text"].vtr-bk-input'), 'Camila Fuentes');
  typeInto(must<HTMLInputElement>('input[type="tel"].vtr-bk-input'), '+56 9 6543 2109');
  const consent = must<HTMLInputElement>('.vtr-bk-check');
  consent.checked = true;
  consent.dispatchEvent(new Event('change', { bubbles: true }));
  primary().click(); // Continuar → resumen
  await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-bk-turnstile')).not.toBeNull());
  primary().click(); // Confirmar reserva
  await vi.waitFor(() => expect(postedBodies.length).toBe(1));
}

describe('turnstile gate follows the live config', () => {
  it('a controller born from a pre-key cached config still sends a token once the live config lands', async () => {
    // The cache a returning visitor carries from a widget older than 0.9.2.
    globalThis.localStorage.setItem(CONFIG_KEY, JSON.stringify({ bookingEnabled: true }));
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    // The chip is painted from the cache, and with it the booking controller —
    // BEFORE the live config (still held) can say anything about a site key.
    await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-chip-book')).not.toBeNull());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/widget/config'))).toBe(true);
    releaseConfig();
    await vi.waitFor(() =>
      expect(JSON.parse(globalThis.localStorage.getItem(CONFIG_KEY) ?? '{}')).toMatchObject({
        turnstileSiteKey: '0x4AAAAAAA',
      }),
    );

    await bookThroughTheUi();

    // Mounted at least once — the resumen pane re-mounts a fresh challenge on
    // every paint (tokens are single-use), so the exact count is the UI's business.
    expect(turnstileRender).toHaveBeenCalled();
    expect(postedBodies[0]).toMatchObject({ turnstile_token: 'tok_solved' });
    w.destroy();
  });

  it('a first-time visitor (no cache) gets the gate from the live config as before', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    releaseConfig();
    await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-chip-book')).not.toBeNull());

    await bookThroughTheUi();

    expect(postedBodies[0]).toMatchObject({ turnstile_token: 'tok_solved' });
    w.destroy();
  });

  it('drops the gate when the live config stops advertising a key (tokenless POST, server fails open)', async () => {
    globalThis.localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ bookingEnabled: true, turnstileSiteKey: '0x4AAAAAAA' }),
    );
    configData = { bookingEnabled: true };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-chip-book')).not.toBeNull());
    releaseConfig();
    await vi.waitFor(() =>
      expect(JSON.parse(globalThis.localStorage.getItem(CONFIG_KEY) ?? '{}')).not.toHaveProperty(
        'turnstileSiteKey',
      ),
    );

    must<HTMLButtonElement>('.vtr-chip-book').click();
    await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-day').length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-bk-count')).not.toBeNull());
    if (NEXT_MONTH) must<HTMLButtonElement>('.vtr-bk-navnext').click();
    await vi.waitFor(() =>
      expect(shadowOf().querySelector(`[data-bk-day="${YM}-${DAY}"]`)).not.toBeNull(),
    );
    await vi.waitFor(() => expect(must('.vtr-bk-count').textContent).toMatch(/1 d[ií]a/));
    must<HTMLButtonElement>(`[data-bk-day="${YM}-${DAY}"]`).click();
    await vi.waitFor(() => expect(shadowOf().querySelectorAll('.vtr-bk-slot').length).toBe(1));
    must<HTMLButtonElement>('.vtr-bk-slot').click();
    await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-bk-form')).not.toBeNull());
    typeInto(must<HTMLInputElement>('input[type="text"].vtr-bk-input'), 'Camila Fuentes');
    typeInto(must<HTMLInputElement>('input[type="tel"].vtr-bk-input'), '+56 9 6543 2109');
    const consent = must<HTMLInputElement>('.vtr-bk-check');
    consent.checked = true;
    consent.dispatchEvent(new Event('change', { bubbles: true }));
    primary().click();
    await vi.waitFor(() => expect(shadowOf().querySelector('.vtr-bk-note')).not.toBeNull());
    expect(shadowOf().querySelector('.vtr-bk-turnstile')).toBeNull();
    primary().click();
    await vi.waitFor(() => expect(postedBodies.length).toBe(1));
    expect(postedBodies[0]).not.toHaveProperty('turnstile_token');
    expect(turnstileRender).not.toHaveBeenCalled();
    w.destroy();
  });
});
