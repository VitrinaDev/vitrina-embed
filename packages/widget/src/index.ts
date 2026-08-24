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

import { createBookingController, type BookingController } from './booking-controller';
import { createBookingStore } from './booking-store';
import { hasInlineAppearance, resolveConfig } from './config';
import { makeT } from './i18n';
import { createRemoteConfigCache } from './remote-config';
import { createTokenStore } from './token-store';
import {
  VitrinaTransport,
  latestServerCursor,
  localIdFor,
  mergeMessages,
  type MessageStatus,
  type WidgetMessage,
} from './transport';
import type { WidgetNotice } from './config';
import type { WidgetConfig, WidgetInstance } from './types';
import { createWidgetUI } from './ui';

export type {
  WidgetConfig,
  WidgetInstance,
  WidgetTheme,
  WidgetLocale,
  WidgetFont,
} from './types';

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

/**
 * How long the launcher may stay invisible waiting for the server-resolved
 * appearance (ADR 0046) before we give up and paint with what we have.
 *
 * This timer is scheduled UNCONDITIONALLY, not as an error path: a fetch that
 * hangs forever, a proxy that swallows the response, a tab throttled in the
 * background — none of them may leave a dealer's site with no chat button.
 */
const REVEAL_TIMEOUT_MS = 1_200;

