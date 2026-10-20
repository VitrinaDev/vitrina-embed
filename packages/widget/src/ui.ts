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
  resolveHomePrompts,
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
import { createSidebarChrome, sendIcon, type SidebarChrome, type SidebarUiCallbacks, type SidebarUiOptions } from './sidebar-ui';
import { SIDEBAR_STYLES } from './sidebar-styles';
import { STYLES } from './styles';

/**
 * A touch-first device (phone, tablet without a trackpad). Opening the panel
 * there does not focus the composer: focusing pops the on-screen keyboard
 * uninvited. No matchMedia (old engines, test DOMs) means a fine pointer.
 */
export function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
import { resolveAccent, resolvePosition, validateLogoUrl } from './theme';
import type { WidgetFont, WidgetHomeAction, WidgetHomePrompt, WidgetLocale, WidgetTheme } from './types';

export type BannerState = 'none' | 'offline' | 'reconnecting' | 'error' | 'sending';

export interface WidgetUiCallbacks {
  /** Composer submit: raw text + the honeypot field value (empty for humans). */
  onSend(text: string, honeypot: string): void;
  /** Composer submit with staged photos (0.24.0). Only reachable once `setPhotoUpload(true)`. */
  onSendPhotos?(files: File[], text: string, honeypot: string): void;
  /** Launcher clicked — host decides to open (and kick off the session). */
  onRequestOpen(): void;
  /** Close button clicked. */
  onRequestClose(): void;
  /** Retry a failed send, re-using its ORIGINAL client message id (idempotent). */
  onRetry(clientMessageId: string): void;
  /** A button under a transcript line (demo mode's «Seguir probando», «¿Entro?»). */
  onNoticeAction?(id: 'demo_yes' | 'demo_no' | 'demo_resume'): void;
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
  onTurnstileSlot: () => {},
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
   * Sidebar / inline layout (embed#25). Absent ⇒ the bubble widget, node for
   * node and byte for byte (no extra stylesheet, no extra element).
   */
  sidebar?: { options: SidebarUiOptions; callbacks: SidebarUiCallbacks; container: HTMLElement | null };
  /**
   * Mount invisibly, awaiting `reveal()`. Used ONLY when the appearance is
   * coming from the server and we have no cached copy to paint with — showing a
   * default-black launcher that snaps to the dealer's brand colour a moment
   * later looks broken on their own site. The caller guarantees a reveal on a
   * timer regardless of the network, so this can never hide the widget.
   */
  hidden?: boolean;
  /** The «Con tecnología de Vitrina» credit in the panel footer. Default true; false removes it. */
  showPoweredBy?: boolean;
}

export interface WidgetUi {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  mount(): void;
  destroy(): void;
  /** `focus: false` leaves the page's focus where it is (auto-open). */
  openPanel(focus?: boolean): void;
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
  /**
   * Someone is composing a reply. The widget never says who. `note` is an
   * optional line beside the dots («Sigue escribiendo…»).
   */
  setTyping(active: boolean, note?: string | null): void;
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
  /** Host-driven hide/show of the whole widget (hide()/show() in the public API). */
  setHostHidden(hidden: boolean): void;

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
  /** The prompt cards on Home (0.21.0), in order. Nothing to build or tear
   *  down: a tap sends a message through the composer's own send path. */
  setHomePrompts(prompts: readonly WidgetHomePrompt[] | undefined): void;
  /** Show or hide the composer's photo button (server-owned gate). */
  setPhotoUpload(enabled: boolean): void;
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

