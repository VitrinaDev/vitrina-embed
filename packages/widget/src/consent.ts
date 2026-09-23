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
// No signal at all resolves to `null` ("unknown"), which `tag.ts` treats as
// NOT granted — tracking fails CLOSED, never open, on a page with no consent
// integration at all.
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
 * `ad_storage` OR `analytics_storage` granted counts as granted (either is
 * enough for a first-party attribution tracker).
 */
function fromGoogleConsentMode(): ConsentState {
  if (typeof window === 'undefined') return null;
  const layer = window.dataLayer;
  if (!Array.isArray(layer)) return null;

  let state: ConsentState = null;
  for (const entry of layer) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [kind, action, params] = entry as [unknown, unknown, unknown];
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

/**
 * Calls `onGranted` the instant tracking consent is (or becomes) `true`.
 * Checks immediately — a page whose CMP already granted before this script
 * ran fires synchronously-ish (microtask-free, same tick) — and otherwise
 * polls both signals above until granted or `MAX_POLLS` is exhausted.
 *
 * Polling, not a DOM event, because Consent Mode v2 defines no event of its
 * own and a dealer's CMP may push to `dataLayer` at any time relative to this
 * script. Returns a cancel function so a caller (or a test) can stop early.
 */
export function onTrackingConsentGranted(onGranted: () => void): () => void {
  let cancelled = false;
  let attempts = 0;

  const check = (): void => {
    if (cancelled) return;
    if (currentConsent() === true) {
      onGranted();
      return;
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
