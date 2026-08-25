// Config resolution + the PRIVATE transport-layer types. The public surface in
// types.ts is FROZEN (contract); everything here is internal and free to evolve.

import { resolveFont } from './fonts';
import { validateHttpUrl } from './theme';
import type {
  WidgetConfig,
  WidgetFont,
  WidgetHelpConfig,
  WidgetHomeCardsConfig,
  WidgetHomeConfig,
  WidgetLocale,
  WidgetTeamMemberConfig,
  WidgetTheme,
} from './types';

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

/** A sanitized FAQ pair, ready to paint. Both sides are non-blank. */
export interface Faq {
  q: string;
  a: string;
}

/** A sanitized team member. `avatarUrl` is either an http(s) href or null. */
export interface TeamMember {
  name: string;
  avatarUrl: string | null;
}

/**
 * The three quick-action cards, resolved. All false ⇒ nothing about the flows is
 * ever constructed: no cards, no overlay, no consignment code path.
 */
export interface ResolvedHomeCards {
  buy: boolean;
  sell: boolean;
  search: boolean;
}

/** The Home tab, resolved. `enabled` decides whether the tab bar exists at all. */
export interface ResolvedHome {
  enabled: boolean;
  /** null ⇒ the built-in, locale-driven greeting. */
  title: string | null;
  subtitle: string | null;
  /**
   * The quick-action gates, ABSENT when all three are off.
   *
   * Optional and omitted rather than always-present-and-false for the same
   * reason the remote coercion drops an empty bag: a tenant who has no quick
   * actions must resolve to the object 0.8.x resolved to, key for key. Absent is
   * read as all-off, through `resolveHomeCards`, everywhere it is consumed.
   */
  cards?: ResolvedHomeCards;
}

/** Read a possibly-absent `cards` bag as three hard booleans. */
export function resolveHomeCards(input: WidgetHomeCardsConfig | undefined): ResolvedHomeCards {
  return {
    buy: input?.buy === true,
    sell: input?.sell === true,
    search: input?.search === true,
  };
}

/**
 * The Help tab, resolved. `enabled` is re-derived client-side as
 * `flag && faqs.length > 0`: a tenant who switched Help on and then deleted
 * every question gets no tab rather than an empty one.
 */
export interface ResolvedHelp {
  enabled: boolean;
  faqs: Faq[];
}

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
   * The tenant's own name for the booking chip, or null for the built-in copy.
   * Already trimmed and length-checked — the UI paints it verbatim.
   */
  bookingLabel: string | null;
  /** Always a value this widget can render; unknown names collapse to 'system'. */
  font: WidgetFont;
  /**
   * Whether this tenant takes bookings from the widget. SERVER-ONLY, and false
   * unless `GET /widget/config` said otherwise: a dealer's page cannot turn on
   * a feature their Vitrina tenant has not enabled, and the booking routes 404
   * (fail closed) when it is off. False ⇒ no chip and no booking code path is
   * reachable, which is exactly today's widget.
   */
  bookingEnabled: boolean;
  /**
   * Turnstile site key for the booking confirm step, or null. SERVER-ONLY
   * like `bookingEnabled`, and for the same reason: a page must not be able
   * to switch the tenant's anti-bot armor off (nor invent a key the server
   * would not verify against).
   */
  turnstileSiteKey: string | null;
  /** The Home tab. `enabled: false` ⇒ nothing about it is ever constructed. */
  home: ResolvedHome;
  /** The Help tab. `enabled: false` ⇒ nothing about it is ever constructed. */
  help: ResolvedHelp;
  /** Faces for the Home hero. Empty ⇒ no avatar stack. */
  team: TeamMember[];
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
  /**
   * The tenant's own name for the booking chip ("Agendar demo").
   *
   * The wire type is `string | null` and null means "I have nothing to say" —
   * the server sends it explicitly rather than omitting the key. The coercion
   * drops null for exactly that reason, so an absent value and a null one are
   * the same thing here: fall back to the built-in copy.
   */
  bookingLabel?: string;
  /** The tenant's typeface. Absent (or unknown) ⇒ the system stack. */
  font?: WidgetFont;
  /**
   * The tenant's logo, hoisted out of `theme` — the shape the server sends.
   * Layered UNDER the same field passed inline, like everything else here.
   */
  logoUrl?: string;
  /**
   * The Home tab, server-owned. Merged FIELD-WISE under the inline `home`, so a
   * page that overrides the greeting still lets Vitrina decide whether the tab
   * exists.
   *
   * `home.cards` rides here too, and the server emits each key ONLY as an
   * explicit `true` — the vertical's defaults are resolved server-side, and the
   * widget just renders what arrives.
   */
  home?: WidgetHomeConfig;
  /** The Help tab (FAQ accordion), server-owned. Same field-wise merge. */
  help?: WidgetHelpConfig;
  /** Faces for the Home hero. An inline `team` replaces this list wholesale. */
  team?: WidgetTeamMemberConfig[];
  /**
   * Cloudflare Turnstile site key for the booking confirm step. SERVER-ONLY:
   * present exactly when the deployment will DEMAND a token on
   * `POST /widget/appointments` (it serves the key iff its secret is set), so
   * absent means "book tokenless, the server fails open" and present means
   * "render the challenge or every booking 400s".
   */
  turnstileSiteKey?: string;
}

