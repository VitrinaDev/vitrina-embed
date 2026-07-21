// Server-resolved appearance (Vitrina ADR 0046).
//
// The widget asks `GET /widget/config` what it should look like, so a dealer can
// restyle their bubble from the Vitrina admin UI without editing their own site.
// The properties that make that safe to ship — and which this file exists to
// pin down — are:
//
//   1. INLINE WINS. Every widget installed before the endpoint existed carries a
//      fully-populated inline config. None of them may change by a pixel.
//   2. IT FAILS OPEN. A 404, a network error, a garbage body: the widget still
//      mounts, still works, and still shows up.
//   3. IT NEVER HIDES THE WIDGET. The one case where we hold the launcher back
//      (cold cache + nothing inline) is bounded by a timer, not by the network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coerceRemoteConfig } from '../src/remote-config';
import { hasInlineAppearance, resolveConfig } from '../src/config';
import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';
const CONFIG_KEY = `vtr:widget:${PK}:config`;

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

/** What the server would send for a dealer who set everything. */
const SERVED = {
  theme: {
    accent: '#E4852B',
    position: 'bl' as const,
    logoUrl: 'https://cdn.dealer.cl/logo.png',
  },
  welcomeMessage: 'Bienvenido a Autos Pérez',
  locale: 'en' as const,
};