  // --- Sidebar mode (embed#25). No-ops on a bubble widget. --------------------
  /** Show the peek card with the current greeting. */
  showTeaser(): void;
  hideTeaser(): void;
  isTeaserShown(): boolean;
  /** Demo-mode framing (D60): header, exit button, placeholder (`kind` picks «paciente»). */
  setDemo(on: boolean, kind?: 'automotora' | 'clinica' | null): void;
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
  bag: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  box: [
    'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
    'm3.3 7 8.7 5 8.7-5',
    'M12 22V12',
  ],
  // The inmobiliaria's three (0.24.0): a building (proyectos), a map pin (sala
  // de ventas) and a wrench (post-venta).
  building: [
    'M5 21V4.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V21',
    'M15 9.5h3.5a1 1 0 0 1 1 1V21',
    'M3 21h18',
    'M8.5 7.5h3',
    'M8.5 11h3',
    'M8.5 14.5h3',
  ],
  pin: [
    'M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11z',
    'M14.4 10a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0z',
  ],
  wrench: [
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  ],
  // The composer's photo button, the document card's page and its arrow.
  paperclip: ['m20.3 11.3-8.2 8.2a5.2 5.2 0 0 1-7.4-7.3l8.2-8.2a3.5 3.5 0 0 1 4.9 4.9l-8.2 8.2a1.7 1.7 0 0 1-2.5-2.4l7.5-7.5'],
  file: [
    'M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z',
    'M14 3.5V8h4.5',
    'M9 13h6',
    'M9 16.5h4',
  ],
  download: ['M12 4v11', 'm7.5 11 4.5 4.5 4.5-4.5', 'M5 19.5h14'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
} as const;

/** The Home prompt cards (0.21.0): glyph, copy, and the message a tap sends. */
const HOME_PROMPT_CARDS: Record<
  WidgetHomePrompt,
  { icon: keyof typeof ICONS; title: StringKey; sub: StringKey; message: StringKey }
> = {
  properties: {
    icon: 'search',
    title: 'homePropertiesTitle',
    sub: 'homePropertiesSub',
    message: 'homePropertiesMessage',
  },
  visit: {
    icon: 'calendar',
    title: 'homeVisitTitle',
    sub: 'homeVisitSub',
    message: 'homeVisitMessage',
  },
  list_property: {
    icon: 'home',
    title: 'homeListPropertyTitle',
    sub: 'homeListPropertySub',
    message: 'homeListPropertyMessage',
  },
  products: {
    icon: 'bag',
    title: 'homeProductsTitle',
    sub: 'homeProductsSub',
    message: 'homeProductsMessage',
  },
  order_status: {
    icon: 'box',
    title: 'homeOrderStatusTitle',
    sub: 'homeOrderStatusSub',
    message: 'homeOrderStatusMessage',
  },
  projects: {
    icon: 'building',
    title: 'homeProjectsTitle',
    sub: 'homeProjectsSub',
    message: 'homeProjectsMessage',
  },
  showroom_visit: {
    icon: 'pin',
    title: 'homeShowroomTitle',
    sub: 'homeShowroomSub',
    message: 'homeShowroomMessage',
  },
  after_sales: {
    icon: 'wrench',
    title: 'homeAfterSalesTitle',
    sub: 'homeAfterSalesSub',
    message: 'homeAfterSalesMessage',
  },
};

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
/** The credit link: a plain followed backlink, tagged so Vitrina can see the traffic. */
export const POWERED_BY_URL =
  'https://www.vitrinadev.com/?utm_source=widget&utm_medium=referral&utm_campaign=powered_by';

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
  // The dark-ground variant (0.18.1). Each logo slot may carry a second <img>
  // right after it, and CSS decides which of the two the ground shows (the
  // accent header is dark; the surface is dark only under a dark scheme) — no
  // colour guessing in script. The second <img> exists ONLY while a usable
  // variant is configured, so a tenant without one gets today's DOM, node for
  // node.
  let logoOnDarkUrl: string | undefined = theme.logoOnDarkUrl;
  const darkLogos = new Map<HTMLImageElement, HTMLImageElement>();

  /** Point ONE logo <img> at the current URL, or hide it. */
  function paintLogo(el: HTMLImageElement): void {
    paintDarkLogo(el);
    const href = validateLogoUrl(logoUrl);
    if (href) {
      el.src = href;
      el.hidden = false;
      return;
    }
    el.hidden = true;
    el.removeAttribute('src');
  }

  /** Give a logo slot its dark-ground twin, or take it away. */
  function paintDarkLogo(el: HTMLImageElement): void {
    const href = validateLogoUrl(logoOnDarkUrl);
    let dark = darkLogos.get(el);
    if (!href) {
      dark?.remove();
      darkLogos.delete(el);
      el.removeAttribute('data-ondark');
      return;
    }
    if (!dark) {
      dark = document.createElement('img');
      dark.className = 'vtr-logo vtr-logo-ondark';
      dark.alt = '';
      darkLogos.set(el, dark);
    }
    if (dark.getAttribute('src') !== href) dark.src = href;
    // Tells the CSS "a twin exists": dark grounds then hide THIS one.
    el.setAttribute('data-ondark', '');
    placeDarkLogo(el);
  }

