// Tenant branding: the booking chip's words, the typeface, and the logo.
//
// Three fields a dealer sets in Vitrina and one inline escape hatch each. The
// properties that make them safe to ship on a stranger's website — and which
// this file exists to pin down — are:
//
//   1. INLINE WINS, exactly as it does for theme/locale/welcomeMessage. A page
//      that says what it looks like is never overruled by the server.
//   2. THE FONT CAN FAIL AND NOTHING BREAKS. The @font-face has to be declared
//      in the HOST document (a shadow root cannot host one the engine honours),
//      so the widget injects ONE <link> per family — and the family it applies
//      inside the shadow always falls back to the stack it has always used.
//      'system' injects nothing at all.
//   3. THE LOGO IS AN ENHANCEMENT. A missing, blank or hostile URL means no
//      logo — never a broken <img>, never an empty box in the header.
//   4. A TENANT LABEL IS THE TENANT'S WORDS. It is not a translation key: a
//      locale swap must not quietly rewrite "Agendar demo" back to our copy.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_BOOKING_LABEL, normalizeBookingLabel, resolveConfig } from '../src/config';
import {
  FONT_LINK_ATTR,
  SYSTEM_FONT_STACK,
  WIDGET_FONTS,
  ensureFontLoaded,
  fontStack,
  googleFontsHref,
  resolveFont,
} from '../src/fonts';
import { init } from '../src/index';
import { coerceRemoteConfig } from '../src/remote-config';
import type { WidgetFont } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';
const LOGO = 'https://cdn.dealer.cl/logo.png';

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

/** What GET /widget/config answers. Set per test. */
let configData: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  configData = {};
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, configData));
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    }
    return Promise.resolve(emptyRes(404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
  // The font <link> deliberately OUTLIVES destroy() (see fonts.ts), so the
  // suite has to sweep the host document itself between tests.
  document.querySelectorAll(`link[${FONT_LINK_ATTR}]`).forEach((n) => n.remove());
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
function root(): HTMLElement {
  return must<HTMLElement>('.vtr-root');
}
function fontLinks(font?: string): HTMLLinkElement[] {
  const sel = font ? `link[${FONT_LINK_ATTR}="${font}"]` : `link[${FONT_LINK_ATTR}]`;
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>(sel));
}
/** coerceRemoteConfig, minus the `| null` it only returns for a non-object. */
function coerce(input: unknown): NonNullable<ReturnType<typeof coerceRemoteConfig>> {
  const out = coerceRemoteConfig(input);
  if (!out) throw new Error('coerceRemoteConfig rejected an object body');
  return out;
}

/** Wait until GET /widget/config has been answered and applied. */
async function settled(): Promise<void> {
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length).toBe(1),
  );
  // One more turn so the .then() that applies the answer has run.
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// 1. bookingLabel — the chip says what the tenant configured.
// ---------------------------------------------------------------------------

