// Lazy boot stub (embed#25; spec v3 §6.2): tsup entry -> dist/boot.global.js.
//
// A host page that cares about LCP/INP (the Vitrina landing, any fast dealer
// site) loads THIS instead of /widget.js. It is a few hundred bytes, mounts
// nothing, and injects the real loader only on the first of:
//
//   - first interaction (pointerdown, keydown, touchstart, scroll),
//   - idle + 4 s (requestIdleCallback, falling back to a timeout),
//   - the inline auto-open timer coming due (`autoOpen.delaySeconds`),
//   - any call on the public API below.
//
// Until then `window.vitrinaChatApi` is a stub that QUEUES calls (open, close,
// prefill, send, enterDemo, exitDemo, openBooking, on…); the real loader drains
// the queue in order and swaps the stub for the live instance. So the landing
// can wire `vitrinaChatApi.open()` to its buttons from the first paint.
//
// Install:
//   <script>window.vitrinaChat = { publicKey, apiBaseUrl, layout: 'sidebar', … }</script>
//   <script src=".../boot.global.js" data-src="https://api.vitrinadev.com/widget.js" async></script>
//
// With `async`, code that runs before this file may not find the stub yet; it
// queues directly instead, and the stub keeps what is already there:
//   (window.vitrinaChatQueue = window.vitrinaChatQueue || []).push(['on', ['cta', openSheet]]);
//
// Kept dependency-free on purpose: importing anything from the widget would
// pull the widget into this file and defeat the point.

type Call = [method: string, args: unknown[]];

interface BootWindow {
  vitrinaChat?: { autoOpen?: { enabled?: boolean; delaySeconds?: number } };
  vitrinaChatQueue?: Call[];
  vitrinaChatApi?: Record<string, unknown>;
  vitrinaChatInstance?: unknown;
}

export const IDLE_EXTRA_MS = 4_000;
export const API_METHODS = [
  'open',
  'close',
  'prefill',
  'send',
  'enterDemo',
  'exitDemo',
  'openBooking',
  'openHomeAction',
  'setVehicle',
  'on',
] as const;

(function boot(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as BootWindow;
  if (w.vitrinaChatApi || w.vitrinaChatInstance) return;

  const script = document.currentScript as HTMLScriptElement | null;
  const src = script?.getAttribute('data-src');
  if (!src) {
    // eslint-disable-next-line no-console
    console.warn('[vitrina-widget] boot: data-src (the widget.js URL) is required; skipping.');
    return;
  }

  const queue: Call[] = (w.vitrinaChatQueue = w.vitrinaChatQueue || []);
  let loaded = false;
  const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
  const timers: ReturnType<typeof setTimeout>[] = [];

  function load(): void {
    if (loaded) return;
    loaded = true;
    for (const e of events) removeEventListener(e, load, true);
    for (const t of timers) clearTimeout(t);
    const s = document.createElement('script');
    s.src = src!;
    s.async = true;
    document.head.appendChild(s);
  }

  const api: Record<string, unknown> = {};
  for (const m of API_METHODS) {
    api[m] = (...args: unknown[]) => {
      queue.push([m, args]);
      // Subscribing is not a reason to fetch the widget; every other call is.
      if (m !== 'on') load();
      // `on` returns an unsubscribe; until the real widget is up, removing the
      // queued subscription is the honest equivalent.
      if (m === 'on') {
        const entry = queue[queue.length - 1];
        return () => {
          const i = queue.indexOf(entry!);
          if (i >= 0) queue.splice(i, 1);
        };
      }
      return undefined;
    };
  }
  w.vitrinaChatApi = api;

  for (const e of events) addEventListener(e, load, { capture: true, passive: true, once: true });

  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => number })
    .requestIdleCallback;
  if (typeof idle === 'function') {
    idle.call(window, () => timers.push(setTimeout(load, IDLE_EXTRA_MS)), { timeout: 3_000 });
  } else {
    timers.push(setTimeout(load, 1_000 + IDLE_EXTRA_MS));
  }

  const auto = w.vitrinaChat?.autoOpen;
  if (auto?.enabled === true) {
    const s = typeof auto.delaySeconds === 'number' && auto.delaySeconds > 0 ? auto.delaySeconds : 10;
    // Load a little before the timer is due so the widget is ready to open on time.
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    timers.push(setTimeout(load, Math.max(0, s * 1000 - now - 1_500)));
  }
})();

export {};