  /** Keep the twin right after its slot (a slot built before it is attached
   *  gets placed once the caller has put it in the DOM). */
  function placeDarkLogo(el: HTMLImageElement): void {
    const dark = darkLogos.get(el);
    if (dark && el.parentNode && el.nextSibling !== dark) el.after(dark);
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
  function applyLogo(url: string | undefined, onDark?: string): void {
    logoUrl = url;
    logoOnDarkUrl = onDark;
    for (const el of logoImages) paintLogo(el);
  }

  const logo = makeLogo();
  header.appendChild(logo);
  placeDarkLogo(logo);

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
  // Built on first use: a widget that never shows a note keeps the old DOM.
  let typingNote: HTMLElement | null = null;

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

  // --- Photo attach (0.24.0) ---
  // Built on first `setPhotoUpload(true)`: a tenant without it keeps the old
  // composer node for node. Photos are STAGED in a tray above the composer and
  // leave with the next send, so the buyer can add a line of context.
  const MAX_PHOTOS = 4;
  let attachBtn: HTMLButtonElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let tray: HTMLElement | null = null;
  const staged: Array<{ file: File; url: string }> = [];
  function paintTray(): void {
    if (!tray) return;
    tray.replaceChildren();
    tray.hidden = staged.length === 0;
    staged.forEach((entry, i) => {
      const item = document.createElement('div');
      item.className = 'vtr-tray-item';
      const img = document.createElement('img');
      img.src = entry.url;
      img.alt = '';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'vtr-tray-x';
      rm.dataset.trayRemove = String(i);
      rm.setAttribute('aria-label', t('removePhoto'));
      rm.appendChild(strokeIcon(ICONS.close));
      item.append(img, rm);
      tray!.appendChild(item);
    });
    if (attachBtn) attachBtn.disabled = staged.length >= MAX_PHOTOS;
  }
  function clearStaged(revoke: boolean): void {
    if (revoke) for (const e of staged) URL.revokeObjectURL(e.url);
    staged.length = 0;
    paintTray();
  }

  // The footer holds up to two lines of fine print: the AI / demo disclaimer
  // (sidebar layouts) and the «Con tecnología de Vitrina» credit. Separate
  // nodes so a disclaimer swap never wipes the credit link.
  const footer = document.createElement('div');
  footer.className = 'vtr-footer';
  const footerNote = document.createElement('span');
  footerNote.className = 'vtr-footer-note';
  footerNote.hidden = true;
  const credit = document.createElement('span');
  credit.className = 'vtr-credit';
  const showCredit = opts.showPoweredBy !== false;
  function renderCredit(): void {
    credit.textContent = '';
    if (!showCredit) return;
    const text = t('poweredBy');
    const at = text.lastIndexOf('Vitrina');
    if (at < 0) {
      credit.textContent = text;
      return;
    }
    const link = document.createElement('a');
    link.className = 'vtr-credit-link';
    link.href = POWERED_BY_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Vitrina';
    credit.append(text.slice(0, at), link, text.slice(at + 'Vitrina'.length));
  }
  /** Sets the disclaimer line; null/'' removes it. Hides the footer when empty. */
  function setFooterNote(text: string | null): void {
    footerNote.textContent = text ?? '';
    footerNote.hidden = !text;
    footer.hidden = !text && !showCredit;
  }
  renderCredit();
  footer.append(footerNote, credit);
  footer.hidden = !showCredit;

  panel.append(header, messagesEl, typingEl, banner, form, footer);
  root.append(launcher, panel);
  shadow.appendChild(root);

  // --- Sidebar / inline chrome (embed#25) ---
  const sb = opts.sidebar ?? null;
  let chrome: SidebarChrome | null = null;
  // Declared before the chrome so its document listeners are tracked too.
  const listeners: TrackedListener[] = [];
  function on(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    listeners.push({ target, type, handler });
  }
  let demoOn = false;
  let demoKindOn: 'automotora' | 'clinica' | null = null;
  const demoPlaceholderKey = (): StringKey =>
    demoKindOn === 'clinica' ? 'sbDemoPlaceholderClinic' : 'sbDemoPlaceholder';
  /** The launcher's accessible name: the named assistant in sidebar mode. */
  function launcherBase(): string {
    return chrome ? chrome.launcherAria() : t('launcherLabel');
  }
  /** Re-apply the sidebar's own strings after anything that repaints chrome. */
  function paintSidebarChrome(): void {
    if (!chrome || !sb) return;
    chrome.setT(t);
    const key = demoOn ? demoPlaceholderKey() : 'sbAskPlaceholder';
    input.placeholder = t(key);
    input.setAttribute('aria-label', t(key));
    sendBtn.textContent = '';
    sendBtn.setAttribute('aria-label', t('send'));
    sendBtn.appendChild(sendIcon());
    closeBtn.setAttribute('aria-label', t('sbMinimize'));
    const agentName = sb.options.agent?.name;
    if (demoOn) setFooterNote(t('sbDemoDisclaimer'));
    else if (agentName) setFooterNote(t('sbAiDisclaimer').replace('{name}', agentName));
  }
  if (sb) {
    const sbStyle = document.createElement('style');
    sbStyle.textContent = SIDEBAR_STYLES;
    shadow.appendChild(sbStyle);
    root.setAttribute('data-layout', sb.options.layout);
    root.setAttribute('data-preset', sb.options.preset);
    chrome = createSidebarChrome(sb.options, sb.callbacks, () => t, on);
    chrome.decorateHeader(header, closeBtn);
    chrome.decorateLauncher(launcher);
    const cta = chrome.ctaButton();
    panel.insertBefore(chrome.demoExitButton(), form);
    if (cta) {
      panel.insertBefore(cta, form);
      panel.setAttribute('data-cta', '');
    }
    paintSidebarChrome();
    root.appendChild(chrome.teaser);
    if (sb.options.layout === 'inline') {
      // In the page flow, not over it.
      for (const prop of ['position', 'z-index', 'bottom', 'right', 'left']) host.style.removeProperty(prop);
      host.style.setProperty('position', 'relative', 'important');
      host.style.setProperty('width', '100%', 'important');
      host.style.setProperty('height', '100%', 'important');
    }
  }

  // --- state + listeners ---
  let open = false;
  /** Places the open panel over the visible area on phones (wired below). */
  let fitPanel: () => void = () => {};
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
  /** The prompt cards, seeded the same way; moved only through setHomePrompts. */
  let homePrompts: WidgetHomePrompt[] = resolveHomePrompts(opts.home?.prompts);

  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /** The link label a card's kind earns; an unknown kind gets the neutral one. */
  const CARD_LINK_LABEL: Record<string, Parameters<typeof t>[0]> = {
    vehicle: 'viewVehicle',
    product: 'viewProduct',
    property: 'viewProperty',
    service: 'viewService',
    treatment: 'viewTreatment',
  };

  /** At most this many facts on a card: it is a teaser, the listing has the rest. */
  const CARD_MAX_FACTS = 6;
  const CARD_MAX_ACTIONS = 2;

  type CardAction = { label: string; url: string | null; message: string | null };

  /**
   * A catalog card: photo, title, a subtitle, the price, the kind's facts as a
   * small grid (value over label), and up to two buttons. One renderer for every
   * kind (vehicle, product, property, unidad, service…); a vehicle prints no
   * facts, so it looks exactly as it always has.
   *
   * Nothing here knows a vocabulary: labels, facts and button text are what the
   * server sent. Only a card with no button of its own and a listing URL gets
   * the generic link, worded by kind.
   *
   * Built from DOM nodes like everything else here. The image and link URLs were
   * validated server-side AND are validated again through validateLogoUrl: a
   * card with a hostile URL renders without it rather than not at all.
   */
  function catalogCard(card: {
    kind: string;
    itemId: string;
    title: string;
    subtitle: string | null;
    price: string | null;
    thumbnailUrl: string | null;
    listingUrl: string | null;
    facts: Array<{ label: string; value: string }>;
    actions: CardAction[];
  }): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vtr-card';
    el.dataset.kind = card.kind;
    el.dataset.itemId = card.itemId;
    if (card.kind === 'vehicle') el.dataset.vehicleId = card.itemId;

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

    if (card.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'vtr-card-sub';
      sub.textContent = card.subtitle;
      body.appendChild(sub);
    }

    if (card.price) {
      const price = document.createElement('div');
      price.className = 'vtr-card-price';
      price.textContent = card.price;
      body.appendChild(price);
    }

    const facts = card.kind === 'vehicle' ? [] : card.facts.slice(0, CARD_MAX_FACTS);
    if (facts.length > 0) {
      const dl = document.createElement('dl');
      dl.className = 'vtr-card-facts';
      for (const f of facts) {
        const row = document.createElement('div');
        row.className = 'vtr-card-fact';
        const dt = document.createElement('dt');
        dt.textContent = f.label;
        const dd = document.createElement('dd');
        dd.textContent = f.value;
        row.append(dt, dd);
        dl.appendChild(row);
      }
      body.appendChild(dl);
    }

    const href = validateLogoUrl(card.listingUrl);
    const actions = card.actions.slice(0, CARD_MAX_ACTIONS);
    const generic = actions.length === 0 && !!href;
    if (generic && href) {
      actions.push({ label: t(CARD_LINK_LABEL[card.kind] ?? 'viewItem'), url: href, message: null });
    }
    if (actions.length > 0) {
      const bar = document.createElement('div');
      bar.className = 'vtr-card-actions';
      actions.forEach((action, i) => {
        const url = validateLogoUrl(action.url);
        let btn: HTMLElement;
        if (url) {
          const link = document.createElement('a');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          btn = link;
        } else if (action.message) {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.cardMessage = action.message;
          btn = b;
        } else {
          return;
        }
        btn.className =
          (i === 0 ? 'vtr-card-btn' : 'vtr-card-btn vtr-card-btn-alt') +
          (generic ? ' vtr-card-link' : '');
        btn.textContent = action.label;
        bar.appendChild(btn);
      });
      if (bar.childElementCount > 0) body.appendChild(bar);
    }

    el.appendChild(body);
    return el;
  }