const INIT_ERROR = '[vitrina-widget] init() requires { publicKey, apiBaseUrl }.';

/**
 * Longest booking label the chip can carry without wrapping into something that
 * no longer reads as a button. Beyond it we keep the built-in copy rather than
 * truncating: half of a dealer's sentence is worse than a coherent default.
 */
export const MAX_BOOKING_LABEL = 40;

/** Trim a tenant-supplied booking label, or null when it is unusable. */
export function normalizeBookingLabel(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (value === '' || value.length > MAX_BOOKING_LABEL) return null;
  return value;
}

// --- Home / Help / team sanitizers ------------------------------------------
//
// Every one of these runs TWICE — once on the wire (remote-config.ts, which is
// also the localStorage read path) and once here, over the merged object. They
// are pure and idempotent, so the second pass costs nothing and the widget can
// never paint a value that skipped the gate.
//
// The shape of the failure matters as much as the caps. A malformed FAQ entry
// drops ITSELF, not the list: a dealer with one bad row still gets the other
// nineteen answers on screen. A too-long title falls back to our copy rather
// than being truncated mid-sentence.

export const MAX_HOME_TITLE = 80;
export const MAX_HOME_SUBTITLE = 120;
export const MAX_FAQS = 20;
export const MAX_FAQ_Q = 200;
export const MAX_FAQ_A = 2000;
export const MAX_TEAM = 5;
export const MAX_TEAM_NAME = 40;

/** Trim to a bounded, non-blank string, or null. */
function boundedText(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (value === '' || value.length > max) return null;
  return value;
}

/** Greeting headline for the Home hero, or null for the built-in copy. */
export function normalizeHomeTitle(input: unknown): string | null {
  return boundedText(input, MAX_HOME_TITLE);
}

/** Line under the Home greeting, or null for the built-in copy. */
export function normalizeHomeSubtitle(input: unknown): string | null {
  return boundedText(input, MAX_HOME_SUBTITLE);
}

/**
 * Keep the usable FAQ pairs, in order, up to the cap. Anything that is not an
 * object with two non-blank, in-bounds strings is dropped on its own.
 */
export function normalizeFaqs(input: unknown): Faq[] {
  if (!Array.isArray(input)) return [];
  const out: Faq[] = [];
  for (const raw of input) {
    if (out.length >= MAX_FAQS) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const q = boundedText(item.q, MAX_FAQ_Q);
    const a = boundedText(item.a, MAX_FAQ_A);
    if (q === null || a === null) continue;
    out.push({ q, a });
  }
  return out;
}

/**
 * Keep the usable team members, in order, up to the cap. An avatar URL that is
 * not absolute http(s) becomes null — which the UI renders as initials, never
 * as a broken image.
 */
