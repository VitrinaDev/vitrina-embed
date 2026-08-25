// VitrinaTransport — the SOLE owner of the /widget contract. DOM-free, pure I/O,
// unit-testable in isolation. Every method catches network/HTTP errors and
// returns a typed result; NOTHING throws to the UI (AC#4).
//
// Contract (vitrina-app/src/routes/api/v1/widget.ts + api/schemas/widget-chat.ts):
//   POST /widget/conversations  body {}          -> {data:{visitorToken,conversationExternalId,expiresAt}}
//   POST /widget/messages       snake_case body  -> 202 {data:{status,visitorToken,conversationExternalId}}
//   GET  /widget/messages?since=<ISO>            -> {data:{messages[],conversation|null}}
//   GET  /widget/stream         SSE (fetch-read) -> invalidation pokes (no text)
//
// Booking (api/schemas/widget-appointment.ts), gated per tenant — every route
// 404s when the tenant has bookings off, which is why nothing here is fatal:
//   GET    /widget/appointments/availability?from&to  -> {data:{configured,timezone,slots}}
//   POST   /widget/appointments   snake_case body     -> 201 {data:{appointment,managementToken}}
//   GET    /widget/appointments/:token                -> {data:<appointment>}
//   DELETE /widget/appointments/:token                -> {data:<cancelled appointment>}
//
// Consignment intake (0.9.0), the one MULTIPART route — the visitor's photos
// ride with the fields, so the browser sets Content-Type and its boundary:
//   POST /widget/consignments   multipart/form-data  -> 201 received / 200 duplicate
//
// Auth on EVERY call: Authorization: Bearer <pk_...>. Visitor-scoped calls add
// X-Vitrina-Visitor: <vt_...>. NEVER credentials:'include' and NEVER any header
// outside the fixed CORS allow-list (Authorization, Content-Type, X-Vitrina-Visitor)
// — booking needs no new header, which is the reason it fits on this pipeline.

import type {
  AvailabilityResult,
  AvailabilitySlot,
  BookFailureReason,
  BookingResult,
  BootstrapResult,
  HistoryResult,
  RemoteWidgetConfig,
  SendResult,
  WidgetAppointmentDto,
  WidgetMessage,
  WidgetMessageDto,
} from './config';
import { coerceRemoteConfig } from './remote-config';
import type { TokenStore } from './token-store';

export type { WidgetMessage, WidgetMessageDto, MessageStatus } from './config';
export type {
  AvailabilityResult,
  AvailabilitySlot,
  BookFailureReason,
  BookingResult,
  WidgetAppointmentDto,
} from './config';

/** Input to send(): the visitor's message + optional identity/idempotency. */
export interface SendInput {
  message: string;
  name?: string;
  email?: string;
  phone?: string;
  clientMessageId?: string;
  /** Hidden honeypot value. Always sent (empty string for a real human). */
  honeypot?: string;
  /**
   * The vehicle the visitor is looking at, as an opaque id from the dealer's
   * public /stock. The webchat ingress persists it onto the inbound message's
   * metadata, so the dealer inbox shows which listing was being asked about.
   * There is no round-trip: it never comes back on the read DTO.
   */
  vehicleId?: string | null;
}

export type SendOutcome = SendResult | { error: true; status: number | null };

/**
 * What the ledger did with a consignment intake.
 *
 *   received  — a new row was written (201)
 *   duplicate — this car is already on the ledger (200); the visitor's ask is
 *               satisfied either way, so the UI treats it as a success
 */
export type ConsignmentStatus = 'received' | 'duplicate';

/**
 * Why an intake did not land.
 *
 *   photos  — 415: the server would not take one of the files
 *   invalid — any other refusal; retryable, and the form is preserved
 *   network — the request never reached anyone
 */
export type ConsignmentFailure = 'photos' | 'invalid' | 'network';

export type ConsignmentOutcome =
  | { ok: true; status: ConsignmentStatus }
  | { ok: false; reason: ConsignmentFailure };

/**
 * The result of a history read. DISCRIMINATED, and that is the whole point: the
 * old signature returned `[]` on every failure, so a 500 was indistinguishable
 * from an empty conversation. The caller repainted from an empty list while
 * reporting success — which is exactly how a visitor's own message vanished off
 * their screen. A caller must now decide what to do about `ok: false`, and the
 * only correct answer is "do not repaint".
 */
