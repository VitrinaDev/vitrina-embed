// Theme sanitizers. Every dynamic theme value the dealer supplies is validated
// here BEFORE it touches the DOM, so the otherwise-static inline stylesheet can
// never be broken out of via a CSS-injection or a javascript: URL.
//
//   accent   -> a CSS custom property value (--vtr-accent). sanitizeColor().
//   position -> a data-pos attribute ('br' | 'bl'). resolvePosition().
//   logoUrl  -> an <img src> loaded under the host page CSP. validateLogoUrl().

/** Default brand accent when none is supplied or the supplied value is rejected. */
export const DEFAULT_ACCENT = '#111827';

/** A conservative allow-list of named colors we accept verbatim. */
const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'orange', 'purple', 'teal',
  'navy', 'gray', 'grey', 'crimson', 'indigo', 'violet', 'coral', 'gold',
  'salmon', 'tomato', 'turquoise', 'magenta', 'cyan', 'maroon', 'olive',
  'lime', 'aqua', 'fuchsia', 'silver', 'pink', 'brown', 'transparent',
]);

// Any of these substrings means the value is trying to break out of the custom
// property (comment, selector close, extra declaration, url()/expression()).
const DANGEROUS = /[;{}<>()]|url|expression|javascript|\/\*|\*\/|@import/i;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// rgb/rgba/hsl/hsla with only digits, %, commas, dots, slash and spaces inside.
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%/ \t]+\)$/i;

/**
 * Sanitize a dealer-supplied accent color. Accepts #hex (3/4/6/8),
 * rgb()/rgba()/hsl()/hsla() with numeric args only, or a bounded set of named
 * colors. Returns `null` for anything containing dangerous CSS syntax so the
 * caller can fall back to the default — the value is inserted ONLY as a CSS
 * custom-property value, never a selector.
 */
export function sanitizeColor(input: string | undefined | null): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (value === '' || value.length > 64) return null;
  // Reject the function-body chars for hex/named first; function colors are
  // matched by their own strict pattern which permits '(' ')'.
  if (FUNC_COLOR.test(value)) return value;
  if (DANGEROUS.test(value)) return null;
  if (HEX.test(value)) return value;
  if (NAMED_COLORS.has(value.toLowerCase())) return value.toLowerCase();
  return null;
}

/** Resolve an accent to a safe CSS value, falling back to the default. */
export function resolveAccent(input: string | undefined | null): string {
  return sanitizeColor(input) ?? DEFAULT_ACCENT;
}

/**
 * Validate ANY URL that will reach the DOM: it must parse as absolute and use
 * http/https only. Returns the normalized href, or `null`.
 *
 * The single gate for every URL the widget renders — a logo `<img src>`, a
 * markdown link `<a href>`. `javascript:`, `data:`, `vbscript:`, and every
 * other scheme are rejected here, once, rather than in each call site.
 * Relative URLs do not parse and are rejected too; a reply must link absolutely.
 */
export function validateHttpUrl(input: string | undefined | null): string | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Validate a logo URL. Returns the normalized href, or `null` (omit the logo
 * entirely — no broken <img>, no javascript: URI). A strict dealer CSP may still
 * block the image at load time; that is acceptable degradation (the title/alt
 * text shows instead).
 */
export const validateLogoUrl = validateHttpUrl;

/** Corner placement -> the data-pos attribute value. Defaults to 'br'. */
export function resolvePosition(pos: 'br' | 'bl' | undefined): 'br' | 'bl' {
  return pos === 'bl' ? 'bl' : 'br';
}
