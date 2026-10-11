// Public configuration surface for the Vitrina chat widget. This is the
// contract a dealer site (or the storefront template's <ChatWidget>) passes to
// VitrinaChat.init(). Kept deliberately small and stable — additive changes
// only; the widget reads sensible defaults for everything omitted.

export type WidgetLocale = 'es' | 'en';

/**
 * The typeface the widget paints itself in. A CLOSED set, not an arbitrary
 * family name: each value maps to a Google Fonts stylesheet the widget injects
 * into the host page's <head> (see ./fonts for why it cannot live in the shadow
 * root). `system` is the default and loads nothing at all.
 *
 * An unknown value — a newer server offering a face this widget predates —
 * resolves to `system` rather than to a family the browser cannot find.
 */
export type WidgetFont =
  | 'system'
  | 'dmSans'
  | 'ibmPlexSans'
  | 'poppins'
  | 'nunitoSans'
  | 'archivo'
  | 'montserrat'
  | 'saira';

export interface WidgetTheme {
  /** Brand accent for the launcher + agent bubbles. Any CSS color. */
  accent?: string;
  /** Launcher corner. Default 'br'. */
  position?: 'br' | 'bl';
  /** Optional logo shown in the panel header (absolute URL). */
  logoUrl?: string;
}

/**
 * The three automotive quick actions on the Home screen (0.9.0). Each one is a
 * card that opens a short form inside the panel:
 *
 *   buy    — "Comprar un auto": what are you after, and how do we reach you
 *   sell   — "Vender tu auto": the consignment intake (plate, make, photos…)
 *   search — "¿No encuentras el auto que buscas?": we go and find it
 *
 * Every card is OFF unless something says `true`. Which ones a vertical turns on
 * by default is the SERVER's decision — the widget renders what resolves.
 */
export interface WidgetHomeCardsConfig {
  buy?: boolean;
  sell?: boolean;
  search?: boolean;
}

/**
 * The Home tab: an Intercom-style landing surface in front of the transcript.
 *
 * OFF unless `enabled` is explicitly true. A tenant who says nothing gets the
 * widget they have always had — one view, no tab bar, not a single extra node.
 */
export interface WidgetHomeConfig {
  /** Show the Home tab. Only an explicit `true` turns it on. */
  enabled?: boolean;
  /** Greeting headline. Trimmed; blank or over 80 chars falls back to "¡Hola! 👋". */
  title?: string;
  /** Line under the greeting. Trimmed; blank or over 120 chars falls back. */
  subtitle?: string;
  /**
   * The automotive quick-action cards. Merged FIELD-WISE like the rest of
   * `home`, so a page can force one card on and still let Vitrina decide the
   * others.
   */
  cards?: WidgetHomeCardsConfig;
}

/** Which quick-action flow a card (or `openHomeAction`) opens. */
export type WidgetHomeAction = 'buy' | 'sell' | 'search';

/** One question/answer pair on the Help tab. The answer is markdown. */
export interface WidgetFaqItem {
  q: string;
  a: string;
}

/**
 * The Help tab: a short FAQ accordion plus an escape hatch into the chat.
 *
 * Enabled means `enabled === true` AND at least one usable FAQ — a Help tab
 * that opens onto nothing is worse than no Help tab.
 */
export interface WidgetHelpConfig {
  enabled?: boolean;
  /** Up to 20; malformed entries are dropped individually, never the whole list. */
  faqs?: WidgetFaqItem[];
}

/**
 * A face on the Home hero. Up to 5 are accepted and the first 3 are drawn, as
 * an overlapping avatar stack — the "there are humans here" signal.
 *
 * `avatarUrl` is validated as an absolute http(s) URL; anything else means the
 * member's initials on a deterministic colour instead of a broken image.
 */
export interface WidgetTeamMemberConfig {
  name: string;
  avatarUrl?: string | null;
}

/**
 * How the widget sits on the page (embed#25, D7/D15).
 *
 *   bubble  — the floating launcher + card it has always been. The default:
 *             an install that says nothing keeps exactly today's widget.
 *   sidebar — a 400 px panel docked right that OVERLAYS the page and collapses
 *             to a side tab; on a phone a peek card that opens full screen
 *             only when tapped, never on its own.
 *   inline  — the same chat rendered inside a host container (`container`),
 *             for a page section such as a live «pruébala» demo.
 */