describe('bookingLabel', () => {
  it('defaults to the built-in copy when nobody says otherwise', async () => {
    configData = { bookingEnabled: true };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(must('.vtr-chip-book').textContent).toBe('Agendar visita');
    w.destroy();
  });

  it('paints the server-configured label on the chip', async () => {
    configData = { bookingEnabled: true, bookingLabel: 'Agendar demo' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    await vi.waitFor(() => expect(must('.vtr-chip-book').textContent).toBe('Agendar demo'));
    w.destroy();
  });

  it('lets an inline label beat the server', async () => {
    configData = { bookingEnabled: true, bookingLabel: 'Agendar demo' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, bookingLabel: 'Reservar hora' });
    await settled();
    expect(must('.vtr-chip-book').textContent).toBe('Reservar hora');
    w.destroy();
  });

  it('keeps the tenant label through a server-driven locale swap', async () => {
    // The server changes the chrome language; it does NOT get to translate the
    // dealer's own word for their flow. (The chip repaint inside setLocale is
    // exactly where a naive implementation loses the label.)
    configData = { bookingEnabled: true, locale: 'es', bookingLabel: 'Agendar demo' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'en' });
    await settled();
    expect(must('.vtr-chip-book').textContent).toBe('Agendar demo');
    // ...and with nothing pinned inline, the server's language does land.
    w.destroy();
    document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
    const w2 = init({ publicKey: PK, apiBaseUrl: BASE });
    await vi.waitFor(() => expect(must('.vtr-close').getAttribute('aria-label')).toBe('Cerrar'));
    expect(must('.vtr-chip-book').textContent).toBe('Agendar demo');
    w2.destroy();
  });

  it('falls back to our copy for a blank or over-long label', async () => {
    configData = { bookingEnabled: true, bookingLabel: '   ' };
    const w = init({
      publicKey: PK,
      apiBaseUrl: BASE,
      locale: 'es',
      bookingLabel: 'x'.repeat(200),
    });
    await settled();
    expect(must('.vtr-chip-book').textContent).toBe('Agendar visita');
    w.destroy();
  });

  it('normalizes: trims, rejects blank, null, and anything over the cap', () => {
    expect(normalizeBookingLabel('  Agendar demo  ')).toBe('Agendar demo');
    expect(normalizeBookingLabel('')).toBeNull();
    expect(normalizeBookingLabel('   ')).toBeNull();
    expect(normalizeBookingLabel(null)).toBeNull();
    expect(normalizeBookingLabel(undefined)).toBeNull();
    expect(normalizeBookingLabel(42)).toBeNull();
    expect(normalizeBookingLabel('a'.repeat(MAX_BOOKING_LABEL))).toHaveLength(MAX_BOOKING_LABEL);
    expect(normalizeBookingLabel('a'.repeat(MAX_BOOKING_LABEL + 1))).toBeNull();
  });

  it('resolves inline over remote, and null out of an absent value', () => {
    const base = { publicKey: PK, apiBaseUrl: BASE };
    expect(resolveConfig(base).bookingLabel).toBeNull();
    expect(resolveConfig(base, { bookingLabel: 'Agendar demo' }).bookingLabel).toBe('Agendar demo');
    expect(
      resolveConfig({ ...base, bookingLabel: 'Reservar hora' }, { bookingLabel: 'Agendar demo' })
        .bookingLabel,
    ).toBe('Reservar hora');
  });

  it('drops a null label off the wire rather than caching it', () => {
    // The server sends `bookingLabel: null` explicitly; that is "nothing to
    // say", and it must never survive into the cache as a value.
    expect(coerce({ bookingLabel: null }).bookingLabel).toBeUndefined();
    expect(coerce({ bookingLabel: 'Agendar demo' }).bookingLabel).toBe('Agendar demo');
  });

  it('no chip is constructed for a tenant without the agenda, label or not', async () => {
    configData = { bookingLabel: 'Agendar demo' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    expect(q('.vtr-chip-book')).toBeNull();
    expect(q('.vtr-actions')).toBeNull();
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. font — the ONE thing that has to leave the shadow root.
// ---------------------------------------------------------------------------

describe('font', () => {
  it('injects nothing at all for the default (system) font', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    expect(fontLinks()).toHaveLength(0);
    // No inline override either: the widget wears the :host stack it always has.
    expect(root().style.getPropertyValue('--vtr-font')).toBe('');
    w.destroy();
  });

  it('declares the family in the HOST document, once, for an inline font', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, font: 'dmSans' });
    await settled();
    const links = fontLinks('dmSans');
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe('stylesheet');
    expect(links[0].getAttribute('href')).toBe(
      'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap',
    );
    // The <link> is in <head>, NOT in the shadow root — @font-face declared
    // inside a shadow root is ignored by every engine, which is the whole
    // reason this indirection exists.
    expect(shadow().querySelector(`link[${FONT_LINK_ATTR}]`)).toBeNull();
    w.destroy();
  });

  it('applies the family inside the shadow styles, over the old stack', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, font: 'dmSans' });
    await settled();
    const stack = root().style.getPropertyValue('--vtr-font');
    expect(stack).toContain("'DM Sans'");
    // The fallback is the point: a stylesheet that never loads leaves the
    // widget looking exactly as it does today.
    expect(stack).toContain(SYSTEM_FONT_STACK);
    expect(stack.indexOf("'DM Sans'")).toBeLessThan(stack.indexOf('-apple-system'));
    w.destroy();
  });

  it('injects exactly one <link> per family across destroy/init cycles', async () => {
    const first = init({ publicKey: PK, apiBaseUrl: BASE, font: 'dmSans' });
    await settled();
    first.destroy();
    // Survives the teardown on purpose: a stylesheet already in the page costs
    // nothing to keep, and removing it would make the next init re-download it.
    expect(fontLinks('dmSans')).toHaveLength(1);
    const second = init({ publicKey: PK, apiBaseUrl: BASE, font: 'dmSans' });
    expect(fontLinks('dmSans')).toHaveLength(1);
    expect(fontLinks()).toHaveLength(1);
    second.destroy();
  });

  it('injects one <link> per family when two widgets want different faces', async () => {
    const a = init({ publicKey: PK, apiBaseUrl: BASE, font: 'dmSans' });
    await settled();
    a.destroy();
    const b = init({ publicKey: PK, apiBaseUrl: BASE, font: 'poppins' });
    expect(fontLinks('dmSans')).toHaveLength(1);
    expect(fontLinks('poppins')).toHaveLength(1);
    expect(fontLinks()).toHaveLength(2);
    b.destroy();
  });

  it('takes the font from the server when the page pinned none', async () => {
    configData = { font: 'ibmPlexSans' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    await vi.waitFor(() => expect(fontLinks('ibmPlexSans')).toHaveLength(1));
    expect(root().style.getPropertyValue('--vtr-font')).toContain("'IBM Plex Sans'");
    w.destroy();
  });

  it('lets an inline font beat the server, and loads only the inline one', async () => {
    configData = { font: 'poppins' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, font: 'dmSans' });
    await settled();
    expect(root().style.getPropertyValue('--vtr-font')).toContain("'DM Sans'");
    expect(fontLinks('poppins')).toHaveLength(0);
    expect(fontLinks()).toHaveLength(1);
    w.destroy();
  });

  it('ignores a font this widget has never heard of', async () => {
    // A newer server offering a face this build predates. The honest answer is
    // the system stack, not a family the browser cannot find.
    configData = { font: 'comicSans' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    expect(fontLinks()).toHaveLength(0);
    expect(root().style.getPropertyValue('--vtr-font')).toBe('');
    expect(coerce({ font: 'comicSans' }).font).toBeUndefined();
    w.destroy();
  });

  it('restores the original stack when the dealer switches back to system', async () => {
    // Cached as dmSans (a repeat visitor), then the live answer says system.
    globalThis.localStorage.setItem(
      `vtr:widget:${PK}:config`,
      JSON.stringify({ font: 'dmSans' }),
    );
    configData = { font: 'system' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    expect(root().style.getPropertyValue('--vtr-font')).toContain("'DM Sans'");
    await settled();
    await vi.waitFor(() => expect(root().style.getPropertyValue('--vtr-font')).toBe(''));
    w.destroy();
  });

  it('maps every enum value to a Google Fonts stylesheet with 400/500/700', () => {
    expect(WIDGET_FONTS).toContain('system');
    expect(googleFontsHref('system')).toBeNull();
    expect(fontStack('system')).toBe(SYSTEM_FONT_STACK);
    const hrefs = new Set<string>();
    for (const font of WIDGET_FONTS) {
      if (font === 'system') continue;
      const href = googleFontsHref(font);
      expect(href, font).toMatch(
        /^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z+]+:wght@400;500;700&display=swap$/,
      );
      hrefs.add(href as string);
    }
    // Eight values, seven real families, no duplicates.
    expect(WIDGET_FONTS).toHaveLength(8);
    expect(hrefs.size).toBe(7);
    expect(googleFontsHref('nunitoSans')).toContain('family=Nunito+Sans:');
  });

  it('resolves anything unusable to system rather than throwing', () => {
    expect(resolveFont('dmSans')).toBe('dmSans');
    expect(resolveFont('nope')).toBe('system');
    expect(resolveFont(undefined)).toBe('system');
    expect(resolveFont(null)).toBe('system');
    expect(resolveFont({ font: 'dmSans' })).toBe('system');
  });

  it('never throws when the host document refuses the injection', () => {
    // A page with no <head> to speak of, or one that throws on the way in.
    expect(ensureFontLoaded('dmSans', { head: null } as unknown as Document)).toBeNull();
    expect(ensureFontLoaded('system')).toBeNull();
    const hostile = {
      get head(): never {
        throw new Error('locked down');
      },
    } as unknown as Document;
    expect(ensureFontLoaded('dmSans', hostile)).toBeNull();
  });

  it('carries the font through to a widget that also has booking chips', async () => {
    // The chips inherit `font: inherit`, so the face has to reach them too —
    // this is the regression that a font applied to :host only would produce.
    configData = { bookingEnabled: true, font: 'dmSans' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    await vi.waitFor(() => expect(fontLinks('dmSans')).toHaveLength(1));
    expect(must('.vtr-chip-book').closest('.vtr-root')).toBe(root());
    expect(root().style.getPropertyValue('--vtr-font')).toContain("'DM Sans'");
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. logoUrl — the tenant's mark in the panel header.
// ---------------------------------------------------------------------------

describe('logoUrl', () => {
  it('renders the logo in the header next to the title', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, logoUrl: LOGO });
    await settled();
    const logo = must<HTMLImageElement>('.vtr-logo');
    expect(logo.hidden).toBe(false);
    expect(logo.getAttribute('src')).toBe(LOGO);
    // In the header, BEFORE the title — the mark reads first.
    expect(logo.parentElement?.className).toBe('vtr-header');
    expect(logo.nextElementSibling?.className).toBe('vtr-title');
    w.destroy();
  });

  it('is gracefully absent when nobody configured one', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    const logo = must<HTMLImageElement>('.vtr-logo');
    expect(logo.hidden).toBe(true);
    // No src means no request and nothing drawn — never a broken image.
    expect(logo.hasAttribute('src')).toBe(false);
    w.destroy();
  });

  it('refuses a non-http(s) URL rather than putting it in the DOM', async () => {
    const w = init({
      publicKey: PK,
      apiBaseUrl: BASE,
      logoUrl: 'javascript:alert(1)',
    });
    await settled();
    const logo = must<HTMLImageElement>('.vtr-logo');
    expect(logo.hidden).toBe(true);
    expect(logo.hasAttribute('src')).toBe(false);
    w.destroy();
  });

  it('takes the logo from the server when the page pinned none', async () => {
    configData = { logoUrl: LOGO };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    await vi.waitFor(() => expect(must<HTMLImageElement>('.vtr-logo').hidden).toBe(false));
    expect(must<HTMLImageElement>('.vtr-logo').getAttribute('src')).toBe(LOGO);
    w.destroy();
  });

  it('takes the logo away when the dealer clears it mid-session', async () => {
    globalThis.localStorage.setItem(
      `vtr:widget:${PK}:config`,
      JSON.stringify({ logoUrl: LOGO }),
    );
    configData = { logoUrl: null };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    expect(must<HTMLImageElement>('.vtr-logo').hidden).toBe(false);
    await settled();
    await vi.waitFor(() => expect(must<HTMLImageElement>('.vtr-logo').hidden).toBe(true));
    w.destroy();
  });

  it('is the same slot as theme.logoUrl, with top-level winning per tier', () => {
    const base = { publicKey: PK, apiBaseUrl: BASE };
    const other = 'https://cdn.dealer.cl/other.png';
    // Nothing anywhere.
    expect(resolveConfig(base).theme.logoUrl).toBeUndefined();
    // The old spelling still works, inline and remote.
    expect(resolveConfig({ ...base, theme: { logoUrl: LOGO } }).theme.logoUrl).toBe(LOGO);
    expect(resolveConfig(base, { theme: { logoUrl: LOGO } }).theme.logoUrl).toBe(LOGO);
    // The new one too.
    expect(resolveConfig(base, { logoUrl: LOGO }).theme.logoUrl).toBe(LOGO);
    // Top-level beats nested WITHIN a tier...
    expect(
      resolveConfig({ ...base, logoUrl: LOGO, theme: { logoUrl: other } }).theme.logoUrl,
    ).toBe(LOGO);
    expect(resolveConfig(base, { logoUrl: LOGO, theme: { logoUrl: other } }).theme.logoUrl).toBe(
      LOGO,
    );
    // ...and inline beats remote in EITHER spelling.
    expect(resolveConfig({ ...base, logoUrl: LOGO }, { logoUrl: other }).theme.logoUrl).toBe(LOGO);
    expect(
      resolveConfig({ ...base, theme: { logoUrl: LOGO } }, { logoUrl: other }).theme.logoUrl,
    ).toBe(LOGO);
  });

  it('drops a null logo off the wire rather than caching it', () => {
    expect(coerce({ logoUrl: null }).logoUrl).toBeUndefined();
    expect(coerce({ logoUrl: LOGO }).logoUrl).toBe(LOGO);
  });
});

