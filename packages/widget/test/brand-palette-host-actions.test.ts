// Brand palette, heading face, corner style and host Home actions (0.27.0).
//
// Two properties matter most, and both are pinned here against a real init():
//
//   1. A HOST THAT SAYS NOTHING NEW GETS TODAY'S WIDGET, NODE FOR NODE — the
//      same stylesheet text, the same attributes, the same inline properties.
//   2. Every host value passes a sanitizer: a colour that is not a colour, an
//      id that is not a slug, an href that is not http(s) never reaches the DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_HOST_ACTIONS, resolveConfig, resolveHostActions } from '../src/config';
import { FONT_LINK_ATTR, googleFontsHref } from '../src/fonts';
import { init } from '../src/index';
import { BRAND_STYLES, STYLES } from '../src/styles';
import { contrastRatio, parseColor, readableOn, resolvePalette } from '../src/theme';
import type { WidgetConfig, WidgetPalette } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_brand';

const AUVA: WidgetPalette = {
  surface: '#1B2341',
  surfaceAlt: '#242E52',
  text: '#EFE6D7',
  muted: '#CCBFAE',
  accent: '#C79D87',
  accentText: '#1B2341',
  launcher: '#1B2341',
  launcherIcon: '#EFE6D7',
};

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }));
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(jsonRes(200, { messages: [], conversation: null }));
    }
    return Promise.resolve(jsonRes(200, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
  document.head.querySelectorAll(`link[${FONT_LINK_ATTR}]`).forEach((n) => n.remove());
});

function shadow(): ShadowRoot {
  const hosts = document.querySelectorAll('[data-vitrina-widget]');
  const host = hosts[hosts.length - 1];
  if (!host?.shadowRoot) throw new Error('widget not mounted');
  return host.shadowRoot;
}
function must<T extends Element = HTMLElement>(sel: string): T {
  const el = shadow().querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
}
function root(): HTMLElement {
  return must('.vtr-root');
}
function styles(): string[] {
  return Array.from(shadow().querySelectorAll('style')).map((s) => s.textContent ?? '');
}
function cards(): Array<{ card: string | undefined; id: string | undefined; tag: string }> {
  return Array.from(shadow().querySelectorAll<HTMLElement>('.vtr-home-card')).map((el) => ({
    card: el.dataset.card,
    id: el.dataset.actionId,
    tag: el.tagName.toLowerCase(),
  }));
}

/** A self-contained widget: no server answer involved. */
function start(extra: Partial<WidgetConfig> = {}): ReturnType<typeof init> {
  return init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es', remoteConfig: false, ...extra });
}

/** Tag, attributes (sorted) and text of every node under the shadow root. */
function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return JSON.stringify(node.textContent);
  if (!(node instanceof Element)) {
    return Array.from(node.childNodes).map(serialize).join('');
  }
  const attrs = Array.from(node.attributes)
    .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
    .sort()
    .join(' ');
  return `<${node.tagName.toLowerCase()} ${attrs}>${Array.from(node.childNodes).map(serialize).join('')}</>`;
}

// ---------------------------------------------------------------------------
// 1. Nothing new configured ⇒ today's widget.
// ---------------------------------------------------------------------------

describe('without the new fields', () => {
  it('carries only the stylesheet it always had and no brand attribute or property', () => {
    const w = start({ home: { enabled: true }, help: { enabled: true, faqs: [{ q: 'a', a: 'b' }] } });
    must<HTMLButtonElement>('.vtr-launcher').click();
    expect(styles()).toEqual([STYLES]);
    for (const attr of ['data-palette', 'data-accent-tone', 'data-radius', 'data-heading-font']) {
      expect(root().hasAttribute(attr), attr).toBe(false);
    }
    expect(root().getAttribute('style')).toBe('--vtr-accent: #111827;');
    w.destroy();
  });

  it('is byte-identical to a widget given new fields with nothing usable in them', () => {
    const base: Partial<WidgetConfig> = {
      theme: { accent: '#0055ff' },
      home: { enabled: true, title: 'Hola' },
    };
    const a = start(base);
    must<HTMLButtonElement>('.vtr-launcher').click();
    const plain = serialize(shadow());
    a.destroy();

    const b = start({
      theme: {
        accent: '#0055ff',
        palette: { surface: 'red; color: blue', accent: 'url(x)', text: '' },
        radius: 'default',
      },
      home: {
        enabled: true,
        title: 'Hola',
        actions: [{ id: 'bad id!', title: 'x' }, { id: 'ok', title: '   ' }],
      },
    });
    must<HTMLButtonElement>('.vtr-launcher').click();
    expect(serialize(shadow())).toBe(plain);
    b.destroy();
  });

  it('resolves a config without them to the same object, plus a null heading face', () => {
    const resolved = resolveConfig({ publicKey: PK, apiBaseUrl: BASE, home: { enabled: true } });
    expect(resolved.home).toEqual({ enabled: true, title: null, subtitle: null });
    expect(resolved.headingFont).toBeNull();
    expect(resolved.theme).toEqual({ position: 'br' });
  });
});

