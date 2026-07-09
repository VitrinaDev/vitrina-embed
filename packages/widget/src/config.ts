// Config resolution + the PRIVATE transport-layer types. The public surface in
// types.ts is FROZEN (contract); everything here is internal and free to evolve.

import type { WidgetConfig, WidgetLocale, WidgetTheme } from './types';

// --- Private transport DTOs (mirror vitrina-app/src/api/schemas/widget-chat.ts
//     and the `ok()` envelope in api/response.ts EXACTLY) --------------------

/** Browser-safe message row from GET /widget/messages (`.data.messages[]`). */
export interface WidgetMessageDto {
  id: string | number;
  createdAt: string;
  content: string;
  direction: 'inbound' | 'outbound';
  type: string | null;
}

/** `.data` of POST /widget/conversations. */
export interface BootstrapResult {
  visitorToken: string;
  conversationExternalId: string;
  expiresAt: string;
}

/** `.data` of POST /widget/messages (202). Byte-identical for honeypot/spam. */
export interface SendResult {
  status: 'accepted';
  visitorToken: string;
  conversationExternalId: string;
}

/** `.data` of GET /widget/messages. `conversation: null` + [] = empty session. */
export interface HistoryResult {
  messages: WidgetMessageDto[];
  conversation: { externalId: string } | null;
}

/** The universal `ok()` response envelope. */
export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// --- Resolved config --------------------------------------------------------

export interface ResolvedConfig {
  publicKey: string;
  /** Normalized: no trailing slash. Endpoints are `${apiBaseUrl}/widget/*`. */
  apiBaseUrl: string;
  vehicleId: string | null;
  locale: WidgetLocale;
  theme: Required<Pick<WidgetTheme, 'position'>> & WidgetTheme;
  welcomeMessage: string | null;
}

const INIT_ERROR = '[vitrina-widget] init() requires { publicKey, apiBaseUrl }.';

/** navigator.language heuristic → 'en' only when it clearly starts with 'en'. */
function detectLocale(): WidgetLocale {
  try {
    const lang = (globalThis.navigator?.language ?? '').toLowerCase();
    return lang.startsWith('en') ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

/**
 * Validate + normalize the public config into the internal shape. Throws the
 * SAME message as the original stub on a missing publicKey/apiBaseUrl (the only
 * hard failure — everything else has a sane default).
 */
export function resolveConfig(config: WidgetConfig): ResolvedConfig {
  if (!config?.publicKey || !config?.apiBaseUrl) {
    throw new Error(INIT_ERROR);
  }
  const apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const locale: WidgetLocale = config.locale ?? detectLocale();
  const theme = config.theme ?? {};
  return {
    publicKey: config.publicKey,
    apiBaseUrl,
    vehicleId: config.vehicleId ?? null,
    locale,
    theme: { ...theme, position: theme.position ?? 'br' },
    welcomeMessage: config.welcomeMessage ?? null,
  };
}