export type WidgetLayout = 'bubble' | 'sidebar' | 'inline';

/**
 * A closed set of surface palettes. `cream` matches the Vitrina landing
 * (cream surfaces, warm hairlines, darkened ember accent, DM Sans) and opts out
 * of the automatic dark scheme, because the page around it does not switch.
 */
export type WidgetPreset = 'default' | 'cream';

/**
 * The named assistant shown in the header, peek card and side tab (D20/D23).
 * The label is the disclosure and is ALWAYS rendered next to the portrait; the
 * widget refuses to show a portrait with no label rather than imply a person.
 */
export interface WidgetAgentConfig {
  /** First name, e.g. "Tomás". Trimmed, at most 24 characters. */
  name?: string;
  /** Disclosure label, e.g. "Asistente IA de Vitrina". At most 48 characters. */
  label?: string;
  /** Status line, e.g. "Responde al instante". At most 40 characters. */
  status?: string;
  /** Portrait (absolute http(s) URL, round-masked). Absent ⇒ initials. */
  avatarUrl?: string;
}

/** What auto-open shows on one kind of device. A phone never gets `panel` (D15). */
export type WidgetAutoOpenDesktop = 'panel' | 'teaser' | 'off';
export type WidgetAutoOpenMobile = 'teaser' | 'off';

/**
 * Proactive open (D16). OFF unless `enabled` is true. Fires at most once per
 * browser session, never after any dismiss or manual open, never while a
 * field is focused, a video is playing or a host dialog/booking sheet is open
 * (it waits for the page to be quiet instead), and never on an excluded path.
 */
export interface WidgetAutoOpenConfig {
  enabled?: boolean;
  /** Seconds after load. Default 10, clamped to 1..600. */
  delaySeconds?: number;
  /** Seconds on a phone; defaults to `delaySeconds`. */
  mobileDelaySeconds?: number;
  /** Default `panel`. */
  desktop?: WidgetAutoOpenDesktop;
  /** Default `teaser` (the peek card). */
  mobile?: WidgetAutoOpenMobile;
  /**
   * Path patterns where it never fires: exact (`/agendar`) or prefix with a
   * trailing `*` (`/agendar/*`). Matched against `location.pathname`.
   */
  excludePaths?: string[];
  /** Experiment arm, echoed on every auto-open event so tests can be judged. */
  variant?: string;
}

/**
 * A suggested question under the greeting. Tapping it sends `message` (or the
 * label) as the visitor's first message; `action: 'demo'` enters demo mode
 * first, `action: 'booking'` opens the agenda instead of sending anything.
 */
export interface WidgetChipConfig {
  label: string;
  message?: string;
  action?: 'message' | 'demo' | 'booking';
}

/** One-tap continuation on WhatsApp with the conversation's reference (D36). */
export interface WidgetWhatsAppConfig {
  /** International number, digits only after normalisation (e.g. 56912345678). */
  number: string;
  /**
   * Prefilled text. `{ref}` is replaced by the conversation's reference code;
   * without the placeholder the code is appended as " (ref XXXXXX)".
   */
  text?: string;
}

