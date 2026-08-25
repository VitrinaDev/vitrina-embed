// The shadow-DOM UI: a floating launcher + a conversation panel, both isolated
// from host-page CSS. This module is presentation-only — it owns NO transport
// state; index.ts wires it to VitrinaTransport via the callbacks below.
//
// XSS SAFETY (AC#6): message content reaches the DOM only as text nodes or as
// elements built by ./markdown, which constructs nodes and never produces an
// HTML string; ids and metadata go through dataset/setAttribute. There is NO
// innerHTML anywhere and no eval. The remote assets are exactly three, all of
// them inert: a validated logo <img>, validated http(s) link targets, and — in
// the HOST document rather than the shadow root, because @font-face has to be —
// one Google Fonts <link> per configured family (see ./fonts).

import {
  createBookingUi,
  type BookingCallbacks,
  type BookingUi,
  type BookingViewState,
} from './booking-ui';
import {
  resolveHomeCards,
  type ResolvedHelp,
  type ResolvedHome,
  type ResolvedHomeCards,
  type TeamMember,
  type WidgetMessage,
  type WidgetNotice,
} from './config';
import { ensureFontLoaded, fontStack } from './fonts';
import {
  createHomeActionsUi,
  type HomeActionCallbacks,
  type HomeActionsUi,
  type HomeActionViewState,
} from './home-actions-ui';
import { makeT, type StringKey, type Translate } from './i18n';
import { renderMarkdown } from './markdown';
import { STYLES } from './styles';
import { resolveAccent, resolvePosition, validateLogoUrl } from './theme';
import type { WidgetFont, WidgetHomeAction, WidgetLocale, WidgetTheme } from './types';

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
  /** The booking chip. Absent ⇒ no booking surface is ever constructed. */
  onBookingOpen?(): void;
  /** "Mis reservas · N" chip. */
  onVisitsOpen?(): void;
  /** Everything the booking overlay reports. */
  booking?: BookingCallbacks;
  /** A Home quick-action card was tapped. Absent ⇒ the cards are inert. */
  onHomeAction?(kind: WidgetHomeAction): void;
  /** Everything the quick-action overlay reports. */
  homeActions?: HomeActionCallbacks;
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

/** The same courtesy for the quick-action overlay: coherent, reporting nowhere. */
const noopHomeActions: HomeActionCallbacks = {
  onClose: () => {},
  onBack: () => {},
  onFormChange: () => {},
  onPickPhotos: () => {},
  onRemovePhoto: () => {},
  onPrimary: () => {},
};

export interface WidgetUiOptions {
  t: Translate;
  /** The locale `t` was built from — the calendar needs it for Intl, not just t. */
  locale: WidgetLocale;
  theme: WidgetTheme;
  welcomeMessage: string | null;
  /** Typeface. Omitted ⇒ 'system': nothing is loaded and nothing changes. */
  font?: WidgetFont;
  /**
   * The tenant's own name for the booking chip, already normalized. null ⇒ the
   * built-in "Agendar visita" / "Book a visit", which follows the locale.
   */
  bookingLabel?: string | null;
  /**
   * The Home tab. Omitted (or `enabled: false`) ⇒ no tab bar and no Home view
   * is ever constructed — see the lazy-construction note above `ensureViews`.
   */
  home?: ResolvedHome;
  /** The Help tab. Same zero-DOM-until-needed rule. */
  help?: ResolvedHelp;
  /** Faces for the Home hero's avatar stack. Empty ⇒ no stack. */
  team?: TeamMember[];
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
  /**
   * Re-typeface a MOUNTED widget. Declares the family in the HOST document (the
   * only place `@font-face` works — see ./fonts) and points the shadow styles at
   * it. Idempotent: calling it twice with the same font loads nothing twice, and
   * 'system' both loads nothing and restores the original stack exactly.
   */
  applyFont(font: WidgetFont): void;
  /** Swap the booking chip's copy. null restores the built-in, locale-driven one. */
  setBookingLabel(label: string | null): void;
  /** Swap the pre-conversation greeting, repainting it if it is on screen. */
  setWelcomeMessage(message: string | null): void;
  /** Swap the chrome language, re-rendering every static string in place. */
  setLocale(locale: WidgetLocale): void;

  // --- Tabs: Home / Messages / Help (0.8.0) ---------------------------------
  // Same contract as the booking surface above: NOTHING is constructed until a
  // resolved config says the surface is on. A tenant with neither Home nor Help
  // gets the panel the widget has always produced — no `.vtr-views` wrapper, no
  // `.vtr-tabs` node, node for node.

  /** Turn the Home tab on/off and repaint its greeting. Does NOT touch the
   *  quick-action gates — those have their own setter, for the same reason
   *  `bookingEnabled` is not part of `setBookingLabel`. */
  setHomeConfig(home: ResolvedHome): void;
  /** Turn the Help tab on/off and rebuild its FAQ accordion. */
  setHelpConfig(help: ResolvedHelp): void;
  /** Faces for the Home hero. An empty list removes the stack. */
  setTeam(team: TeamMember[]): void;
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

