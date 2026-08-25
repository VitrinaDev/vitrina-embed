// The three Home quick-action cards (0.9.0), and the public handle that opens
// their forms without one.
//
// The property this file exists to pin down is the one that makes the release
// safe to push to every dealer already running the widget:
//
//   A TENANT WITH NO CARDS GETS THE 0.8.x PANEL, NODE FOR NODE.
//
// No `.vtr-ha` overlay, no card, no `data-home-action` — because none of it is
// ever CONSTRUCTED, not because it is hidden. Everything else here is the other
// half: a card exists exactly when its gate says so, in both directions, and
// `openHomeAction()` behaves like `openBooking()` down to the deferred intent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../src/config';
import { init } from '../src/index';
import { coerceRemoteConfig } from '../src/remote-config';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_cards';

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

let configData: Record<string, unknown>;
/** Holds the appearance answer open, to exercise a click during a cold load. */
let configGate: Promise<void> | null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  configData = {};
  configGate = null;
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/widget/config')) {
      const res = jsonRes(200, configData);
      return configGate ? configGate.then(() => res) : Promise.resolve(res);
    }
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
});

function shadow(): ShadowRoot {
  const host = document.querySelector('[data-vitrina-widget]');
  if (!host?.shadowRoot) throw new Error('widget not mounted');
  return host.shadowRoot;
}
function q(sel: string): Element | null {
  return shadow().querySelector(sel);
}
function all(sel: string): Element[] {
  return Array.from(shadow().querySelectorAll(sel));
}
function must<T extends Element = HTMLElement>(sel: string): T {
  const el = q(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
}
function panel(): HTMLElement {
  return must<HTMLElement>('.vtr-panel');
}
function cards(): (string | undefined)[] {
  return all('.vtr-home-card').map((el) => (el as HTMLElement).dataset.card);
}

/** Wait until GET /widget/config has been answered and applied. */
async function settled(): Promise<void> {
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('/widget/config')).length,
    ).toBe(1),
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** A remote config with Home on and whichever cards the test wants. */
function withCards(cardFlags: Record<string, boolean>): Record<string, unknown> {
  return { home: { enabled: true, cards: cardFlags } };
}

// ---------------------------------------------------------------------------
// 1. Non-regression: nothing is built for a tenant with no cards.
// ---------------------------------------------------------------------------