// ---------------------------------------------------------------------------
// 4. The three of them together — precedence and the first-paint hold.
// ---------------------------------------------------------------------------

describe('brand config, layered', () => {
  it('resolves all three with inline over remote', () => {
    const resolved = resolveConfig(
      {
        publicKey: PK,
        apiBaseUrl: BASE,
        bookingLabel: 'Reservar hora',
        font: 'montserrat',
        logoUrl: LOGO,
      },
      { bookingLabel: 'Agendar demo', font: 'poppins', logoUrl: 'https://cdn.x/other.png' },
    );
    expect(resolved.bookingLabel).toBe('Reservar hora');
    expect(resolved.font).toBe('montserrat');
    expect(resolved.theme.logoUrl).toBe(LOGO);
  });

  it('round-trips all three through the last-known-good cache', async () => {
    // A repeat visitor's first paint is already branded, before any request.
    globalThis.localStorage.setItem(
      `vtr:widget:${PK}:config`,
      JSON.stringify({
        bookingEnabled: true,
        bookingLabel: 'Agendar demo',
        font: 'dmSans',
        logoUrl: LOGO,
      }),
    );
    configData = { bookingEnabled: true, bookingLabel: 'Agendar demo', font: 'dmSans', logoUrl: LOGO };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    // Synchronously, off the cache — no waiting on the network.
    expect(must('.vtr-chip-book').textContent).toBe('Agendar demo');
    expect(root().style.getPropertyValue('--vtr-font')).toContain("'DM Sans'");
    expect(must<HTMLImageElement>('.vtr-logo').getAttribute('src')).toBe(LOGO);
    expect(fontLinks('dmSans')).toHaveLength(1);
    await settled();
    expect(must('.vtr-chip-book').textContent).toBe('Agendar demo');
    w.destroy();
  });

  it('counts an inline brand field as pinned appearance (no first-paint hold)', () => {
    // A page that says what it looks like must never be held back waiting for
    // GET /widget/config — the same rule theme/locale/welcomeMessage follow.
    for (const pinned of [
      { bookingLabel: 'Agendar demo' },
      { font: 'dmSans' as WidgetFont },
      { logoUrl: LOGO },
    ]) {
      const w = init({ publicKey: PK, apiBaseUrl: BASE, ...pinned });
      expect(root().style.getPropertyValue('visibility'), JSON.stringify(pinned)).toBe('');
      w.destroy();
      document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
    }
  });

  it('holds the launcher back when it is genuinely flying blind', () => {
    // Nothing inline, nothing cached: the pre-existing behaviour, unchanged by
    // the new fields.
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    expect(root().style.getPropertyValue('visibility')).toBe('hidden');
    w.destroy();
  });
});