  // --- Home quick actions (0.9.0) -------------------------------------------
  // Same contract as the booking surface: inert, and UNBUILT, until a resolved
  // config turns a card on. A tenant with all three off gets the 0.8.x panel,
  // node for node — not a hidden card and not an empty overlay.

  /** Show/hide the three quick-action cards on Home, and build the overlay the
   *  first time any of them is on. */
  setHomeCards(cards: ResolvedHomeCards | undefined): void;
  /** Cover the panel with one quick-action flow. The transcript is NOT destroyed. */
  openHomeAction(kind: WidgetHomeAction): void;
  /** Uncover the transcript. A `hidden` flip, never a re-render. */
  closeHomeAction(): void;
  isHomeActionOpen(): boolean;
  /** Full repaint of the quick-action overlay from the caller's state. */
  renderHomeAction(state: HomeActionViewState): void;
  /** Show the conversation. Where a submitted buy/search lands: the message is
   *  in the transcript, and the transcript is the confirmation. */
  showMessages(): void;
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
 * The stroked line icons for the tab bar and the Home cards. Same
 * createElementNS discipline as the launcher glyph — these are module
 * constants, never built from anything a tenant can supply.
 *
 * Stroke rather than fill so a single `currentColor` carries both the muted
 * inactive state and the dealer's accent on the active tab.
 */
const ICONS = {
  home: ['M3 10.4 12 3l9 7.4V20a1 1 0 0 1-1 1h-4.6v-6.1H8.6V21H4a1 1 0 0 1-1-1z'],
  chat: [
    'M20.5 11.6c0 4.2-3.8 7.6-8.5 7.6-1 0-2-.15-2.9-.42L4 20.6l1.5-3.9C4 15.3 3.5 13.5 3.5 11.6 3.5 7.4 7.3 4 12 4s8.5 3.4 8.5 7.6z',
  ],
  help: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    'M9.3 9.3A2.8 2.8 0 0 1 12 7.4c1.6 0 2.8 1 2.8 2.4 0 1.9-2.7 2.3-2.7 4',
    'M12 16.6h.01',
  ],
  send: ['M21.5 2.5 10.8 13.2', 'M21.5 2.5 14.7 21.5l-3.9-8.3-8.3-3.9z'],
  calendar: [
    'M4.5 6.4h15a1 1 0 0 1 1 1v11.6a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7.4a1 1 0 0 1 1-1z',
    'M8 3.5v5',
    'M16 3.5v5',
    'M3.5 11.4h17',
  ],
  chevronRight: ['m9.5 5.5 6.5 6.5-6.5 6.5'],
  chevronDown: ['m5.5 9 6.5 6.5L18.5 9'],
  // The three quick actions: a car (comprar), a price tag (vender) and a
  // magnifier (lo buscamos por ti). Wheels are arcs rather than <circle> so the
  // whole set stays a list of `d` strings.
  car: [
    'M4.6 12.4 6.7 7.7a2 2 0 0 1 1.8-1.2h7a2 2 0 0 1 1.8 1.2l2.1 4.7',
    'M3.5 12.4h17v4.3a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z',
    'M8.4 15.1a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z',
    'M17.8 15.1a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z',
  ],
  tag: [
    'M20.6 13.4 11.6 4.4a2 2 0 0 0-1.4-.6H4.8a1 1 0 0 0-1 1v5.4c0 .5.2 1 .6 1.4l9 9a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8z',
    'M7.9 7.9h.01',
  ],
  search: ['M18 10.6a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', 'm16 15.6 4.5 4.5'],
} as const;