let fetchMock: ReturnType<typeof vi.fn>;
/** Set per test: what GET /widget/config answers. */
let configResponse: () => Promise<Response>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  configResponse = () => Promise.resolve(jsonRes(200, SERVED));
  fetchMock = vi.fn((url: string) => {
    if (String(url).includes('/widget/config')) return configResponse();
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
function rootEl(): HTMLElement {
  return shadowOf().querySelector('.vtr-root') as HTMLElement;
}
function configCalls(): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length;
}

// ---------------------------------------------------------------------------
// Precedence — the property the whole rollout rests on.
// ---------------------------------------------------------------------------
describe('resolveConfig precedence (inline over server)', () => {
  it('uses the server answer for everything the page did not pin', () => {
    const r = resolveConfig({ publicKey: PK, apiBaseUrl: BASE }, SERVED);
    expect(r.theme.accent).toBe('#E4852B');
    expect(r.theme.position).toBe('bl');
    expect(r.theme.logoUrl).toBe('https://cdn.dealer.cl/logo.png');
    expect(r.welcomeMessage).toBe('Bienvenido a Autos Pérez');
    expect(r.locale).toBe('en');
  });

  it('lets an inline value beat the server field by field', () => {
    const r = resolveConfig(
      {
        publicKey: PK,
        apiBaseUrl: BASE,
        theme: { accent: '#000000' },
        locale: 'es',
      },
      SERVED,
    );
    // Overridden…
    expect(r.theme.accent).toBe('#000000');
    expect(r.locale).toBe('es');
    // …while the untouched fields still come from the server.
    expect(r.theme.position).toBe('bl');
    expect(r.theme.logoUrl).toBe('https://cdn.dealer.cl/logo.png');
  });

  it('does NOT let an explicitly-undefined inline key clobber the server', () => {
    // `theme: { accent: props.brandColor }` with nothing configured is an
    // ordinary thing for a host app to produce. It means "I have nothing to
    // say", not "blank it".
    const r = resolveConfig(
      { publicKey: PK, apiBaseUrl: BASE, theme: { accent: undefined } },
      SERVED,
    );
    expect(r.theme.accent).toBe('#E4852B');
  });

  it('behaves exactly as before when there is no server answer', () => {
    const without = resolveConfig({
      publicKey: PK,
      apiBaseUrl: BASE,
      theme: { accent: '#123456' },
    });
    expect(without.theme.accent).toBe('#123456');
    expect(without.theme.position).toBe('br');
    expect(without.welcomeMessage).toBeNull();
  });

  it('still throws the original error on a missing key/base', () => {
    expect(() => resolveConfig({ apiBaseUrl: BASE } as never, SERVED)).toThrow(
      /init\(\) requires/,
    );
  });
});

describe('hasInlineAppearance', () => {
  it('is false for a minimal snippet', () => {
    expect(hasInlineAppearance({ publicKey: PK, apiBaseUrl: BASE })).toBe(false);
  });

  it('is false when every inline appearance key is undefined', () => {
    expect(
      hasInlineAppearance({
        publicKey: PK,
        apiBaseUrl: BASE,
        theme: { accent: undefined },
      }),
    ).toBe(false);
  });

  it('is true for a pre-ADR-0046 snippet', () => {
    expect(
      hasInlineAppearance({
        publicKey: PK,
        apiBaseUrl: BASE,
        theme: { accent: '#111827', position: 'br' },
      }),
    ).toBe(true);
  });

  it('counts welcomeMessage and locale, not just theme', () => {
    expect(
      hasInlineAppearance({ publicKey: PK, apiBaseUrl: BASE, welcomeMessage: 'hola' }),
    ).toBe(true);
    expect(hasInlineAppearance({ publicKey: PK, apiBaseUrl: BASE, locale: 'en' })).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Wire/storage coercion — this object gets spread over the dealer's own config,
// so it must never carry a field we did not validate.
// ---------------------------------------------------------------------------
describe('coerceRemoteConfig', () => {
  it('keeps the fields it knows', () => {
    expect(coerceRemoteConfig(SERVED)).toEqual(SERVED);
  });

  it('drops unknown keys rather than passing them through', () => {
    const out = coerceRemoteConfig({
      theme: { accent: '#fff', evil: 'x' },
      apiBaseUrl: 'https://attacker.example',
      publicKey: 'pk_attacker',
    });
    expect(out).toEqual({ theme: { accent: '#fff' } });
  });

  it('drops a position outside the vocabulary', () => {
    expect(coerceRemoteConfig({ theme: { position: 'left' } })).toEqual({});
  });

  it('drops a locale it does not speak', () => {
    expect(coerceRemoteConfig({ locale: 'pt' })).toEqual({});
  });

  it('returns null for a non-object', () => {
    expect(coerceRemoteConfig(null)).toBeNull();
    expect(coerceRemoteConfig('nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end through init().
// ---------------------------------------------------------------------------
describe('init() applies the server-resolved appearance', () => {
  it('fetches the config and re-themes the mounted widget', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });

    await vi.waitFor(() => {
      expect(rootEl().style.getPropertyValue('--vtr-accent')).toBe('#E4852B');
    });
    expect(rootEl().getAttribute('data-pos')).toBe('bl');

    const logo = shadowOf().querySelector('.vtr-logo') as HTMLImageElement;
    expect(logo.hidden).toBe(false);
    expect(logo.getAttribute('src')).toBe('https://cdn.dealer.cl/logo.png');

    // The locale came back as `en`, so the chrome is English.
    expect((shadowOf().querySelector('.vtr-sendbtn') as HTMLElement).textContent).toBe(
      'Send',
    );
    w.destroy();
  });

  it('sends the pk_ as ?siteKey= so the CORS preflight can resolve the key', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => expect(configCalls()).toBe(1));
    const url = String(
      fetchMock.mock.calls.find((c) => String(c[0]).includes('/widget/config'))![0],
    );
    expect(url).toContain(`siteKey=${encodeURIComponent(PK)}`);
    w.destroy();
  });

  it('repaints the greeting that is already on screen', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    // The panel opened before the config landed, so it painted the default.
    expect(shadowOf().querySelector('[data-welcome]')?.textContent).not.toBe(
      SERVED.welcomeMessage,
    );
    await vi.waitFor(() => {
      expect(shadowOf().querySelector('[data-welcome]')?.textContent).toBe(
        SERVED.welcomeMessage,
      );
    });
    // Exactly one greeting — the repaint replaces, never appends.
    expect(shadowOf().querySelectorAll('[data-welcome]').length).toBe(1);
    w.destroy();
  });

  it('leaves an inline theme untouched (a pre-ADR-0046 install cannot change)', async () => {
    const w = init({
      publicKey: PK,
      apiBaseUrl: BASE,
      theme: { accent: '#111827', position: 'br' },
      welcomeMessage: 'Snippet greeting',
      locale: 'es',
    });
    await vi.waitFor(() => expect(configCalls()).toBe(1));
    // Give the applied config a chance to (wrongly) land.
    await Promise.resolve();

    expect(rootEl().style.getPropertyValue('--vtr-accent')).toBe('#111827');
    expect(rootEl().getAttribute('data-pos')).toBe('br');
    expect((shadowOf().querySelector('.vtr-sendbtn') as HTMLElement).textContent).toBe(
      'Enviar',
    );
    // The server's logo still applies: the snippet said nothing about a logo.
    await vi.waitFor(() => {
      const logo = shadowOf().querySelector('.vtr-logo') as HTMLImageElement;
      expect(logo.getAttribute('src')).toBe('https://cdn.dealer.cl/logo.png');
    });
    w.destroy();
  });
});

describe('init() fails open', () => {
  it('keeps the default theme when the endpoint 404s (an older API)', async () => {
    configResponse = () => Promise.resolve(emptyRes(404));
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => expect(configCalls()).toBe(1));

    expect(rootEl().style.getPropertyValue('--vtr-accent')).toBe('#111827');
    // …and the widget is VISIBLE, which is the part that actually matters.
    await vi.waitFor(() => {
      expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    });
    w.destroy();
  });

  it('survives a network error', async () => {
    configResponse = () => Promise.reject(new Error('offline'));
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => expect(configCalls()).toBe(1));
    await vi.waitFor(() => {
      expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    });
    expect(shadowOf().querySelector('.vtr-launcher')).not.toBeNull();
    w.destroy();
  });

  it('ignores a hostile accent and keeps a coherent widget', async () => {
    configResponse = () =>
      Promise.resolve(
        jsonRes(200, { theme: { accent: 'red; } .vtr-panel { display:none } .x {' } }),
      );
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => expect(configCalls()).toBe(1));
    await vi.waitFor(() => {
      expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    });
    // Fell back to the default rather than being injected or left half-themed.
    expect(rootEl().style.getPropertyValue('--vtr-accent')).toBe('#111827');
    w.destroy();
  });

  it('ignores a non-http logo URL', async () => {
    configResponse = () =>
      Promise.resolve(jsonRes(200, { theme: { logoUrl: 'data:image/png;base64,AAA' } }));
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => expect(configCalls()).toBe(1));
    const logo = shadowOf().querySelector('.vtr-logo') as HTMLImageElement;
    expect(logo.hidden).toBe(true);
    expect(logo.getAttribute('src')).toBeNull();
    w.destroy();
  });
});

describe('the last-known-good cache', () => {
  it('paints the first frame from cache, with no waiting', () => {
    globalThis.localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ theme: { accent: '#059669', position: 'bl' } }),
    );
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    // Synchronously — before any fetch could possibly have resolved.
    expect(rootEl().style.getPropertyValue('--vtr-accent')).toBe('#059669');
    expect(rootEl().getAttribute('data-pos')).toBe('bl');
    expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    w.destroy();
  });

  it('writes the served config back for the next pageview', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => {
      expect(JSON.parse(globalThis.localStorage.getItem(CONFIG_KEY) ?? 'null')).toEqual(
        SERVED,
      );
    });
    w.destroy();
  });

  it('survives a corrupt entry', () => {
    globalThis.localStorage.setItem(CONFIG_KEY, '{not json');
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    expect(shadowOf().querySelector('.vtr-launcher')).not.toBeNull();
    w.destroy();
  });

  it('is not written when the fetch fails, so the last good value survives', async () => {
    globalThis.localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ theme: { accent: '#059669' } }),
    );
    configResponse = () => Promise.resolve(emptyRes(500));
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => expect(configCalls()).toBe(1));
    expect(JSON.parse(globalThis.localStorage.getItem(CONFIG_KEY) ?? 'null')).toEqual({
      theme: { accent: '#059669' },
    });
    // Still wearing the cached brand colour, not the default.
    expect(rootEl().style.getPropertyValue('--vtr-accent')).toBe('#059669');
    w.destroy();
  });
});