describe('cards off', () => {
  it('constructs no quick-action DOM at all', async () => {
    configData = { home: { enabled: true } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    must<HTMLButtonElement>('.vtr-launcher').click();

    expect(cards()).toEqual(['chat']);
    // Not hidden — absent.
    expect(q('.vtr-ha')).toBeNull();
    expect(q('.vtr-ha-form')).toBeNull();
    expect(panel().hasAttribute('data-home-action')).toBe(false);
    w.destroy();
  });

  it('leaves the legacy panel untouched when Home itself is off', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(Array.from(panel().children).map((el) => el.className)).toEqual([
      'vtr-header',
      'vtr-messages',
      'vtr-typing',
      'vtr-banner',
      'vtr-composer',
      'vtr-footer',
    ]);
    w.destroy();
  });

  it('is not turned on by a cards bag that never says true', async () => {
    configData = withCards({ buy: false, sell: 'yes' as unknown as boolean });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(cards()).toEqual(['chat']);
    expect(q('.vtr-ha')).toBeNull();
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. The presence matrix.
// ---------------------------------------------------------------------------

describe('card matrix', () => {
  it('paints exactly the cards the tenant turned on', async () => {
    configData = withCards({ buy: true, search: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(cards()).toEqual(['chat', 'buy', 'search']);
    w.destroy();
  });

  it('paints all three, after the booking card, in the designed order', async () => {
    configData = { ...withCards({ buy: true, sell: true, search: true }), bookingEnabled: true };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(cards()).toEqual(['chat', 'book', 'buy', 'sell', 'search']);
    w.destroy();
  });

  it('carries the Chilean copy on each card', async () => {
    configData = withCards({ buy: true, sell: true, search: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    const copy = (kind: string): string[] => [
      must(`.vtr-home-card[data-card="${kind}"] .vtr-home-card-title`).textContent ?? '',
      must(`.vtr-home-card[data-card="${kind}"] .vtr-home-card-sub`).textContent ?? '',
    ];
    expect(copy('buy')).toEqual(['Comprar un auto', 'Cuéntanos qué estás buscando']);
    expect(copy('sell')).toEqual(['Vender tu auto', 'Te ayudamos a venderlo']);
    expect(copy('search')).toEqual([
      '¿No encuentras el auto que buscas?',
      '¡Lo buscamos por ti!',
    ]);
    w.destroy();
  });

  it('follows the locale the server resolved', async () => {
    configData = { ...withCards({ sell: true }), locale: 'en' };
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    expect(must('.vtr-home-card[data-card="sell"] .vtr-home-card-title').textContent).toBe(
      'Sell your car',
    );
    w.destroy();
  });

  it('takes a card away if the dealer switches it off mid-session', async () => {
    globalThis.localStorage.setItem(
      `vtr:widget:${PK}:config`,
      JSON.stringify({ home: { enabled: true, cards: { sell: true } } }),
    );
    configData = { home: { enabled: true } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    // The cached config painted the card on the first frame…
    expect(q('.vtr-home-card[data-card="sell"]')).not.toBeNull();
    // …and the live answer takes it back rather than leaving a form that 404s.
    await vi.waitFor(() => expect(q('.vtr-home-card[data-card="sell"]')).toBeNull());
    expect(must<HTMLElement>('.vtr-ha').hidden).toBe(true);
    w.destroy();
  });

  it('opens the form from a card, by the same path as the public handle', async () => {
    configData = withCards({ buy: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    must<HTMLButtonElement>('.vtr-launcher').click();

    must<HTMLButtonElement>('.vtr-home-card[data-card="buy"]').click();
    expect(panel().getAttribute('data-home-action')).toBe('buy');
    expect(must<HTMLElement>('.vtr-ha').hidden).toBe(false);
    expect(must('.vtr-ha-title').textContent).toBe('Comprar un auto');
    // The transcript is COVERED, never destroyed.
    expect(q('.vtr-messages')).not.toBeNull();

    must<HTMLButtonElement>('.vtr-ha-close').click();
    expect(must<HTMLElement>('.vtr-ha').hidden).toBe(true);
    expect(panel().hasAttribute('data-home-action')).toBe(false);
    w.destroy();
  });

  it('hides the composer, the chips and the tab bar while a form is up', () => {
    // The CSS is the mechanism; assert the rule exists rather than a computed
    // style happy-dom does not resolve for a shadow root.
    return import('../src/styles').then(({ STYLES }) => {
      expect(STYLES).toContain('.vtr-panel[data-home-action] .vtr-composer');
      expect(STYLES).toContain('.vtr-panel[data-home-action] .vtr-actions');
      expect(STYLES).toContain('.vtr-panel[data-home-action] .vtr-tabs');
    });
  });
});

// ---------------------------------------------------------------------------
// 3. The honeypot rides on every flow.
// ---------------------------------------------------------------------------

describe('honeypot', () => {
  it('is in the overlay for all three flows, off-screen and out of reach', async () => {
    configData = withCards({ buy: true, sell: true, search: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    must<HTMLButtonElement>('.vtr-launcher').click();

    for (const kind of ['buy', 'sell', 'search']) {
      must<HTMLButtonElement>(`.vtr-home-card[data-card="${kind}"]`).click();
      const hp = must<HTMLInputElement>('.vtr-ha .vtr-hp');
      expect(hp.name).toBe('hp_website');
      expect(hp.tabIndex).toBe(-1);
      expect(hp.getAttribute('aria-hidden')).toBe('true');
      must<HTMLButtonElement>('.vtr-ha-close').click();
    }
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. openHomeAction() — the storefront template's own buttons.
// ---------------------------------------------------------------------------

describe('openHomeAction() on the public handle', () => {
  it('opens the form directly, without the visitor finding the card', async () => {
    configData = withCards({ sell: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();

    expect(w.openHomeAction('sell')).toBe(true);
    // The panel came with it — the form is laid OVER a conversation.
    expect(panel().hidden).toBe(false);
    expect(panel().getAttribute('data-home-action')).toBe('sell');
    expect(must('.vtr-ha-title').textContent).toBe('Tu auto');
    expect(must('.vtr-ha-step').textContent).toBe('Paso 1 de 4');
    w.destroy();
  });

  it('falls back to the panel and finishes the job when the gate answers late', async () => {
    let openGate = (): void => {};
    configGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    configData = withCards({ buy: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });

    // The click lands before the server has said whether this tenant offers the
    // form at all, so the honest answer is "not yet".
    expect(w.openHomeAction('buy')).toBe(false);
    expect(q('.vtr-ha')).toBeNull();
    expect(panel().hidden).toBe(false);

    openGate();
    // …and the ask is honoured rather than dropped.
    await vi.waitFor(() => expect(panel().getAttribute('data-home-action')).toBe('buy'));
    expect(must<HTMLElement>('.vtr-ha').hidden).toBe(false);
    w.destroy();
  });

  it('withdraws a deferred open when the visitor closes the panel first', async () => {
    let openGate = (): void => {};
    configGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    configData = withCards({ search: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    expect(w.openHomeAction('search')).toBe(false);
    w.close();
    openGate();

    // The card mounts, because the tenant does offer it…
    await vi.waitFor(() => expect(q('.vtr-home-card[data-card="search"]')).not.toBeNull());
    // …but nothing opens itself over a visitor who walked away.
    expect(panel().hasAttribute('data-home-action')).toBe(false);
    expect((q('.vtr-ha') as HTMLElement | null)?.hidden ?? true).toBe(true);
    w.destroy();
  });

  it('gives a card-off tenant the conversation, and constructs no overlay', async () => {
    configData = { home: { enabled: true } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(w.openHomeAction('sell')).toBe(false);
    expect(panel().hidden).toBe(false);
    expect(q('.vtr-ha')).toBeNull();
    w.destroy();
  });

  it('opens nothing at all for a kind it cannot understand', async () => {
    configData = withCards({ buy: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(w.openHomeAction('trade-in' as never)).toBe(false);
    expect(panel().hidden).toBe(true);
    w.destroy();
  });

  it('works without the Home tab: the gate is the card, not the tab', async () => {
    // A storefront hero button is a real use even for a tenant whose panel opens
    // straight into the conversation.
    configData = { home: { cards: { sell: true } } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(q('.vtr-tabs')).toBeNull();
    expect(w.openHomeAction('sell')).toBe(true);
    expect(panel().getAttribute('data-home-action')).toBe('sell');
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Coercion + resolution.
// ---------------------------------------------------------------------------

describe('cards coercion', () => {
  it('keeps only the cards a server said true, and drops an empty bag', () => {
    expect(
      coerceRemoteConfig({ home: { enabled: true, cards: { buy: true, sell: 'true', search: 0 } } })
        ?.home,
    ).toEqual({ enabled: true, cards: { buy: true } });
    expect(coerceRemoteConfig({ home: { enabled: true, cards: {} } })?.home).toEqual({
      enabled: true,
    });
    expect(coerceRemoteConfig({ home: { cards: null } })?.home).toBeUndefined();
  });

  it('resolves to the 0.8.x shape when no card is on', () => {
    const base = { publicKey: PK, apiBaseUrl: BASE };
    expect(resolveConfig(base).home).toEqual({ enabled: false, title: null, subtitle: null });
    expect(resolveConfig(base, { home: { enabled: true, cards: {} } }).home.cards).toBeUndefined();
  });

  it('merges the cards bag field-wise rather than replacing it wholesale', () => {
    const r = resolveConfig(
      { publicKey: PK, apiBaseUrl: BASE, home: { cards: { sell: true } } },
      { home: { enabled: true, cards: { buy: true } } },
    );
    // A page that pins one card must not blank the one the server turned on.
    expect(r.home.cards).toEqual({ buy: true, sell: true, search: false });
  });
});
