// IIFE <script>-tag entry (tsup entry 2 -> dist/loader.global.js). The dealer
// sets `window.vitrinaChat` (a WidgetConfig) BEFORE this script tag; on load we
// read it and auto-init, stashing the handle on `window.vitrinaChatInstance` so
// the host page can drive open()/close()/setVehicle()/destroy() imperatively.
//
// Defensive: no-ops with a console.warn on a missing/invalid config, guards
// against a double-load (idempotent), and never throws into the host page.

import { init } from './index';
import type { WidgetConfig, WidgetInstance } from './types';

declare global {
  interface Window {
    vitrinaChat?: WidgetConfig;
    vitrinaChatInstance?: WidgetInstance;
    /** Calls queued by the lazy boot stub (./boot) before this bundle loaded. */
    vitrinaChatQueue?: [string, unknown[]][];
    /** The public handle: the boot stub's queue proxy, then the live instance. */
    vitrinaChatApi?: unknown;
  }
}

(function autoInit(): void {
  if (typeof window === 'undefined') return;
  // Idempotent: a second copy of the script must not double-mount.
  if (window.vitrinaChatInstance) return;

  const config = window.vitrinaChat;
  if (!config || typeof config !== 'object' || !config.publicKey || !config.apiBaseUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      '[vitrina-widget] window.vitrinaChat must be set with { publicKey, apiBaseUrl } before the loader script; skipping.',
    );
    return;
  }

  try {
    const instance = init(config);
    window.vitrinaChatInstance = instance;
    window.vitrinaChatApi = instance;
    drainQueue(instance);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[vitrina-widget] init() failed:', err);
  }
})();

/**
 * Replay what the host asked of the boot stub, in order. One bad call (an
 * unknown method, a throwing handler) is skipped, never fatal.
 */
function drainQueue(instance: WidgetInstance): void {
  const queue = window.vitrinaChatQueue;
  if (!Array.isArray(queue)) return;
  const calls = queue.splice(0, queue.length);
  for (const call of calls) {
    try {
      const [method, args] = call;
      const fn = (instance as unknown as Record<string, unknown>)[method];
      if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown).apply(instance, args);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[vitrina-widget] queued call failed:', err);
    }
  }
}

export {};
