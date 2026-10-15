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

import {
  browserAutoOpenEnv,
  createAutoOpenScheduler,
  type AutoOpenScheduler,
} from './auto-open';
import { createBookingController, type BookingController } from './booking-controller';
import { createEmitter } from './events';
import { conversationRef, whatsappHandoffUrl } from './handoff';
import {
  MAX_PAGE_CONTEXT_KEYS,
  MAX_PAGE_CONTEXT_VALUE,
  chipAt,
  resolvePricePolicy, resolveSidebar, type ResolvedChip } from './sidebar-config';
import { createTurnstileGate, type TurnstileGate } from './turnstile';
import { createBookingStore } from './booking-store';
import { createClinicBookingController, type ClinicBookingController } from './clinic-booking-controller';
import { bookingAttribution, captureLandingClick } from './clinic-attribution';
import {
  draftAlreadyHandled,
  draftReturnUrl,
  markDraftHandled,
  readDraftToken,
} from './clinic-draft-link';
import { hasInlineAppearance, resolveConfig, resolveHomeCards, type ResolvedHomeCards } from './config';
import {
  createHomeActionsController,
  type HomeActionsController,
} from './home-actions-controller';
import {
  DEMO_IDLE_MS,
  DEMO_MAX_TURNS,
  asksAboutProduct,
  asksToTryDemo,
  demoKindOf,
  newDemoSessionId,
} from './demo-mode';
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
import type { WidgetConfig, WidgetHomeAction, WidgetInstance } from './types';
import { createWidgetUI } from './ui';

export type {
  WidgetAgentConfig,
  WidgetAutoOpenConfig,
  WidgetChipConfig,
  WidgetEventMap,
  WidgetEventName,
  WidgetLayout,
  WidgetPreset,
  WidgetWhatsAppConfig,
  WidgetConfig,
  WidgetPricePolicy,
  WidgetInstance,
  WidgetTheme,
  WidgetLocale,
  WidgetFont,
  WidgetHomeAction,
  WidgetHomePrompt,
} from './types';

/**
 * Who the visitor is, as a form told us. Rides with the message the form
 * composed — the webchat ingress puts it on the lead, which is the whole point
 * of asking for a name and a phone before sending anything.
 */