export type HistoryOutcome =
  | { ok: true; messages: WidgetMessageDto[] }
  | { ok: false; status: number | null };

/** A parsed SSE frame (comment-only frames are dropped before this). */
export interface SseFrame {
  event?: string;
  data?: string;
  id?: string;
  retry?: number;
}

/**
 * The realtime stream's connection state, as the UI needs to understand it.
 *
 *   connecting    — the first attempt is in flight; nothing to tell the visitor
 *   open          — connected and listening
 *   reconnecting  — the stream dropped and a backoff is running
 *
 * The transport has always KNOWN all three: it has a full backoff loop with
 * jitter, a re-mint-on-401 path, and a longer backoff on rate limiting. It just
 * never told anyone, so a visitor waiting on a reply could not distinguish a
 * recovering connection from a dealership ignoring them.
 */
export type StreamState = 'connecting' | 'open' | 'reconnecting';

export interface StreamHandlers {
  /** Something changed server-side; refetch history from `cursor`. */
  onInvalidation(cursor?: string): void;
  /** Connection state transitions. Fires only on CHANGE, never repeated. */
  onState?(state: StreamState): void;
  /**
   * Someone on the dealer's side is composing a reply. AUTHORLESS: the event
   * carries no name and no bot-vs-human flag, and the widget must not invent
   * one. `ttlMs` is how long the indicator may stay up without a further event,
   * so a producer that crashes cannot leave a permanent lie on screen.
   */
  onTyping?(ttlMs: number): void;
  /**
   * The conversation moved between the AI and a person. `to: 'human'` means
   * someone joined. ANONYMOUS: there is no name here and there never will be.
   */
  onHandoff?(to: 'human' | 'bot'): void;
}

/** Fallback when a typing event arrives with a missing or absurd TTL. */
const DEFAULT_TYPING_TTL_MS = 6_000;
const MAX_TYPING_TTL_MS = 30_000;

/** Parse an SSE `data:` payload without ever throwing on garbage. */
function parseEventData(data: string | undefined): Record<string, unknown> | null {
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Ok<T> = { ok: true; data: T };
/**
 * `reason` is populated ONLY for calls that opt into reading the error body
 * (booking). It is the ledger's machine-readable refusal from
 * `error.details.reason` — never the free-text English message, which is not a
 * contract and must never be string-matched.
 */
type Fail = { ok: false; status: number | null; reason?: BookFailureReason };
type CallResult<T> = Ok<T> | Fail;

/** The never-throw envelope every transport method answers with. */
export type TransportResult<T> = CallResult<T>;

const BOOK_FAILURE_REASONS: readonly string[] = [
  'blocked',
  'slot_taken',
  'vehicle_taken',
  'not_configured',
  'invalid',
];

/** Pull `error.details.reason` out of a refusal body, or undefined. */
function refusalReason(json: unknown): BookFailureReason | undefined {
  const err = (json as { error?: { details?: { reason?: unknown } } } | null)?.error;
  const reason = err?.details?.reason;
  return typeof reason === 'string' && BOOK_FAILURE_REASONS.includes(reason)
    ? (reason as BookFailureReason)
    : undefined;
}

/** Coerce one wire slot, dropping anything without a usable time range. */
function coerceSlot(input: unknown): AvailabilitySlot | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.startsAt !== 'string' || typeof raw.endsAt !== 'string') return null;
  const slot: AvailabilitySlot = {
    startsAt: raw.startsAt,
    endsAt: raw.endsAt,
    label: typeof raw.label === 'string' ? raw.label : '',
    labelLong: typeof raw.labelLong === 'string' ? raw.labelLong : '',
  };
  // ABSENT stays absent: it is how the widget knows the server did not answer
  // the include_taken question, and therefore must not paint a dimmed grid.
  if (typeof raw.available === 'boolean') slot.available = raw.available;
  return slot;
}

