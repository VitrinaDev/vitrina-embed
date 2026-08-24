// The Home / Messages / Help tabs (0.8.0).
//
// The property this file exists to pin down is the one that makes the redesign
// safe to push to every dealer already running the widget:
//
//   A TENANT WHO CONFIGURED NOTHING GETS THE 0.7.0 PANEL, NODE FOR NODE.
//
// No `.vtr-views` wrapper, no `.vtr-tabs`, no `data-tabs`, no
// `data-active-view`, and an accent header — because none of that chrome is
// ever CONSTRUCTED, not because it is hidden. Everything else here is about the
// other half: when the tabs are on, they have to be worth the space. The Home
// cards are a presence matrix (recent conversation only with a transcript, the
// booking card only behind the tenant's own gate and under the tenant's own
// word for it), and a Help tab only exists when it has an answer to show.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_FAQS,
  MAX_TEAM,
  normalizeFaqs,
  normalizeTeam,
  resolveConfig,
} from '../src/config';
import { init } from '../src/index';
import { coerceRemoteConfig } from '../src/remote-config';
import { STYLES } from '../src/styles';
import { createWidgetUI, type WidgetUi } from '../src/ui';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_tabs';

const FAQS = [
  { q: '¿Cómo agendo una visita?', a: 'Desde el botón **Agendar visita**.' },
  { q: '¿Cuáles son los horarios?', a: 'Lunes a sábado, 9:30 a 19:00.' },
];

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

/** What GET /widget/config answers. Set per test, before init(). */
let configData: Record<string, unknown>;
/** What GET /widget/messages answers. Set per test, before the panel opens. */
let historyMessages: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  configData = {};
  historyMessages = [];
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, configData));
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(
        jsonRes(200, { messages: historyMessages, conversation: { externalId: 'web:a' } }),
      );
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
function openPanel(): void {
  must<HTMLButtonElement>('.vtr-launcher').click();
}
function activeView(): string | null {
  return panel().getAttribute('data-active-view');
}
function clickTab(view: 'home' | 'messages' | 'help'): void {
  must<HTMLButtonElement>(`.vtr-tab[data-tab="${view}"]`).click();
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

/** A remote config with the tabs on. */
function withTabs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { home: { enabled: true }, help: { enabled: true, faqs: FAQS }, ...extra };
}

// ---------------------------------------------------------------------------
// 1. Legacy non-regression — the tenant who configured nothing.
// ---------------------------------------------------------------------------

