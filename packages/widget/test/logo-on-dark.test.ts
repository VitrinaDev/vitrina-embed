// The dark-ground logo (0.18.1). A dealer whose mark is dark ink (Up Autos: a
// navy "P") vanishes on the accent header and on the dark-scheme surface. The
// tenant's dark-ground variant rides `logoOnDarkUrl`; every logo slot then gets
// a twin <img> right after it and CSS picks one by the ground. What this file
// pins down:
//
//   1. NO VARIANT, NO CHANGE. Without one the DOM is today's, node for node.
//   2. Same URL gate as the logo: a hostile value never reaches the DOM.
//   3. It arrives from the server (theme.logoOnDarkUrl, what vitrina-app sends)
//      even when the page pinned its own logoUrl inline (vitrina-template).
//   4. The stylesheet carries the ground rules (the cascade itself is checked
//      in a real browser; jsdom does not evaluate media queries in a shadow).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../src/config';
import { init } from '../src/index';
import { coerceRemoteConfig } from '../src/remote-config';
import { STYLES } from '../src/styles';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';
const LOGO = 'https://cdn.dealer.cl/logo.png';
const DARK = 'https://cdn.dealer.cl/logo-on-dark.png';

function jsonRes(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
  } as unknown as Response;
}

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
    return Promise.resolve(jsonRes(404, null));
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
function must<T extends Element = HTMLElement>(sel: string): T {
  const el = shadow().querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
}
function twins(): HTMLImageElement[] {
  return Array.from(shadow().querySelectorAll<HTMLImageElement>('.vtr-logo-ondark'));
}
async function settled(): Promise<void> {
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length).toBe(1),
  );
  await Promise.resolve();
  await Promise.resolve();
}

describe('logoOnDarkUrl', () => {
  it('changes nothing when no dark variant is configured', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, logoUrl: LOGO });
    await settled();
    const header = must('.vtr-header');
    expect(header.querySelectorAll('img')).toHaveLength(1);
    const logo = must<HTMLImageElement>('.vtr-header > .vtr-logo');
    expect(logo.hasAttribute('data-ondark')).toBe(false);
    expect(logo.nextElementSibling?.className).toBe('vtr-title');
    expect(twins()).toHaveLength(0);
    w.destroy();
  });

  it('puts the dark twin right after the header logo', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, logoUrl: LOGO, logoOnDarkUrl: DARK });
    await settled();
    const logo = must<HTMLImageElement>('.vtr-header > .vtr-logo');
    expect(logo.getAttribute('src')).toBe(LOGO);
    expect(logo.hasAttribute('data-ondark')).toBe(true);
    const twin = logo.nextElementSibling as HTMLImageElement;
    expect(twin.className).toBe('vtr-logo vtr-logo-ondark');
    expect(twin.getAttribute('src')).toBe(DARK);
    expect(twin.alt).toBe('');
    expect(twin.nextElementSibling?.className).toBe('vtr-title');
    w.destroy();
  });

  it('takes the server variant beside an inline logo (the template case)', async () => {
    configData = { theme: { logoUrl: LOGO, logoOnDarkUrl: DARK } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, theme: { logoUrl: LOGO } });
    await settled();
    await vi.waitFor(() => expect(twins()).toHaveLength(1));
    expect(twins()[0].getAttribute('src')).toBe(DARK);
    w.destroy();
  });

  it('gives the Home hero logo its own twin too', async () => {
    configData = { home: { enabled: true }, theme: { logoUrl: LOGO, logoOnDarkUrl: DARK } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    await vi.waitFor(() => expect(twins()).toHaveLength(2));
    const homeLogo = must<HTMLImageElement>('.vtr-home-top > .vtr-logo:not(.vtr-logo-ondark)');
    expect(homeLogo.hasAttribute('data-ondark')).toBe(true);
    expect(homeLogo.nextElementSibling?.classList.contains('vtr-logo-ondark')).toBe(true);
    w.destroy();
  });

  it('refuses a non-http(s) variant', async () => {
    const hostile = `${'java'}${'script'}:alert(1)`;
    const w = init({ publicKey: PK, apiBaseUrl: BASE, logoUrl: LOGO, logoOnDarkUrl: hostile });
    await settled();
    expect(twins()).toHaveLength(0);
    expect(must('.vtr-header > .vtr-logo').hasAttribute('data-ondark')).toBe(false);
    w.destroy();
  });

  it('removes the twin when the dealer clears the variant mid-session', async () => {
    globalThis.localStorage.setItem(
      `vtr:widget:${PK}:config`,
      JSON.stringify({ theme: { logoUrl: LOGO, logoOnDarkUrl: DARK } }),
    );
    configData = { theme: { logoUrl: LOGO } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    expect(twins()).toHaveLength(1);
    await settled();
    await vi.waitFor(() => expect(twins()).toHaveLength(0));
    expect(must('.vtr-header > .vtr-logo').hasAttribute('data-ondark')).toBe(false);
    w.destroy();
  });

  it('resolves like logoUrl: top-level beats theme, inline beats remote', () => {
    const base = { publicKey: PK, apiBaseUrl: BASE };
    const other = 'https://cdn.dealer.cl/other.png';
    expect(resolveConfig(base).theme).not.toHaveProperty('logoOnDarkUrl');
    expect(resolveConfig(base, { theme: { logoOnDarkUrl: DARK } }).theme.logoOnDarkUrl).toBe(DARK);
    expect(resolveConfig(base, { logoOnDarkUrl: DARK }).theme.logoOnDarkUrl).toBe(DARK);
    expect(
      resolveConfig({ ...base, theme: { logoOnDarkUrl: DARK } }, { logoOnDarkUrl: other }).theme
        .logoOnDarkUrl,
    ).toBe(DARK);
  });

  it('survives the wire coercion in both spellings', () => {
    expect(coerceRemoteConfig({ theme: { logoOnDarkUrl: DARK } })?.theme?.logoOnDarkUrl).toBe(DARK);
    expect(coerceRemoteConfig({ logoOnDarkUrl: DARK })?.logoOnDarkUrl).toBe(DARK);
    expect(coerceRemoteConfig({ logoOnDarkUrl: null })?.logoOnDarkUrl).toBeUndefined();
  });

  it('ships the ground rules in the stylesheet', () => {
    // Accent header: the twin shows, the plain logo hides.
    expect(STYLES).toContain(
      '.vtr-panel:not([data-tabs]) .vtr-header:not(.vtr-sb-head) > .vtr-logo[data-ondark]',
    );
    // Surface grounds flip only under a dark scheme, and never on the cream preset.
    expect(STYLES).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*\.vtr-root:not\(\[data-preset="cream"\]\) \.vtr-panel\[data-tabs\]/,
    );
  });
});
