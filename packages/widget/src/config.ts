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
  /**
   * The client id THIS browser minted for this message, echoed back by the
   * server. Present on inbound rows only. Lets a local echo be reconciled
   * against the row that eventually represents it — the POST answers 202 before
   * the row exists, so there is no server id to match on.
   *
   * Absent when talking to a server that predates the projection; the local
   * echo then simply never reconciles and lingers alongside the server row.
   * Not a concern in practice: the API is single-hosted and ships first.
   */
  clientMessageId?: string;
  /**
   * A vehicle card, on rows whose `type` is `stock_card`. The server projects
   * exactly these five fields — never the raw message metadata.
   *
   * The row's `content` always holds the AI's prose, so a widget that does not
   * recognise the type renders that instead. The card is an enhancement of a
   * message that already reads correctly without it.
   */
  stockCard?: {
    vehicleId: string;
    title: string;
    price: string | null;
    thumbnailUrl: string | null;
    listingUrl: string | null;
  };
}

/**
 * A message's LOCAL send lifecycle. Absent means "server truth" — the row came
 * back from GET /widget/messages and needs no annotation.
 *
 *   pending — submitted, the 202 has not come back yet
 *   failed  — the send did not reach the server; the visitor can retry
 *
 * `pending` clears on the 202, not on the row appearing: the 202 IS the
 * server's acceptance. The row lands later (the inbound dispatcher coalesces),
 * and until it does the local entry stays on screen as an ordinary bubble.
 */
export type MessageStatus = 'pending' | 'failed';

/**
 * What the widget keeps in its message list and hands to the UI: a server row,
 * or a local echo not yet reconciled with one. Local echoes are REAL ENTRIES,
 * never DOM artifacts — that is the whole point. A repaint rebuilds the list
 * from this array, so anything not in it is gone.
 */
export interface WidgetMessage extends WidgetMessageDto {
  status?: MessageStatus;
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

/**
 * A centered, anonymous system line in the transcript — "an advisor joined the
 * conversation". NOT a message: it has no author, no direction, and no server
 * row behind it.
 *
 * LIVE ONLY. It does not replay on reload, by design. Persisting it would mean
 * admitting `sender_type = 'system'` rows to the browser-safe DTO, which would
 * invert that strict allowlist from opt-in to opt-out (ADR 0035 ¶2). The line is
 * a courtesy, not history — and the visitor loses nothing on reload, because the
 * advisor's actual replies are still there.
 */
export interface WidgetNotice {
  /** Synthetic, namespaced so it can never collide with a message id. */
  id: string;
  /** ISO8601 — sorts the notice into the transcript where it happened. */
  at: string;
  kind: 'handoff_human';
}
