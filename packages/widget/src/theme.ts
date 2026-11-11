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

// --- Brand palette (0.27.0) -------------------------------------------------
//
// A host that brings its own design system passes `theme.palette`. Every entry
// goes through sanitizeColor() above; an unusable one is treated as absent.
// When at least one entry survives, the palette PINS every surface token in
// both colour schemes: the tokens a host left out are derived from the ones it
// gave (never from the widget's own light/dark tokens), so a navy panel stays
// navy under `prefers-color-scheme: light` and a cream one stays cream under
// dark. No usable entry at all ⇒ null ⇒ exactly the widget it has always been.

/** The palette entries a host may set. Order is the documented order. */
export const PALETTE_KEYS = [
  'surface',
  'surfaceAlt',
  'text',
  'muted',
  'border',
  'accent',
  'accentText',
  'bubbleIn',
  'bubbleInText',
  'bubbleOut',
  'bubbleOutText',
  'launcher',
  'launcherIcon',
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

/** A sanitized palette, ready to paint: CSS custom property → value. */
export interface ResolvedPalette {
  /** Whether the panel surface is dark — picks the logo variant and code tint. */
  tone: 'light' | 'dark';
  /** Whether the accent is dark — picks the logo variant on the accent header. */
  accentTone: 'light' | 'dark';
  vars: Record<string, string>;
}

/** The two foregrounds the widget picks between when a host gave none. */
const LIGHT_INK = '#ffffff';
const DARK_INK = '#111827';

const NAMED_RGB: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], orange: [255, 165, 0], purple: [128, 0, 128], teal: [0, 128, 128],
  navy: [0, 0, 128], gray: [128, 128, 128], grey: [128, 128, 128], crimson: [220, 20, 60],
  indigo: [75, 0, 130], violet: [238, 130, 238], coral: [255, 127, 80], gold: [255, 215, 0],
  salmon: [250, 128, 114], tomato: [255, 99, 71], turquoise: [64, 224, 208],
  magenta: [255, 0, 255], cyan: [0, 255, 255], maroon: [128, 0, 0], olive: [128, 128, 0],
  lime: [0, 255, 0], aqua: [0, 255, 255], fuchsia: [255, 0, 255], silver: [192, 192, 192],
  pink: [255, 192, 203], brown: [165, 42, 42],
};

/** One numeric channel of rgb()/hsl(): a number, or a percentage of `full`. */
function channel(raw: string | undefined, full: number): number | null {
  if (raw === undefined) return null;
  const pct = raw.endsWith('%');
  const n = Number.parseFloat(pct ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(n)) return null;
  return pct ? (n / 100) * full : n;
}

/**
 * An ALREADY-SANITIZED colour → its sRGB channels (0..255), alpha ignored.
 * null for `transparent` or anything it cannot read; callers then keep their
 * default rather than guessing.
 */
