// @vitrinadev/widget — public entry.
//
// Two ways to embed:
//   1. NPM (storefront template):  import { init } from '@vitrinadev/widget'
//   2. <script> loader (any site):  see ./loader — reads window.vitrinaChat
//
// The widget renders a Shadow-DOM launcher (style-isolated from the host page)
// and an iframe conversation panel (PII/CSP-isolated). It speaks the Vitrina
// `web` channel protocol (ADR 0032): create/resume a conversation, POST
// messages, and subscribe to a visitor-scoped SSE stream for agent replies —
// all authenticated with the publishable widget key (ADR 0033).
//
// STATUS: scaffold. The transport client + UI land in W6, once the Core
// endpoints (W1–W4) exist. Until then init() is a no-op-safe stub so the
// storefront can wire against the final signature today.

import type { WidgetConfig, WidgetInstance } from './types';

export type { WidgetConfig, WidgetInstance, WidgetTheme, WidgetLocale } from './types';

export function init(config: WidgetConfig): WidgetInstance {
  if (!config?.publicKey || !config?.apiBaseUrl) {
    throw new Error(
      '[vitrina-widget] init() requires { publicKey, apiBaseUrl }.',
    );
  }
  // W6: mount launcher (Shadow DOM) + panel (iframe), open the transport.
  let vehicleId = config.vehicleId ?? null;
  return {
    open() {},
    close() {},
    setVehicle(id) {
      vehicleId = id;
    },
    destroy() {},
    // expose current target for tests until the real impl lands
    get _vehicleId() {
      return vehicleId;
    },
  } as WidgetInstance;
}

export default { init };
