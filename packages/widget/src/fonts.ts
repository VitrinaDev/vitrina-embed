// Web fonts — the ONE piece of the widget's appearance that cannot live inside
// the shadow root.
//
// WHY THE HOST DOCUMENT. A shadow root scopes selectors, and that is exactly
// what makes the widget safe on a stranger's site. But `@font-face` is not a
// selector: browsers only match font-face rules declared in the DOCUMENT's font
// source, so a face declared inside a shadow stylesheet is silently ignored and
// the text falls back. The face therefore has to be declared in the host page's
// <head> — a single <link> to the Google Fonts stylesheet — while the
// `font-family` that USES it stays inside the shadow styles where it belongs.
//
// WHAT THIS MAY NEVER DO. Break a dealer's page. The <link> is additive, carries
// no callback anything depends on, and is loaded ONLY when a non-system font is
// configured. If it 404s, is blocked by the dealer's CSP, or never arrives
// because the visitor is offline, the widget renders in the fallback stack and
// nothing else changes — `font-display: swap` (the css2 API's default) means the
// text is painted immediately either way, so there is no FOIT to work around.
//
// ONE NODE PER FAMILY, FOREVER. Injection is keyed on `data-vitrina-font` and is
// therefore idempotent across re-inits, across a destroy()/init() cycle, and
// across two widgets on the same page. Nothing here is removed on destroy: a
// stylesheet that has already loaded costs nothing to keep, and tearing it out
// would make the next init() re-download it.

import type { WidgetFont } from './types';

/** The stack the widget has always used, and the fallback under every web font. */
export const SYSTEM_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Enum value → the family name Google Fonts (and CSS) knows it by. The keys ARE
 * the contract with `GET /widget/config`; adding one here is all it takes to
 * offer another face.
 */
const FAMILY: Record<Exclude<WidgetFont, 'system'>, string> = {
  dmSans: 'DM Sans',
  ibmPlexSans: 'IBM Plex Sans',
  poppins: 'Poppins',
  nunitoSans: 'Nunito Sans',
  archivo: 'Archivo',
  montserrat: 'Montserrat',
  saira: 'Saira',
};

/** Weights the widget actually paints: body, chips/labels, and the code/CTA bold. */
const WEIGHTS = '400;500;700';

/** The attribute that makes injection idempotent. Value is the enum key. */
export const FONT_LINK_ATTR = 'data-vitrina-font';

/** Every accepted value, `system` first. Exported for the parity test. */
export const WIDGET_FONTS: readonly WidgetFont[] = Object.freeze([
  'system',
  ...(Object.keys(FAMILY) as Array<Exclude<WidgetFont, 'system'>>),
]);

/** Type guard over the closed enum — anything else is not a font we serve. */
export function isWidgetFont(input: unknown): input is WidgetFont {
  return typeof input === 'string' && (WIDGET_FONTS as readonly string[]).includes(input);
}

/**
 * Coerce whatever the server (or the dealer's page) said into a font we can
 * actually render. An unknown value is NOT an error: it means a newer server
 * offered a face this widget has never heard of, and the honest answer to that
 * is the system stack, not a broken panel.
 */
export function resolveFont(input: unknown): WidgetFont {
  return isWidgetFont(input) ? input : 'system';
}

/** The CSS family name, or null for `system` (which has no single family). */
export function fontFamilyName(font: WidgetFont): string | null {
  return font === 'system' ? null : (FAMILY[font] ?? null);
}

/**
 * The `font-family` value to put in the shadow styles: the chosen face followed
 * by the ENTIRE system stack. The fallback is the whole point — a stylesheet
 * that never loads leaves the widget looking exactly as it does today.
 */
export function fontStack(font: WidgetFont): string {
  const family = fontFamilyName(font);
  return family ? `'${family}', ${SYSTEM_FONT_STACK}` : SYSTEM_FONT_STACK;
}

/** The Google Fonts css2 stylesheet URL for `font`, or null for `system`. */
export function googleFontsHref(font: WidgetFont): string | null {
  const family = fontFamilyName(font);
  if (!family) return null;
  const name = family.replace(/ /g, '+');
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${WEIGHTS}&display=swap`;
}

/**
 * Declare `font` in the HOST document, once. Returns the <link> (existing or
 * newly appended), or null when there is nothing to load — `system`, no
 * document, or a DOM that refused us.
 *
 * Never throws: a host page with a locked-down <head> is a page whose widget
 * simply renders in the fallback stack.
 */
export function ensureFontLoaded(
  font: WidgetFont,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): HTMLLinkElement | null {
  const href = googleFontsHref(font);
  if (!href || !doc) return null;
  try {
    const head = doc.head;
    if (!head) return null;
    const existing = head.querySelector<HTMLLinkElement>(`link[${FONT_LINK_ATTR}="${font}"]`);
    if (existing) return existing;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(FONT_LINK_ATTR, font);
    head.appendChild(link);
    return link;
  } catch {
    return null;
  }
}