/** Coerce one wire appointment, or null when the shape is unusable. */
function coerceAppointment(input: unknown): WidgetAppointmentDto | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.displayId !== 'string' || typeof raw.startsAt !== 'string') return null;
  return {
    displayId: raw.displayId,
    status: typeof raw.status === 'string' ? raw.status : 'scheduled',
    startsAt: raw.startsAt,
    endsAt: typeof raw.endsAt === 'string' ? raw.endsAt : raw.startsAt,
    vehicleId: typeof raw.vehicleId === 'string' ? raw.vehicleId : null,
    customerName: typeof raw.customerName === 'string' ? raw.customerName : '',
    notes: typeof raw.notes === 'string' ? raw.notes : null,
  };
}

/**
 * Parse ONE raw SSE frame (the text between `\n\n` boundaries) into its fields.
 * Returns null for a pure-comment frame (`: connected`, `: ping`) so the caller
 * ignores liveness noise. Follows the SSE line grammar: `field: value`, a
 * leading space after the colon is stripped, `data` lines concatenate with `\n`,
 * unknown fields are ignored.
 */
export function parseSseFrame(raw: string): SseFrame | null {
  const lines = raw.split('\n');
  let event: string | undefined;
  let data: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  let sawField = false;

  for (const line of lines) {
    if (line === '') continue;
    // Comment line (starts with ':') — `: connected` / `: ping` heartbeats.
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event':
        event = value;
        sawField = true;
        break;
      case 'data':
        data = data === undefined ? value : `${data}\n${value}`;
        sawField = true;
        break;
      case 'id':
        id = value;
        sawField = true;
        break;
      case 'retry': {
        const n = Number(value);
        if (Number.isFinite(n)) retry = n;
        sawField = true;
        break;
      }
      default:
        // Unknown field — ignore per SSE spec.
        break;
    }
  }
  if (!sawField) return null;
  return { event, data, id, retry };
}

/**
 * Synthetic id for a LOCAL echo — a message the visitor has sent that no server
 * row represents yet. Namespaced so it can never collide with a server id, and
 * derived from the client message id so the entry is addressable for a status
 * update or a retry without an extra index.
 */
const LOCAL_ID_PREFIX = 'local:';

export const localIdFor = (clientMessageId: string): string =>
  `${LOCAL_ID_PREFIX}${clientMessageId}`;

export const isLocalId = (id: string | number): boolean =>
  typeof id === 'string' && id.startsWith(LOCAL_ID_PREFIX);

/**
 * Merge server rows into the widget's message list.
 *
 * Two reconciliation rules, in order:
 *
 *  1. A server row that carries a `clientMessageId` SUPERSEDES the local echo
 *     with that id — the echo is removed and the row takes its place. This is
 *     the only way to match them: POST /widget/messages answers 202 before the
 *     row exists, so the browser never learns the server id, and matching on
 *     content would break the moment a visitor sends "hola" twice.
 *  2. Everything else dedupes strictly by id, incoming winning. That absorbs
 *     the INCLUSIVE `since` boundary row and the publish-before-persist race.
 *
 * A local echo that matches nothing STAYS. It is not a rendering artifact to be
 * swept up; it is a message the visitor sent, and it remains on screen until a
 * server row claims it. Server rows never carry a local `status`.
 */
export function mergeMessages(
  existing: WidgetMessage[],
  incoming: WidgetMessageDto[],
): WidgetMessage[] {
  const byId = new Map<string, WidgetMessage>();
  for (const m of existing) byId.set(String(m.id), m);
  for (const row of incoming) {
    // Rule 1: the row supersedes its own local echo.
    if (row.clientMessageId) byId.delete(localIdFor(row.clientMessageId));
    // Rule 2: server truth, with any local status stripped.
    const { ...serverRow } = row;
    byId.set(String(row.id), serverRow);
  }
  const merged = [...byId.values()];
  merged.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
  return merged;
}

/**
 * The newest SERVER `createdAt` — the widget's `since` cursor. Local echoes are
 * excluded on purpose: their timestamp comes from the visitor's clock, and a
 * clock running fast would push the cursor past messages the server has not
 * handed us yet, which the next catch-up read would then skip forever.
 */
export function latestServerCursor(
  messages: WidgetMessage[],
): string | undefined {
  let max: string | undefined;
  for (const m of messages) {
    if (isLocalId(m.id)) continue;
    if (typeof m.createdAt === 'string' && (max === undefined || m.createdAt > max)) {
      max = m.createdAt;
    }
  }
  return max;
}

