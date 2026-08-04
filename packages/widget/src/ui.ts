// The shadow-DOM UI: a floating launcher + a conversation panel, both isolated
// from host-page CSS. This module is presentation-only — it owns NO transport
// state; index.ts wires it to VitrinaTransport via the callbacks below.
//
// XSS SAFETY (AC#6): message content reaches the DOM only as text nodes or as
// elements built by ./markdown, which constructs nodes and never produces an
// HTML string; ids and metadata go through dataset/setAttribute. There is NO
// innerHTML anywhere, no eval, no remote script/style/asset (the only remote
// assets are a validated logo <img> and validated http(s) link targets).

import {
  createBookingUi,
  type BookingCallbacks,
  type BookingUi,
  type BookingViewState,
} from './booking-ui';
import type { WidgetMessage, WidgetNotice } from './config';
import { makeT, type StringKey, type Translate } from './i18n';
import { renderMarkdown } from './markdown';
import { STYLES } from './styles';
import { resolveAccent, resolvePosition, validateLogoUrl } from './theme';
import type { WidgetLocale, WidgetTheme } from './types';

export type BannerState = 'none' | 'offline' | 'reconnecting' | 'error' | 'sending';

export interface WidgetUiCallbacks {
  /** Composer submit: raw text + the honeypot field value (empty for humans). */
  onSend(text: string, honeypot: string): void;
  /** Launcher clicked — host decides to open (and kick off the session). */
  onRequestOpen(): void;
  /** Close button clicked. */
  onRequestClose(): void;
  /** Retry a failed send, re-using its ORIGINAL client message id (idempotent). */
  onRetry(clientMessageId: string): void;
  /** "Agendar visita" chip. Absent ⇒ no booking surface is ever constructed. */
  onBookingOpen?(): void;
  /** "Mis visitas · N" chip. */
  onVisitsOpen?(): void;
  /** Everything the booking overlay reports. */
  booking?: BookingCallbacks;
}

/**
 * A booking overlay built without callbacks still has to be coherent — it just
 * reports nowhere. Cheaper and safer than making every field of
 * BookingCallbacks optional at the call site.
 */
const noopBooking: BookingCallbacks = {
  onClose: () => {},
  onBack: () => {},
  onPrevMonth: () => {},
  onNextMonth: () => {},
  onPickDay: () => {},
  onPickSlot: () => {},
  onFormChange: () => {},
  onSubmitForm: () => {},
  onConfirm: () => {},
  onDone: () => {},
  onAskCancel: () => {},
  onKeepVisit: () => {},
  onConfirmCancel: () => {},
  onBookAgain: () => {},
  onChatFallback: () => {},
  onRetry: () => {},
};

export interface WidgetUiOptions {
  t: Translate;
  /** The locale `t` was built from — the calendar needs it for Intl, not just t. */
  locale: WidgetLocale;
  theme: WidgetTheme;
  welcomeMessage: string | null;
  callbacks: WidgetUiCallbacks;
  /**
   * Mount invisibly, awaiting `reveal()`. Used ONLY when the appearance is
   * coming from the server and we have no cached copy to paint with — showing a
   * default-black launcher that snaps to the dealer's brand colour a moment
   * later looks broken on their own site. The caller guarantees a reveal on a
   * timer regardless of the network, so this can never hide the widget.
   */
  hidden?: boolean;
}