describe('legacy mode (no home, no help)', () => {
  it('constructs no tab chrome at all', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();

    expect(q('.vtr-tabs')).toBeNull();
    expect(q('.vtr-views')).toBeNull();
    expect(q('.vtr-view')).toBeNull();
    expect(q('.vtr-home-hero')).toBeNull();
    expect(q('.vtr-faq')).toBeNull();
    // Not even the attributes the CSS would key off.
    expect(panel().hasAttribute('data-tabs')).toBe(false);
    expect(panel().hasAttribute('data-active-view')).toBe(false);
    w.destroy();
  });

  it('keeps the conversation chrome as DIRECT children of the panel', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();

    const kinds = Array.from(panel().children).map((el) => el.className);
    expect(kinds).toEqual([
      'vtr-header',
      'vtr-messages',
      'vtr-typing',
      'vtr-banner',
      'vtr-composer',
      'vtr-footer',
    ]);
    w.destroy();
  });

  it('focuses the composer on open, as it always has', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    expect(shadow().activeElement).toBe(q('.vtr-input'));
    w.destroy();
  });

  it('is not turned on by home config that never says enabled', async () => {
    configData = { home: { title: 'Hola' }, help: { faqs: FAQS } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(q('.vtr-tabs')).toBeNull();
    w.destroy();
  });

  it('is not turned on by a Help flag with no usable questions', async () => {
    configData = { help: { enabled: true, faqs: [{ q: '   ', a: 'x' }] } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(q('.vtr-tabs')).toBeNull();
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. The router.
// ---------------------------------------------------------------------------

describe('view router', () => {
  it('wraps the conversation and mounts a tab bar when the server says so', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();

    expect(q('.vtr-tabs')).not.toBeNull();
    expect(panel().getAttribute('data-tabs')).toBe('1');
    // The conversation's own nodes moved INTO the messages view, intact.
    const messagesView = must('.vtr-view[data-view="messages"]');
    expect(messagesView.querySelector('.vtr-header')).not.toBeNull();
    expect(messagesView.querySelector('.vtr-messages')).not.toBeNull();
    expect(messagesView.querySelector('.vtr-composer')).not.toBeNull();
    expect(messagesView.querySelector('.vtr-footer')).not.toBeNull();
    // In order: home, messages, help.
    const order = all('.vtr-view').map((el) => (el as HTMLElement).dataset.view);
    expect(order).toEqual(['home', 'messages', 'help']);
    w.destroy();
  });

  it('labels the tabs in the resolved locale', async () => {
    configData = withTabs({ locale: 'en' });
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    const labels = all('.vtr-tab-label').map((el) => el.textContent);
    expect(labels).toEqual(['Home', 'Messages', 'Help']);
    w.destroy();
  });

  it('opens on Home and switches views on a tab click', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();

    expect(activeView()).toBe('home');
    expect(must('.vtr-tab[data-tab="home"]').getAttribute('aria-selected')).toBe('true');

    clickTab('messages');
    expect(activeView()).toBe('messages');
    expect(must('.vtr-tab[data-tab="messages"]').getAttribute('aria-selected')).toBe('true');
    expect(must('.vtr-tab[data-tab="home"]').getAttribute('aria-selected')).toBe('false');

    clickTab('help');
    expect(activeView()).toBe('help');
    w.destroy();
  });

  it('hides the tabs a tenant did not enable', async () => {
    configData = { help: { enabled: true, faqs: FAQS } };
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();

    expect(must<HTMLElement>('.vtr-tab[data-tab="home"]').hidden).toBe(true);
    expect(must<HTMLElement>('.vtr-tab[data-tab="help"]').hidden).toBe(false);
    // No Home to land on ⇒ the conversation, which always exists.
    expect(activeView()).toBe('messages');
    expect(q('.vtr-view[data-view="home"]')).toBeNull();
    w.destroy();
  });

  it('lands in Messages when replies were waiting, even after the read-marking', () => {
    const ui = mountUi({ home: { enabled: true, title: null, subtitle: null } });
    // Exactly the host's sequence: count the replies, mark read, then open.
    ui.setUnread(2);
    ui.setUnread(0);
    ui.openPanel();
    expect(ui.shadow.querySelector('.vtr-panel')?.getAttribute('data-active-view')).toBe(
      'messages',
    );
    // And the NEXT open, with nothing waiting, is back to Home.
    ui.closePanel();
    ui.openPanel();
    expect(ui.shadow.querySelector('.vtr-panel')?.getAttribute('data-active-view')).toBe('home');
    ui.destroy();
  });

  it('marks the Messages tab while the visitor is looking elsewhere', () => {
    const ui = mountUi({ home: { enabled: true, title: null, subtitle: null } });
    ui.openPanel();
    const dot = ui.shadow.querySelector<HTMLElement>('.vtr-tab-dot');
    if (!dot) throw new Error('missing .vtr-tab-dot');
    expect(dot.hidden).toBe(true);
    ui.setUnread(3);
    expect(dot.hidden).toBe(false);
    ui.setUnread(0);
    expect(dot.hidden).toBe(true);
    ui.destroy();
  });

  it('falls back to the conversation when a tab is switched off mid-session', () => {
    const ui = mountUi({ home: { enabled: true, title: null, subtitle: null } });
    ui.openPanel();
    expect(ui.shadow.querySelector('.vtr-panel')?.getAttribute('data-active-view')).toBe('home');
    ui.setHomeConfig({ enabled: false, title: null, subtitle: null });
    expect(ui.shadow.querySelector('.vtr-panel')?.getAttribute('data-active-view')).toBe(
      'messages',
    );
    expect(ui.shadow.querySelector('.vtr-panel')?.hasAttribute('data-tabs')).toBe(false);
    ui.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Home.
// ---------------------------------------------------------------------------

describe('home view', () => {
  it('greets with the built-in copy, in the resolved locale', async () => {
    configData = withTabs({ locale: 'en' });
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    await settled();
    expect(must('.vtr-home-title').textContent).toBe('Hi there 👋');
    expect(must('.vtr-home-sub').textContent).toBe('How can we help?');
    w.destroy();
  });

  it('uses the tenant greeting when they wrote one', async () => {
    configData = withTabs({
      home: { enabled: true, title: 'Bienvenido a Alport', subtitle: 'Estamos en línea' },
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(must('.vtr-home-title').textContent).toBe('Bienvenido a Alport');
    expect(must('.vtr-home-sub').textContent).toBe('Estamos en línea');
    w.destroy();
  });

  it('lets an inline greeting beat the server field-wise', async () => {
    configData = withTabs({ home: { enabled: true, title: 'Del servidor' } });
    const w = init({
      publicKey: PK,
      apiBaseUrl: BASE,
      locale: 'es',
      home: { title: 'De la página' },
    });
    await settled();
    // Inline title wins; the server's `enabled` still built the tab.
    expect(must('.vtr-home-title').textContent).toBe('De la página');
    expect(q('.vtr-tabs')).not.toBeNull();
    w.destroy();
  });

  it('draws at most three faces, images where there is a URL and initials where there is not', async () => {
    configData = withTabs({
      team: [
        { name: 'María Fernández', avatarUrl: 'https://cdn.dealer.cl/m.png' },
        { name: 'Pedro Soto', avatarUrl: null },
        { name: 'Josefa Ulloa' },
        { name: 'Cuarta Persona' },
      ],
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();

    const avatars = all('.vtr-avatar');
    expect(avatars).toHaveLength(3);
    expect(avatars[0].tagName).toBe('IMG');
    expect((avatars[0] as HTMLImageElement).alt).toBe('María Fernández');
    expect(avatars[1].textContent).toBe('PS');
    expect(avatars[2].textContent).toBe('JU');
    w.destroy();
  });

  it('gives a name the same initials colour on every render', async () => {
    configData = withTabs({ team: [{ name: 'Pedro Soto' }] });
    const first = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    const colorA = must<HTMLElement>('.vtr-avatar-initials').style.backgroundColor;
    expect(colorA).not.toBe('');
    first.destroy();
    document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());

    const second = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    const colorB = must<HTMLElement>('.vtr-avatar-initials').style.backgroundColor;
    expect(colorB).toBe(colorA);
    second.destroy();
  });

  it('never paints two touching circles the same colour', async () => {
    configData = withTabs({
      // Three names whose raw hashes collide two-and-two on an 8-colour palette.
      team: [{ name: 'María Fernández' }, { name: 'Pedro Soto' }, { name: 'Josefa Ulloa' }],
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    const colors = all('.vtr-avatar-initials').map((el) => (el as HTMLElement).style.backgroundColor);
    expect(colors).toHaveLength(3);
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[1]).not.toBe(colors[2]);
    w.destroy();
  });

  it('draws no stack for a tenant with no team', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(all('.vtr-avatar')).toHaveLength(0);
    expect(must<HTMLElement>('.vtr-avatars').hidden).toBe(true);
    w.destroy();
  });

  it('always offers the chat card, and nothing else without a transcript or an agenda', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    const kinds = all('.vtr-home-card').map((el) => (el as HTMLElement).dataset.card);
    expect(kinds).toEqual(['chat']);
    w.destroy();
  });

  it('adds the booking card only when the tenant takes bookings, in their words', async () => {
    configData = withTabs({ bookingEnabled: true, bookingLabel: 'Agendar demo' });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    const book = must('.vtr-home-card[data-card="book"]');
    expect(book.querySelector('.vtr-home-card-title')?.textContent).toBe('Agendar demo');
    expect(book.querySelector('.vtr-home-card-sub')?.textContent).toBe(
      'Elige día y hora en segundos',
    );
    w.destroy();
  });

  it('titles the booking card with the built-in copy when the tenant said nothing', async () => {
    configData = withTabs({ bookingEnabled: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    expect(
      must('.vtr-home-card[data-card="book"] .vtr-home-card-title').textContent,
    ).toBe('Agendar visita');
    w.destroy();
  });

  it('shows a recent-conversation card once there is a transcript, stripped of markdown', async () => {
    configData = withTabs();
    historyMessages = [
      {
        id: 1,
        createdAt: '2026-08-20T10:00:00.000Z',
        content: 'Hola',
        direction: 'inbound',
        type: 'text',
      },
      {
        id: 2,
        createdAt: '2026-08-20T10:01:00.000Z',
        content: 'Tenemos el **Corolla 2021** disponible',
        direction: 'outbound',
        type: 'text',
      },
    ];
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    await vi.waitFor(() => expect(q('.vtr-home-card[data-card="recent"]')).not.toBeNull());

    const card = must('.vtr-home-card[data-card="recent"]');
    expect(card.querySelector('.vtr-home-card-title')?.textContent).toBe('Conversación reciente');
    expect(card.querySelector('.vtr-home-card-preview')?.textContent).toBe(
      'Tenemos el Corolla 2021 disponible',
    );

    // And it is a door onto the conversation.
    must<HTMLButtonElement>('.vtr-home-card[data-card="recent"]').click();
    expect(activeView()).toBe('messages');
    w.destroy();
  });

  it('drops the visitor into the composer from the chat card', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    must<HTMLButtonElement>('.vtr-home-card[data-card="chat"]').click();
    expect(activeView()).toBe('messages');
    expect(shadow().activeElement).toBe(q('.vtr-input'));
    w.destroy();
  });

  it('opens the agenda from the booking card, by the same path as the chip', async () => {
    configData = withTabs({ bookingEnabled: true });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    must<HTMLButtonElement>('.vtr-home-card[data-card="book"]').click();
    expect(panel().getAttribute('data-booking')).toBe('1');
    expect(must<HTMLElement>('.vtr-booking').hidden).toBe(false);
    w.destroy();
  });

  it('keeps a close button on the Home view', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    const close = must<HTMLButtonElement>('.vtr-home-hero .vtr-close');
    expect(close.getAttribute('aria-label')).toBe('Cerrar');
    close.click();
    expect(panel().hidden).toBe(true);
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Help.
// ---------------------------------------------------------------------------

describe('help view', () => {
  it('renders one collapsed row per question', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    clickTab('help');

    const items = all('.vtr-faq-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.vtr-faq-qtext')?.textContent).toBe(
      '¿Cómo agendo una visita?',
    );
    expect((items[0].querySelector('.vtr-faq-a') as HTMLElement).hidden).toBe(true);
    w.destroy();
  });

  it('expands an answer, rendered through the markdown renderer', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    clickTab('help');

    const first = all('.vtr-faq-item')[0];
    const question = first.querySelector('.vtr-faq-q') as HTMLButtonElement;
    const answer = first.querySelector('.vtr-faq-a') as HTMLElement;

    question.click();
    expect(question.getAttribute('aria-expanded')).toBe('true');
    expect(answer.hidden).toBe(false);
    // Markdown became a NODE, never an HTML string.
    expect(answer.querySelector('strong')?.textContent).toBe('Agendar visita');

    question.click();
    expect(question.getAttribute('aria-expanded')).toBe('false');
    expect(answer.hidden).toBe(true);
    w.destroy();
  });

  it('lets several answers stand open at once', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    clickTab('help');
    all('.vtr-faq-q').forEach((el) => (el as HTMLButtonElement).click());
    expect(all('.vtr-faq-a').every((el) => !(el as HTMLElement).hidden)).toBe(true);
    w.destroy();
  });

  it('never parses an answer as HTML', async () => {
    configData = withTabs({
      help: {
        enabled: true,
        faqs: [{ q: 'XSS', a: '<img src=x onerror="alert(1)"> y <b>negrita</b>' }],
      },
    });
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    clickTab('help');
    must<HTMLButtonElement>('.vtr-faq-q').click();
    const answer = must('.vtr-faq-a');
    expect(answer.querySelector('img')).toBeNull();
    expect(answer.querySelector('b')).toBeNull();
    expect(answer.textContent).toContain('<img src=x onerror="alert(1)">');
    w.destroy();
  });

  it('offers one way out, into the composer', async () => {
    configData = withTabs();
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    await settled();
    openPanel();
    clickTab('help');
    const cta = must<HTMLButtonElement>('.vtr-help-cta');
    expect(cta.textContent).toBe('¿No encontraste lo que buscabas? Escríbenos');
    cta.click();
    expect(activeView()).toBe('messages');
    expect(shadow().activeElement).toBe(q('.vtr-input'));
    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Coercion + resolution.
// ---------------------------------------------------------------------------

describe('remote coercion', () => {
  it('drops nulls rather than letting them clobber anything', () => {
    const out = coerceRemoteConfig({ home: null, help: null, team: null });
    expect(out?.home).toBeUndefined();
    expect(out?.help).toBeUndefined();
    expect(out?.team).toBeUndefined();
  });

  it('keeps the usable FAQ entries and drops the rest, one by one', () => {
    expect(
      normalizeFaqs([
        { q: 'uno', a: 'respuesta' },
        { q: '', a: 'sin pregunta' },
        { q: 'sin respuesta', a: '   ' },
        'no soy un objeto',
        null,
        { q: 'dos', a: 'otra' },
      ]),
    ).toEqual([
      { q: 'uno', a: 'respuesta' },
      { q: 'dos', a: 'otra' },
    ]);
  });

  it('trims and caps', () => {
    expect(normalizeFaqs([{ q: '  espacios  ', a: '  y más  ' }])).toEqual([
      { q: 'espacios', a: 'y más' },
    ]);
    const many = Array.from({ length: 40 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    expect(normalizeFaqs(many)).toHaveLength(MAX_FAQS);
    expect(normalizeFaqs([{ q: 'x'.repeat(201), a: 'ok' }])).toEqual([]);
    expect(normalizeFaqs([{ q: 'ok', a: 'x'.repeat(2001) }])).toEqual([]);
  });

  it('validates every avatar URL and caps the roster', () => {
    expect(
      normalizeTeam([
        { name: 'Con foto', avatarUrl: 'https://cdn.dealer.cl/a.png' },
        { name: 'Sin foto', avatarUrl: 'javascript:alert(1)' },
        { name: 'Relativa', avatarUrl: '/a.png' },
        { name: '   ' },
        { name: 'x'.repeat(41) },
      ]),
    ).toEqual([
      { name: 'Con foto', avatarUrl: 'https://cdn.dealer.cl/a.png' },
      { name: 'Sin foto', avatarUrl: null },
      { name: 'Relativa', avatarUrl: null },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}` }));
    expect(normalizeTeam(many)).toHaveLength(MAX_TEAM);
  });

  it('round-trips the tabs through the last-known-good cache shape', () => {
    const out = coerceRemoteConfig({
      home: { enabled: true, title: '  Hola  ', subtitle: 'x'.repeat(200) },
      help: { enabled: true, faqs: [{ q: 'p', a: 'r' }] },
      team: [{ name: 'Ana' }],
    });
    expect(out?.home).toEqual({ enabled: true, title: 'Hola' });
    expect(out?.help).toEqual({ enabled: true, faqs: [{ q: 'p', a: 'r' }] });
    expect(out?.team).toEqual([{ name: 'Ana', avatarUrl: null }]);
  });
});

describe('resolveConfig', () => {
  const base = { publicKey: PK, apiBaseUrl: BASE };

  it('is off, and empty, for a config that says nothing', () => {
    const r = resolveConfig(base);
    expect(r.home).toEqual({ enabled: false, title: null, subtitle: null });
    expect(r.help).toEqual({ enabled: false, faqs: [] });
    expect(r.team).toEqual([]);
  });

  it('merges home field-wise, inline over remote', () => {
    const r = resolveConfig(
      { ...base, home: { title: 'Inline' } },
      { home: { enabled: true, title: 'Remote', subtitle: 'Remote sub' } },
    );
    expect(r.home).toEqual({ enabled: true, title: 'Inline', subtitle: 'Remote sub' });
  });

  it('re-derives help.enabled from the questions that survived', () => {
    expect(resolveConfig(base, { help: { enabled: true, faqs: [] } }).help.enabled).toBe(false);
    expect(
      resolveConfig(base, { help: { enabled: true, faqs: [{ q: 'a', a: 'b' }] } }).help.enabled,
    ).toBe(true);
  });

  it('replaces the roster wholesale rather than interleaving two teams', () => {
    const r = resolveConfig({ ...base, team: [{ name: 'Inline' }] }, { team: [{ name: 'Remote' }] });
    expect(r.team).toEqual([{ name: 'Inline', avatarUrl: null }]);
  });
});

// ---------------------------------------------------------------------------
// 6. The panel got bigger.
// ---------------------------------------------------------------------------

describe('panel dimensions', () => {
  it('is 400 wide and up to 704 tall, still clear of the viewport edges', () => {
    expect(STYLES).toContain('width: 400px; max-width: calc(100vw - 40px);');
    expect(STYLES).toContain('height: min(704px, calc(100dvh - 40px));');
  });

  it('is still fullscreen on a phone', () => {
    expect(STYLES).toContain('@media (max-width: 480px)');
    expect(STYLES).toContain('height: 100dvh;');
  });
});

// ---------------------------------------------------------------------------
// Helpers that need the UI layer on its own — the initial-view rule depends on
// the ORDER the host calls setUnread/openPanel in, which is not reachable
// through init() without an SSE round trip.
// ---------------------------------------------------------------------------

const mounted: WidgetUi[] = [];

function mountUi(opts: Partial<Parameters<typeof createWidgetUI>[0]> = {}): WidgetUi {
  const ui = createWidgetUI({
    t: (key) => String(key),
    locale: 'es',
    theme: { position: 'br' },
    welcomeMessage: null,
    callbacks: {
      onSend: () => {},
      onRequestOpen: () => {},
      onRequestClose: () => {},
      onRetry: () => {},
    },
    ...opts,
  });
  ui.mount();
  mounted.push(ui);
  return ui;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.destroy();
});