export function parseColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) {
    const hex = v.slice(1);
    const full =
      hex.length === 3 || hex.length === 4
        ? hex.slice(0, 3).split('').map((c) => c + c).join('')
        : hex.slice(0, 6);
    if (!/^[0-9a-f]{6}$/.test(full)) return null;
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter((p) => p !== '');
    if (fn[1].startsWith('rgb')) {
      const rgb = [channel(parts[0], 255), channel(parts[1], 255), channel(parts[2], 255)];
      if (rgb.some((c) => c === null)) return null;
      return rgb.map((c) => Math.max(0, Math.min(255, c as number))) as [number, number, number];
    }
    const h = Number.parseFloat(parts[0] ?? '');
    const s = channel(parts[1], 1);
    const l = channel(parts[2], 1);
    if (!Number.isFinite(h) || s === null || l === null) return null;
    // Standard HSL → RGB.
    const sat = Math.max(0, Math.min(1, s));
    const lig = Math.max(0, Math.min(1, l));
    const k = (n: number): number => (n + h / 30) % 12;
    const a = sat * Math.min(lig, 1 - lig);
    const f = (n: number): number =>
      Math.round(255 * (lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return [f(0), f(8), f(4)];
  }
  return NAMED_RGB[v] ?? null;
}

/** WCAG relative luminance of an sRGB triple. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1..21), or null if either is unreadable. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The foreground that reads on `background`: white or near-black, whichever
 * has the higher contrast. An unreadable background gets white — the widget's
 * historic ink on its accent.
 */
export function readableOn(background: string): string {
  const onLight = contrastRatio(background, DARK_INK);
  const onDark = contrastRatio(background, LIGHT_INK);
  if (onLight === null || onDark === null) return LIGHT_INK;
  return onLight >= onDark ? DARK_INK : LIGHT_INK;
}

/** Whether a colour is dark (white ink reads better on it). Unreadable ⇒ light. */
function toneOf(color: string): 'light' | 'dark' {
  return parseColor(color) !== null && readableOn(color) === LIGHT_INK ? 'dark' : 'light';
}

/** `pct` of `a` mixed into `b`. Both are sanitized values or var()s of them. */
function mix(a: string, pct: number, b: string): string {
  return `color-mix(in srgb, ${a} ${pct}%, ${b})`;
}

/**
 * Resolve a host palette. Returns null when there is nothing usable in it, so
 * the caller paints exactly today's widget. `fallbackAccent` is the theme's own
 * accent (already layered inline-over-server); `palette.accent` beats it.
 */
export function resolvePalette(
  input: unknown,
  fallbackAccent?: string | null,
): ResolvedPalette | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const p: Partial<Record<PaletteKey, string>> = {};
  for (const key of PALETTE_KEYS) {
    const value = sanitizeColor(raw[key] as string | undefined);
    if (value !== null) p[key] = value;
  }
  if (Object.keys(p).length === 0) return null;

  const surface = p.surface ?? '#ffffff';
  const tone = toneOf(surface);
  const text = p.text ?? readableOn(surface);
  const surfaceAlt = p.surfaceAlt ?? mix(text, 7, surface);
  const muted = p.muted ?? mix(text, 64, surface);
  const border = p.border ?? mix(text, 16, surface);
  const accent = p.accent ?? sanitizeColor(fallbackAccent) ?? DEFAULT_ACCENT;
  const accentText = p.accentText ?? readableOn(accent);
  const bubbleIn = p.bubbleIn ?? accent;
  const bubbleInText = p.bubbleInText ?? (p.bubbleIn ? readableOn(p.bubbleIn) : accentText);
  const bubbleOut = p.bubbleOut ?? surfaceAlt;
  const bubbleOutText = p.bubbleOutText ?? (p.bubbleOut ? readableOn(p.bubbleOut) : text);
  const launcher = p.launcher ?? accent;
  const launcherIcon = p.launcherIcon ?? (p.launcher ? readableOn(p.launcher) : accentText);

  return {
    tone,
    accentTone: toneOf(accent),
    vars: {
      '--vtr-surface': surface,
      '--vtr-bubble-out': surfaceAlt,
      '--vtr-text': text,
      '--vtr-muted': muted,
      '--vtr-border': border,
      '--vtr-accent': accent,
      '--vtr-on-accent': accentText,
      '--vtr-bubble-in': bubbleIn,
      '--vtr-bubble-in-text': bubbleInText,
      '--vtr-msg-out': bubbleOut,
      '--vtr-msg-out-text': bubbleOutText,
      '--vtr-launcher': launcher,
      '--vtr-launcher-icon': launcherIcon,
      // Status colours and the sidebar's derived tokens follow the surface,
      // not the visitor's scheme, for the same reason as everything above.
      '--vtr-danger': tone === 'dark' ? '#f87171' : '#b91c1c',
      '--vtr-ok': tone === 'dark' ? '#4ade80' : '#15803d',
      '--vtr-page': surfaceAlt,
      '--vtr-tint': mix(accent, 12, surface),
      '--vtr-chip-border': mix(accent, 35, border),
      '--vtr-input': border,
    },
  };
}

/** Every custom property a palette may set — what removing one has to clear. */
export const PALETTE_VARS: readonly string[] = Object.keys(
  resolvePalette({ surface: '#ffffff' })?.vars ?? {},
);

/** Corner style. Anything but `soft` / `pill` is the default (no attribute). */
export function resolveRadius(input: unknown): 'soft' | 'pill' | null {
  return input === 'soft' || input === 'pill' ? input : null;
}