export function normalizeTeam(input: unknown): TeamMember[] {
  if (!Array.isArray(input)) return [];
  const out: TeamMember[] = [];
  for (const raw of input) {
    if (out.length >= MAX_TEAM) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const name = boundedText(item.name, MAX_TEAM_NAME);
    if (name === null) continue;
    out.push({ name, avatarUrl: validateHttpUrl(item.avatarUrl as string | null | undefined) });
  }
  return out;
}

/**
 * The Home tab, resolved from an already-merged object. `enabled` is opt-IN:
 * only an explicit `true` builds the tab bar, so a server that starts sending
 * `home: {}` tomorrow cannot restructure a live widget.
 */
export function resolveHome(input: WidgetHomeConfig | undefined): ResolvedHome {
  const home: ResolvedHome = {
    enabled: input?.enabled === true,
    title: normalizeHomeTitle(input?.title),
    subtitle: normalizeHomeSubtitle(input?.subtitle),
  };
  // Opt-IN per card, on the same terms as `enabled`: a server that starts
  // sending `cards: {}` tomorrow cannot conjure a form onto a live widget. The
  // key is added only when a card is actually on, so a tenant without them
  // resolves to exactly the object 0.8.x resolved to.
  const cards = resolveHomeCards(input?.cards);
  if (cards.buy || cards.sell || cards.search) home.cards = cards;
  return home;
}

/** The Help tab, resolved. Enabled means the flag AND at least one usable FAQ. */
export function resolveHelp(input: WidgetHelpConfig | undefined): ResolvedHelp {
  const faqs = normalizeFaqs(input?.faqs);
  return { enabled: input?.enabled === true && faqs.length > 0, faqs };
}

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
    config?.locale !== undefined ||
    config?.bookingLabel !== undefined ||
    config?.font !== undefined ||
    config?.logoUrl !== undefined
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
  // The logo has TWO spellings: `theme.logoUrl` (where it has always lived) and
  // the top-level `logoUrl` the server sends. Same slot, same sanitizer — the
  // top-level one simply wins WITHIN each tier, and inline still beats remote.
  const logoUrl =
    config.logoUrl ?? config.theme?.logoUrl ?? remote?.logoUrl ?? remote?.theme?.logoUrl;
  // Home and Help merge FIELD-WISE, exactly like `theme`: inline `home.title`
  // beats the server's, and the server's `home.enabled` still applies when the
  // page said nothing about it. `team` is an array and merges wholesale —
  // interleaving two rosters would produce a team that does not exist.
  const home: WidgetHomeConfig = { ...defined(remote?.home), ...defined(config.home) };
  // `cards` is a nested bag, so the field-wise rule has to reach INTO it: a page
  // that pins `cards: { sell: true }` must not blank the two cards the server
  // turned on. Spreading `home` alone would have replaced the whole object.
  home.cards = { ...defined(remote?.home?.cards), ...defined(config.home?.cards) };
  const help = { ...defined(remote?.help), ...defined(config.help) };
  return {
    publicKey: config.publicKey,
    apiBaseUrl,
    vehicleId: config.vehicleId ?? null,
    vehicleLabel: config.vehicleLabel ?? null,
    locale,
    theme: {
      ...theme,
      position: theme.position ?? 'br',
      ...(logoUrl !== undefined ? { logoUrl } : {}),
    },
    welcomeMessage: welcome,
    bookingLabel: normalizeBookingLabel(config.bookingLabel ?? remote?.bookingLabel),
    font: resolveFont(config.font ?? remote?.font),
    // Deliberately NOT layered with an inline override: a booking surface that
    // calls routes the tenant has switched off would only ever paint a 404.
    bookingEnabled: remote?.bookingEnabled === true,
    turnstileSiteKey:
      typeof remote?.turnstileSiteKey === 'string' && remote.turnstileSiteKey !== ''
        ? remote.turnstileSiteKey
        : null,
    home: resolveHome(home),
    help: resolveHelp(help),
    team: normalizeTeam(config.team ?? remote?.team),
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
