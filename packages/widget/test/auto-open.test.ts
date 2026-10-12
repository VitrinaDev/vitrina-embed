import { describe, expect, it, vi } from 'vitest';

import {
  QUIET_GIVE_UP_MS,
  QUIET_RETRY_MS,
  SCROLL_SETTLE_MS,
  createAutoOpenScheduler,
  detectBusy,
  pathExcluded,
  sessionKey,
  type AutoOpenEnv,
  type BusyReason,
} from '../src/auto-open';
import { resolveAutoOpen, resolveRequireScroll } from '../src/sidebar-config';
import type { WidgetAutoOpenConfig } from '../src/types';

/** A fake page with a manual clock. */
function fakeEnv(opts: { mobile?: boolean; path?: string; now?: number } = {}) {
  let clock = opts.now ?? 0;
  let busy: BusyReason | null = null;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const store = new Map<string, string>();
  const env: AutoOpenEnv = {
    now: () => clock,
    setTimeout: (fn, ms) => {
      const t = { at: clock + ms, fn, id: nextId++ };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    isMobile: () => opts.mobile ?? false,
    pathname: () => opts.path ?? '/automotoras',
    busy: () => busy,
    session: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  function advance(ms: number): void {
    const until = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift();
      clock = t.at;
      t.fn();
    }
    clock = until;
  }
  return { env, advance, store, setBusy: (b: BusyReason | null) => (busy = b) };
}

function make(cfg: WidgetAutoOpenConfig, page = fakeEnv()) {
  const onFire = vi.fn();
  const s = createAutoOpenScheduler({ publicKey: 'pk_t', config: resolveAutoOpen(cfg), env: page.env, onFire });
  return { s, onFire, page };
}

describe('auto-open scheduler', () => {
  it('is off unless enabled', () => {
    const { s, onFire, page } = make({});
    s.start();
    page.advance(60_000);
    expect(onFire).not.toHaveBeenCalled();
    expect(s.state()).toBe('off');
  });

  it('fires the panel on desktop at the delay, once', () => {
    const { s, onFire, page } = make({ enabled: true });
    s.start();
    page.advance(9_999);
    expect(onFire).not.toHaveBeenCalled();
    page.advance(1);
    expect(onFire).toHaveBeenCalledWith('panel', 'desktop');
    expect(page.store.get(sessionKey('pk_t'))).toBe('shown');
    s.start();
    page.advance(60_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('fires the teaser on mobile with the mobile delay', () => {
    const { s, onFire, page } = make(
      { enabled: true, delaySeconds: 25, mobileDelaySeconds: 10 },
      fakeEnv({ mobile: true }),
    );
    s.start();
    page.advance(10_000);
    expect(onFire).toHaveBeenCalledWith('teaser', 'mobile');
  });

  it('counts the delay from page load, not from init (lazy bundle)', () => {
    const { s, onFire, page } = make({ enabled: true }, fakeEnv({ now: 7_000 }));
    s.start();
    page.advance(3_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('fires immediately when the bundle loaded after the delay had passed', () => {
    const { s, onFire, page } = make({ enabled: true }, fakeEnv({ now: 15_000 }));
    s.start();
    page.advance(0);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('never fires again in the session once spent (new page, same session)', () => {
    const first = make({ enabled: true });
    first.s.start();
    first.page.advance(10_000);
    // A second pageview in the same session: same session store.
    const page2 = fakeEnv();
    page2.store.set(sessionKey('pk_t'), first.page.store.get(sessionKey('pk_t'))!);
    const second = make({ enabled: true }, page2);
    second.s.start();
    page2.advance(60_000);
    expect(second.onFire).not.toHaveBeenCalled();
    expect(second.s.state()).toBe('spent');
  });

  it('a manual open before the timer spends it', () => {
    const { s, onFire, page } = make({ enabled: true });
    s.start();
    page.advance(3_000);
    s.noteOpened();
    page.advance(60_000);
    expect(onFire).not.toHaveBeenCalled();
    expect(page.store.get(sessionKey('pk_t'))).toBe('opened');
  });

  it('a dismiss is recorded and turns it off for the session', () => {
    const { s, page } = make({ enabled: true });
    s.start();
    page.advance(10_000);
    s.noteDismissed();
    expect(page.store.get(sessionKey('pk_t'))).toBe('dismissed');
    expect(s.state()).toBe('spent');
  });

  it('never fires on an excluded path', () => {
    const { s, onFire, page } = make(
      { enabled: true, excludePaths: ['/agendar/*', '/precios'] },
      fakeEnv({ path: '/agendar/listo' }),
    );
    s.start();
    page.advance(60_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('respects desktop/mobile off', () => {
    const { s, onFire, page } = make({ enabled: true, mobile: 'off' }, fakeEnv({ mobile: true }));
    s.start();
    page.advance(60_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('waits while the page is busy and fires once it is quiet', () => {
    const { s, onFire, page } = make({ enabled: true });
    s.start();
    page.setBusy('input');
    page.advance(10_000);
    expect(onFire).not.toHaveBeenCalled();
    expect(s.state()).toBe('waiting-quiet');
    page.advance(5 * QUIET_RETRY_MS);
    expect(onFire).not.toHaveBeenCalled();
    page.setBusy(null);
    page.advance(QUIET_RETRY_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('gives up when the page stays busy too long', () => {
    const { s, onFire, page } = make({ enabled: true });
    s.start();
    page.setBusy('dialog');
    page.advance(10_000 + QUIET_GIVE_UP_MS + 5_000);
    page.setBusy(null);
    page.advance(60_000);
    expect(onFire).not.toHaveBeenCalled();
    expect(s.state()).toBe('off');
  });
});

describe('pathExcluded', () => {
  it('matches exact paths (with or without trailing slash) and prefixes', () => {
    expect(pathExcluded('/agendar', ['/agendar'])).toBe(true);
    expect(pathExcluded('/agendar/', ['/agendar'])).toBe(true);
    expect(pathExcluded('/agendarx', ['/agendar'])).toBe(false);
    expect(pathExcluded('/agendar/listo', ['/agendar/*'])).toBe(true);
    expect(pathExcluded('/', ['/agendar/*'])).toBe(false);
  });
});

describe('detectBusy', () => {
  it('sees a focused field, a dialog, and the host busy marker; ignores our own host', () => {
    document.body.innerHTML = '<input id="f"><div id="host" data-vitrina-widget><input id="own"></div>';
    const host = document.getElementById('host');
    expect(detectBusy(document, host)).toBeNull();
    (document.getElementById('f') as HTMLInputElement).focus();
    expect(detectBusy(document, host)).toBe('input');
    (document.getElementById('own') as HTMLInputElement).focus();
    expect(detectBusy(document, host)).toBeNull();
    (document.activeElement as HTMLElement).blur();
    document.body.insertAdjacentHTML('beforeend', '<div data-vtr-busy></div>');
    expect(detectBusy(document, host)).toBe('dialog');
    document.body.innerHTML = '';
  });

  it('a playing video with sound is busy; a muted loop is not', () => {
    document.body.innerHTML = '<video id="v"></video>';
    const v = document.getElementById('v') as HTMLVideoElement;
    Object.defineProperty(v, 'paused', { value: false, configurable: true });
    Object.defineProperty(v, 'ended', { value: false, configurable: true });
    Object.defineProperty(v, 'muted', { value: true, configurable: true });
    expect(detectBusy(document, null)).toBeNull();
    Object.defineProperty(v, 'muted', { value: false, configurable: true });
    expect(detectBusy(document, null)).toBe('video');
    document.body.innerHTML = '';
  });
});


/** fakeEnv plus a scrollable page. */
function scrollEnv(opts: { vh?: number; withScroll?: boolean } = {}) {
  const page = fakeEnv();
  let y = 0;
  const subs = new Set<() => void>();
  if (opts.withScroll !== false) {
    page.env.scrollDistance = () => y;
    page.env.viewportHeight = () => opts.vh ?? 800;
    page.env.onScroll = (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    };
  }
  return {
    ...page,
    subs,
    scrollTo(next: number): void {
      y = next;
      for (const fn of [...subs]) fn();
    },
  };
}

describe('auto-open requireScroll (0.18.0)', () => {
  it('resolves: off by default, true = half a window, bounds clamped, junk = off', () => {
    expect(resolveAutoOpen({ enabled: true }).requireScroll).toBeNull();
    expect(resolveRequireScroll(true)).toEqual({ px: 0, viewport: 0.5 });
    expect(resolveRequireScroll({ px: 300 })).toEqual({ px: 300, viewport: 0 });
    expect(resolveRequireScroll({ viewport: 99 })).toEqual({ px: 0, viewport: 5 });
    expect(resolveRequireScroll({ px: -1 })).toBeNull();
    expect(resolveRequireScroll('yes')).toBeNull();
    expect(resolveRequireScroll(false)).toBeNull();
  });

  it('never fires while the visitor stays on the first screen', () => {
    const page = scrollEnv();
    const { s, onFire } = make({ enabled: true, requireScroll: true }, page);
    s.start();
    page.advance(10 * 60_000);
    expect(onFire).not.toHaveBeenCalled();
    expect(s.state()).toBe('waiting-scroll');
    // A small scroll under the threshold (half of 800 px) does not count.
    page.scrollTo(200);
    page.advance(60_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('a due timer fires a beat after the visitor scrolls far enough', () => {
    const page = scrollEnv();
    const { s, onFire } = make({ enabled: true, requireScroll: { px: 300 } }, page);
    s.start();
    page.advance(30_000);
    expect(s.state()).toBe('waiting-scroll');
    page.scrollTo(450);
    expect(onFire).not.toHaveBeenCalled();
    page.advance(SCROLL_SETTLE_MS);
    expect(onFire).toHaveBeenCalledWith('panel', 'desktop');
    expect(page.subs.size).toBe(0);
  });

  it('a scroll before the delay counts (latched), even if they scroll back to the top', () => {
    const page = scrollEnv();
    const { s, onFire } = make({ enabled: true, requireScroll: true }, page);
    s.start();
    page.advance(2_000);
    page.scrollTo(900);
    page.scrollTo(0);
    page.advance(8_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('busy detection still applies after the scroll', () => {
    const page = scrollEnv();
    const { s, onFire } = make({ enabled: true, requireScroll: true }, page);
    s.start();
    page.advance(10_000);
    page.setBusy('dialog');
    page.scrollTo(900);
    page.advance(SCROLL_SETTLE_MS + 3 * QUIET_RETRY_MS);
    expect(onFire).not.toHaveBeenCalled();
    expect(s.state()).toBe('waiting-quiet');
    page.setBusy(null);
    page.advance(QUIET_RETRY_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('a manual open while waiting for the scroll spends it and stops listening', () => {
    const page = scrollEnv();
    const { s, onFire } = make({ enabled: true, requireScroll: true }, page);
    s.start();
    page.advance(12_000);
    s.noteOpened();
    expect(page.subs.size).toBe(0);
    page.scrollTo(2_000);
    page.advance(60_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('without scroll bindings in the env it never fires (fails closed)', () => {
    const page = scrollEnv({ withScroll: false });
    const { s, onFire } = make({ enabled: true, requireScroll: true }, page);
    s.start();
    page.advance(10 * 60_000);
    expect(onFire).not.toHaveBeenCalled();
  });
});
