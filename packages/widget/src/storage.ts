// The one place that touches localStorage.
//
// Some browsers expose the object but throw on ACCESS (Safari private mode,
// storage disabled by policy, quota exhausted), so presence is not usability —
// only a successful write+remove round-trip is. Everything the widget persists
// is non-secret and non-essential, so every path here degrades to memory and
// NEVER throws into the host page (AC#4).

/** Shared namespace for everything the widget persists, keyed by publicKey so
 *  two widgets/keys on one origin can never collide. */
export const STORAGE_PREFIX = 'vtr:widget:';

export function storageKey(publicKey: string, suffix: string): string {
  return `${STORAGE_PREFIX}${publicKey}${suffix}`;
}

/**
 * A localStorage we have PROVEN we can write to, or null. Probing costs one
 * write+remove per widget instance and buys us the right to treat every later
 * failure as exceptional rather than expected.
 */
export function safeLocalStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__vtr_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