export interface WidgetUi {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  mount(): void;
  destroy(): void;
  openPanel(): void;
  closePanel(): void;
  isOpen(): boolean;
  /**
   * Repaint the panel from the caller's message list. The list is the single
   * source of truth for what is on screen — including the visitor's own not-yet
   * -persisted messages, which are ENTRIES in it, not DOM artifacts. A repaint
   * can therefore never lose one.
   */
  renderMessages(messages: WidgetMessage[], notices?: WidgetNotice[]): void;
  setBanner(state: BannerState): void;
  /** Unread replies waiting behind a closed panel. 0 hides the badge. */
  setUnread(count: number): void;
  /** Someone is composing a reply. The widget never says who. */
  setTyping(active: boolean): void;
  /**
   * Re-theme a MOUNTED widget (ADR 0046) — accent, corner, header logo. Every
   * value goes through the same sanitizers as the initial paint; an unusable
   * one falls back to the default rather than being skipped, so the widget can
   * never be left half-themed.
   */
  applyTheme(theme: WidgetTheme): void;
  /** Swap the pre-conversation greeting, repainting it if it is on screen. */
  setWelcomeMessage(message: string | null): void;
  /** Swap the chrome language, re-rendering every static string in place. */
  setLocale(locale: WidgetLocale): void;
  /** Show a widget mounted with `hidden`. Idempotent, and safe to call when it
   *  was never hidden in the first place. */
  reveal(): void;

  // --- Booking (S15-21) -----------------------------------------------------
  // Every one of these is inert until setBookingEnabled(true). Nothing is even
  // CONSTRUCTED before then: a tenant without the agenda gets the same DOM the
  // widget has always produced, node for node.

  /** Show/hide the booking entry over the composer. */
  setBookingEnabled(enabled: boolean): void;
  /** Chip presence + the count on "Mis visitas · N". */
  setVisitCount(info: { hasBookings: boolean; upcoming: number }): void;
  /** Cover the panel with the booking overlay. The transcript is NOT destroyed. */
  openBooking(): void;
  /** Uncover the transcript. A `hidden` flip, never a re-render. */
  closeBooking(): void;
  isBookingOpen(): boolean;
  /** Full repaint of the overlay from the caller's state. */
  renderBooking(state: BookingViewState): void;
  /**
   * Put a draft in the composer and focus it. The escape hatch out of every
   * booking dead end (empty month, booked on another device) is a human, and
   * the human is one message away in the panel behind the overlay.
   */
  focusComposer(draft?: string): void;
}

interface TrackedListener {
  target: EventTarget;
  type: string;
  handler: EventListener;
}

/** Banner state -> the i18n key whose string it shows. */
const BANNER_STRING: Record<Exclude<BannerState, 'none'>, StringKey> = {
  offline: 'offline',
  reconnecting: 'reconnecting',
  error: 'error',
  sending: 'sending',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHAT_ICON_PATH =
  'M12 2C6.48 2 2 5.94 2 10.8c0 2.5 1.2 4.74 3.13 6.32-.1 1.2-.53 2.4-1.36 3.42-.2.24-.02.6.29.56 1.9-.26 3.3-.86 4.28-1.5.83.2 1.72.3 2.66.3 5.52 0 10-3.94 10-8.8S17.52 2 12 2z';

/** Build the launcher's chat glyph via the DOM — no innerHTML anywhere (AC#6). */
function chatIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', CHAT_ICON_PATH);
  svg.appendChild(path);
  return svg;
}

/**
 * Build the widget UI. Nothing is attached to the page until mount() is called;
 * destroy() removes the host node and every tracked listener.
 */