export interface WidgetConfig {
  /**
   * Publishable widget key (`pk_...`, origin-locked — Vitrina ADR 0033).
   * Safe to ship in page source; it only works on the dealer's allow-listed
   * domains and only grants stock:read + leads:intake + widget:chat.
   */
  publicKey: string;
  /** Vitrina API base, e.g. https://<host>/api/v1. */
  apiBaseUrl: string;
  /** Optional: pre-attach the inquiry to a vehicle (the `id` from /stock). */
  vehicleId?: string;
  /**
   * Human-readable name for `vehicleId` — e.g. "Toyota Yaris 2021".
   *
   * ONLY used to show which car a visit is being booked for. There is no public
   * route that can resolve a vehicle id to a title, so the dealer's own page —
   * which already has the title on screen — is the honest source. Rendered only
   * when BOTH `vehicleId` and `vehicleLabel` are present; never a placeholder,
   * never a spinner, never an empty card.
   */
  vehicleLabel?: string;
  locale?: WidgetLocale;
  theme?: WidgetTheme;
  /**
   * What the booking chip over the composer says — "Agendar demo", "Reservar
   * hora", "Book a test drive". Used VERBATIM, in whatever language it is
   * written in: it is the tenant's own words, not a translation key, so it does
   * not change when the chrome language does.
   *
   * Trimmed; blank or longer than 40 characters falls back to the built-in
   * "Agendar visita" / "Book a visit". Omit for the default.
   */
  /**
   * Clinic workspaces: the slug of the online-booking landing the clinic
   * booking flow books through, when the clinic runs several. Omitted ⇒ the
   * clinic's main landing. Ignored by a dealer's widget.
   */
  landing?: string;
  bookingLabel?: string;
  /**
   * Typeface for the whole widget. Default `system` — today's native stack,
   * which loads nothing. Any other value injects ONE Google Fonts <link> into
   * the host page's <head>; if it fails to load, the widget renders in the
   * system stack and nothing breaks.
   */
  font?: WidgetFont;
  /**
   * Logo shown in the panel header, ~22px tall (absolute http(s) URL).
   *
   * The same slot as `theme.logoUrl`, hoisted to the top level because it is
   * brand identity rather than a colour choice, and because that is the shape
   * `GET /widget/config` sends. This wins over `theme.logoUrl` when both are
   * set inline; an unusable URL simply means no logo, never a broken image.
   */
  logoUrl?: string;
  /** Greeting shown before the visitor sends the first message. */
  welcomeMessage?: string;
  /**
   * The Home tab. Absent (or `enabled` not true) ⇒ no tab bar, no Home view,
   * and the panel is exactly the single-view widget it has always been.
   *
   * Merged FIELD-WISE with the server's answer, like every other appearance
   * field: a page can override the greeting and still let Vitrina decide
   * whether Home is on at all.
   */
  home?: WidgetHomeConfig;
  /** The Help tab (FAQ accordion). Same field-wise merge as `home`. */
  help?: WidgetHelpConfig;
  /**
   * Faces for the Home hero's avatar stack. Inline REPLACES the server's list
   * rather than merging into it — half of two teams is nobody's team.
   */
  team?: WidgetTeamMemberConfig[];
  /** Placement mode. Default `bubble` (today's widget). */
  layout?: WidgetLayout;
  /** Surface palette. Default `default`. */
  preset?: WidgetPreset;
  /**
   * `bottom-bar`: on a phone the widget draws NO floating launcher; the host
   * page owns a sticky bar and gives the widget a slot in it (`launcherSlot`).
   * The peek card then sits above the bar. Default `auto`.
   */
  anchor?: 'auto' | 'bottom-bar';
  /** Element (or selector) the launcher renders into when `anchor` is `bottom-bar`. */
  launcherSlot?: HTMLElement | string;
  /** Host element (or selector) for `layout: 'inline'`. */
  container?: HTMLElement | string;
  /** The named assistant (portrait + disclosure label). */
  agent?: WidgetAgentConfig;
  /** Proactive open (D16). Field-wise merged over the server's answer. */
  autoOpen?: WidgetAutoOpenConfig;
  /** Up to 4 suggested questions under the greeting. Inline replaces remote. */
  chips?: WidgetChipConfig[];
  /** WhatsApp continuation. */
  whatsapp?: WidgetWhatsAppConfig;
  /**
   * A full-width pinned button above the composer ("Agendar demo"). With the
   * tenant's in-widget booking on it opens the agenda in the panel; otherwise it
   * emits the `cta` event so the host opens its own booking sheet.
   * `target: 'host'` always hands it to the host, even with the agenda on (the
   * Vitrina landing books demos in its own sheet).
   */
  cta?: { label: string; target?: 'auto' | 'host' };
  /** Name of the fictional business demo mode plays (e.g. "Automotora Demo"). */
  demoWorld?: string;
  /**
   * Page facts the assistant may use for its first answer (spec v3 §5.2), e.g.
   * `{ page_id: 'automotoras', vertical: 'automotriz' }`. Strings only, at most
   * 8 keys; travels with each message.
   */
  pageContext?: Record<string, string>;
  /**
   * Fetch the dealer's appearance from Vitrina at init (default `true`).
   *
   * With it on, `theme` / `welcomeMessage` / `locale` / `bookingLabel` /
   * `font` / `logoUrl` / `home` / `help` / `team` can be managed from the
   * Vitrina admin UI and reach this widget without anyone editing this page —
   * which is the point. Anything set HERE still wins, so these fields remain
   * per-site overrides rather than being taken away.
   *
   * Set `false` to keep the widget entirely self-contained (one fewer request,
   * and immunity from a remote change). A site that pins every field inline is
   * already unaffected by the fetch; this is for opting out of it entirely.
   */
  remoteConfig?: boolean;
}

