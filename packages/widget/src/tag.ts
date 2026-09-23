// IIFE <script>-tag entry (tsup entry 3 -> dist/tag.global.js) — the COMBINED
// tag (vitrina-app#1610): one script that boots the Vitrina assistant embed
// AND injects Atribu's attribution tracker with the dealer's tracking key.
// One install, never two (the "tag único" — vitrina-app#1594/#1595).
//
// THE SITE ID, TWO WAYS. `data-site` on the <script> tag, same as the plain
// loader's `data-*` config, for a direct one-line install. But Google Tag
// Manager's Custom HTML strips `data-*` attributes when it re-creates a
// <script> tag (verified in the wild — see #1594's ticket body), so this
// loader ALSO reads its site id off its own `src` query string (`?site=…`),
// which GTM cannot strip because it never rewrites the URL. Same story for
// `data-api-base` / `?api=`.
//
// FINDING "OUR OWN" <script> TAG. `document.currentScript` is null for a
// script GTM (or any dynamic inserter) creates as `async` — which is the
// default for a programmatically-created <script> — so it cannot be the
// ONLY lookup. The fallback scans every <script> on the page for one whose
// `src` matches this file's own name, taking the LAST match: GTM processes
// its Custom HTML tag synchronously enough that, by the time this script's
// own top-level code runs, its own <script> element is the most recent match
// in the DOM.
//
// WHY apiBaseUrl DEFAULTS TO "SAME ORIGIN AS THIS SCRIPT". `tag.js` is meant
// to be served from the same host the API lives on (`api.vitrinadev.com`,
// exactly like `/widget.js` — see `vitrina-app/src/routes/widget-loader.ts`'s
// header for why: one Vitrina host in a dealer's CSP). Deriving apiBaseUrl
// from the script's own origin means the common install needs ONLY
// `data-site` / `?site=` — no second value to get right. `data-api-base` /
// `?api=` exist purely as an override for local development and a
// non-default deployment (a regional API host, say).
//
// ONE FETCH, BOTH HALVES. `GET {apiBase}/public/sites/{siteId}/tag-config`
// answers `{ assistant, tracking }` — `assistant` is exactly what
// `window.vitrinaChat` would have held for the plain loader, `tracking` is
// `{ key, tracker_src } | null` (null when the tenant holds no Vitrina Ads
// entitlement). A single source of truth for both halves keeps this script
// from guessing at a host or a key on its own.
//
// FAIL POSTURE. Assistant and tracker are independent once resolved: a
// tracker-injection failure never stops the assistant (and vice-versa) — see
// `bootAssistant`/`bootTracker` below, each wrapped in its own try/catch. The
// one thing that stops BOTH is failing to resolve a site id / API base, or a
// tag-config fetch that never comes back with a body: without it we have no
// key material for either half and booting one with a guess would be worse
// than not booting at all.
//
// Defensive throughout: no-ops with a console.warn on anything unusable,
// idempotent against a double-load, and never throws into the host page.

import { init } from './index';
import { currentConsent, onTrackingConsentGranted } from './consent';
import type { WidgetConfig, WidgetInstance } from './types';

declare global {
  interface Window {
    vitrinaChatInstance?: WidgetInstance;
    /** Set once the Atribu tracker script has been appended — the tag's own
     *  idempotency guard, separate from `vitrinaChatInstance`'s. */
    __vitrinaTagTrackerBooted?: boolean;
  }
}

/** The shape `GET /public/sites/{siteId}/tag-config` answers (vitrina-app,
 *  `src/api/schemas/public-tag-config.ts` — kept in sync by hand; this
 *  package does not depend on vitrina-app's generated client). */
export interface TagConfigResponse {
  assistant?: Partial<WidgetConfig> | null;
  tracking?: { key: string; tracker_src: string } | null;
}

/** Matches this bundle's own filename, built (`.global.js`) or served under
 *  any other extension a deploy might rename it to — deliberately loose. */