describe('holding the launcher back', () => {
  it('mounts invisibly only when flying blind, and reveals on the answer', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    // Cold cache + nothing inline: a default-black launcher that snapped to the
    // dealer's orange a moment later would look broken on their own site.
    expect(rootEl().style.getPropertyValue('visibility')).toBe('hidden');
    await vi.waitFor(() => {
      expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    });
    w.destroy();
  });

  it('reveals on a timer even if the config never answers', async () => {
    vi.useFakeTimers();
    // A fetch that never settles — a hung proxy, a throttled background tab.
    configResponse = () => new Promise<Response>(() => {});
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    expect(rootEl().style.getPropertyValue('visibility')).toBe('hidden');

    await vi.advanceTimersByTimeAsync(1_300);
    expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    w.destroy();
    vi.useRealTimers();
  });

  it('never hides a widget that says what it looks like', () => {
    const w = init({
      publicKey: PK,
      apiBaseUrl: BASE,
      theme: { accent: '#111827' },
    });
    expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    w.destroy();
  });

  it('never hides a widget with a cached appearance', () => {
    globalThis.localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ theme: { accent: '#059669' } }),
    );
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    w.destroy();
  });
});

describe('remoteConfig: false', () => {
  it('makes no request and reads no cache', async () => {
    globalThis.localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ theme: { accent: '#059669' } }),
    );
    const w = init({ publicKey: PK, apiBaseUrl: BASE, remoteConfig: false });
    expect(rootEl().style.getPropertyValue('--vtr-accent')).toBe('#111827');
    expect(rootEl().style.getPropertyValue('visibility')).toBe('');
    await Promise.resolve();
    expect(configCalls()).toBe(0);
    w.destroy();
  });
});

describe('position changes flip BOTH pins', () => {
  it('drops the old side on the light-DOM host, not just the shadow root', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    const host = document.querySelector('[data-vitrina-widget]') as HTMLElement;
    // Default is bottom-right.
    expect(host.style.getPropertyValue('right')).toBe('0px');

    await vi.waitFor(() => expect(rootEl().getAttribute('data-pos')).toBe('bl'));
    // Leaving `right: 0 !important` behind would stretch the host across the
    // viewport and swallow clicks on the page underneath it.
    expect(host.style.getPropertyValue('left')).toBe('0px');
    expect(host.style.getPropertyValue('right')).toBe('');
    w.destroy();
  });
});