  /**
   * The card a `stock_card` row carries, normalised: the generic `itemCard`
   * first, then the vehicle-only `stockCard` an older server sends, else null
   * (the row is its prose). A malformed card (no kind, id or title) is null.
   */
  function cardOf(m: WidgetMessage): Parameters<typeof catalogCard>[0] | null {
    const ic = m.itemCard;
    const text = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null;
    if (
      ic &&
      typeof ic.kind === 'string' && ic.kind &&
      typeof ic.itemId === 'string' && ic.itemId &&
      typeof ic.title === 'string' && ic.title.trim()
    ) {
      const rawActions = [
        ...(ic.cta ? [ic.cta] : []),
        ...(Array.isArray(ic.actions) ? ic.actions : []),
      ];
      const actions: CardAction[] = [];
      for (const a of rawActions) {
        const label = text(a?.label);
        if (!label || (!text(a.url) && !text(a.message))) continue;
        actions.push({ label, url: text(a.url), message: text(a.message) });
      }
      return {
        kind: ic.kind,
        itemId: ic.itemId,
        title: ic.title,
        subtitle: text(ic.subtitle),
        price: typeof ic.price === 'string' && ic.price.trim() ? ic.price : null,
        thumbnailUrl: ic.thumbnailUrl ?? null,
        listingUrl: ic.listingUrl ?? null,
        facts: Array.isArray(ic.facts)
          ? ic.facts.filter(
              (f) => f && typeof f.label === 'string' && typeof f.value === 'string' && f.value.trim(),
            )
          : [],
        actions,
      };
    }
    const sc = m.stockCard;
    if (sc && typeof sc.title === 'string' && sc.title.trim()) {
      return {
        kind: 'vehicle',
        itemId: sc.vehicleId,
        title: sc.title,
        subtitle: null,
        price: sc.price,
        thumbnailUrl: sc.thumbnailUrl,
        listingUrl: sc.listingUrl,
        facts: [],
        actions: [],
      };
    }
    return null;
  }