/** One stroked 24×24 glyph. `paths` is always a module constant (see ICONS). */
function strokeIcon(paths: readonly string[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * The eight initials backgrounds. Picked deterministically from the member's
 * name, so the same person is the same colour on every pageview and across
 * every repaint — an avatar that changes colour reads as a different person.
 *
 * All eight are dark enough to carry white text at 11px (contrast ≥ 4.5:1).
 */
const AVATAR_COLORS = [
  '#0f766e',
  '#b45309',
  '#4338ca',
  '#be123c',
  '#15803d',
  '#7c3aed',
  '#0369a1',
  '#9a3412',
];

/** FNV-1a over the name → a palette INDEX. Stable, and never a network call. */
function avatarColorIndex(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % AVATAR_COLORS.length;
}

/** "María Fernández" → "MF"; "Pedro" → "P". Never more than two letters. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p !== '');
  const first = parts[0]?.charAt(0) ?? '';
  const second = parts.length > 1 ? parts[1].charAt(0) : '';
  return (first + second).toUpperCase();
}

/** Which view the panel is showing. Only ever one, only ever these three. */
type ViewName = 'home' | 'messages' | 'help';

/** Longest preview we put in the DOM. CSS ellipsis does the visible truncation;
 *  this only stops a 4kB reply from becoming a 4kB text node. */
const MAX_PREVIEW = 160;

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
  // The tenant's own word for the booking flow. NOT a translation key: it is
  // whatever the dealer typed, in whatever language, and a locale swap leaves it
  // alone on purpose.
  let bookingLabel: string | null = opts.bookingLabel ?? null;
  // The tab surfaces. All three are MUTABLE for the same reason as the
  // greeting: the server-resolved config lands after mount and must be able to
  // bring Home and Help into existence without a remount.
  let homeCfg: ResolvedHome = opts.home ?? { enabled: false, title: null, subtitle: null };
  let helpCfg: ResolvedHelp = opts.help ?? { enabled: false, faqs: [] };
  let team: TeamMember[] = opts.team ?? [];

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

  /**
   * Point the widget at a typeface. Two halves, and BOTH are needed:
   *
   *   1. the face is declared in the host document (`ensureFontLoaded`), because
   *      a shadow root cannot host an @font-face the engine will honour;
   *   2. the family is applied inside the shadow styles, via `--vtr-font`.
   *
   * The stack always ends in the system fonts, so half 1 failing — a dealer CSP,
   * an offline visitor, a blocked CDN — costs the widget nothing but the face.
   * 'system' REMOVES the property rather than setting an equal value, so the
   * widget falls back to the :host declaration it has always had.
   */
  function applyFont(font: WidgetFont): void {
    ensureFontLoaded(font);
    if (font === 'system') {
      root.style.removeProperty('--vtr-font');
      return;
    }
    root.style.setProperty('--vtr-font', fontStack(font));
  }
  applyFont(opts.font ?? 'system');

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
  // The Home hero carries the SAME mark as the header, so there are up to two
  // <img> for one URL. They are painted from one source of truth rather than
  // being kept in sync by hand — a logo that lands on one and not the other is
  // the kind of half-branded panel applyLogo exists to prevent.
  let logoUrl: string | undefined = theme.logoUrl;
  const logoImages: HTMLImageElement[] = [];

  /** Point ONE logo <img> at the current URL, or hide it. */
  function paintLogo(el: HTMLImageElement): void {
    const href = validateLogoUrl(logoUrl);
    if (href) {
      el.src = href;
      el.hidden = false;
      return;
    }
    el.hidden = true;
    el.removeAttribute('src');
  }

  /** A logo slot: always in the DOM, hidden until there is a URL worth loading. */
  function makeLogo(): HTMLImageElement {
    const el = document.createElement('img');
    el.className = 'vtr-logo';
    el.alt = '';
    el.hidden = true;
    logoImages.push(el);
    paintLogo(el);
    return el;
  }

  /** Point every logo slot at `url`, or hide them all. Re-validated every time:
   *  this runs again for every server-resolved config, not just the first paint. */
  function applyLogo(url: string | undefined): void {
    logoUrl = url;
    for (const el of logoImages) paintLogo(el);
  }

  const logo = makeLogo();
  header.appendChild(logo);

  // Every view has its own close button — the panel must be dismissible from
  // wherever the visitor happens to be standing. They share one handler and one
  // accessible name, both re-derived on a locale swap.
  const closeButtons: HTMLButtonElement[] = [];

  function makeCloseBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'vtr-close';
    btn.type = 'button';
    btn.setAttribute('aria-label', t('close'));
    btn.textContent = '×';
    closeButtons.push(btn);
    return btn;
  }

  const title = document.createElement('span');
  title.className = 'vtr-title';
  title.textContent = t('title');
  const closeBtn = makeCloseBtn();
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
  /**
   * Whether replies arrived while the panel was shut, remembered ACROSS the
   * moment the host zeroes the count.
   *
   * The host marks the conversation read (`setUnread(0)`) immediately before
   * `openPanel()`, so reading `unreadCount` at open time always sees zero. This
   * flag is what actually decides "the visitor has something waiting, put them
   * in Messages rather than on the Home screen" — the rule the count was only
   * ever a proxy for.
   */
  let hadUnreadSinceOpen = false;
  /** One-line, markdown-stripped preview of the newest message, for the Home
   *  "recent conversation" card. null ⇒ the transcript is empty and no card. */
  let lastPreview: string | null = null;
  /** Mirrors setBookingEnabled, so the Home booking card can follow the gate. */
  let bookingSurfaceEnabled = false;
  /**
   * Which quick-action cards are on. Seeded from the cached config so a repeat
   * visitor gets them on the FIRST paint rather than a round trip later; moved
   * afterwards only through setHomeCards.
   */
  let homeCards: ResolvedHomeCards = resolveHomeCards(opts.home?.cards);

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
  // Where the conversation's own chrome lives. `panel` in legacy mode — which
  // is what makes the legacy DOM byte-identical — and the messages VIEW once
  // the tab bar exists. Everything that inserts into the conversation column
  // (today: the booking chips) goes through this rather than through `panel`.
  let messagesHost: HTMLElement = panel;

  let actions: HTMLElement | null = null;
  let bookBtn: HTMLButtonElement | null = null;
  let visitsBtn: HTMLButtonElement | null = null;
  let bookingUi: BookingUi | null = null;
  let bookingOpen = false;
  let visitInfo = { hasBookings: false, upcoming: 0 };

  /** What the booking chip says: the tenant's words, else the built-in copy. */
  function bookChipText(): string {
    return bookingLabel ?? t('bookVisit');
  }

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
    bookBtn.textContent = bookChipText();

    visitsBtn = document.createElement('button');
    visitsBtn.className = 'vtr-chip vtr-chip-visits';
    visitsBtn.type = 'button';
    visitsBtn.hidden = true;
    visitsBtn.textContent = t('myVisits');

    actions.append(bookBtn, visitsBtn);
    // Over the composer, under the banner: always in view, never in the way,
    // and it never covers a single line of the conversation.
    messagesHost.insertBefore(actions, form);

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

  // --- Home quick actions (constructed on demand) -----------------------------
  //
  // LAZY, on exactly the booking surface's terms. `setHomeCards` with a card on
  // is the only thing that brings the overlay into existence, and it is only
  // ever called for a tenant whose `GET /widget/config` said so.
  let homeActionsUi: HomeActionsUi | null = null;
  let homeActionOpen = false;

  function ensureHomeActions(): void {
    if (homeActionsUi) return;
    homeActionsUi = createHomeActionsUi({
      getT: () => t,
      callbacks: callbacks.homeActions ?? noopHomeActions,
      on,
    });
    // Appended LAST, like the booking overlay: whichever of the two is open
    // covers the panel, the tab bar included. Only one is ever open at a time.
    panel.appendChild(homeActionsUi.root);
  }

  // --- Tabs: Home / Messages / Help (0.8.0) -----------------------------------
  //
  // LAZY BY DESIGN, on exactly the same terms as the booking surface above. A
  // tenant with neither Home nor Help never reaches `ensureViews()`: the panel's
  // children stay header → messages → typing → banner → composer → footer, the
  // panel carries no `data-tabs` and no `data-active-view`, and `.vtr-views` /
  // `.vtr-tabs` are not in the document at all.
  //
  // When they ARE on, the conversation does not move house — it is wrapped. The
  // same header, transcript, banner, chips, composer and footer nodes are
  // re-parented once into `.vtr-view[data-view="messages"]`, so nothing that
  // holds a reference to them (the booking overlay, the retry delegation, the
  // typing indicator) notices.
  let views: HTMLElement | null = null;
  let messagesView: HTMLElement | null = null;
  let homeView: HTMLElement | null = null;
  let helpView: HTMLElement | null = null;
  let tabsEl: HTMLElement | null = null;
  let activeView: ViewName = 'messages';

  const tabButtons: Partial<Record<ViewName, HTMLButtonElement>> = {};
  const tabLabels: Partial<Record<ViewName, HTMLElement>> = {};
  let tabDot: HTMLElement | null = null;

  // Home internals.
  let homeTitleEl: HTMLElement | null = null;
  let homeSubEl: HTMLElement | null = null;
  let avatarsEl: HTMLElement | null = null;
  let homeCardsEl: HTMLElement | null = null;
  // Help internals.
  let helpTitleEl: HTMLElement | null = null;
  let faqListEl: HTMLElement | null = null;
  let helpCtaEl: HTMLButtonElement | null = null;

  /** A view is reachable only when it is BOTH configured on and constructed. */
  function viewAvailable(view: ViewName): boolean {
    if (view === 'home') return homeCfg.enabled && homeView !== null;
    if (view === 'help') return helpCfg.enabled && helpView !== null;
    return true;
  }

  /** True while the panel has a tab bar. The one test for "am I in tabs mode". */
  function tabsOn(): boolean {
    return homeCfg.enabled || helpCfg.enabled;
  }

  /** Repaint the tab bar: which tabs exist, which is selected, the unread dot. */
  function paintTabs(): void {
    if (!tabsEl) return;
    tabsEl.hidden = !tabsOn();
    const visible: Array<[ViewName, boolean]> = [
      ['home', homeCfg.enabled && homeView !== null],
      ['messages', true],
      ['help', helpCfg.enabled && helpView !== null],
    ];
    for (const [view, shown] of visible) {
      const btn = tabButtons[view];
      if (!btn) continue;
      btn.hidden = !shown;
      btn.setAttribute('aria-selected', String(activeView === view));
      btn.tabIndex = activeView === view ? 0 : -1;
    }
    // The dot repeats the launcher badge INSIDE the panel: replies are waiting
    // and the visitor is looking at another tab. It says "there", never "how
    // many" — a count on a tab is noise a bubble already carries.
    if (tabDot) tabDot.hidden = !(unreadCount > 0 && activeView !== 'messages');
  }

  /**
   * Show one view. An unavailable target falls back to the conversation, which
   * is the view that always exists — a Home tab switched off mid-session can
   * never leave the visitor staring at a blank panel.
   */
  function setView(next: ViewName): void {
    activeView = viewAvailable(next) ? next : 'messages';
    if (!views) return;
    panel.setAttribute('data-active-view', activeView);
    paintTabs();
    if (activeView === 'home') paintHome();
    if (activeView === 'messages') scrollToBottom();
  }

  /** Land in the conversation with the cursor already in the composer. */
  function goToComposer(): void {
    setView('messages');
    input.focus();
  }

  /** One tab button: 20px glyph over an 11px label, plus the unread dot slot. */
  function makeTab(view: ViewName, key: StringKey, paths: readonly string[]): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'vtr-tab';
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.dataset.tab = view;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'vtr-tab-icon';
    iconWrap.appendChild(strokeIcon(paths));
    if (view === 'messages') {
      tabDot = document.createElement('span');
      tabDot.className = 'vtr-tab-dot';
      tabDot.setAttribute('aria-hidden', 'true');
      tabDot.hidden = true;
      iconWrap.appendChild(tabDot);
    }

    const label = document.createElement('span');
    label.className = 'vtr-tab-label';
    label.textContent = t(key);

    btn.append(iconWrap, label);
    tabButtons[view] = btn;
    tabLabels[view] = label;
    return btn;
  }

  /** The i18n key behind each tab's label, for the locale swap. */
  const TAB_KEYS: Record<ViewName, StringKey> = {
    home: 'tabHome',
    messages: 'tabMessages',
    help: 'tabHelp',
  };

  /**
   * Wrap the conversation in a view router and build the tab bar. Called by the
   * first `setHomeConfig`/`setHelpConfig` that turns a tab on, and never again.
   */
  function ensureViews(): void {
    if (views) return;
    views = document.createElement('div');
    views.className = 'vtr-views';

    messagesView = document.createElement('div');
    messagesView.className = 'vtr-view';
    messagesView.dataset.view = 'messages';
    // append() MOVES these nodes; every existing reference stays valid.
    messagesView.append(header, messagesEl, typingEl, banner);
    if (actions) messagesView.appendChild(actions);
    messagesView.append(form, footer);
    views.appendChild(messagesView);
    messagesHost = messagesView;

    tabsEl = document.createElement('div');
    tabsEl.className = 'vtr-tabs';
    tabsEl.setAttribute('role', 'tablist');
    tabsEl.append(
      makeTab('home', 'tabHome', ICONS.home),
      makeTab('messages', 'tabMessages', ICONS.chat),
      makeTab('help', 'tabHelp', ICONS.help),
    );
    // ONE delegated listener for all three tabs: they are never rebuilt, but
    // the delegation keeps the tracked-listener array flat either way.
    on(tabsEl, 'click', (e) => {
      const el = (e.target as Element | null)?.closest?.('[data-tab]') as HTMLElement | null;
      const view = el?.dataset.tab as ViewName | undefined;
      if (view) setView(view);
    });

    panel.prepend(views);
    // Before whichever overlay already exists, so the overlays stay the last
    // children and keep covering everything — the tab bar included.
    panel.insertBefore(tabsEl, bookingUi?.root ?? homeActionsUi?.root ?? null);
    panel.setAttribute('data-tabs', '1');
  }

  // --- Home view --------------------------------------------------------------

  /** The overlapping avatar stack. Up to three faces, from the resolved team. */
  function paintAvatars(): void {
    if (!avatarsEl) return;
    avatarsEl.replaceChildren();
    const shown = team.slice(0, 3);
    avatarsEl.hidden = shown.length === 0;
    // Eight colours and three overlapping circles: a plain hash pairs two of
    // them often enough to look like a bug. The hash still picks the colour;
    // a collision with the circle IMMEDIATELY to the left just steps one along.
    // Both inputs (the name, its place in the roster) are stable, so a member
    // keeps their colour across every repaint.
    let prev = -1;
    for (const member of shown) {
      if (member.avatarUrl) {
        const img = document.createElement('img');
        img.className = 'vtr-avatar';
        img.src = member.avatarUrl;
        // The name IS the alt text: the stack's whole job is to say who is here.
        img.alt = member.name;
        img.loading = 'lazy';
        avatarsEl.appendChild(img);
        // A photo between two initials breaks the adjacency the step-along
        // exists to fix, so it also clears it.
        prev = -1;
        continue;
      }
      // No usable URL ⇒ initials on a deterministic colour. Never a broken
      // <img>, and never a grey blank where a person should be.
      let index = avatarColorIndex(member.name);
      if (index === prev) index = (index + 1) % AVATAR_COLORS.length;
      prev = index;
      const el = document.createElement('span');
      el.className = 'vtr-avatar vtr-avatar-initials';
      el.style.setProperty('background-color', AVATAR_COLORS[index]);
      el.title = member.name;
      el.textContent = initialsOf(member.name);
      avatarsEl.appendChild(el);
    }
  }

  /** A Home card. `kind` is what the delegated click listener dispatches on. */
  function homeCard(kind: string, paths: readonly string[], accent: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'vtr-home-card';
    btn.type = 'button';
    btn.dataset.card = kind;
    const body = document.createElement('div');
    body.className = 'vtr-home-card-body';
    btn.appendChild(body);
    const icon = document.createElement('span');
    icon.className = accent ? 'vtr-home-card-icon' : 'vtr-home-card-icon vtr-home-card-chev';
    icon.appendChild(strokeIcon(paths));
    btn.appendChild(icon);
    return btn;
  }

  /** Add a title/sub pair into a card body. */
  function cardLine(card: HTMLElement, cls: string, text: string): void {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    card.firstElementChild?.appendChild(el);
  }

  /**
   * Remember a one-line, markup-free preview of the newest message.
   *
   * The markdown is stripped by RENDERING it and reading the text back, rather
   * than by a second regex pass: the renderer is the only thing that knows what
   * the subset means, and its output is nodes, so `**Corolla**` becomes
   * "Corolla" and an injected tag stays literal text either way.
   */
  function setPreview(content: string | null): void {
    let next: string | null = null;
    if (content !== null) {
      const flat = (renderMarkdown(content).textContent ?? '').replace(/\s+/g, ' ').trim();
      if (flat !== '') {
        next = flat.length > MAX_PREVIEW ? `${flat.slice(0, MAX_PREVIEW)}…` : flat;
      }
    }
    if (next === lastPreview) return;
    lastPreview = next;
    paintHomeCards();
  }

  /**
   * The Home cards, rebuilt from scratch on every paint.
   *
   * Which ones are present is the whole design:
   *   · recent conversation — only with something to come back to;
   *   · send us a message — ALWAYS, because that is what the widget is for;
   *   · the booking card — only for a tenant whose agenda is on, and titled
   *     with THEIR word for it, never ours;
   *   · comprar / vender / lo buscamos — one per quick action the tenant's
   *     vertical turned on, each opening a form inside the panel.
   */
  function paintHomeCards(): void {
    if (!homeCardsEl) return;
    homeCardsEl.replaceChildren();

    if (lastPreview) {
      const card = homeCard('recent', ICONS.chevronRight, false);
      cardLine(card, 'vtr-home-card-title', t('recentConversation'));
      cardLine(card, 'vtr-home-card-preview', lastPreview);
      homeCardsEl.appendChild(card);
    }

    const chat = homeCard('chat', ICONS.send, true);
    cardLine(chat, 'vtr-home-card-title', t('homeChatTitle'));
    cardLine(chat, 'vtr-home-card-sub', t('homeChatSub'));
    homeCardsEl.appendChild(chat);

    if (bookingSurfaceEnabled) {
      const book = homeCard('book', ICONS.calendar, true);
      cardLine(book, 'vtr-home-card-title', bookChipText());
      cardLine(book, 'vtr-home-card-sub', t('homeBookSub'));
      homeCardsEl.appendChild(book);
    }

    if (homeCards.buy) {
      const buy = homeCard('buy', ICONS.car, true);
      cardLine(buy, 'vtr-home-card-title', t('homeBuyTitle'));
      cardLine(buy, 'vtr-home-card-sub', t('homeBuySub'));
      homeCardsEl.appendChild(buy);
    }

    if (homeCards.sell) {
      const sell = homeCard('sell', ICONS.tag, true);
      cardLine(sell, 'vtr-home-card-title', t('homeSellTitle'));
      cardLine(sell, 'vtr-home-card-sub', t('homeSellSub'));
      homeCardsEl.appendChild(sell);
    }

    if (homeCards.search) {
      const search = homeCard('search', ICONS.search, true);
      cardLine(search, 'vtr-home-card-title', t('homeSearchTitle'));
      cardLine(search, 'vtr-home-card-sub', t('homeSearchSub'));
      homeCardsEl.appendChild(search);
    }
  }

  /** Repaint the whole Home view: greeting, faces, cards. */
  function paintHome(): void {
    if (!homeView) return;
    if (homeTitleEl) homeTitleEl.textContent = homeCfg.title ?? t('homeTitle');
    if (homeSubEl) homeSubEl.textContent = homeCfg.subtitle ?? t('homeSubtitle');
    paintAvatars();
    paintHomeCards();
  }

  function ensureHomeView(): void {
    if (homeView) return;
    ensureViews();
    homeView = document.createElement('div');
    homeView.className = 'vtr-view';
    homeView.dataset.view = 'home';

    const scroll = document.createElement('div');
    scroll.className = 'vtr-home-scroll';

    const hero = document.createElement('div');
    hero.className = 'vtr-home-hero';
    const top = document.createElement('div');
    top.className = 'vtr-home-top';
    const spacer = document.createElement('div');
    spacer.className = 'vtr-home-spacer';
    avatarsEl = document.createElement('div');
    avatarsEl.className = 'vtr-avatars';
    const closeHome = makeCloseBtn();
    on(closeHome, 'click', () => callbacks.onRequestClose());
    top.append(makeLogo(), spacer, avatarsEl, closeHome);

    homeTitleEl = document.createElement('h2');
    homeTitleEl.className = 'vtr-home-title';
    homeSubEl = document.createElement('p');
    homeSubEl.className = 'vtr-home-sub';
    hero.append(top, homeTitleEl, homeSubEl);

    homeCardsEl = document.createElement('div');
    homeCardsEl.className = 'vtr-home-cards';
    // ONE delegated listener: the cards are rebuilt on every repaint, so a
    // per-card listener would grow the tracked-listener array without bound.
    on(homeCardsEl, 'click', (e) => {
      const el = (e.target as Element | null)?.closest?.('[data-card]') as HTMLElement | null;
      const kind = el?.dataset.card;
      switch (kind) {
        case 'recent':
          setView('messages');
          break;
        case 'chat':
          goToComposer();
          break;
        case 'book':
          // The SAME path the chip takes, gate and all — the card is another
          // door onto one flow, never a second implementation of it.
          callbacks.onBookingOpen?.();
          break;
        case 'buy':
        case 'sell':
        case 'search':
          // Same rule: the card reports the intent and the host decides, so
          // openHomeAction() from a page button and a tap here are one path.
          callbacks.onHomeAction?.(kind);
          break;
        default:
          break;
      }
    });

    scroll.append(hero, homeCardsEl);
    homeView.appendChild(scroll);
    views?.insertBefore(homeView, messagesView);
    paintHome();
  }

  // --- Help view --------------------------------------------------------------

  /**
   * The FAQ accordion. Answers go through the same markdown renderer as every
   * agent reply — DOM nodes, never an HTML string — so a dealer who pastes a
   * `<script>` into an answer gets a visible `<script>`, not a running one.
   */
  function paintFaqs(): void {
    if (!faqListEl) return;
    faqListEl.replaceChildren();
    helpCfg.faqs.forEach((faq, i) => {
      const item = document.createElement('div');
      item.className = 'vtr-faq-item';

      const q = document.createElement('button');
      q.className = 'vtr-faq-q';
      q.type = 'button';
      q.setAttribute('aria-expanded', 'false');
      q.dataset.faq = String(i);
      const qText = document.createElement('span');
      qText.className = 'vtr-faq-qtext';
      qText.textContent = faq.q;
      const chev = document.createElement('span');
      chev.className = 'vtr-faq-chev';
      chev.appendChild(strokeIcon(ICONS.chevronDown));
      q.append(qText, chev);

      const a = document.createElement('div');
      a.className = 'vtr-faq-a';
      a.hidden = true;
      a.appendChild(renderMarkdown(faq.a));

      item.append(q, a);
      faqListEl?.appendChild(item);
    });
  }

  function ensureHelpView(): void {
    if (helpView) return;
    ensureViews();
    helpView = document.createElement('div');
    helpView.className = 'vtr-view';
    helpView.dataset.view = 'help';

    // The compact header: no accent band, no border. On the Help and (in tabs
    // mode) Messages views the panel reads as ONE surface with a tab bar at the
    // bottom, rather than as three screens that each start with a coloured lid.
    const head = document.createElement('div');
    head.className = 'vtr-vhead';
    helpTitleEl = document.createElement('span');
    helpTitleEl.className = 'vtr-title';
    helpTitleEl.textContent = t('tabHelp');
    const closeHelp = makeCloseBtn();
    on(closeHelp, 'click', () => callbacks.onRequestClose());
    head.append(helpTitleEl, closeHelp);

    const body = document.createElement('div');
    body.className = 'vtr-help-body';
    faqListEl = document.createElement('div');
    faqListEl.className = 'vtr-faq';
    // Delegated, like every other repeated control in this file.
    on(faqListEl, 'click', (e) => {
      const q = (e.target as Element | null)?.closest?.('.vtr-faq-q') as HTMLElement | null;
      if (!q || !faqListEl?.contains(q)) return;
      const answer = q.nextElementSibling as HTMLElement | null;
      if (!answer) return;
      // Several may be open at once: a visitor comparing two answers should not
      // have the first one taken away to read the second.
      const expanded = q.getAttribute('aria-expanded') === 'true';
      q.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      answer.hidden = expanded;
    });
    body.appendChild(faqListEl);

    const foot = document.createElement('div');
    foot.className = 'vtr-help-foot';
    helpCtaEl = document.createElement('button');
    helpCtaEl.className = 'vtr-help-cta';
    helpCtaEl.type = 'button';
    helpCtaEl.textContent = t('helpCta');
    on(helpCtaEl, 'click', () => goToComposer());
    foot.appendChild(helpCtaEl);

    helpView.append(head, body, foot);
    views?.appendChild(helpView);
    paintFaqs();
  }

  /**
   * Reflect the current Home/Help flags on the chrome. Safe in both directions
   * and at any time: a tenant who switches Home off mid-session loses the tab
   * and, if they were standing on it, is moved to the conversation.
   */
  function syncTabChrome(): void {
    if (!views) return;
    if (tabsOn()) panel.setAttribute('data-tabs', '1');
    else panel.removeAttribute('data-tabs');
    setView(activeView);
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
      // Where the visitor lands. Replies waiting beat the Home screen every
      // time: they came back to READ something, and making them find the
      // Messages tab first would be a redesign that costs them a click.
      const waiting = unreadCount > 0 || hadUnreadSinceOpen;
      setView(!waiting && viewAvailable('home') ? 'home' : 'messages');
      hadUnreadSinceOpen = false;
      // Only when the composer is actually on screen — focusing an input inside
      // a display:none view would scroll nothing and steal nothing.
      if (activeView === 'messages') input.focus();
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
      // The Home card's one-line preview follows the transcript, so it is
      // derived HERE — from the caller's list, the same single source of truth
      // the panel is painted from — rather than read back out of the DOM.
      setPreview(messages.length > 0 ? messages[messages.length - 1].content : null);
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
    applyFont,
    setBookingLabel(label: string | null): void {
      const next = label ?? null;
      if (next === bookingLabel) return;
      bookingLabel = next;
      // Only if the chip exists. A tenant without booking must not gain one for
      // having been told what it would have been called.
      if (bookBtn) bookBtn.textContent = bookChipText();
      // Same words on the Home card, which titles itself with the tenant's
      // label and never with ours.
      paintHomeCards();
    },
    setWelcomeMessage(message: string | null): void {
      if (message === welcomeMessage) return;
      welcomeMessage = message;
      repaintWelcome();
    },
    setBookingEnabled(enabled: boolean): void {
      bookingSurfaceEnabled = enabled;
      // The Home card follows the same gate as the chip, in both directions.
      paintHomeCards();
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
    setHomeCards(cards: ResolvedHomeCards | undefined): void {
      homeCards = resolveHomeCards(cards);
      // The cards follow the gate in both directions, like the booking card.
      paintHomeCards();
      if (homeCards.buy || homeCards.sell || homeCards.search) {
        ensureHomeActions();
        return;
      }
      // Never constructed ⇒ nothing to take away. A tenant who never had the
      // quick actions must not gain a hidden overlay for having been asked.
      if (!homeActionsUi) return;
      ui.closeHomeAction();
    },
    openHomeAction(kind: WidgetHomeAction): void {
      ensureHomeActions();
      if (!homeActionsUi) return;
      homeActionOpen = true;
      homeActionsUi.root.hidden = false;
      // The composer, the chips and the tab bar go with it (CSS): while a form
      // is up there is exactly one thing to do, and nothing behind it is
      // tabbable. The kind rides on the attribute so a host page's own CSS —
      // and this suite — can tell which flow is showing.
      panel.setAttribute('data-home-action', kind);
    },
    closeHomeAction(): void {
      homeActionOpen = false;
      if (homeActionsUi) homeActionsUi.root.hidden = true;
      panel.removeAttribute('data-home-action');
    },
    isHomeActionOpen(): boolean {
      return homeActionOpen;
    },
    renderHomeAction(state: HomeActionViewState): void {
      ensureHomeActions();
      homeActionsUi?.render(state);
    },
    showMessages(): void {
      setView('messages');
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
      for (const btn of closeButtons) btn.setAttribute('aria-label', t('close'));
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
      // The chip follows the locale ONLY while it is using our copy: a tenant
      // label is the dealer's own word, not a string we are entitled to swap.
      if (bookBtn) bookBtn.textContent = bookChipText();
      paintVisitsChip();
      bookingUi?.setLocale();
      // The quick-action forms are chrome too: a language swap that left a
      // half-filled consignment form in Spanish is the same half-translated
      // panel this method exists to prevent — and it must not lose a keystroke,
      // which is why setLocale re-renders rather than rebuilding.
      homeActionsUi?.setLocale();
      // The tabs are chrome too. The tenant's own words — home.title,
      // home.subtitle, the FAQ text, the booking label — are NOT: paintHome and
      // paintFaqs fall back to t() only where the tenant said nothing.
      for (const view of ['home', 'messages', 'help'] as ViewName[]) {
        const label = tabLabels[view];
        if (label) label.textContent = t(TAB_KEYS[view]);
      }
      if (helpTitleEl) helpTitleEl.textContent = t('tabHelp');
      if (helpCtaEl) helpCtaEl.textContent = t('helpCta');
      paintHome();
    },
    setHomeConfig(home: ResolvedHome): void {
      homeCfg = {
        enabled: home?.enabled === true,
        title: home?.title ?? null,
        subtitle: home?.subtitle ?? null,
      };
      if (homeCfg.enabled) ensureHomeView();
      paintHome();
      syncTabChrome();
    },
    setHelpConfig(help: ResolvedHelp): void {
      const faqs = Array.isArray(help?.faqs) ? help.faqs : [];
      // Re-derived rather than trusted: "Help is on" and "Help has answers" are
      // two different facts, and only their conjunction earns a tab.
      helpCfg = { enabled: help?.enabled === true && faqs.length > 0, faqs };
      if (helpCfg.enabled) ensureHelpView();
      paintFaqs();
      syncTabChrome();
    },
    setTeam(next: TeamMember[]): void {
      team = Array.isArray(next) ? next : [];
      paintAvatars();
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
      // Sticky across the host's read-marking, which happens a line before
      // openPanel() — see hadUnreadSinceOpen.
      if (n > 0) hadUnreadSinceOpen = true;
      paintTabs();
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

  // Build the tab chrome NOW when the caller already knows the answer — a
  // repeat visitor whose cached config says Home is on gets the tab bar on the
  // first paint rather than watching it appear a round trip later. A caller who
  // passes nothing reaches none of this, and the panel above is complete.
  if (homeCfg.enabled) ensureHomeView();
  if (helpCfg.enabled) ensureHelpView();
  if (views) syncTabChrome();

  return ui;
}