/** Handle returned by init(), so the host can control the widget. */
export interface WidgetInstance {
  open(): void;
  close(): void;
  /**
   * Open the panel with the booking calendar already up, for a host page that
   * has its own booking button (whatever `bookingLabel` calls it).
   *
   * Returns `true` when the calendar is showing and `false` when the visitor
   * got the conversation instead — this tenant has booking off, or the widget
   * has not yet heard back from `GET /widget/config` (in that case the calendar
   * still opens on its own the moment the answer arrives, as long as the
   * visitor has not closed the panel meanwhile).
   *
   * The panel opens in every case, so `false` is a fallback, never a failure.
   */
  openBooking(): boolean;
  /**
   * Open one of the Home quick-action forms directly — "Comprar un auto",
   * "Vender tu auto", "Lo buscamos por ti" — for a host page that has its own
   * button for the same ask (a storefront template's "Vende tu auto" hero CTA).
   *
   * Returns `true` when that form is showing and `false` when the visitor got
   * the conversation instead — this tenant has that card off, or the widget has
   * not yet heard back from `GET /widget/config` (in that case the form still
   * opens on its own the moment the answer arrives, as long as the visitor has
   * not closed the panel meanwhile).
   *
   * The panel opens in every case, so `false` is a fallback, never a failure.
   */
  openHomeAction(kind: WidgetHomeAction): boolean;
  /**
   * Point the current conversation — and any booking started after it — at a
   * vehicle (e.g. on SPA route change).
   *
   * `label` is the optional display title, mirroring `WidgetConfig.vehicleLabel`.
   * Passing `null` for the id clears both, so a route change away from a listing
   * can never leave the previous car's name on a booking summary.
   */
  setVehicle(vehicleId: string | null, label?: string | null): void;
  /** Put text in the composer without sending it, and open the panel. */
  prefill(text: string): void;
  /** Open the panel and send `text` as the visitor's message. */
  send(text: string): Promise<boolean>;
  /** Enter demo mode (D60): the next messages go to the demo persona. */
  enterDemo(): void;
  exitDemo(): void;
  /**
   * The wa.me link for the current conversation, with its reference code —
   * null when no WhatsApp number is configured.
   */
  whatsappUrl(): string | null;
  /** Subscribe to widget events; returns the unsubscribe function. */
  on<E extends WidgetEventName>(event: E, handler: (payload: WidgetEventMap[E]) => void): () => void;
  destroy(): void;
}

/** Events a host page can listen to (analytics, sticky-bar coordination). */
export interface WidgetEventMap {
  open: { source: 'api' | 'launcher' | 'auto' | 'peek' | 'chip' };
  close: { source: 'api' | 'visitor' };
  /** Auto-open fired. `mode` is what was shown. */
  autoopen: { mode: 'panel' | 'teaser'; device: 'desktop' | 'mobile'; variant: string | null };
  /** The visitor dismissed the peek card or the auto-opened panel. */
  dismiss: { surface: 'panel' | 'teaser' };
  chip: { index: number; label: string; action: 'message' | 'demo' | 'booking' };
  message: { clientMessageId: string };
  handoff_whatsapp: { ref: string | null };
  demo_enter: { entry: 'api' | 'chip' };
  demo_exit: { reason: 'api' | 'visitor' };
  /** The pinned CTA (or a booking chip) was tapped and the host should act. */
  cta: { source: 'pinned' | 'chip' };
}
export type WidgetEventName = keyof WidgetEventMap;
