// Last-known-good cache for the server-resolved appearance (Vitrina ADR 0046).
//
// WHY THIS EXISTS. `GET /widget/config` is a network round trip, and the
// launcher is on screen before it can possibly answer. Without a cache, EVERY
// first paint on EVERY page of a dealer's site would show the default near-black
// bubble and then snap to the dealer's brand colour a few hundred milliseconds
// later. With one, only a visitor's very first pageview can flash — and even
// that is handled, by holding the launcher back briefly (see index.ts).
//
// DELIBERATELY NO TTL. The cache is a first-paint hint, never an authority: a
// live fetch always follows and overwrites it within the same pageview. The one
// case where a stale entry survives is a fetch that keeps failing — and there,
// last-known-good branding is strictly better than falling back to defaults.
//
// The stored value is public (a colour, a corner, a logo URL that is already in
// the dealer's page). Nothing here is a secret, and nothing here is load-bearing:
// a corrupt or absent entry simply means we paint defaults for one frame.

import {
  normalizeFaqs,
  normalizeHomeSubtitle,
  normalizeHomeTitle,
  normalizeTeam,
  type RemoteWidgetConfig,
} from './config';
import { isWidgetFont } from './fonts';
import { safeLocalStorage, storageKey } from './storage';

const KEY_SUFFIX = ':config';

export interface RemoteConfigCache {
  read(): RemoteWidgetConfig | null;
  write(config: RemoteWidgetConfig): void;
}

/**
 * Coerce whatever came out of storage (or off the wire) into the shape we are
 * willing to hand to the theme layer. Unknown keys are DROPPED rather than
 * passed through: this object is spread over the dealer's own config, so an
 * attacker-controlled localStorage entry must not be able to introduce fields
 * the widget never validated. Every value is re-sanitized downstream anyway
 * (theme.ts), so this is the second of two gates, not the only one.
 */
export function coerceRemoteConfig(input: unknown): RemoteWidgetConfig | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const out: RemoteWidgetConfig = {};

  const theme = raw.theme;
  if (theme && typeof theme === 'object') {
    const t = theme as Record<string, unknown>;
    const next: NonNullable<RemoteWidgetConfig['theme']> = {};
    if (typeof t.accent === 'string') next.accent = t.accent;
    if (t.position === 'br' || t.position === 'bl') next.position = t.position;
    if (typeof t.logoUrl === 'string') next.logoUrl = t.logoUrl;
    if (Object.keys(next).length > 0) out.theme = next;
  }
  if (typeof raw.welcomeMessage === 'string') {
    out.welcomeMessage = raw.welcomeMessage;
  }
  if (raw.locale === 'es' || raw.locale === 'en') out.locale = raw.locale;
  // The three brand fields. All three arrive as `T | null` rather than being
  // omitted, and null is "nothing to say" — a non-string is simply dropped, so
  // it can never clobber the dealer's inline value or the built-in default.
  if (typeof raw.bookingLabel === 'string') out.bookingLabel = raw.bookingLabel;
  // An unknown font name means a server newer than this widget. Drop it here
  // rather than caching it: the honest render is the system stack.
  if (isWidgetFont(raw.font)) out.font = raw.font;
  if (typeof raw.logoUrl === 'string') out.logoUrl = raw.logoUrl;
  // Booking gate. Only an explicit `true` survives — the server omits the field
  // when the tenant has bookings off, so `false`, `'true'`, `1` and everything
  // else are all "off". This coercion is also the localStorage read path, so
  // without the line the flag would round-trip out of the cache as undefined
  // and the chip would flicker off on every repeat pageview.
  if (raw.bookingEnabled === true) out.bookingEnabled = true;
  // Turnstile site key for the booking confirm step. Bounded so a tampered
  // localStorage entry cannot smuggle a novel into the config — site keys are
  // short opaque identifiers.
  if (
    typeof raw.turnstileSiteKey === 'string' &&
    raw.turnstileSiteKey.length > 0 &&
    raw.turnstileSiteKey.length <= 128
  ) {
    out.turnstileSiteKey = raw.turnstileSiteKey;
  }

  // Home / Help / team. Sanitized HERE as well as in resolveConfig, because
  // this function is also the localStorage read path: a tampered cache entry
  // must not be able to smuggle an unvalidated avatar URL or a 40kB "answer"
  // into the panel. The sanitizers are pure and idempotent, so the second pass
  // in resolveConfig changes nothing.
  //
  // An EMPTY result is dropped rather than emitted, so a server that sends
  // `home: null` (or garbage) leaves the key absent — which is what lets the
  // dealer's inline value, and then the default, still win.
  const home = raw.home;
  if (home && typeof home === 'object') {
    const h = home as Record<string, unknown>;
    const next: NonNullable<RemoteWidgetConfig['home']> = {};
    if (h.enabled === true) next.enabled = true;
    const title = normalizeHomeTitle(h.title);
    if (title !== null) next.title = title;
    const subtitle = normalizeHomeSubtitle(h.subtitle);
    if (subtitle !== null) next.subtitle = subtitle;
    // The quick-action gates. Only an explicit `true` survives, per card: the
    // server omits a card it has off, so `false`, `'true'`, `1` and everything
    // else all mean off. Dropping an empty bag keeps "the server said nothing"
    // distinguishable from "the server said no" for the field-wise merge.
    const cards = h.cards;
    if (cards && typeof cards === 'object') {
      const c = cards as Record<string, unknown>;
      const kept: NonNullable<NonNullable<RemoteWidgetConfig['home']>['cards']> = {};
      if (c.buy === true) kept.buy = true;
      if (c.sell === true) kept.sell = true;
      if (c.search === true) kept.search = true;
      if (Object.keys(kept).length > 0) next.cards = kept;
    }
    if (Object.keys(next).length > 0) out.home = next;
  }

  const help = raw.help;
  if (help && typeof help === 'object') {
    const h = help as Record<string, unknown>;
    const next: NonNullable<RemoteWidgetConfig['help']> = {};
    if (h.enabled === true) next.enabled = true;
    const faqs = normalizeFaqs(h.faqs);
    if (faqs.length > 0) next.faqs = faqs;
    if (Object.keys(next).length > 0) out.help = next;
  }

  const team = normalizeTeam(raw.team);
  if (team.length > 0) out.team = team;

  return out;
}

/** Namespaced, never-throwing cache. Degrades to a no-op without storage. */
export function createRemoteConfigCache(publicKey: string): RemoteConfigCache {
  const key = storageKey(publicKey, KEY_SUFFIX);
  const ls = safeLocalStorage();

  return {
    read(): RemoteWidgetConfig | null {
      if (!ls) return null;
      try {
        const raw = ls.getItem(key);
        if (!raw) return null;
        return coerceRemoteConfig(JSON.parse(raw));
      } catch {
        // Corrupt entry, blocked storage, whatever. Paint defaults for a frame.
        return null;
      }
    },
    write(config: RemoteWidgetConfig): void {
      if (!ls) return;
      try {
        ls.setItem(key, JSON.stringify(config));
      } catch {
        /* storage full/blocked — the cache is an optimisation, not a need */
      }
    },
  };
}
