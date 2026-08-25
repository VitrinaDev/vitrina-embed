/**
 * Cloudflare Turnstile for the booking confirm step.
 *
 * The server has enforced a Turnstile token on `POST /widget/appointments`
 * since vitrina-app #1265 ("Turnstile IS its first layer" — a missing token is
 * a 400, `details.reason: 'missing_token'`), but no widget release ever SENT
 * one, so every widget booking on an enforcing deployment failed at the
 * confirm step. This module closes that gap: the server now advertises its
 * site key on `GET /widget/config` (`turnstileSiteKey`, present exactly when
 * the deployment will demand a token), and the resumen pane renders the
 * challenge through this gate.
 *
 * Design constraints, in order:
 *
 *  - EXPLICIT render only. The widget paints inside a shadow root, and
 *    Turnstile's implicit mode scans `document` — it would never find the
 *    container. `turnstile.render(el, …)` with a direct element handle works
 *    inside an open shadow root (the api injects an iframe, which shadow DOM
 *    hosts fine); the Tasador funnel uses the same explicit-render shape.
 *
 *  - MOUNT-FRESH per paint. The booking UI rebuilds the resumen pane on every
 *    render, which would orphan a live Turnstile iframe. Rather than fight
 *    that with a portal, `mountFresh` removes the old widget and renders a new
 *    one — renders of this pane are rare (enter, error), and a booking
 *    rejection is exactly when a FRESH token is needed anyway (tokens are
 *    single-use; `timeout_or_duplicate` is what replaying one earns).
 *
 *  - The script loads once per PAGE (host document, not shadow) from
 *    Cloudflare, lazily, only when a gate first mounts — a tenant without
 *    `turnstileSiteKey` never loads a byte of it. The storefront template and
 *    the tasador already ship this same script on their own forms, so on the
 *    surfaces that book, the host CSP already admits it.
 */

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** How long `token()` waits for the challenge before giving up. Interactive
 *  challenges are the visitor's to solve, so this is generous. */
const TOKEN_TIMEOUT_MS = 120_000;

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'flexible' | 'compact';
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi | null> | null = null;

/** Load the Turnstile api once per page; null when the script cannot load
 *  (offline, CSP) — the caller degrades to "no token", and the server's own
 *  error path takes it from there. */
function loadApi(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => {
      // Allow a later mount to try again — a flaky network on pageview one
      // must not condemn the whole session.
      scriptPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileGate {
  /** True when a site key exists — the UI uses it to reserve the slot. */
  readonly enabled: boolean;
  /** Tear down any previous widget and render a fresh one into `el`. */
  mountFresh(el: HTMLElement): void;
  /**
   * The current token, waiting for the visitor to pass the challenge if it has
   * not resolved yet. Null when the script never loaded, nothing is mounted,
   * or the wait timed out — the caller sends nothing and lets the server
   * answer honestly.
   */
  token(): Promise<string | null>;
  destroy(): void;
}

export function createTurnstileGate(siteKey: string): TurnstileGate {
  let widgetId: string | null = null;
  let api: TurnstileApi | null = null;
  let currentToken: string | null = null;
  let waiters: Array<(token: string | null) => void> = [];
  let destroyed = false;
  let mountGen = 0;

  function settle(token: string | null): void {
    if (token === null) {
      currentToken = null; // expiry clears the token but never rejects waiters
      return;
    }
    if (waiters.length > 0) {
      // Tokens are single-use: a waiter consumes it, so it never ALSO lands
      // in `currentToken` for a later call to double-spend.
      currentToken = null;
      const pending = waiters;
      waiters = [];
      for (const w of pending) w(token);
      return;
    }
    currentToken = token;
  }

  return {
    enabled: true,

    mountFresh(el: HTMLElement): void {
      if (destroyed) return;
      const gen = ++mountGen;
      currentToken = null;
      void loadApi().then((loaded) => {
        if (destroyed || gen !== mountGen || !loaded) {
          if (!loaded) settleFailure();
          return;
        }
        api = loaded;
        if (widgetId !== null) {
          try {
            api.remove(widgetId);
          } catch {
            /* an already-gone widget is the goal state */
          }
          widgetId = null;
        }
        try {
          widgetId = api.render(el, {
            sitekey: siteKey,
            size: 'flexible',
            callback: (token) => settle(token),
            'expired-callback': () => {
              currentToken = null;
            },
            'error-callback': () => settleFailure(),
          });
        } catch {
          settleFailure();
        }
      });

      function settleFailure(): void {
        // Resolve every waiter with null so confirm() proceeds tokenless and
        // the SERVER's verdict (fail-open when unconfigured, 400 when
        // enforcing) stays the single source of truth.
        currentToken = null;
        const pending = waiters;
        waiters = [];
        for (const w of pending) w(null);
      }
    },

    token(): Promise<string | null> {
      if (destroyed) return Promise.resolve(null);
      if (currentToken !== null) {
        // Single-use: hand it out once, then require a fresh mount/solve.
        const t = currentToken;
        currentToken = null;
        return Promise.resolve(t);
      }
      if (widgetId === null && api !== null) return Promise.resolve(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w !== wrapped);
          resolve(null);
        }, TOKEN_TIMEOUT_MS);
        const wrapped = (token: string | null): void => {
          clearTimeout(timer);
          resolve(token);
        };
        waiters.push(wrapped);
      });
    },

    destroy(): void {
      destroyed = true;
      const pending = waiters;
      waiters = [];
      for (const w of pending) w(null);
      if (api && widgetId !== null) {
        try {
          api.remove(widgetId);
        } catch {
          /* page teardown */
        }
      }
      widgetId = null;
    },
  };
}