interface SendIdentity {
  name?: string;
  email?: string;
  phone?: string;
}

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
/** typingOnSend: after this long the dots read «Sigue escribiendo…». */
export const AWAIT_SLOW_MS = 12_000;
/** typingOnSend: with no reply after this long, the dots go away. */
export const AWAIT_GIVE_UP_MS = 60_000;
/** The typing beat before a scripted reply, picked at random in this range. */
export const SCRIPT_BEAT_MIN_MS = 600;
export const SCRIPT_BEAT_MAX_MS = 900;

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
  // Sidebar mode, auto-open, chips, WhatsApp (embed#25). Same layering as the
  // rest: inline over the server's answer, which arrives below.
  let sidebar = resolveSidebar(config, cached);
  /**
   * Sidebar and inline layouts are one conversation, opened by the greeting and
   * its chips: the Home/Help tabs (and the quick-action cards that live on
   * Home) stay off there, whatever the tenant's bubble widget uses.
   */
  const fitLayout = (r: typeof resolved): typeof resolved =>
    sidebar.layout === 'bubble'
      ? r
      : { ...r, home: { enabled: false, title: null, subtitle: null }, help: { enabled: false, faqs: [] } };
  resolved = fitLayout(resolved);
  const emitter = createEmitter();
  /** Demo mode (D60): messages carry `mode: 'demo'` while it is on. */
  let demoMode = false;
  /** Visitor messages sent in this stay in demo mode (the 12-turn exit). */
  let demoTurns = 0;
  /** One id per stay: the server grants a fresh allowance per id. */
  let demoSession: string | null = null;
  let demoIdleTimer: ReturnType<typeof setTimeout> | null = null;
  /** The text of a typed «quiero probar» waiting for the visitor's yes or no. */
  let pendingDemoText: string | null = null;
  /** The web conversation's external id, once bootstrapped — the WhatsApp ref. */
  let conversationExternalId: string | null = null;
  /** Who opened the panel that is open now: a dismiss of an auto-open is reported. */
  let openedBy: 'api' | 'launcher' | 'auto' | 'peek' | 'chip' | null = null;
  let autoOpen: AutoOpenScheduler | null = null;
  const t = makeT(resolved.locale);
  const tokens = createTokenStore(resolved.publicKey);
  // A restart (0.17.4): forget the stored visitor so bootstrap opens a NEW conversation.
  if (config.freshConversation === true) tokens.clear();
  const pricePolicy = resolvePricePolicy(config.pricePolicy);
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
  // hide()/show(): what was on screen when the host hid the widget.
  let hiddenByHost = false;
  let restoreOnShow: 'panel' | 'teaser' | 'launcher' = 'launcher';
  let unread = 0;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  /** The server said someone is composing (its TTL not yet run out). */
  let serverTyping = false;
  // typingOnSend (0.18.0): dots from the visitor's send until a reply lands.
  const typingOnSend = config.typingOnSend === true;
  let awaitingReply = false;
  let awaitSlowTimer: ReturnType<typeof setTimeout> | null = null;
  let awaitGiveUpTimer: ReturnType<typeof setTimeout> | null = null;
  let awaitSlow = false;
  // Scripted chips (0.18.0): the local typing beat, and the trail of taps sent
  // as `chips_seen` page context with the next real message.
  let scriptTyping = false;
  let scriptTimer: ReturnType<typeof setTimeout> | null = null;
  let scriptSeq = 0;
  const chipsSeen: string[] = [];
  // Live-only transcript notices ("an advisor joined"). Never persisted, never
  // replayed on reload — see WidgetNotice.
  let notices: WidgetNotice[] = [];
  /**
   * Who sent a given message, when a quick-action form said so. Kept by client
   * message id rather than folded into the text so a RETRY re-sends the same
   * name and phone — a lead that loses its phone number on the second attempt
   * is a lead nobody can answer.
   */
  const identities = new Map<string, SendIdentity>();

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
    serverTyping = active;
    paintTyping();
    if (active && ttlMs) {
      typingTimer = setTimeout(() => {
        typingTimer = null;
        serverTyping = false;
        paintTyping();
      }, ttlMs);
    }
  }

  /** The dots show while ANY source says a reply is coming. */
  function paintTyping(): void {
    if (destroyed) return;
    const on = serverTyping || awaitingReply || scriptTyping;
    ui.setTyping(on, on && awaitingReply && awaitSlow ? t('typingStill') : null);
  }

  function stopAwaitingReply(): void {
    awaitingReply = false;
    awaitSlow = false;
    if (awaitSlowTimer) clearTimeout(awaitSlowTimer);
    if (awaitGiveUpTimer) clearTimeout(awaitGiveUpTimer);
    awaitSlowTimer = null;
    awaitGiveUpTimer = null;
  }

  /** typingOnSend: the visitor's message was accepted; hold the dots until a reply. */
  function startAwaitingReply(): void {
    if (!typingOnSend || destroyed) return;
    stopAwaitingReply();
    awaitingReply = true;
    awaitSlowTimer = setTimeout(() => {
      awaitSlowTimer = null;
      awaitSlow = true;
      paintTyping();
    }, AWAIT_SLOW_MS);
    awaitGiveUpTimer = setTimeout(() => {
      awaitGiveUpTimer = null;
      stopAwaitingReply();
      paintTyping();
    }, AWAIT_GIVE_UP_MS);
    paintTyping();
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

  let turnstileGate: TurnstileGate | null = null;
  let turnstileGateKey: string | null = null;

  /**
   * The gate for the CURRENT resolved site key — created on first use, torn
   * down and rebuilt when the key changes (a tenant moved to another widget),
   * dropped when the server stops advertising one. Called from
   * `ensureBookingController` and again when the live config lands, because a
   * controller built from a cached config that predates the key would
   * otherwise keep POSTing tokenless for the whole pageview (every returning
   * visitor's first session after the 0.9.2 upgrade did exactly that).
   */
  function gateForResolvedKey(): TurnstileGate | null {
    const key = resolved.turnstileSiteKey;
    if (turnstileGate && turnstileGateKey === key) return turnstileGate;
    if (turnstileGate) {
      turnstileGate.destroy();
      turnstileGate = null;
      turnstileGateKey = null;
    }
    if (key) {
      turnstileGate = createTurnstileGate(key);
      turnstileGateKey = key;
    }
    return turnstileGate;
  }

  /** The clinic flow's controller, when this tenant is a clinic (#3707). */
  let clinicBooking: ClinicBookingController | null = null;

  /**
   * The booking flow the chip opens, chosen from the tenant's configuration:
   * the clinic flow for a clinic with a live online-booking landing, the
   * dealer's test-drive flow otherwise.
   */
  function ensureBookingController(): BookingController {
    if (resolved.bookingFlow === 'clinic') {
      if (!clinicBooking) {
        clinicBooking = createClinicBookingController({
          transport,
          landing: resolved.landing,
          getLocale: () => resolved.locale,
          getAttribution: () => bookingAttribution(),
          getReturnUrl: () => draftReturnUrl(),
          onRender: (state) => {
            if (!destroyed) ui.renderBooking(state);
          },
          onChatFallback: (draftKey) => {
            if (destroyed) return;
            ui.closeBooking();
            ui.focusComposer(makeT(resolved.locale)(draftKey));
          },
          onClose: () => {
            if (!destroyed) ui.closeBooking();
          },
          turnstile: gateForResolvedKey(),
        });
      }
      return clinicBooking;
    }
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
        // One gate per controller: created iff the server advertised a site
        // key, torn down with the controller. Null keeps the pre-Turnstile
        // behaviour byte-for-byte (tokenless POST, server fails open).
        turnstile: gateForResolvedKey(),
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

  /**
   * The recovery link's draft (embed#18): `?vt_draft=` on this page. Held
   * until the configuration says this tenant runs the clinic flow, then the
   * widget opens itself at the draft — once per tab, so a reload does not pop
   * the booking up again.
   */
  let pendingDraft: string | null = (() => {
    const token = readDraftToken();
    return token && !draftAlreadyHandled(token) ? token : null;
  })();

  function maybeOpenDraft(): void {
    if (!pendingDraft || destroyed || !bookingEnabled || resolved.bookingFlow !== 'clinic') return;
    const token = pendingDraft;
    pendingDraft = null;
    markDraftHandled(token);
    instanceOpen();
    pendingBookingOpen = false;
    ui.openBooking();
    const controller = ensureBookingController();
    if (controller === clinicBooking && clinicBooking) clinicBooking.resumeDraft(token);
    else controller.openBooking();
  }

  /** Reflect the tenant's booking gate. Idempotent, and safe in both directions. */
  function applyBookingGate(enabled: boolean): void {
    if (destroyed || enabled === bookingEnabled) return;
    bookingEnabled = enabled;
    ui.setBookingEnabled(enabled);
    if (enabled) {
      ensureBookingController().refreshChip();
      if (pendingDraft && resolved.bookingFlow === 'clinic') {
        maybeOpenDraft();
        return;
      }
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

  // --- Home quick actions (0.9.0) -------------------------------------------
  //
  // Same lazy contract as booking: the controller is created the first time a
  // card is on. A tenant with all three off never constructs a form, never
  // reaches a consignment code path, and gets the widget it has always had.
  let homeActions: HomeActionsController | null = null;
  let homeCards: ResolvedHomeCards = resolveHomeCards(resolved.home.cards);

  function ensureHomeActionsController(): HomeActionsController {
    if (!homeActions) {
      homeActions = createHomeActionsController({
        transport,
        getT: () => makeT(resolved.locale),
        sendMessage: (input) => sendFormMessage(input),
        onRender: (state) => {
          if (!destroyed) ui.renderHomeAction(state);
        },
        onSent: () => {
          if (destroyed) return;
          // The message is in the transcript, so THAT is the confirmation:
          // uncover it rather than inventing a success screen the visitor
          // would have to dismiss before seeing the reply they are waiting for.
          ui.closeHomeAction();
          ui.showMessages();
        },
        onClose: () => {
          if (!destroyed) ui.closeHomeAction();
        },
      });
    }
    return homeActions;
  }

  /**
   * A host page asked for a form before the server had answered whether this
   * tenant offers it. Held rather than dropped, exactly like a pending booking:
   * a "Vende tu auto" button on a storefront hero is clicked in the first few
   * hundred milliseconds of a cold load more often than anyone expects.
   */
  let pendingHomeAction: WidgetHomeAction | null = null;

  /** Put one quick-action form up over the (already open) panel. */
  function showHomeAction(kind: WidgetHomeAction): void {
    pendingHomeAction = null;
    ui.openHomeAction(kind);
    ensureHomeActionsController().open(kind);
  }

  /** Reflect the tenant's card gates. Idempotent, and safe in both directions. */
  function applyHomeCards(cards: ResolvedHomeCards): void {
    if (destroyed) return;
    homeCards = cards;
    ui.setHomeCards(cards);
    // The answer arrived after the ask. Honour it — but only while the panel is
    // still open: a visitor who walked away must not have a form appear under
    // their cursor a second later.
    if (pendingHomeAction && cards[pendingHomeAction]) {
      if (panelOpen) showHomeAction(pendingHomeAction);
      pendingHomeAction = null;
      return;
    }
    // A card that went away takes its form with it, rather than leaving a
    // half-filled intake pointing at a route the tenant just switched off.
    if (!cards.buy && !cards.sell && !cards.search) pendingHomeAction = null;
  }

  /**
   * The chip's words: the tenant's own label, else — for a clinic — "Reservar
   * hora" rather than the dealer default "Agendar visita". Null hands the
   * choice to the UI's built-in copy, exactly as before the clinic flow.
   */
  function chipLabel(): string | null {
    if (resolved.bookingLabel) return resolved.bookingLabel;
    return resolved.bookingFlow === 'clinic' ? makeT(resolved.locale)('clinicBookChip') : null;
  }
  if (resolved.bookingFlow === 'clinic') captureLandingClick();

  /** A host element passed as an element or a selector, or null. */
  function hostElement(ref: HTMLElement | string | undefined): HTMLElement | null {
    if (!ref) return null;
    if (typeof ref !== 'string') return ref instanceof HTMLElement ? ref : null;
    try {
      return document.querySelector<HTMLElement>(ref);
    } catch {
      return null;
    }
  }
  // Layout is decided ONCE, at init, from inline + cached config: a live
  // answer that changes it applies from the next pageview, never by
  // re-mounting a widget the visitor may be typing into.
  const inlineContainer = sidebar.layout === 'inline' ? hostElement(config.container) : null;
  const layout = sidebar.layout === 'inline' && !inlineContainer ? 'sidebar' : sidebar.layout;
  // The cream preset brings its own face and accent unless the page or the
  // tenant chose one.
  const presetFont = (): typeof resolved.font =>
    sidebar.preset === 'cream' && resolved.font === 'system' ? 'dmSans' : resolved.font;
  // The preset's ember beats the tenant's server accent (the preset is the
  // more specific choice); only an accent pinned in the page beats the preset.
  const presetTheme = (): typeof resolved.theme =>
    sidebar.preset === 'cream' && !config.theme?.accent
      ? { ...resolved.theme, accent: '#AD4E00' }
      : resolved.theme;

  const ui = createWidgetUI({
    t,
    locale: resolved.locale,
    theme: presetTheme(),
    welcomeMessage: resolved.welcomeMessage,
    font: presetFont(),
    bookingLabel: chipLabel(),
    // A repeat visitor's cached config already knows whether this tenant has
    // the tabs, so they paint with the panel rather than a round trip after it.
    home: resolved.home,
    help: resolved.help,
    team: resolved.team,
    hidden: awaitingFirstConfig,
    showPoweredBy: config.showPoweredBy !== false,
    ...(layout !== 'bubble'
      ? {
          sidebar: {
            container: inlineContainer,
            options: {
              layout,
              preset: sidebar.preset,
              anchor: sidebar.anchor,
              launcherSlot: hostElement(config.launcherSlot),
              agent: sidebar.agent,
              chips: sidebar.chips,
              hasWhatsApp: sidebar.whatsapp !== null,
              ctaLabel: sidebar.ctaLabel,
              demoWorld: sidebar.demoWorld,
              launcherStyle: sidebar.launcherStyle,
            },
            callbacks: {
              onChip: (path: string, from: 'panel' | 'teaser' | 'reply') => runChip(path, from),
              whatsappUrl: () => currentWhatsappUrl(),
              onWhatsApp: () => {
                emitter.emit('handoff_whatsapp', {
                  ref: conversationExternalId ? conversationRef(conversationExternalId) : null,
                });
              },
              onCta: () => runCta('pinned'),
              onTeaserOpen: () => instanceOpen('peek'),
              onTeaserDismiss: () => {
                ui.hideTeaser();
                autoOpen?.noteDismissed();
                emitter.emit('dismiss', { surface: 'teaser' });
              },
              onDemoExit: () => setDemo(false, 'visitor'),
              onRequestOpen: () => instanceOpen('launcher'),
            },
          },
        }
      : {}),
    callbacks: {
      onRequestOpen: () => instanceOpen('launcher'),
      onRequestClose: () => instanceClose('visitor'),
      onSend: (text, honeypot) => {
        void sendFlow(text, honeypot);
      },
      onRetry: (clientMessageId) => {
        void retryFlow(clientMessageId);
      },
      onNoticeAction: (id) => onNoticeAction(id),
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
        onTurnstileSlot: (el) => ensureBookingController().callbacks.onTurnstileSlot(el),
        onRetry: () => ensureBookingController().callbacks.onRetry(),
        onPickService: (id) => ensureBookingController().callbacks.onPickService?.(id),
        onPickProfessional: (p) => ensureBookingController().callbacks.onPickProfessional?.(p),
        onManage: (action) => ensureBookingController().callbacks.onManage?.(action),
        onConfirmMove: () => ensureBookingController().callbacks.onConfirmMove?.(),
      },
      onHomeAction: (kind) => {
        if (!homeCards[kind]) return;
        showHomeAction(kind);
      },
      // Bound through a getter for the same reason as booking's: the overlay is
      // only built on the first setHomeCards with a card on, always after this.
      homeActions: {
        onClose: () => ensureHomeActionsController().callbacks.onClose(),
        onBack: () => ensureHomeActionsController().callbacks.onBack(),
        onFormChange: (patch) => ensureHomeActionsController().callbacks.onFormChange(patch),
        onPickPhotos: (files) => ensureHomeActionsController().callbacks.onPickPhotos(files),
        onRemovePhoto: (index) => ensureHomeActionsController().callbacks.onRemovePhoto(index),
        onPrimary: (honeypot) => ensureHomeActionsController().callbacks.onPrimary(honeypot),
      },
    },
  });
  ui.mount();
  // Inline mode IS the open chat: there is no launcher to press.
  if (layout === 'inline') instanceOpen('api');
  // A repeat visitor's cached config already knows the answer, so the chip is
  // there on the first paint rather than popping in a round trip later.
  if (resolved.bookingEnabled) applyBookingGate(true);
  // Same for the quick-action cards — and `setHomeCards` is a no-op that
  // constructs nothing when all three are off, which is every tenant today.
  applyHomeCards(homeCards);
  ui.setHomePrompts(resolved.home.prompts);

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
          const nextSidebar = resolveSidebar(config, remote);
          // The layout itself never changes after mount (see `layout` below).
          sidebar = { ...nextSidebar, layout: sidebar.layout };
          resolved = fitLayout(resolveConfig(config, remote));
          armAutoOpen();
          // A controller built from the cached config gets the live gate now.
          if (booking) booking.setTurnstile(gateForResolvedKey());
          if (clinicBooking) clinicBooking.setTurnstile(gateForResolvedKey());
          if (resolved.bookingFlow === 'clinic') captureLandingClick();
          // Locale first: the greeting repaint inside setWelcomeMessage should
          // land in the language we are switching to, not the one we are
          // leaving.
          ui.setLocale(resolved.locale);
          ui.applyTheme(presetTheme());
          // After setLocale, which repaints the chip from our own copy: a tenant
          // label must be the LAST word on what that button says.
          ui.setBookingLabel(chipLabel());
          ui.applyFont(presetFont());
          ui.setWelcomeMessage(resolved.welcomeMessage);
          // The tab surfaces, AFTER setLocale so their built-in copy lands in
          // the language we just switched to — and, like the booking label,
          // with the tenant's own words as the last word over ours.
          ui.setTeam(resolved.team);
          ui.setHomeConfig(resolved.home);
          ui.setHelpConfig(resolved.help);
          // The quick-action gates ride on `home` but are applied on their own,
          // like the booking gate: they can move in both directions, and a card
          // switched off mid-session is taken away rather than left opening a
          // form the tenant no longer answers.
          applyHomeCards(resolveHomeCards(resolved.home.cards));
          // The prompt cards follow the live answer the same way, both ways.
          ui.setHomePrompts(resolved.home.prompts);
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
      if (arrived > 0) {
        stopAwaitingReply();
        setTyping(false);
      }

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
      if (typeof boot.conversationExternalId === 'string' && boot.conversationExternalId !== '') {
        conversationExternalId = boot.conversationExternalId;
      }
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
      pageContext: pageContextWithChips(),
      pricePolicy,
      ...(demoMode
        ? {
            mode: 'demo' as const,
            ...(currentDemoKind() ? { demoWorld: currentDemoKind() as 'automotora' | 'clinica' } : {}),
            ...(demoSession ? { demoSession } : {}),
          }
        : {}),
      // Present only for a message a form composed. A composer message carries
      // no identity, and inventing one would put an empty name on every lead.
      ...(identities.get(clientMessageId) ?? {}),
    });
    if (destroyed) return;
    if ('error' in res && res.error) {
      // The message STAYS on screen, marked failed, with a retry beside it.
      stopAwaitingReply();
      paintTyping();
      setStatus(clientMessageId, 'failed');
      setSend('error');
      // A 429 comes with words written for the visitor («Estás escribiendo muy
      // rápido…»): show them in the transcript instead of a generic failure.
      if (res.status === 429 && res.message) showRateLimited(res.message);
      return;
    }
    setStatus(clientMessageId, undefined);
    setSend('idle');
    startAwaitingReply();
    // Pull our own now-accepted inbound. If the row has not been written yet,
    // the merge keeps the local echo and nothing is lost.
    await refreshHistory();
  }

  /**
   * Put `text` in the transcript as the visitor's own message and return its
   * client id — or null when there is no session to put it in.
   *
   * Split out of sendFlow because the quick-action forms need exactly this half:
   * once the message is a real entry in the list, their overlay's job is done
   * and the visitor should be looking at their thread. What happens to the POST
   * afterwards is reported where every other send is — on the message itself.
   */
  async function beginSend(
    text: string,
    identity?: SendIdentity,
  ): Promise<string | null> {
    if (destroyed) return null;
    // Ensure the session (and its initial history paint) first, THEN echo — the
    // bootstrap's own renderMessages must not race the echo we are about to add.
    await ensureSession();
    if (destroyed) return null;
    if (!bootstrapped) {
      setConnection('offline');
      return null;
    }
    const clientMessageId = newClientMessageId();
    if (identity) identities.set(clientMessageId, identity);
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
        ...(demoMode ? { mode: 'demo' as const } : {}),
      },
    ];
    ui.renderMessages(messages, notices);
    return clientMessageId;
  }

  async function sendFlow(text: string, honeypot: string, skipAsk = false): Promise<void> {
    if (prepareSend(text, skipAsk) === 'held') return;
    const clientMessageId = await beginSend(text);
    if (clientMessageId === null) return;
    await deliver(clientMessageId, text, honeypot);
  }

  /**
   * A quick-action form's message. Resolves TRUE once the message is in the
   * transcript — the delivery runs on after that, so the visitor is handed
   * their own thread instead of a spinner, and a failure lands on the retry
   * control the transcript already has.
   */
  async function sendFormMessage(input: {
    text: string;
    honeypot: string;
    name: string;
    phone: string;
    email: string;
  }): Promise<boolean> {
    const identity: SendIdentity = {};
    if (input.name) identity.name = input.name;
    if (input.phone) identity.phone = input.phone;
    if (input.email) identity.email = input.email;
    const clientMessageId = await beginSend(input.text, identity);
    if (clientMessageId === null) return false;
    void deliver(clientMessageId, input.text, input.honeypot);
    return true;
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

  function instanceHide(): void {
    if (destroyed || hiddenByHost) return;
    hiddenByHost = true;
    restoreOnShow = panelOpen ? 'panel' : ui.isTeaserShown() ? 'teaser' : 'launcher';
    if (panelOpen) instanceClose('api');
    ui.hideTeaser();
    ui.setHostHidden(true);
    emitter.emit('hide', {});
  }

  function instanceShow(): void {
    if (destroyed || !hiddenByHost) return;
    hiddenByHost = false;
    ui.setHostHidden(false);
    if (restoreOnShow === 'panel') {
      // Reopen without spending auto-open or stealing the keyboard.
      if (!panelOpen) {
        openedBy = 'api';
        panelOpen = true;
        emitter.emit('open', { source: 'api' });
        ui.openPanel(false);
      }
    } else if (restoreOnShow === 'teaser') {
      ui.showTeaser();
    }
    emitter.emit('show', { restored: restoreOnShow });
  }

  function instanceOpen(source: 'api' | 'launcher' | 'auto' | 'peek' | 'chip' = 'api'): void {
    if (destroyed) return;
    if (hiddenByHost) {
      // Nothing may appear while the host has the widget hidden; show() opens it.
      restoreOnShow = 'panel';
      return;
    }
    // Any open the visitor (or the host, on the visitor's behalf) asked for
    // spends auto-open for the session: it must never pop up again over a
    // conversation they already started.
    if (source !== 'auto') autoOpen?.noteOpened();
    if (!panelOpen) {
      openedBy = source;
      emitter.emit('open', { source });
    }
    panelOpen = true;
    // Opening IS reading. No timers, no scroll tracking, no read receipts.
    unread = 0;
    ui.setUnread(0);
    ui.openPanel(source !== 'auto');
    void ensureSession();
  }

  function instanceClose(source: 'api' | 'visitor' = 'api'): void {
    if (destroyed) return;
    if (panelOpen) {
      emitter.emit('close', { source });
      if (source === 'visitor') {
        // ANY dismiss turns auto-open off for the session (D16).
        autoOpen?.noteDismissed();
        if (openedBy === 'auto') emitter.emit('dismiss', { surface: 'panel' });
      }
    }
    openedBy = null;
    panelOpen = false;
    // Closing the panel withdraws a booking — or a quick-action form — that has
    // not opened yet. The intent belongs to the moment it was expressed, not to
    // the next pageview.
    pendingBookingOpen = false;
    pendingHomeAction = null;
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

  /**
   * Open ONE quick-action form directly, skipping the card the visitor would
   * otherwise have to find inside the panel.
   *
   * Same contract as `openBooking()`, for the same reason: the storefront
   * template already has "Vende tu auto" on its hero, and routing that click
   * through open() would answer it with a chat panel and leave the visitor to
   * hunt for the form. The panel opens either way, so `false` says "they got
   * the conversation", never "nothing happened".
   *
   * An unknown kind is the one case that opens nothing at all: there is no
   * honest panel-shaped answer to a call the widget cannot understand.
   */
  function instanceOpenHomeAction(kind: WidgetHomeAction): boolean {
    if (destroyed) return false;
    if (kind !== 'buy' && kind !== 'sell' && kind !== 'search') return false;
    instanceOpen();
    if (homeCards[kind]) {
      showHomeAction(kind);
      return true;
    }
    // Either this tenant has that card off — in which case the panel is the
    // whole answer — or GET /widget/config is still in flight, in which case
    // applyHomeCards finishes the job.
    pendingHomeAction = kind;
    return false;
  }

  /**
   * Arm auto-open once the resolved config says it is on — at init from inline
   * or cached config, or later when the live answer turns it on. The delay
   * counts from page load, so arming late does not push the open later.
   */
  function armAutoOpen(): void {
    if (destroyed || autoOpen || !sidebar.autoOpen.enabled) return;
    autoOpen = createAutoOpenScheduler({
      publicKey: resolved.publicKey,
      config: sidebar.autoOpen,
      env: browserAutoOpenEnv(
        () => ui.host,
        undefined,
        () => hiddenByHost,
      ),
      onFire: (mode, device) => {
        if (destroyed) return;
        emitter.emit('autoopen', { mode, device, variant: sidebar.autoOpen.variant });
        // The teaser (peek card) is drawn by the sidebar UI; the panel is the
        // ordinary open, attributed to auto-open.
        if (mode === 'panel') instanceOpen('auto');
        else ui.showTeaser();
      },
    });
    autoOpen.start();
  }
  armAutoOpen();

  function currentWhatsappUrl(): string | null {
    if (!sidebar.whatsapp) return null;
    const ref = conversationExternalId ? conversationRef(conversationExternalId) : null;
    return whatsappHandoffUrl(sidebar.whatsapp.number, sidebar.whatsapp.text, ref);
  }

  // --- Demo mode (D60, spec v3 §5.8) -----------------------------------------

  const currentDemoKind = () => demoKindOf(sidebar.demoKind, sidebar.demoWorld);
  const assistantName = () => sidebar.agent?.name ?? 'Tomás';

  function pushNotice(notice: Omit<WidgetNotice, 'id' | 'at'>): void {
    notices = [
      ...notices,
      { ...notice, id: `notice:${notice.kind}:${Date.now()}:${notices.length}`, at: new Date().toISOString() },
    ];
    ui.renderMessages(messages, notices);
  }

  function dropNotices(kind: WidgetNotice['kind']): void {
    notices = notices.filter((n) => n.kind !== kind);
  }

  /** The server's words for a 429. One at a time: a second replaces the first. */
  function showRateLimited(text: string): void {
    dropNotices('rate_limited');
    pushNotice({ kind: 'rate_limited', text });
  }

  function armDemoIdle(): void {
    if (demoIdleTimer) clearTimeout(demoIdleTimer);
    demoIdleTimer = setTimeout(() => leaveDemo('idle'), DEMO_IDLE_MS);
  }

  function enterDemo(by: 'api' | 'chip' | 'typed'): void {
    if (destroyed || demoMode) return;
    demoMode = true;
    demoTurns = 0;
    demoSession = newDemoSessionId();
    pendingDemoText = null;
    dropNotices('demo_ask');
    const kind = currentDemoKind();
    ui.setDemo(true, kind);
    // The frame comes first: the visitor reads what this is before anything is sent.
    const world = sidebar.demoWorld ?? '';
    const frame =
      kind === 'automotora' ? t('sbDemoFrameAuto') : kind === 'clinica' ? t('sbDemoFrameClinic') : t('sbDemoFrame');
    pushNotice({ kind: 'demo_frame', text: frame.replace('{world}', world) });
    armDemoIdle();
    emitter.emit('demo_enter', { entry: by, world: kind });
  }

  function leaveDemo(reason: 'api' | 'visitor' | 'product' | 'turns' | 'idle'): void {
    if (destroyed || !demoMode) return;
    const turns = demoTurns;
    demoMode = false;
    demoSession = null;
    if (demoIdleTimer) clearTimeout(demoIdleTimer);
    demoIdleTimer = null;
    ui.setDemo(false);
    const name = assistantName();
    const kind = currentDemoKind();
    const exitLine = (
      kind === 'automotora' ? t('sbDemoExitLineAuto') : kind === 'clinica' ? t('sbDemoExitLineClinic') : t('sbDemoExitLine')
    ).replace('{name}', name);
    if (reason === 'product') {
      // The visitor asked about the product: the answer comes next, as the
      // assistant. The exit line's offer would come before its own answer.
      pushNotice({ kind: 'demo_exit', text: t('sbDemoLeaving').replace('{name}', name) });
    } else {
      const lead =
        reason === 'turns' ? `${t('sbDemoLeftTurns')} ` : reason === 'idle' ? `${t('sbDemoLeftIdle')} ` : '';
      pushNotice({
        kind: 'demo_exit',
        text: `${lead}${exitLine}`,
        actions: [{ id: 'demo_resume', label: t('sbDemoResume') }],
      });
    }
    emitter.emit('demo_exit', { reason, turns });
  }

  function setDemo(on: boolean, by: 'api' | 'visitor' | 'chip'): void {
    if (on) enterDemo(by === 'chip' ? 'chip' : 'api');
    else leaveDemo(by === 'visitor' ? 'visitor' : 'api');
  }

  /**
   * Called before every send. In demo mode it leaves the demo when the message
   * is about the product itself or the 12 messages are used (the message then
   * goes to the assistant), and otherwise counts the turn. Outside demo mode, a
   * typed «quiero probar» on a page that has a demo world is not sent: the
   * widget asks first. Returns `held` when the message must not be sent now.
   */
  function prepareSend(text: string, skipAsk: boolean): 'send' | 'held' {
    if (demoMode) {
      if (asksAboutProduct(text)) leaveDemo('product');
      else if (demoTurns >= DEMO_MAX_TURNS) leaveDemo('turns');
      else {
        demoTurns += 1;
        armDemoIdle();
        emitter.emit('demo_turn', { turns: demoTurns });
      }
      return 'send';
    }
    if (!skipAsk && sidebar.layout !== 'bubble' && sidebar.demoWorld && asksToTryDemo(text)) {
      pendingDemoText = text;
      dropNotices('demo_ask');
      pushNotice({
        kind: 'demo_ask',
        text: t('sbDemoAsk').replace('{world}', sidebar.demoWorld),
        actions: [
          { id: 'demo_yes', label: t('sbDemoAskYes') },
          { id: 'demo_no', label: t('sbDemoAskNo').replace('{name}', assistantName()) },
        ],
      });
      return 'held';
    }
    return 'send';
  }

  function onNoticeAction(id: 'demo_yes' | 'demo_no' | 'demo_resume'): void {
    if (destroyed) return;
    if (id === 'demo_resume') {
      dropNotices('demo_exit');
      enterDemo('api');
      return;
    }
    const text = pendingDemoText;
    pendingDemoText = null;
    dropNotices('demo_ask');
    if (id === 'demo_yes') {
      enterDemo('typed');
      return;
    }
    ui.renderMessages(messages, notices);
    if (text) void sendFlow(text, '', true);
  }

  /**
   * The pinned CTA or a booking chip. With the tenant's in-widget agenda on,
   * the calendar opens in the panel; otherwise the host page gets the `cta`
   * event and opens its own booking sheet (the landing does).
   */
  function runCta(source: 'pinned' | 'chip'): void {
    if (destroyed) return;
    if (bookingEnabled && sidebar.ctaTarget !== 'host') {
      instanceOpen(source === 'chip' ? 'chip' : 'api');
      showBooking();
      return;
    }
    emitter.emit('cta', { source });
  }

  /** A suggested question, from the panel, the peek card or under a scripted reply. */
  function runChip(path: string, from: 'panel' | 'teaser' | 'reply'): void {
    const chip = chipAt(sidebar.chips, path);
    if (destroyed || !chip) return;
    const index = Number(path.split('.').pop());
    emitter.emit('chip', { index, label: chip.label, action: chip.action, path, scripted: !!chip.reply });
    if (chip.action === 'booking') {
      runCta('chip');
      return;
    }
    if (chip.action === 'link' && chip.url) {
      // Close first: a same-page anchor (/precios#calculadora) must not land
      // behind a full-screen panel on a phone.
      instanceClose('api');
      try {
        window.location.assign(chip.url);
      } catch {
        /* a sandboxed frame: nothing to do */
      }
      return;
    }
    if (from === 'teaser') instanceOpen('chip');
    if (chip.action === 'compose') {
      instanceOpen('chip');
      ui.focusComposer(chip.message === chip.label ? '' : chip.message);
      return;
    }
    if (chip.reply) {
      runScripted(chip, path);
      return;
    }
    if (chip.action === 'demo') enterDemo('chip');
    void instanceSend(chip.message);
  }

  /**
   * A scripted chip (0.18.0): the visitor's line, a short typing beat, then
   * the reply with its next chips — all local, nothing sent. The tap joins the
   * `chips_seen` trail so the assistant knows what was answered.
   */
  function runScripted(chip: ResolvedChip, path: string): void {
    if (destroyed || scriptTimer) return;
    instanceOpen('chip');
    const seq = (scriptSeq += 1);
    messages = [
      ...messages,
      { id: `local:script:${seq}:q`, createdAt: nextLocalTimestamp(), content: chip.label, direction: 'inbound', type: 'text' },
    ];
    ui.renderMessages(messages, notices);
    chipsSeen.push(chip.label);
    scriptTyping = true;
    paintTyping();
    const beat = SCRIPT_BEAT_MIN_MS + Math.floor(Math.random() * (SCRIPT_BEAT_MAX_MS - SCRIPT_BEAT_MIN_MS + 1));
    scriptTimer = setTimeout(() => {
      scriptTimer = null;
      if (destroyed) return;
      scriptTyping = false;
      paintTyping();
      const next = (chip.next ?? []).map((c, i) => ({ label: c.label, path: `${path}.${i}`, action: c.action }));
      messages = [
        ...messages,
        {
          id: `local:script:${seq}:a`,
          createdAt: nextLocalTimestamp(),
          content: chip.reply ?? '',
          direction: 'outbound',
          type: 'text',
          ...(next.length > 0 ? { replyChips: next } : {}),
        },
      ];
      ui.renderMessages(messages, notices);
    }, beat);
  }

  /** The page's context plus the scripted taps so far (newest kept when it must be cut). */
  function pageContextWithChips(): Record<string, string> {
    const base = sidebar.pageContext;
    if (chipsSeen.length === 0) return base;
    if (Object.keys(base).length >= MAX_PAGE_CONTEXT_KEYS && !('chips_seen' in base)) return base;
    let trail = chipsSeen.join(' › ');
    if (trail.length > MAX_PAGE_CONTEXT_VALUE) trail = `…${trail.slice(-(MAX_PAGE_CONTEXT_VALUE - 1))}`;
    return { ...base, chips_seen: trail };
  }

  async function instanceSend(text: string): Promise<boolean> {
    if (destroyed || typeof text !== 'string') return false;
    const message = text.trim();
    if (message === '' || message.length > 5000) return false;
    instanceOpen('api');
    if (prepareSend(message, false) === 'held') return true;
    const clientMessageId = await beginSend(message);
    if (clientMessageId === null) return false;
    emitter.emit('message', { clientMessageId });
    void deliver(clientMessageId, message, '');
    return true;
  }

  return {
    open: () => instanceOpen('api'),
    close: () => instanceClose('api'),
    prefill(text: string): void {
      if (destroyed || typeof text !== 'string') return;
      instanceOpen('api');
      ui.focusComposer(text.slice(0, 5000));
    },
    send: instanceSend,
    enterDemo(): void {
      if (destroyed) return;
      instanceOpen('api');
      setDemo(true, 'api');
    },
    exitDemo(): void {
      setDemo(false, 'api');
    },
    hide: instanceHide,
    show: instanceShow,
    whatsappUrl: currentWhatsappUrl,
    on: (event, handler) => emitter.on(event, handler),
    openBooking: instanceOpenBooking,
    openHomeAction: instanceOpenHomeAction,
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
      if (demoIdleTimer) clearTimeout(demoIdleTimer);
      if (destroyed) return;
      destroyed = true;
      if (booking) {
        booking.destroy();
        booking = null;
      }
      if (clinicBooking) {
        clinicBooking.destroy();
        clinicBooking = null;
      }
      if (turnstileGate) {
        turnstileGate.destroy();
        turnstileGate = null;
        turnstileGateKey = null;
      }
      if (homeActions) {
        homeActions.destroy();
        homeActions = null;
      }
      identities.clear();
      autoOpen?.cancel();
      autoOpen = null;
      emitter.clear();
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
      }
      stopAwaitingReply();
      if (scriptTimer) {
        clearTimeout(scriptTimer);
        scriptTimer = null;
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