  const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rtf)(?:[?#]|$)/i;

  /** A media URL that is a document rather than a picture (older servers send those in mediaUrls). */
  function isDocumentUrl(raw: string): boolean {
    return DOC_EXT.test(raw);
  }

  function formatBytes(n: number): string {
    const nf = (v: number, d: number) =>
      new Intl.NumberFormat(currentLocale, { maximumFractionDigits: d }).format(v);
    if (n >= 1024 * 1024) return `${nf(n / (1024 * 1024), 1)} MB`;
    return `${nf(Math.max(1, Math.round(n / 1024)), 0)} KB`;
  }

  /**
   * Document cards for a file row: a page glyph with the extension, the file's
   * name and «PDF · 2,4 MB», and one action. The whole card is the link, so the
   * tap target is the card; it opens the file (PDFs render in the browser's
   * viewer and download from there). URLs are validated like every other.
   */
  function fileCards(
    files: Array<{ url: string; filename?: string | null; mimeType?: string | null; size?: number | null }>,
  ): HTMLElement | null {
    const wrap = document.createElement('div');
    wrap.className = 'vtr-files';
    for (const f of files) {
      const href = validateLogoUrl(f.url);
      if (!href) continue;
      let name = typeof f.filename === 'string' && f.filename.trim() ? f.filename.trim() : '';
      if (!name) {
        try {
          name = decodeURIComponent(new URL(href).pathname.split('/').pop() ?? '');
        } catch {
          name = '';
        }
      }
      const extMatch = /\.([a-z0-9]{1,5})$/i.exec(name);
      const isPdf = f.mimeType === 'application/pdf' || extMatch?.[1]?.toLowerCase() === 'pdf';
      const kindLabel = isPdf ? 'PDF' : (extMatch?.[1] ?? '').toUpperCase();
      const link = document.createElement('a');
      link.className = 'vtr-file';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('download', name);
      const icon = document.createElement('span');
      icon.className = 'vtr-file-icon';
      icon.appendChild(strokeIcon(ICONS.file));
      if (kindLabel) {
        const tag = document.createElement('span');
        tag.className = 'vtr-file-ext';
        tag.textContent = kindLabel;
        icon.appendChild(tag);
      }
      const text = document.createElement('span');
      text.className = 'vtr-file-text';
      const nameEl = document.createElement('span');
      nameEl.className = 'vtr-file-name';
      nameEl.textContent = name || kindLabel || t('fileOpen');
      const meta = document.createElement('span');
      meta.className = 'vtr-file-meta';
      const parts = [kindLabel, typeof f.size === 'number' && f.size > 0 ? formatBytes(f.size) : ''].filter(Boolean);
      meta.textContent = parts.join(' · ');
      text.append(nameEl);
      if (parts.length > 0) text.append(meta);
      const action = document.createElement('span');
      action.className = 'vtr-file-action';
      action.setAttribute('aria-label', isPdf ? t('fileOpen') : t('fileDownload'));
      action.appendChild(strokeIcon(ICONS.download));
      link.append(icon, text, action);
      wrap.appendChild(link);
    }
    return wrap.childElementCount > 0 ? wrap : null;
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

  function bubble(
    dir: 'inbound' | 'outbound',
    content: string,
    id?: string,
    demo = false,
  ): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vtr-msg';
    el.setAttribute('data-dir', dir);
    if (id !== undefined) el.dataset.id = id;
    if (demo) {
      // A demo exchange stays visibly apart from the assistant, live or after
      // a reload: its own tint and a «Demo» tag on the business's replies.
      el.setAttribute('data-mode', 'demo');
      if (dir === 'outbound') {
        const tag = document.createElement('span');
        tag.className = 'vtr-msg-tag';
        tag.textContent = t('sbDemoTag');
        el.appendChild(tag);
      }
    }
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
  function systemLine(text: string, id: string, actions?: WidgetNotice['actions']): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vtr-system';
    el.dataset.id = id;
    el.setAttribute('role', 'status');
    el.textContent = text;
    if (actions && actions.length > 0) {
      const row = document.createElement('div');
      row.className = 'vtr-system-actions';
      for (const a of actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vtr-system-btn';
        b.dataset.noticeAction = a.id;
        b.textContent = a.label;
        row.appendChild(b);
      }
      el.appendChild(row);
    }
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
    // Sidebar: the assistant caption, the suggested questions and the WhatsApp
    // link, only while nothing has been said yet (they leave with the greeting).
    if (chrome && !demoOn) for (const extra of chrome.welcomeExtras()) messagesEl.appendChild(extra);
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
   *   · ver propiedades / agendar una visita / publicar mi propiedad — one per
   *     `home.prompts` id, in order; a tap sends a message, no form;
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

    for (const id of homePrompts) {
      const p = HOME_PROMPT_CARDS[id];
      const card = homeCard(id, ICONS[p.icon], true);
      cardLine(card, 'vtr-home-card-title', t(p.title));
      cardLine(card, 'vtr-home-card-sub', t(p.sub));
      homeCardsEl.appendChild(card);
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
    const homeLogo = makeLogo();
    top.append(homeLogo, spacer, avatarsEl, closeHome);
    placeDarkLogo(homeLogo);

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
        case 'properties':
        case 'visit':
        case 'list_property':
        case 'products':
        case 'order_status':
        case 'projects':
        case 'showroom_visit':
        case 'after_sales':
          // A conversation starter, not a form: land in the transcript and send
          // the visitor's words through the composer's own path — same gates,
          // same onSend — so there is one way a visitor message leaves.
          setView('messages');
          sendAsVisitor(t(HOME_PROMPT_CARDS[kind].message));
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
      if (host.isConnected) return;
      const container = sb?.options.layout === 'inline' ? sb.container : null;
      (container ?? document.body).appendChild(host);
      if (chrome?.mountSlot()) root.setAttribute('data-slotted', '');
    },
    destroy(): void {
      clearStaged(true);
      chrome?.destroy();
      settleTimers.forEach(clearTimeout);
      for (const { target, type, handler } of listeners) {
        target.removeEventListener(type, handler);
      }
      listeners.length = 0;
      if (host.isConnected) host.remove();
    },
    openPanel(focus = true): void {
      open = true;
      chrome?.hideTeaser();
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
      // Never on an auto-open: a panel that opened on its own must not take the
      // keyboard (or summon a phone keyboard) from what the visitor was doing.
      // Nor on a touch screen: the focus summons the keyboard over the panel
      // before the visitor has read anything (embed: mobile no-autofocus). They
      // tap the field when they want to type; a mouse/trackpad keeps autofocus.
      if (focus && activeView === 'messages' && !coarsePointer()) input.focus();
      scrollToBottom();
      transcriptAtFoot = true;
      fitPanel();
    },
    closePanel(): void {
      open = false;
      panel.hidden = true;
      fitPanel();
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
      // Nothing said yet but a notice to show (demo mode's frame): the greeting
      // stays above it instead of vanishing.
      if (messages.length === 0 && open) renderWelcome();
      // Interleave notices into the transcript by timestamp, so "an advisor
      // joined" appears where it happened rather than pinned to the bottom.
      const items: Array<{ at: string; render: () => void; msg?: WidgetMessage }> = [
        ...messages.map((m) => ({
          at: m.createdAt,
          msg: m,
          render: () => {
            const el = bubble(m.direction, m.content, String(m.id), m.mode === 'demo');
            if (m.status) el.setAttribute('data-status', m.status);
            // Photos ride ABOVE the caption. A row whose every URL fails
            // validation is simply its caption — never a blank bubble.
            const imageUrls = (m.mediaUrls ?? []).filter((u) => !isDocumentUrl(u));
            const docFiles = [
              ...(Array.isArray(m.files) ? m.files : []),
              ...(m.mediaUrls ?? [])
                .filter(isDocumentUrl)
                .filter((u) => !(m.files ?? []).some((f) => f.url === u))
                .map((url) => ({ url })),
            ];
            if (imageUrls.length > 0) {
              const media = mediaImages(imageUrls);
              if (media) el.prepend(media);
            }
            if (docFiles.length > 0) {
              const docs = fileCards(docFiles);
              if (docs) el.prepend(docs);
            }
            // The card ENHANCES the prose; it never replaces it. A row whose
            // type we do not recognise, or whose card the server declined to
            // project, is simply the reply it always was — never a blank bubble.
            if (m.type === 'stock_card') {
              const card = cardOf(m);
              if (card) el.appendChild(catalogCard(card));
            }
            messagesEl.appendChild(el);
            if (m.status === 'failed' && m.clientMessageId) {
              messagesEl.appendChild(retryControl(m.clientMessageId));
            }
          },
        })),
        ...notices.map((n) => ({
          at: n.at,
          render: () =>
            messagesEl.appendChild(
              systemLine(
                n.kind === 'handoff_human' ? t('advisorJoined') : (n.text ?? ''),
                n.id,
                n.actions,
              ),
            ),
        })),
      ];
      items.sort((a, b) => {
        const ta = Date.parse(a.at);
        const tb = Date.parse(b.at);
        return Number.isFinite(ta) && Number.isFinite(tb) ? ta - tb : 0;
      });
      for (const item of items) item.render();
      // A scripted reply's chips, only while it is the last thing said.
      const last = items[items.length - 1]?.msg;
      if (chrome && last?.replyChips && last.replyChips.length > 0) {
        messagesEl.appendChild(chrome.replyChips(last.replyChips));
      }
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
      applyLogo(next.logoUrl, next.logoOnDarkUrl);
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
      renderCredit();
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
      paintSidebarChrome();
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
    setHostHidden(hidden: boolean): void {
      // Same !important inline pin the host element has always carried, so page CSS
      // cannot fight it; only the widget flips it.
      host.style.setProperty('display', hidden ? 'none' : 'block', 'important');
      chrome?.setSlotHidden(hidden);
    },
    setTyping(active: boolean, note?: string | null): void {
      typingEl.hidden = !active;
      chrome?.setTyping(active);
      if (note && active) {
        if (!typingNote) {
          typingNote = document.createElement('span');
          typingNote.className = 'vtr-typing-note';
          typingEl.appendChild(typingNote);
        }
        typingNote.textContent = note;
        typingNote.hidden = false;
      } else if (typingNote) {
        typingNote.hidden = true;
      }
      if (active) scrollToBottom();
    },
    showTeaser(): void {
      if (!chrome || open) return;
      chrome.showTeaser(welcomeMessage ?? t('welcome'));
    },
    hideTeaser(): void {
      chrome?.hideTeaser();
    },
    isTeaserShown(): boolean {
      return chrome?.isTeaserShown() ?? false;
    },
    setDemo(on: boolean, kind: 'automotora' | 'clinica' | null = null): void {
      if (!chrome || demoOn === on) return;
      demoOn = on;
      demoKindOn = on ? kind : null;
      chrome.setDemo(on);
      if (on) panel.setAttribute('data-demo', '');
      else panel.removeAttribute('data-demo');
      const key = on ? demoPlaceholderKey() : 'sbAskPlaceholder';
      input.placeholder = t(key);
      input.setAttribute('aria-label', t(key));
      const agentName = sb?.options.agent?.name;
      if (on) setFooterNote(t('sbDemoDisclaimer'));
      else if (agentName) setFooterNote(t('sbAiDisclaimer').replace('{name}', agentName));
      // The suggested questions belong to the assistant, not to the demo world.
      messagesEl.querySelectorAll('.vtr-sb-meta, .vtr-sb-chips, .vtr-sb-walink').forEach((n) => {
        (n as HTMLElement).hidden = on;
      });
    },
    setPhotoUpload(enabled: boolean): void {
      if (enabled && !attachBtn) {
        attachBtn = document.createElement('button');
        attachBtn.type = 'button';
        attachBtn.className = 'vtr-attach';
        attachBtn.setAttribute('aria-label', t('attachPhoto'));
        attachBtn.title = t('attachPhoto');
        attachBtn.appendChild(strokeIcon(ICONS.paperclip));
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        fileInput.hidden = true;
        fileInput.tabIndex = -1;
        tray = document.createElement('div');
        tray.className = 'vtr-tray';
        tray.hidden = true;
        form.insertBefore(attachBtn, input);
        form.appendChild(fileInput);
        form.before(tray);
        on(attachBtn, 'click', () => fileInput?.click());
        on(fileInput, 'change', () => {
          const picked = Array.from(fileInput?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (fileInput) fileInput.value = '';
          for (const file of picked) {
            if (staged.length >= MAX_PHOTOS) break;
            staged.push({ file, url: URL.createObjectURL(file) });
          }
          paintTray();
        });
        on(tray, 'click', (e) => {
          const idx = (e.target as Element | null)?.closest?.('[data-tray-remove]') as HTMLElement | null;
          if (!idx) return;
          const [gone] = staged.splice(Number(idx.dataset.trayRemove), 1);
          if (gone) URL.revokeObjectURL(gone.url);
          paintTray();
        });
      }
      if (attachBtn) attachBtn.hidden = !enabled;
      if (!enabled) clearStaged(true);
      form.toggleAttribute('data-photos', enabled);
    },
    setHomePrompts(prompts: readonly WidgetHomePrompt[] | undefined): void {
      homePrompts = resolveHomePrompts(prompts);
      paintHomeCards();
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
        launcher.setAttribute('aria-label', launcherBase());
        return;
      }
      badge.hidden = false;
      // A dealer chat never has 100 unread replies; cap the glyph anyway so a
      // pathological count cannot stretch the launcher off the page.
      badge.textContent = n > 99 ? '99+' : String(n);
      launcher.setAttribute('aria-label', `${launcherBase()} — ${n} ${t('unread')}`);
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
    const cardMessage = (target?.closest?.('[data-card-message]') as HTMLElement | null)?.dataset
      .cardMessage;
    if (cardMessage) sendAsVisitor(cardMessage);
    const action = target?.dataset?.noticeAction;
    if (action === 'demo_yes' || action === 'demo_no' || action === 'demo_resume') {
      callbacks.onNoticeAction?.(action);
    }
  });

  /**
   * The ONE way a visitor message leaves the UI: the composer and the Home
   * prompt cards both end here, so the honeypot rides along and the host's
   * consent / Turnstile gates in onSend see every send alike.
   */
  function sendAsVisitor(text: string): void {
    callbacks.onSend(text, honeypot.value);
  }

  function submit(): void {
    const text = input.value.trim();
    if (staged.length > 0 && callbacks.onSendPhotos) {
      const files = staged.map((e) => e.file);
      input.value = '';
      // The tray's previews live on as the echo's photos: the host owns its own
      // object URLs, so ours are released.
      clearStaged(true);
      callbacks.onSendPhotos(files, text, honeypot.value);
      return;
    }
    if (text === '') return;
    input.value = '';
    sendAsVisitor(text);
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

  // --- Phones: the panel follows the visual viewport (embed: Android keyboard) ---
  // Since Chrome 108 on Android the on-screen keyboard shrinks only the VISUAL
  // viewport (interactive-widget=resizes-visual, the default); the layout
  // viewport, and with it a position:fixed panel sized 100dvh, stays full
  // height, so the composer ends up under the keyboard. iOS Safari behaves the
  // same way and pans the page instead. We are embedded on sites whose
  // viewport meta we do not control, so the widget does not rely on it: while
  // the keyboard is up on a touch screen the open panel publishes the visible
  // area as --vtr-vv-top / --vtr-vv-h, and the phone CSS (full-screen panel
  // only) places the panel there. With the keyboard down the vars are cleared
  // and the panel keeps 100dvh: on iOS 26 the visual viewport stops above the
  // floating toolbar, and a panel cut there would show the page under it.
  // A pinch-zoomed page keeps the plain layout too.
  //
  // "Keyboard up" is read fresh on every event, never from a stored baseline,
  // and a focused widget field counts on its own (0.23.4). Chrome on Android
  // shows its collapsed toolbar and the keyboard in one go when the page was
  // scrolled (a reload restores the scroll with the toolbar hidden), and the
  // viewport heights it reports along the way did not always add up to a
  // keyboard, so the first open after a reload kept the full-height panel.
  const vv = (globalThis as { visualViewport?: VisualViewport }).visualViewport;
  /** Whether the transcript sat at its foot before the viewport changed. */
  let transcriptAtFoot = true;
  on(messagesEl, 'scroll', () => {
    transcriptAtFoot = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 48;
  });
  const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  /** A text field inside the widget has focus: on a touch screen, the keyboard is up or coming. */
  function widgetFieldFocused(): boolean {
    const a = shadow.activeElement as HTMLElement | null;
    return !!a && (TYPING_TAGS.has(a.tagName) || a.isContentEditable);
  }
  /** The layout viewport's height right now (the larger reading wins). */
  function layoutHeight(): number {
    const ih = typeof innerHeight === 'number' ? innerHeight : 0;
    const ch = document.documentElement?.clientHeight ?? 0;
    return Math.max(ih, ch);
  }
  function clearViewportFit(): void {
    panel.style.removeProperty('--vtr-vv-top');
    panel.style.removeProperty('--vtr-vv-h');
    panel.removeAttribute('data-kbd');
  }
  function fitToViewport(): void {
    const keyboardUp =
      !!vv &&
      Math.abs(vv.scale - 1) <= 0.01 &&
      (widgetFieldFocused() || layoutHeight() - vv.height > 150);
    if (!vv || !open || !coarsePointer() || !keyboardUp) {
      clearViewportFit();
      return;
    }
    const foot = transcriptAtFoot;
    panel.style.setProperty('--vtr-vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
    panel.style.setProperty('--vtr-vv-h', `${Math.round(vv.height)}px`);
    // The footer's home-indicator inset would float above the keyboard.
    panel.setAttribute('data-kbd', '');
    // The keyboard took the bottom of the list: keep the latest message in view.
    if (foot && activeView === 'messages') scrollToBottom();
  }
  // Fit at once (no frame of the composer under the keyboard), again on the
  // next frame (resize and scroll arrive in bursts while the keyboard
  // animates), and a few times after a focus change: the keyboard and the
  // browser toolbar settle over ~half a second, and the last step does not
  // always fire an event.
  let fitPending = false;
  function scheduleFit(): void {
    fitToViewport();
    if (fitPending) return;
    fitPending = true;
    const run = (): void => {
      fitPending = false;
      fitToViewport();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }
  let settleTimers: ReturnType<typeof setTimeout>[] = [];
  function settleFit(): void {
    settleTimers.forEach(clearTimeout);
    settleTimers = [0, 150, 400, 800].map((ms) => setTimeout(scheduleFit, ms));
  }
  if (vv) {
    on(vv, 'resize', scheduleFit);
    on(vv, 'scroll', scheduleFit);
    if (typeof window !== 'undefined') on(window, 'resize', scheduleFit);
    on(shadow, 'focusin', settleFit);
    on(shadow, 'focusout', settleFit);
  }
  fitPanel = fitToViewport;

  // Build the tab chrome NOW when the caller already knows the answer — a
  // repeat visitor whose cached config says Home is on gets the tab bar on the
  // first paint rather than watching it appear a round trip later. A caller who
  // passes nothing reaches none of this, and the panel above is complete.
  if (homeCfg.enabled) ensureHomeView();
  if (helpCfg.enabled) ensureHelpView();
  if (views) syncTabChrome();

  return ui;
}
