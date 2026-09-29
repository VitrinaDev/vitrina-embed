// Consent-mode awareness for the combined tag's Atribu-tracker half (#1610).
//
// The ASSISTANT half never checks this module — it may load regardless of
// consent, same as it always has. Only `bootTracker` in `tag.ts` reads it.
//
// TWO signals, checked in order, neither of which this widget owns:
//
//   1. `window.__vitrinaConsent` — a generic hook a dealer's own consent
//      integration (any CMP, or a hand-rolled banner) can set directly: a
//      boolean, or a function returning one. Takes priority because it is an
//      EXPLICIT, Vitrina-specific signal — a dealer who wires this up is
//      telling us exactly what they mean.
//   2. Google Consent Mode v2 (`window.dataLayer` `consent` `default`/`update`
//      entries, the de-facto standard most CMPs already push regardless of
//      Vitrina). Read defensively: dataLayer is a plain array anyone can
//      push malformed entries onto, so every shape is checked before use.
//
// No signal at all resolves to `null` ("unknown"). The tag's rule (founder
// decision 2026-09-29 — a Chilean site needs no cookie banner) is DEFAULT
// GRANTED: `null` loads the beacon; only an EXPLICIT denial (`false`) holds
// it back. See `onTrackingAllowed` below.
export type ConsentState = true | false | null;

declare global {
  interface Window {
    __vitrinaConsent?: boolean | (() => boolean | null | undefined);
    dataLayer?: unknown[];
  }
}

function fromHook(): ConsentState {
  if (typeof window === 'undefined') return null;
  const hook = window.__vitrinaConsent;
  if (typeof hook === 'boolean') return hook;
  if (typeof hook === 'function') {
    try {
      const value = hook();
      if (value === true || value === false) return value;
    } catch {
      // A dealer's own hook throwing must never break the host page or this
      // loader — fall through to "no signal from this source".
    }
  }
  return null;
}

/**
 * Walks `window.dataLayer` for `['consent', 'default' | 'update', params]`
 * entries (Google Consent Mode v2) and returns the LAST verdict found —
 * `update` entries are meant to supersede `default`, and pushes are
 * chronological, so the last matching entry is the current state.
 * Either key `granted` counts as granted (enough for a first-party
 * tracker); otherwise either key `denied` counts as denied.
 */
function fromGoogleConsentMode(): ConsentState {
  if (typeof window === 'undefined') return null;
  const layer = window.dataLayer;
  if (!Array.isArray(layer)) return null;

  let state: ConsentState = null;
  for (const entry of layer) {
    // gtag() pushes its `arguments` object, not a real array — accept both.
    const isArgs = Object.prototype.toString.call(entry) === '[object Arguments]';
    if (!isArgs && !Array.isArray(entry)) continue;
    const tuple = entry as ArrayLike<unknown>;
    if (tuple.length < 3) continue;
    const [kind, action, params] = Array.from(tuple) as [unknown, unknown, unknown];
    if (kind !== 'consent') continue;
    if (action !== 'default' && action !== 'update') continue;
    if (!params || typeof params !== 'object') continue;
    const p = params as Record<string, unknown>;
    if (p.ad_storage === 'granted' || p.analytics_storage === 'granted') {
      state = true;
    } else if (p.ad_storage === 'denied' || p.analytics_storage === 'denied') {
      state = false;
    }
  }
  return state;
}

/** The consent verdict at THIS instant — never throws, never blocks. */
export function currentConsent(): ConsentState {
  const hook = fromHook();
  if (hook !== null) return hook;
  return fromGoogleConsentMode();
}

const POLL_MS = 500;
// 20s of polling: long enough for a CMP banner's first render and a
// visitor's first click, short enough that a page which never grants does
// not leak a timer forever.
const MAX_POLLS = 40;

// How long a page that HAS a dataLayer but has set no consent default yet
// gets to set one before the beacon defaults to granted. Consent Mode
// defaults are pushed before GTM boots, so this is a short grace, not a wait
// for a visitor's click.
const PENDING_GRACE_MS = 1500;

/**
 * The tag's loading rule. Calls `onAllowed` once, when the beacon may load:
 *
 *   - verdict `true`, or NO signal at all (no hook, no dataLayer) -> now;
 *   - verdict `false` (explicit denial) -> never, unless it later becomes
 *     `true` (polled every 500 ms, up to ~20 s);
 *   - no verdict yet but a dataLayer exists (Consent Mode may still be
 *     initialising) -> wait `PENDING_GRACE_MS`; if still no verdict, load
 *     (default granted); if a denial arrived meanwhile, hold as above.
 *
 * Returns a cancel function.
 */
export function onTrackingAllowed(onAllowed: () => void): () => void {
  const pendingPossible = (): boolean =>
    typeof window !== 'undefined' && Array.isArray(window.dataLayer);

  let cancelled = false;
  let attempts = 0;
  let graceLeftMs = pendingPossible() ? PENDING_GRACE_MS : 0;

  const check = (): void => {
    if (cancelled) return;
    const verdict = currentConsent();
    if (verdict === true) {
      onAllowed();
      return;
    }
    if (verdict === null) {
      if (graceLeftMs <= 0) {
        onAllowed();
        return;
      }
      graceLeftMs -= POLL_MS;
    } else {
      graceLeftMs = 0; // an explicit denial ends the grace: never default-grant
    }
    attempts += 1;
    if (attempts >= MAX_POLLS) return;
    setTimeout(check, POLL_MS);
  };

  check();
  return () => {
    cancelled = true;
  };
}