export function init(config: WidgetConfig): WidgetInstance {
  // The server-resolved appearance (ADR 0046), layered UNDER anything the
  // dealer pinned inline. Read the last-known-good copy synchronously so a
  // repeat visitor's first paint is already correct; the live fetch below
  // corrects it (and refreshes the cache) within the same pageview.
  const remoteEnabled = config?.remoteConfig !== false;
  const cache =
    remoteEnabled && config?.publicKey
      ? createRemoteConfigCache(config.publicKey)
      : null;
  const cached = cache?.read() ?? null;

  // Throws the same message as the original stub on a missing publicKey/apiBaseUrl.
  let resolved = resolveConfig(config, cached);
  const t = makeT(resolved.locale);
  const tokens = createTokenStore(resolved.publicKey);
  const transport = new VitrinaTransport(
    { apiBaseUrl: resolved.apiBaseUrl, publicKey: resolved.publicKey },
    tokens,
  );

  let vehicleId: string | null = resolved.vehicleId;
  let vehicleLabel: string | null = resolved.vehicleLabel;
  let messages: WidgetMessage[] = [];
  let cursor: string | undefined;
  let destroyed = false;
  let bootstrapped = false;
  let bootstrapping: Promise<void> | null = null;
  let closeStream: (() => void) | null = null;
  let panelOpen = false;
  let unread = 0;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  // Live-only transcript notices ("an advisor joined"). Never persisted, never
  // replayed on reload — see WidgetNotice.
  let notices: WidgetNotice[] = [];

  /**
   * Show or hide the "a reply is being composed" indicator.
   *
   * The event carries its own TTL and we honour it: a producer that dies
   * mid-turn (a worker OOM, a salesperson closing the tab) never gets to leave
   * a permanent lie on the visitor's screen. The indicator also clears the
   * moment a reply actually lands, whichever comes first.
   */
  function setTyping(active: boolean, ttlMs?: number): void {
    if (destroyed) return;
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    ui.setTyping(active);
    if (active && ttlMs) {
      typingTimer = setTimeout(() => {
        typingTimer = null;
        if (!destroyed) ui.setTyping(false);
      }, ttlMs);
    }
  }

  // The banner has ONE slot but TWO independent sources: how the connection is
  // doing, and how the last send went. They used to overwrite each other — a
  // successful send called setBanner('none') and wiped an offline notice that
  // was still true. Track them separately and resolve with an explicit
  // precedence: a failed send is the most actionable thing the visitor can see,
  // then the connection being down, then transient send progress.
  let connectionState: 'ok' | 'offline' | 'reconnecting' = 'ok';
  let sendState: 'idle' | 'sending' | 'error' = 'idle';

  function paintBanner(): void {
    if (destroyed) return;
    if (sendState === 'error') ui.setBanner('error');
    else if (connectionState === 'offline') ui.setBanner('offline');
    else if (connectionState === 'reconnecting') ui.setBanner('reconnecting');
    else if (sendState === 'sending') ui.setBanner('sending');
    else ui.setBanner('none');
  }
  const setConnection = (next: typeof connectionState): void => {
    connectionState = next;
    paintBanner();
  };
  const setSend = (next: typeof sendState): void => {
    sendState = next;
    paintBanner();
  };

  // Hold the launcher back ONLY when we are genuinely flying blind: the server
  // owns the appearance, we have no cached copy, and this page pinned nothing
  // inline. Every widget installed before ADR 0046 fails that last test, so
  // they all mount instantly, exactly as they always have.
  const awaitingFirstConfig =
    remoteEnabled && !cached && !hasInlineAppearance(config);

  // --- Booking (S15-21) -----------------------------------------------------
  //
  // The controller is created LAZILY, the first time the server says this
  // tenant takes bookings. A tenant with the agenda off never constructs a
  // keyring, never mounts a chip, and never reaches a single booking code path
  // — it gets the widget it has always had.
  let booking: BookingController | null = null;
  let bookingEnabled = false;

  function ensureBookingController(): BookingController {
    if (!booking) {
      booking = createBookingController({
        transport,
        store: createBookingStore(resolved.publicKey),
        getVehicle: () => ({ id: vehicleId, label: vehicleLabel }),
        getLocale: () => resolved.locale,
        onRender: (state) => {
          if (!destroyed) ui.renderBooking(state);
        },
        onChip: (info) => {
          if (!destroyed) ui.setVisitCount(info);
        },
        onChatFallback: (draftKey) => {
          if (destroyed) return;
          // The escape hatch is not a dead end and not a waitlist row nobody
          // watches: it drops the visitor into the conversation with the words
          // already typed, where a human can actually act.
          ui.closeBooking();
          ui.focusComposer(makeT(resolved.locale)(draftKey));
        },
        onClose: () => {
          if (!destroyed) ui.closeBooking();
        },
      });
    }
    return booking;
  }

  /**
   * A host page asked for the agenda before the server had answered whether
   * this tenant even has one. Held here rather than dropped, so a visitor who
   * clicks a "Agendar demo" button on the host page in the first few hundred
   * milliseconds of a cold load still lands on the calendar instead of on a
   * chat panel that silently ignored them.
   */
  let pendingBookingOpen = false;

  /** Put the booking overlay up over the (already open) panel. */
  function showBooking(): void {
    pendingBookingOpen = false;
    ui.openBooking();
    ensureBookingController().openBooking();
  }

  /** Reflect the tenant's booking gate. Idempotent, and safe in both directions. */
  function applyBookingGate(enabled: boolean): void {
    if (destroyed || enabled === bookingEnabled) return;
    bookingEnabled = enabled;
    ui.setBookingEnabled(enabled);
    if (enabled) {
      ensureBookingController().refreshChip();
      // The answer arrived after the ask. Honour it — but only while the panel
      // is still open: a visitor who walked away must not have an overlay
      // appear under their cursor a second later.
      if (pendingBookingOpen && panelOpen) showBooking();
      pendingBookingOpen = false;
    } else {
      pendingBookingOpen = false;
      ui.closeBooking();
    }
  }

  const ui = createWidgetUI({
    t,
    locale: resolved.locale,
    theme: resolved.theme,
    welcomeMessage: resolved.welcomeMessage,
    font: resolved.font,
    bookingLabel: resolved.bookingLabel,
    // A repeat visitor's cached config already knows whether this tenant has
    // the tabs, so they paint with the panel rather than a round trip after it.
    home: resolved.home,
    help: resolved.help,
    team: resolved.team,
    hidden: awaitingFirstConfig,
    callbacks: {
      onRequestOpen: () => instanceOpen(),
      onRequestClose: () => instanceClose(),
      onSend: (text, honeypot) => {
        void sendFlow(text, honeypot);
      },
      onRetry: (clientMessageId) => {
        void retryFlow(clientMessageId);
      },
      onBookingOpen: () => {
        if (!bookingEnabled) return;
        showBooking();
      },
      onVisitsOpen: () => {
        if (!bookingEnabled) return;
        ui.openBooking();
        ensureBookingController().openVisits();
      },
      // Bound through a getter so the controller can be created after the UI:
      // the overlay is only built on the first setBookingEnabled(true), which
      // is always after this point.
      booking: {
        onClose: () => ensureBookingController().callbacks.onClose(),
        onBack: () => ensureBookingController().callbacks.onBack(),
        onPrevMonth: () => ensureBookingController().callbacks.onPrevMonth(),
        onNextMonth: () => ensureBookingController().callbacks.onNextMonth(),
        onPickDay: (day) => ensureBookingController().callbacks.onPickDay(day),
        onPickSlot: (startsAt) => ensureBookingController().callbacks.onPickSlot(startsAt),
        onFormChange: (patch) => ensureBookingController().callbacks.onFormChange(patch),
        onSubmitForm: () => ensureBookingController().callbacks.onSubmitForm(),
        onConfirm: () => ensureBookingController().callbacks.onConfirm(),
        onDone: () => ensureBookingController().callbacks.onDone(),
        onAskCancel: (ref) => ensureBookingController().callbacks.onAskCancel(ref),
        onKeepVisit: () => ensureBookingController().callbacks.onKeepVisit(),
        onConfirmCancel: () => ensureBookingController().callbacks.onConfirmCancel(),
        onBookAgain: () => ensureBookingController().callbacks.onBookAgain(),
        onChatFallback: (key) => ensureBookingController().callbacks.onChatFallback(key),
        onRetry: () => ensureBookingController().callbacks.onRetry(),
      },
    },
  });
  ui.mount();
  // A repeat visitor's cached config already knows the answer, so the chip is
  // there on the first paint rather than popping in a round trip later.
  if (resolved.bookingEnabled) applyBookingGate(true);

  // --- Server-resolved appearance (ADR 0046) --------------------------------
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  const reveal = (): void => {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    if (!destroyed) ui.reveal();
  };
  if (awaitingFirstConfig) {
    revealTimer = setTimeout(reveal, REVEAL_TIMEOUT_MS);
  }
  if (remoteEnabled) {
    void transport
      .fetchConfig()
      .then((remote) => {
        if (destroyed) return;
        if (remote) {
          cache?.write(remote);
          resolved = resolveConfig(config, remote);
          // Locale first: the greeting repaint inside setWelcomeMessage should
          // land in the language we are switching to, not the one we are
          // leaving.
          ui.setLocale(resolved.locale);
          ui.applyTheme(resolved.theme);
          // After setLocale, which repaints the chip from our own copy: a tenant
          // label must be the LAST word on what that button says.
          ui.setBookingLabel(resolved.bookingLabel);
          ui.applyFont(resolved.font);
          ui.setWelcomeMessage(resolved.welcomeMessage);
          // The tab surfaces, AFTER setLocale so their built-in copy lands in
          // the language we just switched to — and, like the booking label,
          // with the tenant's own words as the last word over ours.
          ui.setTeam(resolved.team);
          ui.setHomeConfig(resolved.home);
          ui.setHelpConfig(resolved.help);
          // The gate is server-owned and can move in both directions: a dealer
          // who switches booking off mid-session gets the chip taken away
          // rather than a chip that opens a 404.
          applyBookingGate(resolved.bookingEnabled);
        }
      })
      .catch(() => {
        /* fetchConfig never rejects; belt-and-suspenders */
      })
      .finally(reveal);
  }

  /**
   * Timestamp for a local echo. Never bare `Date.now()`: a visitor whose clock
   * runs slow would sort their brand-new message ABOVE the history they are
   * looking at. Clamp it past the newest message we hold.
   */
  function nextLocalTimestamp(): string {
    let newest = 0;
    for (const m of messages) {
      const t2 = Date.parse(m.createdAt);
      if (Number.isFinite(t2) && t2 > newest) newest = t2;
    }
    return new Date(Math.max(Date.now(), newest + 1)).toISOString();
  }

  /** Set (or clear) a local echo's status, then repaint. No-op if it is gone. */
  function setStatus(clientMessageId: string, status: MessageStatus | undefined): void {
    const localId = localIdFor(clientMessageId);
    let touched = false;
    messages = messages.map((m) => {
      if (String(m.id) !== localId) return m;
      touched = true;
      if (status === undefined) {
        const { status: _drop, ...rest } = m;
        return rest;
      }
      return { ...m, status };
    });
    if (touched && !destroyed) ui.renderMessages(messages, notices);
  }

  /**
   * Pull server history from the current cursor, reconcile, repaint.
   *
   * A FAILED fetch repaints NOTHING. This is the fix for the vanishing message:
   * the old fetchHistory returned `[]` on every failure, so a 500 looked exactly
   * like an empty conversation, and the repaint that followed wiped the panel —
   * including the message the visitor had just typed.
   */
  async function refreshHistory(): Promise<void> {
    if (destroyed) return;
    const res = await transport.fetchHistory(cursor);
    if (destroyed) return;
    if (!res.ok) return;
    if (res.messages.length > 0) {
      // Count replies that arrived while the visitor was not looking. The poke
      // already reaches us with the panel closed and we already refetch on it —
      // nothing new is fetched here, it is simply counted.
      //
      // Rows we already hold are excluded, so the INCLUSIVE `since` boundary row
      // and the reconnect catch-up cannot inflate the count. Inbound rows are
      // excluded because they are the visitor's own messages.
      const known = new Set(messages.map((m) => String(m.id)));
      const arrived = res.messages.filter(
        (row) => row.direction === 'outbound' && !known.has(String(row.id)),
      ).length;

      messages = mergeMessages(messages, res.messages);
      cursor = latestServerCursor(messages);

      // The reply landed. Whoever was composing has finished, whatever the
      // typing event's TTL said.
      if (arrived > 0) setTyping(false);

      if (arrived > 0 && !panelOpen) {
        unread += arrived;
        ui.setUnread(unread);
      }
    }
    ui.renderMessages(messages, notices);
  }

  /** Bootstrap the visitor session ONCE, paint history, open the SSE stream. */
  function ensureSession(): Promise<void> {
    if (bootstrapped) return Promise.resolve();
    if (bootstrapping) return bootstrapping;
    bootstrapping = (async () => {
      const boot = await transport.bootstrap();
      if (destroyed) return;
      if (!boot) {
        setConnection('offline');
        return;
      }
      bootstrapped = true;
      setConnection('ok');
      await refreshHistory();
      if (destroyed) return;
      closeStream = transport.openStream({
        onInvalidation: () => {
          void refreshHistory();
        },
        // The transport has always known it was reconnecting. Now it says so.
        // 'connecting' is deliberately silent: the panel has only just opened
        // and there is nothing for the visitor to worry about yet.
        onState: (state) => {
          if (state === 'reconnecting') setConnection('reconnecting');
          else if (state === 'open') setConnection('ok');
        },
        // Authorless by contract. We are told a reply is coming, never by whom.
        onTyping: (ttlMs) => setTyping(true, ttlMs),
        onHandoff: (to) => announceHandoff(to),
      });
    })();
    // Allow a retry if this bootstrap attempt failed (bootstrapped stays false).
    void bootstrapping.finally(() => {
      bootstrapping = null;
    });
    return bootstrapping;
  }

  /**
   * Push the visitor's text to the server and reflect the outcome on the
   * message itself. The echo already exists in `messages` before this runs (or,
   * on retry, still does), so there is no window in which the text lives only
   * in a local variable.
   *
   * `pending` clears on the 202, NOT on the row coming back. The 202 is the
   * server's acceptance into a durable queue; the row lands later because the
   * inbound dispatcher coalesces. Waiting for the row would leave the message
   * marked pending indefinitely whenever nobody replies — which, with the AI
   * kill-switch off, is most of the time.
   */
  async function deliver(clientMessageId: string, text: string, honeypot: string): Promise<void> {
    setStatus(clientMessageId, 'pending');
    setSend('sending');
    const res = await transport.send({
      message: text,
      honeypot,
      clientMessageId,
      vehicleId: vehicleId ?? undefined,
    });
    if (destroyed) return;
    if ('error' in res && res.error) {
      // The message STAYS on screen, marked failed, with a retry beside it.
      setStatus(clientMessageId, 'failed');
      setSend('error');
      return;
    }
    setStatus(clientMessageId, undefined);
    setSend('idle');
    // Pull our own now-accepted inbound. If the row has not been written yet,
    // the merge keeps the local echo and nothing is lost.
    await refreshHistory();
  }

  async function sendFlow(text: string, honeypot: string): Promise<void> {
    if (destroyed) return;
    // Ensure the session (and its initial history paint) first, THEN echo — the
    // bootstrap's own renderMessages must not race the echo we are about to add.
    await ensureSession();
    if (destroyed) return;
    if (!bootstrapped) {
      setConnection('offline');
      return;
    }
    const clientMessageId = newClientMessageId();
    // The echo is a REAL ENTRY in the message list, not a DOM artifact. Every
    // repaint rebuilds the panel from this array, so nothing can wipe it.
    messages = [
      ...messages,
      {
        id: localIdFor(clientMessageId),
        createdAt: nextLocalTimestamp(),
        content: text,
        direction: 'inbound',
        type: 'text',
        clientMessageId,
        status: 'pending',
      },
    ];
    ui.renderMessages(messages, notices);
    await deliver(clientMessageId, text, honeypot);
  }

  /**
   * Re-send a failed message with its ORIGINAL client message id. The server
   * namespaces that id into the inbound dedup key, so a retry of a message that
   * did in fact land is idempotent — it will not double-post.
   */
  async function retryFlow(clientMessageId: string): Promise<void> {
    if (destroyed) return;
    const entry = messages.find((m) => String(m.id) === localIdFor(clientMessageId));
    if (!entry) return;
    await deliver(clientMessageId, entry.content, '');
  }

  /**
   * A person joined the conversation. Say so ONCE, in a centered line that names
   * nobody, and never say the reverse: telling the visitor "the AI is back"
   * would keep score of who is on the other end, which is exactly what the
   * authorless contract exists to prevent. The `to: 'bot'` event is still
   * received and ignored — the server publishes the honest projection of the
   * handler transition; the widget decides what a visitor should see.
   */
  function announceHandoff(to: 'human' | 'bot'): void {
    if (destroyed || to !== 'human') return;
    if (notices.some((n) => n.kind === 'handoff_human')) return;
    notices = [
      ...notices,
      { id: `notice:handoff:${Date.now()}`, at: new Date().toISOString(), kind: 'handoff_human' },
    ];
    ui.renderMessages(messages, notices);
  }

  function instanceOpen(): void {
    if (destroyed) return;
    panelOpen = true;
    // Opening IS reading. No timers, no scroll tracking, no read receipts.
    unread = 0;
    ui.setUnread(0);
    ui.openPanel();
    void ensureSession();
  }

  function instanceClose(): void {
    if (destroyed) return;
    panelOpen = false;
    // Closing the panel withdraws a booking that has not opened yet. The intent
    // belongs to the moment it was expressed, not to the next pageview.
    pendingBookingOpen = false;
    ui.closePanel();
  }

  /**
   * Open the agenda DIRECTLY, skipping the chip the visitor would otherwise
   * have to find inside the panel.
   *
   * This exists because the host page often already has the ask on screen — a
   * dealer's "Agendar visita" button, a landing page's "Agendar demo" — and
   * routing that click through open() would answer it with a chat panel and
   * leave the visitor to hunt for the calendar.
   *
   * The panel opens either way: booking is an overlay LAID OVER the
   * conversation, and the conversation is the honest fallback whenever the
   * agenda is not available. So the return value is the useful signal, not an
   * error — `true` means the visitor is looking at the calendar, `false` means
   * they got the panel and the host page can say so in its own words.
   */
  function instanceOpenBooking(): boolean {
    if (destroyed) return false;
    instanceOpen();
    if (bookingEnabled) {
      showBooking();
      return true;
    }
    // Either this tenant has the agenda off — in which case the panel is the
    // whole answer and nothing more will happen — or GET /widget/config is
    // still in flight, in which case applyBookingGate finishes the job.
    pendingBookingOpen = true;
    return false;
  }

  return {
    open: instanceOpen,
    close: instanceClose,
    openBooking: instanceOpenBooking,
    setVehicle(id: string | null, label?: string | null): void {
      // Live server-side: the next send() carries it as `vehicle_id`, which the
      // webchat ingress persists onto the inbound message's metadata so the
      // dealer inbox shows which listing the visitor asked about. SPA route
      // changes call this. A booking made afterwards attaches the same id.
      vehicleId = id;
      // A route change to another car must not leave the OLD car's title on the
      // booking summary. No id ⇒ no label, ever.
      if (label !== undefined) vehicleLabel = label;
      else if (id === null) vehicleLabel = null;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (booking) {
        booking.destroy();
        booking = null;
      }
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
      }
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      if (closeStream) {
        closeStream();
        closeStream = null;
      }
      ui.destroy();
      messages = [];
      notices = [];
    },
  };
}

export default { init };
