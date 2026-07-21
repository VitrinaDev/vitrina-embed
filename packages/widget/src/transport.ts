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
// Auth on EVERY call: Authorization: Bearer <pk_...>. Visitor-scoped calls add
// X-Vitrina-Visitor: <vt_...>. NEVER credentials:'include' and NEVER any header
// outside the fixed CORS allow-list (Authorization, Content-Type, X-Vitrina-Visitor).

import type {
  BootstrapResult,
  HistoryResult,
  RemoteWidgetConfig,
  SendResult,
  WidgetMessage,
  WidgetMessageDto,
} from './config';
import { coerceRemoteConfig } from './remote-config';
import type { TokenStore } from './token-store';

export type { WidgetMessage, WidgetMessageDto, MessageStatus } from './config';

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
type Fail = { ok: false; status: number | null };
type CallResult<T> = Ok<T> | Fail;

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
   */
  private async call<T>(
    path: string,
    opts: { method: 'GET' | 'POST'; body?: string; withVisitor: boolean },
  ): Promise<CallResult<T>> {
    const headers = this.authHeaders({
      withVisitor: opts.withVisitor,
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
    if (!res.ok) return { ok: false, status: res.status };
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