// ---------------------------------------------------------------------------
// 2. Palette.
// ---------------------------------------------------------------------------

describe('palette', () => {
  it('pins every given colour on the root and adds the brand sheet last', () => {
    const w = start({ theme: { palette: AUVA } });
    const s = root().style;
    expect(s.getPropertyValue('--vtr-surface')).toBe('#1B2341');
    expect(s.getPropertyValue('--vtr-bubble-out')).toBe('#242E52');
    expect(s.getPropertyValue('--vtr-text')).toBe('#EFE6D7');
    expect(s.getPropertyValue('--vtr-muted')).toBe('#CCBFAE');
    expect(s.getPropertyValue('--vtr-accent')).toBe('#C79D87');
    expect(s.getPropertyValue('--vtr-on-accent')).toBe('#1B2341');
    expect(s.getPropertyValue('--vtr-launcher')).toBe('#1B2341');
    expect(s.getPropertyValue('--vtr-launcher-icon')).toBe('#EFE6D7');
    // The visitor's bubble follows the accent, and so does its ink.
    expect(s.getPropertyValue('--vtr-bubble-in')).toBe('#C79D87');
    expect(s.getPropertyValue('--vtr-bubble-in-text')).toBe('#1B2341');
    expect(root().getAttribute('data-palette')).toBe('dark');
    expect(root().getAttribute('data-accent-tone')).toBe('light');
    expect(styles()).toEqual([STYLES, BRAND_STYLES]);
    w.destroy();
  });

  it('beats theme.accent with palette.accent, and falls back to it otherwise', () => {
    const a = start({ theme: { accent: '#0055ff', palette: { accent: '#C79D87' } } });
    expect(root().style.getPropertyValue('--vtr-accent')).toBe('#C79D87');
    a.destroy();
    const b = start({ theme: { accent: '#0055ff', palette: { surface: '#ffffff' } } });
    expect(root().style.getPropertyValue('--vtr-accent')).toBe('#0055ff');
    b.destroy();
  });

  it('drops a bad colour on its own and falls back for that token only', () => {
    const w = start({
      theme: {
        palette: {
          surface: '#fff; } .x { color: red',
          text: '#1B2341',
          accent: 'javascript:alert(1)',
          border: 'url(https://evil.example/x.png)',
          launcher: 'expression(alert(1))',
        },
      },
    });
    const s = root().style;
    expect(s.getPropertyValue('--vtr-surface')).toBe('#ffffff');
    expect(s.getPropertyValue('--vtr-text')).toBe('#1B2341');
    expect(s.getPropertyValue('--vtr-accent')).toBe('#111827');
    expect(s.getPropertyValue('--vtr-border')).toBe('color-mix(in srgb, #1B2341 16%, #ffffff)');
    expect(s.getPropertyValue('--vtr-launcher')).toBe('#111827');
    const all = root().getAttribute('style') ?? '';
    expect(all).not.toMatch(/javascript|url\(|expression|\}/);
    w.destroy();
  });

  it('is no palette at all when nothing in it is usable', () => {
    const w = start({ theme: { palette: { surface: 'nope', text: 42 as unknown as string } } });
    expect(root().hasAttribute('data-palette')).toBe(false);
    expect(root().style.getPropertyValue('--vtr-surface')).toBe('');
    expect(styles()).toEqual([STYLES]);
    w.destroy();
  });

  it('derives readable text for a surface given without it, and ink for an accent', () => {
    const dark = resolvePalette({ surface: '#1B2341' });
    expect(dark?.vars['--vtr-text']).toBe('#ffffff');
    expect(dark?.tone).toBe('dark');
    const light = resolvePalette({ surface: '#FDF6EC', accent: '#F5D0A9' });
    expect(light?.vars['--vtr-text']).toBe('#111827');
    expect(light?.vars['--vtr-on-accent']).toBe('#111827');
    expect(light?.tone).toBe('light');
    const deep = resolvePalette({ accent: 'navy' });
    expect(deep?.vars['--vtr-on-accent']).toBe('#ffffff');
    // A launcher colour without an icon colour gets readable ink too.
    expect(resolvePalette({ launcher: '#F5D0A9' })?.vars['--vtr-launcher-icon']).toBe('#111827');
    // An agent bubble without its text colour reads too.
    expect(resolvePalette({ bubbleOut: '#111111' })?.vars['--vtr-msg-out-text']).toBe('#ffffff');
  });

  it('keeps the derived text at a readable contrast for any surface', () => {
    for (const surface of ['#000000', '#1B2341', '#C79D87', '#EFE6D7', '#ffffff', 'rgb(20, 120, 90)', 'hsl(210, 60%, 30%)']) {
      const text = resolvePalette({ surface })?.vars['--vtr-text'] as string;
      expect(contrastRatio(surface, text), surface).toBeGreaterThanOrEqual(4.5);
    }
    // A mid grey cannot reach 4.5 with either ink; it still gets the better one.
    const mid = resolvePalette({ surface: '#777777' })?.vars['--vtr-text'] as string;
    const other = mid === '#ffffff' ? '#111827' : '#ffffff';
    expect(contrastRatio('#777777', mid)).toBeGreaterThan(contrastRatio('#777777', other) as number);
  });

  it('reads hex, rgb(), hsl() and the named colours the sanitizer accepts', () => {
    expect(parseColor('#1B2341')).toEqual([27, 35, 65]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0]);
    expect(parseColor('navy')).toEqual([0, 0, 128]);
    expect(parseColor('transparent')).toBeNull();
    expect(readableOn('transparent')).toBe('#ffffff');
  });

  it('pins the surfaces under a dark colour scheme instead of flipping', async () => {
    // Every token the :host dark block redefines is set INLINE on .vtr-root,
    // which every painted node inherits from — the media query cannot reach
    // past it. Checked for a light palette, the case a flip would break.
    const darkBlock = STYLES.match(/@media \(prefers-color-scheme: dark\) \{\s*:host \{([^}]*)\}/)?.[1] ?? '';
    const flipped = Array.from(darkBlock.matchAll(/(--vtr-[a-z-]+):/g)).map((m) => m[1]);
    expect(flipped.length).toBeGreaterThan(5);
    const w = start({ theme: { palette: { surface: '#FDF6EC', accent: '#AD4E00' } } });
    for (const prop of flipped) {
      expect(root().style.getPropertyValue(prop), prop).not.toBe('');
    }
    expect(root().getAttribute('data-palette')).toBe('light');
    // And the dark-only colour tweaks are undone under a palette.
    expect(BRAND_STYLES).toContain('.vtr-root[data-palette] .vtr-tab[aria-selected="true"]');
    expect(BRAND_STYLES).toContain('.vtr-root[data-palette] .vtr-card-btn-alt');
    expect(BRAND_STYLES).toContain('.vtr-root[data-palette="light"] { color-scheme: light; }');

    // The real cascade under a dark scheme: the default widget flips to its
    // navy, the palette widget stays cream with its own ink.
    const device = (window as unknown as { happyDOM: { settings: { device: { prefersColorScheme: string } } } })
      .happyDOM.settings.device;
    device.prefersColorScheme = 'dark';
    try {
      must<HTMLButtonElement>('.vtr-launcher').click();
      expect(getComputedStyle(must('.vtr-panel')).backgroundColor).toBe('#FDF6EC');
      expect(getComputedStyle(must('.vtr-panel')).color).toBe('#111827');
      w.destroy();
      const plain = start();
      must<HTMLButtonElement>('.vtr-launcher').click();
      expect(getComputedStyle(must('.vtr-panel')).backgroundColor).toBe('#1f2937');
      plain.destroy();
    } finally {
      device.prefersColorScheme = 'light';
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Fonts.
// ---------------------------------------------------------------------------

describe('fonts', () => {
  it('loads jost and playfairDisplay like the other faces', () => {
    expect(googleFontsHref('jost')).toBe(
      'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;700&display=swap',
    );
    expect(googleFontsHref('playfairDisplay')).toBe(
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&display=swap',
    );
    const w = start({ font: 'jost' });
    expect(document.head.querySelector(`link[${FONT_LINK_ATTR}="jost"]`)).not.toBeNull();
    expect(root().style.getPropertyValue('--vtr-font')).toContain("'Jost'");
    w.destroy();
  });

  it('applies headingFont to the titles only, and loads it', () => {
    const w = start({
      font: 'jost',
      headingFont: 'playfairDisplay',
      home: { enabled: true, title: 'Hola', subtitle: 'Sub' },
    });
    must<HTMLButtonElement>('.vtr-launcher').click();
    expect(document.head.querySelector(`link[${FONT_LINK_ATTR}="playfairDisplay"]`)).not.toBeNull();
    expect(root().getAttribute('data-heading-font')).toBe('playfairDisplay');
    expect(root().style.getPropertyValue('--vtr-heading-font')).toContain("'Playfair Display'");
    // The body keeps its own face.
    expect(root().style.getPropertyValue('--vtr-font')).toContain("'Jost'");

    // The rule that uses it names titles and nothing else.
    const rule = BRAND_STYLES.replace(/\/\*[\s\S]*?\*\//g, '').match(/([^}]*)\{ font-family: var\(--vtr-heading-font\)/)?.[1] ?? '';
    const selectors = rule.split(',').map((x) => x.trim().replace(/^.*\[data-heading-font\]\s+/, ''));
    expect(selectors.sort()).toEqual(
      ['.vtr-bk-title', '.vtr-ha-title', '.vtr-home-title', '.vtr-sb-name', '.vtr-title'].sort(),
    );
    expect(BRAND_STYLES.match(/var\(--vtr-heading-font\)/g)).toHaveLength(1);

    // The computed cascade: the greeting in Playfair, everything else in Jost.
    expect(getComputedStyle(must('.vtr-home-title')).fontFamily).toMatch(/^"?Playfair Display/);
    for (const sel of ['.vtr-home-sub', '.vtr-panel', '.vtr-messages']) {
      expect(getComputedStyle(must(sel)).fontFamily, sel).toMatch(/^"?Jost/);
    }
    w.destroy();
  });

  it('leaves titles alone without headingFont, and system is a real choice', () => {
    const a = start({ font: 'jost' });
    expect(root().hasAttribute('data-heading-font')).toBe(false);
    a.destroy();
    const b = start({ font: 'jost', headingFont: 'system' });
    expect(root().style.getPropertyValue('--vtr-heading-font')).not.toContain('Jost');
    b.destroy();
    const c = start({ headingFont: 'comicSans' as unknown as 'system' });
    expect(root().getAttribute('data-heading-font')).toBe('system');
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Corner style.
// ---------------------------------------------------------------------------

describe('radius', () => {
  it('sets data-radius for soft and pill only', () => {
    const a = start({ theme: { radius: 'pill' } });
    expect(root().getAttribute('data-radius')).toBe('pill');
    expect(styles()).toEqual([STYLES, BRAND_STYLES]);
    a.destroy();
    const b = start({ theme: { radius: 'square' as unknown as 'pill' } });
    expect(root().hasAttribute('data-radius')).toBe(false);
    b.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Host Home actions.
// ---------------------------------------------------------------------------

describe('home.actions', () => {
  const RESERVE = { id: 'reserve', title: 'Reservar mi evaluación', subtitle: 'Elige tu hora', icon: 'calendar' as const };
  const WA = {
    id: 'whatsapp',
    title: 'Seguir por WhatsApp',
    subtitle: 'Te respondemos por ahí',
    icon: 'whatsapp' as const,
    href: 'https://wa.me/56948818595',
  };

  it('renders above the built-in cards, in order, and Home works with just them + chat', () => {
    const w = start({ home: { enabled: true, actions: [RESERVE, WA] } });
    must<HTMLButtonElement>('.vtr-launcher').click();
    expect(cards()).toEqual([
      { card: 'host', id: 'reserve', tag: 'button' },
      { card: 'host', id: 'whatsapp', tag: 'a' },
      { card: 'chat', id: undefined, tag: 'button' },
    ]);
    const first = must('.vtr-home-card[data-action-id="reserve"]');
    expect(first.querySelector('.vtr-home-card-title')?.textContent).toBe('Reservar mi evaluación');
    expect(first.querySelector('.vtr-home-card-sub')?.textContent).toBe('Elige tu hora');
    expect(first.querySelector('.vtr-home-card-icon svg')).not.toBeNull();
    w.destroy();
  });

  it('caps at four, trims, and drops bad ids, repeats and unusable titles', () => {
    const resolved = resolveHostActions([
      { id: '  a1  ', title: '  Uno  ', subtitle: '   ' },
      { id: 'a1', title: 'Repeat' },
      { id: '<img>', title: 'Bad id' },
      { id: 'x'.repeat(41), title: 'Too long id' },
      { id: 'long', title: 'T'.repeat(61) },
      null,
      'nope',
      { id: 'a2', title: 'Dos', icon: 'skull', href: 'javascript:alert(1)' },
      { id: 'a3', title: 'Tres', href: 'data:text/html,hi' },
      { id: 'a4', title: 'Cuatro', closeOnTap: false },
      { id: 'a5', title: 'Cinco' },
    ]);
    expect(resolved.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(resolved).toHaveLength(MAX_HOST_ACTIONS);
    expect(resolved[0]).toEqual({
      id: 'a1',
      title: 'Uno',
      subtitle: null,
      icon: null,
      href: null,
      closeOnTap: true,
    });
    expect(resolved[1].icon).toBeNull();
    expect(resolved[1].href).toBeNull();
    expect(resolved[2].href).toBeNull();
    expect(resolved[3].closeOnTap).toBe(false);
    expect(resolveHostActions('nope')).toEqual([]);
  });

  it('paints a host title as text, never markup', () => {
    const w = start({ home: { enabled: true, actions: [{ id: 'x', title: '<img src=x onerror=alert(1)>' }] } });
    must<HTMLButtonElement>('.vtr-launcher').click();
    const card = must('.vtr-home-card[data-action-id="x"]');
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.vtr-home-card-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    w.destroy();
  });

  it('emits action { id } and closes the panel by default', () => {
    const w = start({ home: { enabled: true, actions: [RESERVE] } });
    const seen: unknown[] = [];
    const closes: unknown[] = [];
    w.on('action', (p) => seen.push(p));
    w.on('close', (p) => closes.push(p));
    must<HTMLButtonElement>('.vtr-launcher').click();
    must<HTMLButtonElement>('.vtr-home-card[data-action-id="reserve"]').click();
    expect(seen).toEqual([{ id: 'reserve' }]);
    expect(must('.vtr-panel').hidden).toBe(true);
    expect(closes).toEqual([{ source: 'visitor' }]);
    w.destroy();
  });

  it('keeps the panel open with closeOnTap: false', () => {
    const w = start({ home: { enabled: true, actions: [{ ...RESERVE, closeOnTap: false }] } });
    const seen: unknown[] = [];
    w.on('action', (p) => seen.push(p));
    must<HTMLButtonElement>('.vtr-launcher').click();
    must<HTMLButtonElement>('.vtr-home-card[data-action-id="reserve"]').click();
    expect(seen).toEqual([{ id: 'reserve' }]);
    expect(must('.vtr-panel').hidden).toBe(false);
    w.destroy();
  });

  it('renders an href as a safe plain anchor that emits and leaves the panel open', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const w = start({ home: { enabled: true, actions: [WA] } });
    const seen: unknown[] = [];
    w.on('action', (p) => seen.push(p));
    must<HTMLButtonElement>('.vtr-launcher').click();
    const a = must<HTMLAnchorElement>('a.vtr-home-card[data-action-id="whatsapp"]');
    expect(a.getAttribute('href')).toBe('https://wa.me/56948818595');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('onclick')).toBeNull();
    // Keep the test DOM from navigating; the widget's own listener still runs.
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    expect(seen).toEqual([{ id: 'whatsapp' }]);
    expect(must('.vtr-panel').hidden).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    w.destroy();
  });

  it('turns an unsafe href into a plain card rather than a link', () => {
    const w = start({ home: { enabled: true, actions: [{ id: 'x', title: 'X', href: 'javascript:alert(1)' }] } });
    must<HTMLButtonElement>('.vtr-launcher').click();
    expect(cards()[0]).toEqual({ card: 'host', id: 'x', tag: 'button' });
    expect(shadow().querySelector('a.vtr-home-card')).toBeNull();
    w.destroy();
  });

  it('cannot be reached through a server answer (inline only)', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        jsonRes(200, String(url).includes('/widget/config') ? { home: { enabled: true, actions: [RESERVE] } } : {}),
      ),
    );
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    must<HTMLButtonElement>('.vtr-launcher').click();
    await vi.waitFor(() => expect(cards().map((c) => c.card)).toEqual(['chat']));
    w.destroy();
  });
});
