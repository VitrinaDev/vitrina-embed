// Auto-open scheduler (embed#25, D16). Decides IF and WHEN the widget opens on
// its own, and with what (full panel or the peek-card teaser). Owns no DOM:
// everything it needs from the page comes through `AutoOpenEnv`, so the rules
// are unit-testable with fake timers and a fake page.
//
// The rules, in the order they are checked:
//   1. off unless the resolved config says `enabled`
//   2. never on an excluded path
//   3. once per browser session: after it fired, after the visitor opened the
//      widget themselves, or after ANY dismiss, it never fires again in the
//      session (sessionStorage, so a new tab of the same session still counts)
//   4. a phone gets the teaser at most, never the panel (resolved upstream)
//   5. the delay counts from PAGE LOAD, not from init — the full bundle loads
//      lazily, and a visitor who has been reading for 8 s must not wait 10 more
//   6. when the timer is due but the page is busy (a field focused, a video
//      with sound playing, a dialog or booking sheet open), it WAITS for the
//      page to be quiet, re-checking every second, and gives up after a while
//      rather than interrupting the visitor later out of context.

import type { ResolvedAutoOpen } from './sidebar-config';

export type AutoOpenMode = 'panel' | 'teaser';
export type AutoOpenDevice = 'desktop' | 'mobile';
export type BusyReason = 'input' | 'video' | 'dialog' | 'hidden';

export interface SessionStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface AutoOpenEnv {
  /** ms since navigation start (performance.now()). */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  isMobile(): boolean;
  pathname(): string;
  /** Why the page is not quiet right now, or null. */
  busy(): BusyReason | null;
  session: SessionStore;
}

export interface AutoOpenScheduler {
  /** Arm the timer. Idempotent. */
  start(): void;
  /** The visitor opened the widget themselves: auto-open is spent for the session. */
  noteOpened(): void;
  /** The visitor dismissed the panel or the teaser: never again this session. */
  noteDismissed(): void;
  cancel(): void;
  /** For tests and diagnostics. */
  state(): 'idle' | 'armed' | 'waiting-quiet' | 'fired' | 'spent' | 'off';
}

export const QUIET_RETRY_MS = 1_000;
/** How long a due auto-open may wait for a busy page before giving up. */
export const QUIET_GIVE_UP_MS = 60_000;

export function sessionKey(publicKey: string): string {
  return `vtr:widget:${publicKey}:autoopen`;
}

/** Exact match, or prefix match for a pattern ending in '*'. */
export function pathExcluded(pathname: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p.endsWith('*')) {
      if (pathname.startsWith(p.slice(0, -1))) return true;
    } else if (pathname === p || pathname === `${p}/`) {
      return true;
    }
  }
  return false;
}

export function createAutoOpenScheduler(opts: {
  publicKey: string;
  config: ResolvedAutoOpen;
  env: AutoOpenEnv;
  onFire(mode: AutoOpenMode, device: AutoOpenDevice): void;
}): AutoOpenScheduler {
  const { config, env } = opts;
  const key = sessionKey(opts.publicKey);
  let state: ReturnType<AutoOpenScheduler['state']> = 'idle';
  let timer: unknown = null;
  let waitedMs = 0;

  const spentInSession = (): boolean => env.session.get(key) !== null;

  function clear(): void {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  }

  function spend(value: 'shown' | 'opened' | 'dismissed'): void {
    // A dismiss always wins over an earlier 'shown' — the record is only used
    // for "is it spent", but the value is what diagnostics read.
    env.session.set(key, value);
  }

  function fire(): void {
    timer = null;
    if (state !== 'armed' && state !== 'waiting-quiet') return;
    if (spentInSession()) {
      state = 'spent';
      return;
    }
    if (env.busy() !== null) {
      if (waitedMs >= QUIET_GIVE_UP_MS) {
        state = 'off';
        return;
      }
      state = 'waiting-quiet';
      waitedMs += QUIET_RETRY_MS;
      timer = env.setTimeout(fire, QUIET_RETRY_MS);
      return;
    }
    const device: AutoOpenDevice = env.isMobile() ? 'mobile' : 'desktop';
    const choice = device === 'mobile' ? config.mobile : config.desktop;
    if (choice === 'off') {
      state = 'off';
      return;
    }
    state = 'fired';
    spend('shown');
    opts.onFire(choice, device);
  }

  return {
    start(): void {
      if (state !== 'idle') return;
      if (!config.enabled || pathExcluded(env.pathname(), config.excludePaths)) {
        state = 'off';
        return;
      }
      if (spentInSession()) {
        state = 'spent';
        return;
      }
      const delay = env.isMobile() ? config.mobileDelayMs : config.delayMs;
      state = 'armed';
      timer = env.setTimeout(fire, Math.max(0, delay - env.now()));
    },
    noteOpened(): void {
      clear();
      if (!spentInSession()) spend('opened');
      if (state !== 'fired') state = 'spent';
    },
    noteDismissed(): void {
      clear();
      spend('dismissed');
      state = 'spent';
    },
    cancel(): void {
      clear();
      if (state === 'armed' || state === 'waiting-quiet') state = 'idle';
    },
    state: () => state,
  };
}

