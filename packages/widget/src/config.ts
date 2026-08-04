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
  /**
   * Attachment URLs on a media row (`type` image/file) — the photos an agent
   * sent with send_attachment. The server projects only http(s) URLs; the UI
   * validates again anyway (same belt-and-braces as the stock card) and skips
   * anything unusable. Absent on text rows and on servers that predate the
   * projection.
   */
  mediaUrls?: string[];
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

// --- Booking DTOs (mirror vitrina-app/src/api/schemas/widget-appointment.ts) --

/**
 * One candidate slot on the appointment ledger.
 *
 * `label` is the server's LOCAL wall-clock rendering ("2026-08-12 10:00") in the
 * dealership's timezone, and `labelLong` the long es-CL form. Both are load
 * bearing: they let the widget show the dealer's own clock without doing a
 * single timezone conversion in a browser that may be anywhere on earth.
 *
 * `available` arrives only with `?include_taken=1`, and only from a server new
 * enough to send it. ABSENT means "this list is available-only" — the widget
 * then renders no dimmed grid rather than inventing one.
 */
export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
  label: string;
  labelLong: string;
  available?: boolean;
}

/** `.data` of GET /widget/appointments/availability. */
export interface AvailabilityResult {
  configured: boolean;
  /** IANA zone of the dealership, or null when they have no schedule yet. */
  timezone: string | null;
  slots: AvailabilitySlot[];
  /**
   * Last instant the dealer's agenda reaches (`booking_horizon_days` from now).
   * ABSENT on an older server — the widget then never disables month navigation
   * and simply renders honest empty months.
   */
  horizonEnd?: string;
  bookingHorizonDays?: number;
}

/**
 * The browser-safe appointment projection — a strict server-side allowlist, not
 * the raw ledger row. `displayId` is the dealer's own `A-<n>` reference, which
 * is what they read back over the phone; the widget never invents another one.
 */
export interface WidgetAppointmentDto {
  displayId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  vehicleId: string | null;
  customerName: string;
  notes: string | null;
}

/**
 * `.data` of POST /widget/appointments (201).
 *
 * `managementToken` (`bkt_…`) is returned EXACTLY ONCE and is a capability: it
 * is the only thing that can read or cancel this booking. It is never logged,
 * never rendered, and never leaves the booking keyring.
 */
export interface BookingResult {
  appointment: WidgetAppointmentDto;
  managementToken: string;
}

/** Why the ledger refused a booking. Carried in `error.details.reason`. */
export type BookFailureReason =
  | 'blocked'
  | 'slot_taken'
  | 'vehicle_taken'
  | 'not_configured'
  | 'invalid';

// --- Resolved config --------------------------------------------------------

export interface ResolvedConfig {
  publicKey: string;
  /** Normalized: no trailing slash. Endpoints are `${apiBaseUrl}/widget/*`. */
  apiBaseUrl: string;
  vehicleId: string | null;
  /** Host-supplied vehicle title; null unless the page passed one. */
  vehicleLabel: string | null;
  locale: WidgetLocale;
  theme: Required<Pick<WidgetTheme, 'position'>> & WidgetTheme;
  welcomeMessage: string | null;
  /**
   * Whether this tenant takes bookings from the widget. SERVER-ONLY, and false
   * unless `GET /widget/config` said otherwise: a dealer's page cannot turn on
   * a feature their Vitrina tenant has not enabled, and the booking routes 404
   * (fail closed) when it is off. False ⇒ no chip and no booking code path is
   * reachable, which is exactly today's widget.
   */
  bookingEnabled: boolean;
}

/**
 * `.data` of `GET /widget/config` — the dealer's appearance, resolved
 * server-side from their own settings (Vitrina ADR 0046).
 *
 * Every field is optional and the server OMITS anything unset, which is the
 * whole contract: this object is layered UNDER the dealer's inline config, so a
 * present-but-empty key would silently clobber something they set by hand.
 */
export interface RemoteWidgetConfig {
  theme?: WidgetTheme;
  welcomeMessage?: string | null;
  locale?: WidgetLocale;
  /**
   * The tenant takes bookings from the widget (`webchat.booking_enabled`).
   *
   * Present ONLY as an explicit `true`, never as `false` — the DTO omits every
   * unset field, and this one is no exception. Absent therefore means "off",
   * which is also the default.
   */
  bookingEnabled?: true;
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
 * Drop `undefined` values so an explicitly-undefined inline key cannot win a
 * spread against a real server value. `{ accent: undefined }` is a perfectly
 * ordinary thing for a host app to produce (`accent: props.brandColor`), and it
 * means "I have nothing to say", not "blank it".
 */
function defined<T extends object>(source: T | undefined): Partial<T> {
  if (!source) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * True when the dealer pinned ANY appearance inline. Used to decide whether we
 * are relying on the server for the first paint (see index.ts): a site that
 * already says what it looks like must never be held back waiting for us.
 */
export function hasInlineAppearance(config: WidgetConfig): boolean {
  const theme = defined(config?.theme);
  return (
    Object.keys(theme).length > 0 ||
    config?.welcomeMessage !== undefined ||
    config?.locale !== undefined
  );
}

/**
 * Validate + normalize the public config into the internal shape. Throws the
 * SAME message as the original stub on a missing publicKey/apiBaseUrl (the only
 * hard failure — everything else has a sane default).
 *
 * `remote` is the server-resolved appearance (ADR 0046), layered UNDERNEATH the
 * dealer's inline config. INLINE WINS, and that ordering is the reason this can
 * ship at all: every widget installed before the endpoint existed carries a
 * fully-populated inline config, so none of them change appearance by a single
 * pixel. An inline value is an intentional per-site override; the server answer
 * is the default for everyone who did not write one.
 */
export function resolveConfig(
  config: WidgetConfig,
  remote?: RemoteWidgetConfig | null,
): ResolvedConfig {
  if (!config?.publicKey || !config?.apiBaseUrl) {
    throw new Error(INIT_ERROR);
  }
  const apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const locale: WidgetLocale =
    config.locale ?? remote?.locale ?? detectLocale();
  const theme = { ...defined(remote?.theme), ...defined(config.theme) };
  const welcome = config.welcomeMessage ?? remote?.welcomeMessage ?? null;
  return {
    publicKey: config.publicKey,
    apiBaseUrl,
    vehicleId: config.vehicleId ?? null,
    vehicleLabel: config.vehicleLabel ?? null,
    locale,
    theme: { ...theme, position: theme.position ?? 'br' },
    welcomeMessage: welcome,
    // Deliberately NOT layered with an inline override: a booking surface that
    // calls routes the tenant has switched off would only ever paint a 404.
    bookingEnabled: remote?.bookingEnabled === true,
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
