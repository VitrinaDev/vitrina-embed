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

import type { RemoteWidgetConfig } from './config';
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