const OWN_SCRIPT_PATTERN = /\/tag(?:\.[\w.-]+)?\.js(?:[?#]|$)/;

/**
 * The <script> element that loaded this bundle, however it got here.
 * Exported (test seam) so a test can hand it a synthetic `Document` instead
 * of relying on real script-execution semantics happy-dom cannot reproduce
 * for a dynamically-created, async script.
 */
export function ownScriptElement(doc: Document): HTMLScriptElement | null {
  if (doc.currentScript instanceof HTMLScriptElement) return doc.currentScript;
  const scripts = Array.from(doc.getElementsByTagName('script'));
  for (let i = scripts.length - 1; i >= 0; i -= 1) {
    const src = scripts[i].getAttribute('src');
    if (src && OWN_SCRIPT_PATTERN.test(src)) return scripts[i];
  }
  return null;
}

function readQueryParam(src: string, name: string): string | null {
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined;
    const url = new URL(src, base);
    const value = url.searchParams.get(name);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function scriptOrigin(src: string): string | null {
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined;
    return new URL(src, base).origin;
  } catch {
    return null;
  }
}

/** `data-site` first, `?site=` on the script's own `src` otherwise. */
export function resolveSiteId(script: HTMLScriptElement | null): string | null {
  const attr = script?.getAttribute('data-site')?.trim();
  if (attr) return attr;
  const src = script?.getAttribute('src');
  return src ? readQueryParam(src, 'site') : null;
}

/**
 * `data-api-base` first, then `?api=`, then the script's own origin
 * (+ `/api/v1`) — see this file's header for why that is the right default.
 */
export function resolveApiBase(script: HTMLScriptElement | null): string | null {
  const attr = script?.getAttribute('data-api-base')?.trim();
  if (attr) return attr.replace(/\/+$/, '');

  const src = script?.getAttribute('src');
  if (!src) return null;

  const override = readQueryParam(src, 'api');
  if (override) return override.replace(/\/+$/, '');

  const origin = scriptOrigin(src);
  return origin ? `${origin}/api/v1` : null;
}

function bootAssistant(config: Partial<WidgetConfig> | null | undefined): void {
  // Idempotent, same guard the plain loader uses: a second copy of this tag
  // on the page must not double-mount the launcher.
  if (window.vitrinaChatInstance) return;
  if (!config || typeof config !== 'object' || !config.publicKey || !config.apiBaseUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      '[vitrina-tag] tag-config carried no usable assistant config; the assistant half did not boot.',
    );
    return;
  }
  try {
    window.vitrinaChatInstance = init(config as WidgetConfig);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[vitrina-tag] assistant init() failed:', err);
  }
}

function injectTrackerScript(tracking: { key: string; tracker_src: string }): void {
  if (window.__vitrinaTagTrackerBooted) return;
  window.__vitrinaTagTrackerBooted = true;
  try {
    const el = document.createElement('script');
    el.src = tracking.tracker_src;
    el.async = true;
    // Not required by Atribu's collector (the key is already baked into
    // `tracker_src`) — carried for observability/debugging on the page only.
    el.setAttribute('data-vitrina-tracker-key', tracking.key);
    document.head.appendChild(el);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[vitrina-tag] could not inject the Atribu tracker:', err);
  }
}

function bootTracker(tracking: { key: string; tracker_src: string } | null | undefined): void {
  // `null` means the tenant holds no Vitrina Ads entitlement — nothing to
  // boot, silently. This is the expected, common state for a dealer who has
  // not bought the Add-on; it is not an error.
  if (!tracking || !tracking.tracker_src) return;
  if (currentConsent() === true) {
    injectTrackerScript(tracking);
    return;
  }
  onTrackingConsentGranted(() => injectTrackerScript(tracking));
}

async function autoInit(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const script = ownScriptElement(document);
  const siteId = resolveSiteId(script);
  const apiBase = resolveApiBase(script);
  if (!siteId || !apiBase) {
    // eslint-disable-next-line no-console
    console.warn(
      '[vitrina-tag] could not resolve a site id / API base from this <script> tag — ' +
        'set data-site (and data-api-base for a non-default host), or append ?site=… ' +
        'to the script src (the GTM Custom HTML install path).',
    );
    return;
  }

  let payload: TagConfigResponse | null = null;
  try {
    const res = await fetch(
      `${apiBase}/public/sites/${encodeURIComponent(siteId)}/tag-config`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    );
    if (res.ok) {
      const body = (await res.json()) as { data?: TagConfigResponse };
      payload = body?.data ?? null;
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[vitrina-tag] tag-config answered ${res.status}; nothing booted.`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[vitrina-tag] could not reach tag-config:', err);
  }
  if (!payload) return;

  // Independent from here on — one half failing must never take the other
  // down with it.
  bootAssistant(payload.assistant);
  bootTracker(payload.tracking);
}

void autoInit();

export {};
