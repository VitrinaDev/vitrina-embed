// IIFE <script>-tag entry (tsup entry 2 -> dist/loader.global.js). The dealer
// sets `window.vitrinaChat` (a WidgetConfig) BEFORE this script tag; on load we
// read it and auto-init, stashing the handle on `window.vitrinaChatInstance` so
// the host page can drive open()/close()/setVehicle()/destroy() imperatively.
//
// Defensive: no-ops with a console.warn on a missing/invalid config, guards
// against a double-load (idempotent), and never throws into the host page.
//
// NOTE (W6 Stage A): init() is still the scaffold no-op stub — the real UI
// mount lands in Stage B. This loader wires the final control surface today.

import { init } from './index';
import type { WidgetConfig, WidgetInstance } from './types';

declare global {
  interface Window {
    vitrinaChat?: WidgetConfig;
    vitrinaChatInstance?: WidgetInstance;
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
    window.vitrinaChatInstance = init(config);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[vitrina-widget] init() failed:', err);
  }
})();

export {};
