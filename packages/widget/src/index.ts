// @vitrina/widget — public entry.
//
// Two ways to embed:
//   1. NPM (storefront template):  import { init } from '@vitrina/widget'
//   2. <script> loader (any site):  see ./loader — reads window.vitrinaChat
//
// The widget renders a Shadow-DOM launcher + conversation panel (style-isolated
// from the host page) and speaks the Vitrina `web` channel protocol (ADR 0032):
// create/resume a visitor conversation, POST messages, and subscribe to a
// visitor-scoped SSE stream that INVALIDATES (no text) so the widget re-fetches
// history — all authed with the publishable widget key (ADR 0033).
//
// Kill-switch-OFF reality: with AI answers off, the visitor talks to a human via
// the dealer inbox; replies simply start arriving over the same SSE→refetch path
// once José enables AI later — no widget change needed.

import { resolveConfig } from './config';
import { makeT } from './i18n';
import { createTokenStore } from './token-store';
import { VitrinaTransport, mergeMessages, type WidgetMessageDto } from './transport';
import type { WidgetConfig, WidgetInstance } from './types';
import { createWidgetUI } from './ui';

export type { WidgetConfig, WidgetInstance, WidgetTheme, WidgetLocale } from './types';

/** Best-effort idempotency key for a sent message. */
function newClientMessageId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** The cursor is the newest server createdAt (ISO8601) — never a message id. */
function latestCursor(messages: WidgetMessageDto[]): string | undefined {
  let max: string | undefined;
  for (const m of messages) {
    if (typeof m.createdAt === 'string' && (max === undefined || m.createdAt > max)) {
      max = m.createdAt;
    }
  }
  return max;
}

export function init(config: WidgetConfig): WidgetInstance {
  // Throws the same message as the original stub on a missing publicKey/apiBaseUrl.
  const resolved = resolveConfig(config);
  const t = makeT(resolved.locale);
  const tokens = createTokenStore(resolved.publicKey);
  const transport = new VitrinaTransport(
    { apiBaseUrl: resolved.apiBaseUrl, publicKey: resolved.publicKey },
    tokens,
  );

  let vehicleId: string | null = resolved.vehicleId;
  let messages: WidgetMessageDto[] = [];
  let cursor: string | undefined;
  let destroyed = false;
  let bootstrapped = false;
  let bootstrapping: Promise<void> | null = null;
  let closeStream: (() => void) | null = null;

  const ui = createWidgetUI({
    t,
    theme: resolved.theme,
    welcomeMessage: resolved.welcomeMessage,
    callbacks: {
      onRequestOpen: () => instanceOpen(),
      onRequestClose: () => instanceClose(),
      onSend: (text, honeypot) => {
        void sendFlow(text, honeypot);
      },
    },
  });
  ui.mount();

  /** Pull server history (from the current cursor), reconcile, and repaint. */
  async function refreshHistory(): Promise<void> {
    if (destroyed) return;
    const rows = await transport.fetchHistory(cursor);
    if (rows.length > 0) {
      messages = mergeMessages(messages, rows);
      cursor = latestCursor(messages);
    }
    if (!destroyed) ui.renderMessages(messages);
  }

  /** Bootstrap the visitor session ONCE, paint history, open the SSE stream. */
  function ensureSession(): Promise<void> {
    if (bootstrapped) return Promise.resolve();
    if (bootstrapping) return bootstrapping;
    bootstrapping = (async () => {
      const boot = await transport.bootstrap();
      if (destroyed) return;
      if (!boot) {
        ui.setBanner('offline');
        return;
      }
      bootstrapped = true;
      ui.setBanner('none');
      await refreshHistory();
      if (destroyed) return;
      closeStream = transport.openStream(() => {
        void refreshHistory();
      });
    })();
    // Allow a retry if this bootstrap attempt failed (bootstrapped stays false).
    void bootstrapping.finally(() => {
      bootstrapping = null;
    });
    return bootstrapping;
  }

  async function sendFlow(text: string, honeypot: string): Promise<void> {
    if (destroyed) return;
    // Ensure the session (and initial history paint) first, THEN echo — so the
    // optimistic bubble is not wiped by the session's initial renderMessages.
    await ensureSession();
    if (destroyed) return;
    if (!bootstrapped) {
      ui.setBanner('offline');
      return;
    }
    ui.appendOptimistic(text);
    ui.setBanner('sending');
    const res = await transport.send({
      message: text,
      honeypot,
      clientMessageId: newClientMessageId(),
      // Speculative + inert server-side today (non-strict zod strips it).
      vehicleId: vehicleId ?? undefined,
    });
    if (destroyed) return;
    if ('error' in res && res.error) {
      ui.setBanner('error');
      return;
    }
    ui.setBanner('none');
    // No self-poke: pull our own now-persisted inbound; the full render drops
    // the optimistic echo and shows server truth (review requirement).
    await refreshHistory();
  }

  function instanceOpen(): void {
    if (destroyed) return;
    ui.openPanel();
    void ensureSession();
  }

  function instanceClose(): void {
    if (destroyed) return;
    ui.closePanel();
  }

  return {
    open: instanceOpen,
    close: instanceClose,
    setVehicle(id: string | null): void {
      // Inert server-side today, but wired at the API-call layer: the next
      // send() carries it as a speculative vehicle_id (stripped until the
      // backend adds the field). SPA route changes call this.
      vehicleId = id;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (closeStream) {
        closeStream();
        closeStream = null;
      }
      ui.destroy();
      messages = [];
    },
  };
}

export default { init };