export interface TransportConfig {
  apiBaseUrl: string;
  publicKey: string;
}

export class VitrinaTransport {
  private readonly apiBaseUrl: string;
  private readonly publicKey: string;
  private readonly tokens: TokenStore;

  constructor(cfg: TransportConfig, tokens: TokenStore) {
    this.apiBaseUrl = cfg.apiBaseUrl;
    this.publicKey = cfg.publicKey;
    this.tokens = tokens;
  }

  /**
   * The ONLY headers we ever send: Authorization (always), Content-Type (POST
   * only), X-Vitrina-Visitor (visitor-scoped calls, when a token is held). Any
   * other header would fail the fixed CORS preflight allow-list.
   */
  private authHeaders(opts: { withVisitor: boolean; json: boolean }): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.publicKey}`,
    };
    if (opts.json) headers['Content-Type'] = 'application/json';
    if (opts.withVisitor) {
      const token = this.tokens.get();
      if (token) headers['X-Vitrina-Visitor'] = token;
    }
    return headers;
  }

  /**
   * Build a /widget/* URL carrying `?siteKey=<pk_>` alongside the Authorization
   * bearer.
   *
   * Every call below is a non-simple cross-origin request (custom headers +
   * JSON content-type), so the browser fires a CORS preflight first — and a
   * preflight sends NO Authorization header (Fetch spec). The server can
   * therefore only learn WHICH key is calling, and hence which origins it may
   * admit, from the query string. Omit this and the preflight is denied, the
   * browser never sends the real request, and the widget is dead on every
   * cross-origin site.
   *
   * Putting the key in the URL leaks nothing: `pk_` is a PUBLISHABLE key that
   * already sits in this page's HTML source. Its security is the server-side
   * origin lock (requirePublishableOrigin), never secrecy.
   */
  private url(path: string): string {
    const sep = path.includes('?') ? '&' : '?';
    return `${this.apiBaseUrl}${path}${sep}siteKey=${encodeURIComponent(this.publicKey)}`;
  }

  /**
   * Single fetch primitive. Unwraps the `ok()` envelope's `.data`. Never throws:
   * a network exception → {ok:false,status:null}; a non-2xx → {ok:false,status};
   * a JSON parse failure → {ok:false,status}. NO credentials:'include'.
   *
   * `captureError` additionally reads the refusal body for its machine-readable
   * `details.reason`. Off by default — reading a body we are going to discard is
   * pointless work on every ordinary failure, and only booking has a refusal the
   * visitor needs different words for.
   */
  private async call<T>(
    path: string,
    opts: {
      method: 'GET' | 'POST' | 'DELETE';
      body?: string;
      withVisitor: boolean;
      captureError?: boolean;
    },
  ): Promise<CallResult<T>> {
    const headers = this.authHeaders({
      withVisitor: opts.withVisitor,
      // DELETE carries no body, so it carries no Content-Type either — one
      // fewer header for the preflight allow-list to have to admit.
      json: opts.method === 'POST',
    });
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method: opts.method,
        headers,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
      });
    } catch {
      return { ok: false, status: null };
    }
    if (!res.ok) {
      if (opts.captureError) {
        try {
          const reason = refusalReason(await res.json());
          if (reason) return { ok: false, status: res.status, reason };
        } catch {
          /* no body, or not JSON — the status is all we get */
        }
      }
      return { ok: false, status: res.status };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, status: res.status };
    }
    const data = (json as { data?: T } | null)?.data;
    return { ok: true, data: data as T };
  }

  /**
   * Bootstrap/resume the visitor session. Presents the held token (if any) so
   * the server SLIDES it. On a present-stale-token 401 (verifyPresentedVisitor
   * throws), clear it and mint a FRESH session once. Persists the returned
   * token. Returns null on total failure (no throw).
   */
  async bootstrap(): Promise<BootstrapResult | null> {
    const hadToken = !!this.tokens.get();
    const res = await this.call<BootstrapResult>('/widget/conversations', {
      method: 'POST',
      body: '{}',
      withVisitor: true,
    });
    if (res.ok && res.data?.visitorToken) {
      this.tokens.set(res.data.visitorToken);
      return res.data;
    }
    if (!res.ok && res.status === 401 && hadToken) {
      return this.freshBootstrap();
    }
    return null;
  }

  /**
   * Re-bootstrap WITHOUT the X-Vitrina-Visitor header. Presenting the stale
   * token would 401 again, so we CLEAR it first and let the server mint a new
   * visitor identity — a bounded, single-attempt recovery that accepts the
   * new-conversation reset (review requirement).
   */
  private async freshBootstrap(): Promise<BootstrapResult | null> {
    this.tokens.clear();
    const res = await this.call<BootstrapResult>('/widget/conversations', {
      method: 'POST',
      body: '{}',
      withVisitor: false,
    });
    if (res.ok && res.data?.visitorToken) {
      this.tokens.set(res.data.visitorToken);
      return res.data;
    }
    return null;
  }

  /**
   * Fetch the dealer's server-resolved appearance (Vitrina ADR 0046).
   *
   * FAILS OPEN, always: a network error, a 4xx from an older API that has no
   * such route, a garbage body — all return `null`, and the caller keeps the
   * inline/default theme it already painted with. A dealer's chat widget must
   * never be worse off for our having asked a cosmetic question.
   *
   * Carries no visitor token: the launcher needs its colour before the visitor
   * has any identity at all, and the payload is public branding that already
   * sits in the page around it.
   */
  async fetchConfig(): Promise<RemoteWidgetConfig | null> {
    const res = await this.call<unknown>('/widget/config', {
      method: 'GET',
      withVisitor: false,
    });
    if (!res.ok) return null;
    return coerceRemoteConfig(res.data);
  }

  /**
   * Post an inbound message. Body is PURE snake_case — no camelCase leakage.
   * hp_website is ALWAYS present (empty for a human). On 401, re-bootstrap once
   * and retry a single time. Re-persists any rotated token. Returns a typed
   * outcome; never throws.
   */
  async send(input: SendInput): Promise<SendOutcome> {
    const body: Record<string, unknown> = {
      message: input.message,
      hp_website: input.honeypot ?? '',
    };
    if (input.name) body.name = input.name;
    if (input.email) body.email = input.email;
    if (input.phone) body.phone = input.phone;
    if (input.clientMessageId) body.client_message_id = input.clientMessageId;
    // Persisted onto the inbound row's metadata by the webchat ingress.
    if (input.vehicleId) body.vehicle_id = input.vehicleId;
    const payload = JSON.stringify(body);

    let res = await this.call<SendResult>('/widget/messages', {
      method: 'POST',
      body: payload,
      withVisitor: true,
    });
    if (!res.ok && res.status === 401) {
      const boot = await this.freshBootstrap();
      if (boot) {
        res = await this.call<SendResult>('/widget/messages', {
          method: 'POST',
          body: payload,
          withVisitor: true,
        });
      }
    }
    if (res.ok) {
      if (res.data?.visitorToken) this.tokens.set(res.data.visitorToken);
      return res.data;
    }
    return { error: true, status: res.status };
  }

  /**
   * Read-my-history — the AUTHORITATIVE data path. `since` MUST be ISO8601
   * (widgetMessagesQuerySchema is z.string().datetime() — a message id would
   * 400); the INCLUSIVE gte re-returns the boundary row, so the caller dedupes
   * by id. Retries once through a re-bootstrap on 401.
   *
   * Returns a DISCRIMINATED outcome. `{ok:true, messages:[]}` is an empty
   * session; `{ok:false}` is a failure. These used to be the same value — a
   * bare `[]` — and the caller repainted the panel from it, erasing whatever
   * the visitor had on screen. Never conflate them again.
   */
  async fetchHistory(since?: string): Promise<HistoryOutcome> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    const path = `/widget/messages${qs}`;
    let res = await this.call<HistoryResult>(path, {
      method: 'GET',
      withVisitor: true,
    });
    if (!res.ok && res.status === 401) {
      const boot = await this.freshBootstrap();
      if (boot) {
        res = await this.call<HistoryResult>(path, {
          method: 'GET',
          withVisitor: true,
        });
      }
    }
    if (res.ok) return { ok: true, messages: res.data?.messages ?? [] };
    return { ok: false, status: res.status };
  }

  // --- Consignment intake (0.9.0) -------------------------------------------

  /**
   * Post the "vender tu auto" intake to `POST /widget/consignments`.
   *
   * THE ONLY MULTIPART CALL IN THIS FILE, and the reason it does not go through
   * `call()`: the visitor's photos ride with the fields, so the body is a
   * FormData and the browser — not us — has to set `Content-Type`, because only
   * it knows the multipart boundary. Setting the header by hand produces a body
   * the server cannot parse, which is why `authHeaders({ json: false })` is
   * load-bearing here rather than a detail.
   *
   * Everything else is the same pipeline as every other call: `Authorization:
   * Bearer pk_`, `?siteKey=` for the preflight, no visitor token (an intake is
   * not visitor-scoped — it is authorised by the key plus the origin lock), no
   * credentials, and never a throw.
   *
   * 201 and 200 are BOTH successes: a duplicate means the dealer already has
   * this car, which is the visitor's ask satisfied, not an error to show them.
   */
  async submitConsignment(
    fields: Record<string, string>,
    photos: File[],
  ): Promise<ConsignmentOutcome> {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    // One repeated field rather than fotos[0], fotos[1]…: it is what a multipart
    // parser reads back as a list without anyone agreeing on an index syntax.
    for (const photo of photos) body.append('fotos', photo);

    let res: Response;
    try {
      res = await fetch(this.url('/widget/consignments'), {
        method: 'POST',
        headers: this.authHeaders({ withVisitor: false, json: false }),
        body,
      });
    } catch {
      return { ok: false, reason: 'network' };
    }
    if (res.status === 415) return { ok: false, reason: 'photos' };
    if (!res.ok) return { ok: false, reason: 'invalid' };
    // The status code already says which it was; the body is read only in case
    // a server answers 200 for a fresh row and names the outcome itself.
    let status: ConsignmentStatus = res.status === 200 ? 'duplicate' : 'received';
    try {
      const json = (await res.json()) as { data?: { status?: unknown } } | null;
      const said = json?.data?.status;
      if (said === 'duplicate' || said === 'received') status = said;
    } catch {
      /* no body, or not JSON — the status code is all we get, and it is enough */
    }
    return { ok: true, status };
  }

  // --- Booking (S15-21) -----------------------------------------------------
  //
  // None of these carry X-Vitrina-Visitor and none of them retry through
  // freshBootstrap. A booking is NOT visitor-scoped: it is authorised by the
  // publishable key plus the origin lock, and it deliberately has no
  // conversation, lead or contact behind it — booking without ever writing a
  // message is the entire feature. Coupling them to the visitor session would
  // invent a dependency the server does not have, and a 401 here means the key
  // or origin is wrong, which re-minting a visitor token cannot fix.

  /**
   * Open slots in a window. `from`/`to` are ISO8601 WITH OFFSET; the server
   * silently clamps `to` to the dealer's booking horizon, so asking for a month
   * beyond it is honest rather than an error.
   *
   * `includeTaken` asks for the unavailable candidates too, so the grid can show
   * a taken hour dimmed instead of making the agenda look emptier than it is.
   * An older server ignores the parameter and answers available-only — which the
   * caller detects by `available` being absent, not by a version check.
   */
  async fetchAvailability(params: {
    from: string;
    to: string;
    vehicleId?: string | null;
    includeTaken?: boolean;
  }): Promise<CallResult<AvailabilityResult>> {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    if (params.vehicleId) qs.set('vehicle_id', params.vehicleId);
    if (params.includeTaken) qs.set('include_taken', '1');
    const res = await this.call<unknown>(
      `/widget/appointments/availability?${qs.toString()}`,
      { method: 'GET', withVisitor: false },
    );
    if (!res.ok) return res;
    const raw = (res.data ?? {}) as Record<string, unknown>;
    const out: AvailabilityResult = {
      configured: raw.configured === true,
      timezone: typeof raw.timezone === 'string' ? raw.timezone : null,
      slots: Array.isArray(raw.slots)
        ? raw.slots.map(coerceSlot).filter((s): s is AvailabilitySlot => s !== null)
        : [],
    };
    // Accept either casing. The chat DTOs are camelCase, but this pair is a
    // late addition to a schedule engine that speaks snake_case internally, and
    // a widget that guesses wrong would silently lose the horizon and re-enable
    // navigation into months it cannot answer for.
    const horizonEnd = raw.horizonEnd ?? raw.horizon_end;
    if (typeof horizonEnd === 'string') out.horizonEnd = horizonEnd;
    const days = raw.bookingHorizonDays ?? raw.booking_horizon_days;
    if (typeof days === 'number' && Number.isFinite(days)) out.bookingHorizonDays = days;
    return { ok: true, data: out };
  }

  /**
   * Book the tenant's default test-drive slot. `consent: true` is ALWAYS sent —
   * the visitor ticked a box on a public form collecting a Chilean phone number,
   * and a decorative checkbox would be worse than no checkbox.
   *
   * A refusal is a 400 carrying `details.reason`; the caller branches on that
   * and never on the message.
   */
  async bookAppointment(input: {
    startsAt: string;
    endsAt: string;
    name: string;
    phone?: string;
    email?: string;
    vehicleId?: string | null;
    notes?: string;
    /** Cloudflare Turnstile token; omitted when the tenant's config carries
     *  no site key (the server then fails open — or 400s, its call). */
    turnstileToken?: string;
  }): Promise<CallResult<BookingResult>> {
    const body: Record<string, unknown> = {
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      name: input.name,
      consent: true,
    };
    if (input.phone) body.phone = input.phone;
    if (input.email) body.email = input.email;
    if (input.vehicleId) body.vehicle_id = input.vehicleId;
    if (input.notes) body.notes = input.notes;
    if (input.turnstileToken) body.turnstile_token = input.turnstileToken;

    const res = await this.call<unknown>('/widget/appointments', {
      method: 'POST',
      body: JSON.stringify(body),
      withVisitor: false,
      captureError: true,
    });
    if (!res.ok) return res;
    const raw = (res.data ?? {}) as Record<string, unknown>;
    const appointment = coerceAppointment(raw.appointment);
    const token = raw.managementToken;
    if (!appointment || typeof token !== 'string' || token === '') {
      // A 201 we cannot read is a failure, not a booking. Reporting success
      // here would tell the visitor their visit is confirmed while dropping the
      // only token that could ever cancel it.
      return { ok: false, status: 201 };
    }
    return { ok: true, data: { appointment, managementToken: token } };
  }

  /**
   * Read one booking back by its management token. 404 is the ONLY miss signal
   * (unknown token, wrong tenant, too-short string) — there is no enumeration
   * oracle here, and the caller uses it to drop a dead key from its keyring.
   */
  async fetchBooking(token: string): Promise<CallResult<WidgetAppointmentDto>> {
    const res = await this.call<unknown>(
      `/widget/appointments/${encodeURIComponent(token)}`,
      { method: 'GET', withVisitor: false },
    );
    if (!res.ok) return res;
    const appointment = coerceAppointment(res.data);
    return appointment ? { ok: true, data: appointment } : { ok: false, status: 200 };
  }

  /** Cancel a booking. Idempotent server-side; answers the cancelled DTO. */
  async cancelBooking(token: string): Promise<CallResult<WidgetAppointmentDto>> {
    const res = await this.call<unknown>(
      `/widget/appointments/${encodeURIComponent(token)}`,
      { method: 'DELETE', withVisitor: false },
    );
    if (!res.ok) return res;
    const appointment = coerceAppointment(res.data);
    return appointment ? { ok: true, data: appointment } : { ok: false, status: 200 };
  }

  /**
   * fetch-based SSE reader (native EventSource can't set the required headers).
   * Fires onInvalidation(cursor) per `message.created` poke (text-free — the
   * widget re-fetches history). Owns reconnect with exponential backoff+jitter
   * (cap 30s); a reconnect fires a catch-up onInvalidation so the backfill
   * absorbs the publish-before-persist race. 401→re-bootstrap once; 429→longer
   * backoff. Returns a close() that aborts the in-flight fetch + reader.
   */
  openStream(handlers: StreamHandlers): () => void {
    const { onInvalidation, onState, onTyping, onHandoff } = handlers;
    const ac = new AbortController();
    let closed = false;
    let attempt = 0;
    let connectedOnce = false;
    let lastCursor: string | undefined;

    // Report only on CHANGE. Every failure path funnels through `backoff()`, so
    // without this the visitor's banner would flap on each retry.
    let state: StreamState | null = null;
    const setState = (next: StreamState): void => {
      if (closed || state === next) return;
      state = next;
      try {
        onState?.(next);
      } catch {
        /* a UI callback must never break the stream loop */
      }
    };

    const sleep = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        const id = setTimeout(resolve, ms);
        ac.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(id);
            resolve();
          },
          { once: true },
        );
      });

    // Every retry path goes through here, so this is the one place that has to
    // announce "reconnecting" — the state is true for exactly the backoff's
    // duration plus the reconnect attempt that follows it.
    const backoff = async (n: number, longer = false): Promise<void> => {
      setState('reconnecting');
      const base = longer ? 5000 : 1000;
      const cap = 30000;
      const exp = Math.min(cap, base * 2 ** Math.min(n, 10));
      const jitter = Math.random() * Math.min(exp, 1000);
      await sleep(exp + jitter);
    };

    const readSse = async (body: ReadableStream<Uint8Array>): Promise<void> => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          if (ac.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const frame = parseSseFrame(raw);
            if (!frame) continue;
            // Someone on the dealer's side is composing. Authorless by contract:
            // we are told THAT a reply is coming, never by whom. A garbage or
            // absurd TTL degrades to the default rather than pinning the
            // indicator on screen forever.
            if (frame.event === 'agent.typing') {
              const data = parseEventData(frame.data);
              const raw = data?.ttlMs;
              const ttlMs =
                typeof raw === 'number' && Number.isFinite(raw) && raw > 0
                  ? Math.min(raw, MAX_TYPING_TTL_MS)
                  : DEFAULT_TYPING_TTL_MS;
              try {
                onTyping?.(ttlMs);
              } catch {
                /* a UI callback must never break the stream loop */
              }
              continue;
            }

            // A person joined the conversation, or it went back to the AI.
            // Anonymous: `to` is a direction, never an identity.
            if (frame.event === 'conversation.handoff') {
              const data = parseEventData(frame.data);
              const to = data?.to;
              if (to === 'human' || to === 'bot') {
                try {
                  onHandoff?.(to);
                } catch {
                  /* a UI callback must never break the stream loop */
                }
              }
              continue;
            }

            // FORWARD COMPATIBILITY (ADR 0035 ¶4). This widget is installed on
            // dealer sites we cannot force-upgrade, so it WILL one day receive
            // event types that did not exist when it was built. Anything
            // unrecognised is ignored — never an error, and never allowed to
            // advance `lastCursor`. Only `message.created` corresponds to a
            // persisted row, so only it is a valid `since` cursor; letting a
            // typing/handoff frame move the cursor forward would make the next
            // catch-up read skip the messages in between.
            if (frame.event !== 'message.created') continue;
            if (frame.id) lastCursor = frame.id;
            onInvalidation(frame.id ?? lastCursor);
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
      }
    };

    const loop = async (): Promise<void> => {
      setState('connecting');
      while (!closed) {
        let res: Response;
        try {
          res = await fetch(this.url('/widget/stream'), {
            method: 'GET',
            headers: this.authHeaders({ withVisitor: true, json: false }),
            signal: ac.signal,
          });
        } catch {
          if (closed) return;
          await backoff(++attempt);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          const boot = await this.freshBootstrap();
          if (!boot) {
            await backoff(++attempt);
            continue;
          }
          attempt = 0;
          continue; // reconnect with the fresh token
        }
        if (res.status === 429) {
          await backoff(++attempt, true);
          continue;
        }
        if (!res.ok || !res.body) {
          await backoff(++attempt);
          continue;
        }
        attempt = 0;
        setState('open');
        // A RECONNECT always backfills (dedupe absorbs the overlap). The first
        // connect does not — the widget already painted history on bootstrap.
        if (connectedOnce) onInvalidation(lastCursor);
        connectedOnce = true;
        try {
          await readSse(res.body);
        } catch {
          /* reader aborted or network error mid-stream */
        }
        if (closed) return;
        await backoff(++attempt); // stream ended → reconnect
      }
    };

    void loop();

    return () => {
      closed = true;
      try {
        ac.abort();
      } catch {
        /* already aborted */
      }
    };
  }
}
