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
  SendResult,
  WidgetMessageDto,
} from './config';
import type { TokenStore } from './token-store';

export type { WidgetMessageDto } from './config';

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
   * Speculative vehicle context. sendWidgetMessageBodySchema is a NON-strict
   * z.object, so `vehicle_id` is silently STRIPPED server-side today (no
   * round-trip) — wired at the API-call layer per review, inert until the
   * backend adds the field. Do NOT assert a server round-trip on this.
   */
  vehicleId?: string | null;
}

export type SendOutcome = SendResult | { error: true; status: number | null };

/** A parsed SSE frame (comment-only frames are dropped before this). */
export interface SseFrame {
  event?: string;
  data?: string;
  id?: string;
  retry?: number;
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
 * Merge two message lists: dedupe STRICTLY by DTO.id (incoming = server truth
 * wins), then sort createdAt-ascending. Absorbs the since-boundary overlap (the
 * INCLUSIVE `gte` re-returns the boundary row) and the publish-before-persist
 * race. Client-side optimistic entries carry no server id and are dropped by the
 * caller BEFORE a full render — this only reconciles server rows.
 */
export function mergeMessages(
  existing: WidgetMessageDto[],
  incoming: WidgetMessageDto[],
): WidgetMessageDto[] {
  const byId = new Map<string, WidgetMessageDto>();
  for (const m of existing) byId.set(String(m.id), m);
  for (const m of incoming) byId.set(String(m.id), m);
  const merged = [...byId.values()];
  merged.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
  return merged;
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
    // Speculative + inert server-side (non-strict zod strips it). No round-trip.
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
   * by id. conversation:null + [] is an empty session, NOT an error. Returns []
   * on 401/network after one bounded re-bootstrap attempt.
   */
  async fetchHistory(since?: string): Promise<WidgetMessageDto[]> {
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
    if (res.ok) return res.data?.messages ?? [];
    return [];
  }

  /**
   * fetch-based SSE reader (native EventSource can't set the required headers).
   * Fires onInvalidation(cursor) per `message.created` poke (text-free — the
   * widget re-fetches history). Owns reconnect with exponential backoff+jitter
   * (cap 30s); a reconnect fires a catch-up onInvalidation so the backfill
   * absorbs the publish-before-persist race. 401→re-bootstrap once; 429→longer
   * backoff. Returns a close() that aborts the in-flight fetch + reader.
   */
  openStream(onInvalidation: (cursor?: string) => void): () => void {
    const ac = new AbortController();
    let closed = false;
    let attempt = 0;
    let connectedOnce = false;
    let lastCursor: string | undefined;

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

    const backoff = async (n: number, longer = false): Promise<void> => {
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