// --- Browser bindings --------------------------------------------------------

/** sessionStorage that degrades to memory and never throws into the host. */
export function browserSessionStore(): SessionStore {
  const memory = new Map<string, string>();
  return {
    get(k) {
      try {
        const v = globalThis.sessionStorage?.getItem(k);
        if (v !== null && v !== undefined) return v;
      } catch {
        /* storage blocked */
      }
      return memory.get(k) ?? null;
    },
    set(k, v) {
      memory.set(k, v);
      try {
        globalThis.sessionStorage?.setItem(k, v);
      } catch {
        /* storage blocked: memory still holds it for this page */
      }
    },
  };
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Is the host page busy? `widgetHost` is our own shadow host, whose focus never
 * counts (a visitor typing in the widget is not a reason to hold the widget).
 *
 *   input  — a form field (or contenteditable) on the page has focus
 *   video  — a video WITH SOUND is playing; muted hero loops do not count, they
 *            play forever and would hold auto-open forever
 *   dialog — an open <dialog>, an aria-modal element, or anything the host
 *            marked `data-vtr-busy` (the landing's booking sheet does this)
 */
export function detectBusy(doc: Document, widgetHost?: Element | null): BusyReason | null {
  const active = doc.activeElement as HTMLElement | null;
  if (active && active !== widgetHost && !(widgetHost && widgetHost.contains(active))) {
    if (TYPING_TAGS.has(active.tagName) || active.isContentEditable) return 'input';
    // Another Vitrina widget on the page (e.g. an inline chat) with its composer focused:
    // the visitor is typing there, so this instance must not open over it.
    if (active.hasAttribute('data-vitrina-widget')) {
      const inner = active.shadowRoot?.activeElement as HTMLElement | null | undefined;
      if (inner && (TYPING_TAGS.has(inner.tagName) || inner.isContentEditable)) return 'input';
    }
  }
  const videos = doc.getElementsByTagName('video');
  for (let i = 0; i < videos.length; i += 1) {
    const v = videos[i]!;
    if (!v.paused && !v.ended && !v.muted && v.volume > 0) return 'video';
  }
  if (doc.querySelector('dialog[open], [aria-modal="true"], [data-vtr-busy]')) return 'dialog';
  return null;
}

export function browserAutoOpenEnv(
  widgetHost: () => Element | null,
  mobileQuery = '(max-width: 768px)',
  isHidden: () => boolean = () => false,
): AutoOpenEnv {
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : 0),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isMobile: () => {
      try {
        return typeof matchMedia === 'function' && matchMedia(mobileQuery).matches;
      } catch {
        return false;
      }
    },
    pathname: () => {
      try {
        return location.pathname;
      } catch {
        return '/';
      }
    },
    // Hidden by the host (hide()) counts as busy: the timer waits, like for a dialog.
    busy: () => (isHidden() ? 'hidden' : detectBusy(document, widgetHost())),
    session: browserSessionStore(),
  };
}