export function createWidgetUI(opts: WidgetUiOptions): WidgetUi {
  const { theme, callbacks } = opts;
  // Both are MUTABLE: the server-resolved appearance (ADR 0046) can land after
  // mount and must be able to change the language and the greeting in place.
  let t: Translate = opts.t;
  let currentLocale: WidgetLocale = opts.locale;
  let welcomeMessage: string | null = opts.welcomeMessage;

  const host = document.createElement('div');
  // Defensive light-DOM styles: the shadow root protects everything INSIDE it,
  // but not the host element itself — pin it so host CSS cannot hide/mis-stack
  // the launcher (review requirement).
  host.setAttribute('data-vitrina-widget', '');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('z-index', '2147483000', 'important');
  host.style.setProperty('bottom', '0', 'important');
  host.style.setProperty('width', '0', 'important');
  host.style.setProperty('height', '0', 'important');
  host.style.setProperty('visibility', 'visible', 'important');
  host.style.setProperty('display', 'block', 'important');

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'vtr-root';

  /**
   * Pin the corner in BOTH places that care: the shadow root (which draws the
   * launcher + panel) and the light-DOM host (which is pinned defensively
   * against host-page CSS). The unused side must be REMOVED, not left at 0 —
   * flipping br→bl while `right: 0 !important` still applies would stretch the
   * host across the viewport and swallow clicks on the page underneath.
   */
  function applyPosition(pos: WidgetTheme['position']): void {
    const resolved = resolvePosition(pos);
    root.setAttribute('data-pos', resolved);
    host.style.removeProperty(resolved === 'bl' ? 'right' : 'left');
    host.style.setProperty(resolved === 'bl' ? 'left' : 'right', '0', 'important');
  }
  applyPosition(theme.position);
  root.style.setProperty('--vtr-accent', resolveAccent(theme.accent));
  if (opts.hidden) root.style.setProperty('visibility', 'hidden');

  // --- Launcher ---
  const launcher = document.createElement('button');
  launcher.className = 'vtr-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', t('launcherLabel'));
  launcher.appendChild(chatIcon());

  // Unread badge. Lives on the launcher, hidden at zero. `aria-hidden` because
  // the count is announced through the launcher's own aria-label instead — a
  // screen reader should hear "Open chat, 2 unread messages", not a loose "2".
  const badge = document.createElement('span');
  badge.className = 'vtr-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.hidden = true;
  launcher.appendChild(badge);

  // --- Panel ---
  const panel = document.createElement('div');
  panel.className = 'vtr-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('title'));
  panel.hidden = true;

  const header = document.createElement('div');
  header.className = 'vtr-header';
  // Always in the DOM, hidden until there is a URL worth loading. Created up
  // front (rather than inserted on demand) so a logo arriving with the
  // server-resolved config lands in the right slot without re-ordering the
  // header — and so `hidden` + no `src` means no request and nothing drawn.
  const logo = document.createElement('img');
  logo.className = 'vtr-logo';
  logo.alt = '';
  logo.hidden = true;

  /** Point the header logo at `url`, or hide it. Re-validated every time: this
   *  runs again for every server-resolved config, not just the first paint. */
  function applyLogo(url: string | undefined): void {
    const href = validateLogoUrl(url);
    if (href) {
      logo.src = href;
      logo.hidden = false;
      return;
    }
    logo.hidden = true;
    logo.removeAttribute('src');
  }
  applyLogo(theme.logoUrl);
  header.appendChild(logo);

  const title = document.createElement('span');
  title.className = 'vtr-title';
  title.textContent = t('title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'vtr-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', t('close'));
  closeBtn.textContent = '×';
  header.append(title, closeBtn);

  const messagesEl = document.createElement('div');
  messagesEl.className = 'vtr-messages';

  // Typing indicator. A SIBLING of the message list, not an entry in it: it is
  // not a message, it must not survive a repaint, and it must never be mistaken
  // for one. Three animated dots and no name — the visitor is never told
  // whether the AI or a person is composing (ADR 0035 ¶1).
  const typingEl = document.createElement('div');
  typingEl.className = 'vtr-typing';
  typingEl.hidden = true;
  typingEl.setAttribute('role', 'status');
  typingEl.setAttribute('aria-label', t('typing'));
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'vtr-typing-dot';
    typingEl.appendChild(dot);
  }

  const banner = document.createElement('div');
  banner.className = 'vtr-banner';
  banner.hidden = true;

  const form = document.createElement('form');
  form.className = 'vtr-composer';
  const input = document.createElement('textarea');
  input.className = 'vtr-input';
  input.rows = 1;
  input.placeholder = t('placeholder');
  input.setAttribute('aria-label', t('placeholder'));
  const honeypot = document.createElement('input');
  honeypot.className = 'vtr-hp';
  honeypot.type = 'text';
  honeypot.name = 'hp_website';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');
  const sendBtn = document.createElement('button');
  sendBtn.className = 'vtr-sendbtn';
  sendBtn.type = 'submit';
  sendBtn.textContent = t('send');
  form.append(honeypot, input, sendBtn);

  const footer = document.createElement('div');
  footer.className = 'vtr-footer';
  footer.textContent = t('poweredBy');

  panel.append(header, messagesEl, typingEl, banner, form, footer);
  root.append(launcher, panel);
  shadow.appendChild(root);

  // --- state + listeners ---
  const listeners: TrackedListener[] = [];
  let open = false;
  // Remembered so a locale swap can re-derive anything already on screen. Both
  // are already implied by the DOM, but reading them back out of it would mean
  // parsing our own rendered strings.
  let bannerState: BannerState = 'none';
  let unreadCount = 0;

  function on(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    listeners.push({ target, type, handler });
  }

  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /**
   * A vehicle card: photo, title, price, and a link when the listing has one.
   * The moat — Intercom cannot show a car, and the widget already knows which
   * car the visitor is looking at.
   *
   * Built from DOM nodes like everything else here. The image and link URLs were
   * validated server-side AND are validated again through validateHttpUrl: a
   * card with a hostile URL renders without it rather than not at all.
   */
  function stockCard(card: NonNullable<WidgetMessage['stockCard']>): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vtr-card';
    el.dataset.vehicleId = card.vehicleId;

    const thumb = validateLogoUrl(card.thumbnailUrl);
    if (thumb) {
      const img = document.createElement('img');
      img.className = 'vtr-card-img';
      img.src = thumb;
      img.alt = '';
      img.loading = 'lazy';
      el.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'vtr-card-body';

    const title = document.createElement('div');
    title.className = 'vtr-card-title';
    title.textContent = card.title;
    body.appendChild(title);

    if (card.price) {
      const price = document.createElement('div');
      price.className = 'vtr-card-price';
      price.textContent = card.price;
      body.appendChild(price);
    }

    const href = validateLogoUrl(card.listingUrl);
    if (href) {
      const link = document.createElement('a');
      link.className = 'vtr-card-link';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = t('viewVehicle');
      body.appendChild(link);
    }

    el.appendChild(body);
    return el;
  }

  /**
   * Attachment images for a media row, ABOVE the prose (the caption reads
   * under its photo, WhatsApp-style). URLs were filtered server-side and are
   * validated again here; an unusable URL is skipped rather than rendered
   * broken. Each image links out to its full-size original.
   */
  function mediaImages(urls: string[]): HTMLElement | null {
    const wrap = document.createElement('div');
    wrap.className = 'vtr-media';
    for (const raw of urls) {
      const href = validateLogoUrl(raw);
      if (!href) continue;
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const img = document.createElement('img');
      img.className = 'vtr-media-img';
      img.src = href;
      img.alt = '';
      img.loading = 'lazy';
      link.appendChild(img);
      wrap.appendChild(link);
    }
    return wrap.childElementCount > 0 ? wrap : null;
  }

  function bubble(dir: 'inbound' | 'outbound', content: string, id?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vtr-msg';
    el.setAttribute('data-dir', dir);
    if (id !== undefined) el.dataset.id = id;
    if (dir === 'outbound') {
      // Server-authored: the dealer's reply, the AI's reply, or the dealer's
      // configured greeting. Rendered through the safe-subset markdown parser,
      // which builds DOM nodes — an injected tag becomes a text node, because
      // no code path anywhere parses HTML.
      el.appendChild(renderMarkdown(content));
    } else {
      // The visitor's own text. They typed it; render it verbatim.
      el.textContent = content;
    }
    return el;
  }

  /**
   * A failed message gets an inline retry control rather than a toast: the
   * affordance belongs next to the thing that failed, and the visitor should
   * never have to wonder WHICH message did not go out.
   *
   * No listener is attached here. Every repaint rebuilds these nodes, so a
   * per-button listener would accumulate in the tracked-listener array without
   * bound. The click is handled by ONE delegated listener on the message list,
   * which reads `data-retry`.
   */
  function retryControl(clientMessageId: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vtr-msg-status';
    wrap.setAttribute('data-status', 'failed');
    const label = document.createElement('span');
    label.textContent = t('notSent');
    const btn = document.createElement('button');
    btn.className = 'vtr-retry';
    btn.type = 'button';
    btn.textContent = t('retry');
    btn.dataset.retry = clientMessageId;
    wrap.append(label, btn);
    return wrap;
  }

  /**
   * A centered system line. NOT a bubble: no author, no direction, no avatar.
   * It says that a person joined; it never says which person. A workspace
   * member's name must never reach an anonymous browser on a third-party origin,
   * and adding an opt-in operator name later is far easier than un-leaking one.
   */
  function systemLine(text: string, id: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vtr-system';
    el.dataset.id = id;
    el.setAttribute('role', 'status');
    el.textContent = text;
    return el;
  }

  /**
   * The pre-conversation greeting. Tagged `data-welcome` so it can be found
   * and rewritten in place when the server-resolved greeting (or language)
   * arrives after the panel is already open — it is an ephemeral bubble with no
   * message behind it, so a repaint from the message list would not restore it.
   */
  function renderWelcome(): void {
    const greeting = welcomeMessage ?? t('welcome');
    const el = bubble('outbound', greeting);
    el.dataset.welcome = '1';
    messagesEl.appendChild(el);
  }

  /** Rewrite the greeting bubble if (and only if) it is currently on screen. */
  function repaintWelcome(): void {
    const existing = messagesEl.querySelector('[data-welcome]');
    if (!existing) return;
    const el = bubble('outbound', welcomeMessage ?? t('welcome'));
    el.dataset.welcome = '1';
    existing.replaceWith(el);
  }

  // --- Booking surface (constructed on demand) --------------------------------
  //
  // LAZY BY DESIGN. `setBookingEnabled(true)` is the only thing that can bring
  // any of this into existence, and it is only ever called for a tenant whose
  // `GET /widget/config` said `bookingEnabled`. Until then the panel's children
  // are header → messages → typing → banner → composer → footer, exactly as
  // they have always been — not a hidden chip, not an empty overlay, nothing.
  let actions: HTMLElement | null = null;
  let bookBtn: HTMLButtonElement | null = null;
  let visitsBtn: HTMLButtonElement | null = null;
  let bookingUi: BookingUi | null = null;
  let bookingOpen = false;
  let visitInfo = { hasBookings: false, upcoming: 0 };

  function paintVisitsChip(): void {
    if (!visitsBtn) return;
    visitsBtn.hidden = !visitInfo.hasBookings;
    visitsBtn.textContent =
      visitInfo.upcoming > 0 ? `${t('myVisits')} · ${visitInfo.upcoming}` : t('myVisits');
  }

  function ensureBooking(): void {
    if (actions) return;
    actions = document.createElement('div');
    actions.className = 'vtr-actions';

    bookBtn = document.createElement('button');
    bookBtn.className = 'vtr-chip vtr-chip-book';
    bookBtn.type = 'button';
    bookBtn.textContent = t('bookVisit');

    visitsBtn = document.createElement('button');
    visitsBtn.className = 'vtr-chip vtr-chip-visits';
    visitsBtn.type = 'button';
    visitsBtn.hidden = true;
    visitsBtn.textContent = t('myVisits');

    actions.append(bookBtn, visitsBtn);
    // Over the composer, under the banner: always in view, never in the way,
    // and it never covers a single line of the conversation.
    panel.insertBefore(actions, form);

    bookingUi = createBookingUi({
      getT: () => t,
      getLocale: () => currentLocale,
      // A widget built without booking callbacks still gets a coherent overlay;
      // it simply reports nowhere. Cheaper than making every field optional.
      callbacks: callbacks.booking ?? noopBooking,
      on,
    });
    panel.appendChild(bookingUi.root);

    on(bookBtn, 'click', () => callbacks.onBookingOpen?.());
    on(visitsBtn, 'click', () => callbacks.onVisitsOpen?.());
    paintVisitsChip();
  }

  const ui: WidgetUi = {
    host,
    shadow,
    mount(): void {
      if (!host.isConnected) document.body.appendChild(host);
    },
    destroy(): void {
      for (const { target, type, handler } of listeners) {
        target.removeEventListener(type, handler);
      }
      listeners.length = 0;
      if (host.isConnected) host.remove();
    },
    openPanel(): void {
      open = true;
      panel.hidden = false;
      launcher.hidden = true;
      // Paint the ephemeral greeting on first open if the list is still empty.
      if (messagesEl.childElementCount === 0) renderWelcome();
      input.focus();
      scrollToBottom();
    },
    closePanel(): void {
      open = false;
      panel.hidden = true;
      launcher.hidden = false;
    },
    isOpen(): boolean {
      return open;
    },
    renderMessages(messages: WidgetMessage[], notices: WidgetNotice[] = []): void {
      // Repaint from the caller's list, which INCLUDES the visitor's own
      // not-yet-persisted messages. This used to clear the panel and render
      // server rows only, so any local echo was destroyed on every repaint —
      // and a repaint fires after every send. The echo now survives by
      // construction, because it is in `messages`.
      messagesEl.replaceChildren();
      if (messages.length === 0 && notices.length === 0) {
        if (open) renderWelcome();
        return;
      }
      // Interleave notices into the transcript by timestamp, so "an advisor
      // joined" appears where it happened rather than pinned to the bottom.
      const items: Array<{ at: string; render: () => void }> = [
        ...messages.map((m) => ({
          at: m.createdAt,
          render: () => {
            const el = bubble(m.direction, m.content, String(m.id));
            if (m.status) el.setAttribute('data-status', m.status);
            // Photos ride ABOVE the caption. A row whose every URL fails
            // validation is simply its caption — never a blank bubble.
            if (m.mediaUrls && m.mediaUrls.length > 0) {
              const media = mediaImages(m.mediaUrls);
              if (media) el.prepend(media);
            }
            // The card ENHANCES the prose; it never replaces it. A row whose
            // type we do not recognise, or whose card the server declined to
            // project, is simply the reply it always was — never a blank bubble.
            if (m.type === 'stock_card' && m.stockCard) {
              el.appendChild(stockCard(m.stockCard));
            }
            messagesEl.appendChild(el);
            if (m.status === 'failed' && m.clientMessageId) {
              messagesEl.appendChild(retryControl(m.clientMessageId));
            }
          },
        })),
        ...notices.map((n) => ({
          at: n.at,
          render: () => messagesEl.appendChild(systemLine(t('advisorJoined'), n.id)),
        })),
      ];
      items.sort((a, b) => {
        const ta = Date.parse(a.at);
        const tb = Date.parse(b.at);
        return Number.isFinite(ta) && Number.isFinite(tb) ? ta - tb : 0;
      });
      for (const item of items) item.render();
      scrollToBottom();
    },
    setBanner(state: BannerState): void {
      bannerState = state;
      if (state === 'none') {
        banner.hidden = true;
        banner.removeAttribute('data-state');
        return;
      }
      banner.hidden = false;
      banner.setAttribute('data-state', state);
      banner.textContent = BANNER_STRING[state] ? t(BANNER_STRING[state]) : '';
    },
    applyTheme(next: WidgetTheme): void {
      applyPosition(next.position);
      // resolveAccent falls back to the default on an unusable value, so a
      // hostile or malformed colour leaves a coherent widget rather than one
      // wearing half of two themes.
      root.style.setProperty('--vtr-accent', resolveAccent(next.accent));
      applyLogo(next.logoUrl);
    },
    setWelcomeMessage(message: string | null): void {
      if (message === welcomeMessage) return;
      welcomeMessage = message;
      repaintWelcome();
    },
    setBookingEnabled(enabled: boolean): void {
      if (!enabled) {
        // Never constructed ⇒ nothing to hide. A tenant who never had booking
        // must not gain a hidden node for having been asked about it.
        if (!actions) return;
        actions.hidden = true;
        ui.closeBooking();
        return;
      }
      ensureBooking();
      if (actions) actions.hidden = false;
    },
    setVisitCount(info: { hasBookings: boolean; upcoming: number }): void {
      visitInfo = {
        hasBookings: !!info?.hasBookings,
        upcoming: Number.isFinite(info?.upcoming) ? Math.max(0, Math.trunc(info.upcoming)) : 0,
      };
      paintVisitsChip();
    },
    openBooking(): void {
      ensureBooking();
      if (!bookingUi) return;
      bookingOpen = true;
      bookingUi.root.hidden = false;
      // The composer and the chips go with it (CSS): while the overlay is up
      // there is exactly one thing to do, and nothing behind it is tabbable.
      panel.setAttribute('data-booking', '1');
    },
    closeBooking(): void {
      bookingOpen = false;
      if (bookingUi) bookingUi.root.hidden = true;
      panel.removeAttribute('data-booking');
    },
    isBookingOpen(): boolean {
      return bookingOpen;
    },
    renderBooking(state: BookingViewState): void {
      ensureBooking();
      bookingUi?.render(state);
    },
    focusComposer(draft?: string): void {
      if (draft !== undefined) input.value = draft;
      input.focus();
      scrollToBottom();
    },
    setLocale(locale: WidgetLocale): void {
      t = makeT(locale);
      currentLocale = locale;
      // Every string painted ONCE at construction has to be repainted here, or
      // the panel ends up half-translated. The message list is server data and
      // is never translated; the greeting is, because it may be ours.
      launcher.setAttribute('aria-label', t('launcherLabel'));
      panel.setAttribute('aria-label', t('title'));
      title.textContent = t('title');
      closeBtn.setAttribute('aria-label', t('close'));
      typingEl.setAttribute('aria-label', t('typing'));
      input.placeholder = t('placeholder');
      input.setAttribute('aria-label', t('placeholder'));
      sendBtn.textContent = t('send');
      footer.textContent = t('poweredBy');
      // Re-derive anything currently rendered from a string: the unread count
      // is folded into the launcher's aria-label, and a visible banner would
      // otherwise keep the old language until its next state change.
      ui.setUnread(unreadCount);
      if (bannerState !== 'none') ui.setBanner(bannerState);
      repaintWelcome();
      // The booking surface is chrome too: a language swap that left the
      // calendar in Spanish would be the same half-translated panel this
      // method exists to prevent.
      if (bookBtn) bookBtn.textContent = t('bookVisit');
      paintVisitsChip();
      bookingUi?.setLocale();
    },
    reveal(): void {
      root.style.removeProperty('visibility');
    },
    setTyping(active: boolean): void {
      typingEl.hidden = !active;
      if (active) scrollToBottom();
    },
    setUnread(count: number): void {
      const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
      unreadCount = n;
      if (n === 0) {
        badge.hidden = true;
        badge.textContent = '';
        launcher.setAttribute('aria-label', t('launcherLabel'));
        return;
      }
      badge.hidden = false;
      // A dealer chat never has 100 unread replies; cap the glyph anyway so a
      // pathological count cannot stretch the launcher off the page.
      badge.textContent = n > 99 ? '99+' : String(n);
      launcher.setAttribute('aria-label', `${t('launcherLabel')} — ${n} ${t('unread')}`);
    },
  };

  // Wire interactions.
  on(launcher, 'click', () => callbacks.onRequestOpen());
  on(closeBtn, 'click', () => callbacks.onRequestClose());

  // ONE delegated listener for every retry button, present and future. Retry
  // buttons are rebuilt on each repaint, so binding per-button would grow the
  // tracked-listener array without bound.
  on(messagesEl, 'click', (e) => {
    const target = e.target as HTMLElement | null;
    const clientMessageId = target?.dataset?.retry;
    if (clientMessageId) callbacks.onRetry(clientMessageId);
  });

  function submit(): void {
    const text = input.value.trim();
    if (text === '') return;
    const hp = honeypot.value;
    input.value = '';
    callbacks.onSend(text, hp);
  }

  on(form, 'submit', (e) => {
    e.preventDefault();
    submit();
  });
  // Enter to send, Shift+Enter for a newline.
  on(input, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }) as EventListener);

  return ui;
}
