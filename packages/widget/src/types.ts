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
  /**
   * Optional variant of the logo for DARK grounds (absolute URL): drawn
   * instead of `logoUrl` wherever the header ground is dark (the accent
   * header, or the surface under `prefers-color-scheme: dark`). CSS picks the
   * variant; unset ⇒ `logoUrl` everywhere, exactly as before.
   */
  logoOnDarkUrl?: string;
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
  /**
   * Conversation-starter cards (0.21.0), painted in this order after the chat
   * and booking cards. Tapping one opens the conversation and sends a fixed,
   * localized visitor message — no form behind it. Unknown ids and repeats are
   * dropped. An ARRAY, so an inline value replaces the server's wholesale
   * rather than merging id by id. Absent or empty ⇒ no prompt cards.
   */
  prompts?: WidgetHomePrompt[];
  /**
   * The store's catalog page (0.23.5). With it, the `products` prompt card
   * («Ver productos») goes there instead of sending «Quiero ver productos»: in
   * the same tab when the URL is on the host page's own origin (the visitor is
   * already on the store, and the panel closes), in a new tab otherwise.
   * Absolute http(s) only; anything else is dropped and the card keeps sending
   * its message.
   */
  productsUrl?: string;
}

/**
 * A Home prompt card: a one-tap conversation starter.
 *
 *   properties    — "Ver propiedades"       → «Quiero ver propiedades»
 *   visit         — "Agendar una visita"    → «Quiero agendar una visita»
 *   list_property — "Publicar mi propiedad" → «Quiero publicar mi propiedad»
 *   products      — "Ver productos"         → «Quiero ver productos» (0.22.0), or the
 *                                             store's catalog page when `productsUrl` is set (0.23.5)
 *   order_status  — "Estado de mi pedido"   → «¿Cuál es el estado de mi pedido?» (0.22.0)
 *   projects      — "Ver proyectos"         → «Quiero ver los proyectos» (0.24.0, inmobiliarias)
 *   showroom_visit — "Agendar visita a sala" → «Quiero agendar una visita a la sala de ventas» (0.24.0)
 *   after_sales   — "Post-venta"            → «Tengo una consulta de post-venta» (0.24.0)
 */
export type WidgetHomePrompt =
  | 'properties'
  | 'visit'
  | 'list_property'
  | 'products'
  | 'order_status'
  | 'projects'
  | 'showroom_visit'
  | 'after_sales';

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
  /**
   * `'mark'` draws the Vitrina brand mark (the isometric pyramid with the amber
   * core) on a hairline tile instead of a portrait: no presence dot, no «IA»
   * badge, the core bobs while the assistant types. Takes precedence over
   * `avatarUrl`. Absent ⇒ the portrait, exactly as before (0.23.0).
   */
  avatar?: 'mark';
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
  /**
   * Open only after the visitor has scrolled (0.18.0). Off by default. When on,
   * a visitor who stays on the first screen never gets an auto-open: the timer
   * still counts from page load, but when it is due it waits (without giving
   * up) for the page to be scrolled at least `px` pixels, or `viewport` times
   * the window height (`true` = half a window). Busy detection still applies.
   */
  requireScroll?: boolean | WidgetRequireScroll;
}

/** How far the visitor must scroll before auto-open may fire. The larger wins. */
export interface WidgetRequireScroll {
  /** Minimum scroll distance in CSS pixels (0..20000). */
  px?: number;
  /** Minimum scroll distance as a fraction of the window height (0..5). */
  viewport?: number;
}

/**
 * A suggested question under the greeting. Tapping it sends `message` (or the
 * label) as the visitor's first message; `action: 'demo'` enters demo mode
 * first, `action: 'booking'` opens the agenda instead of sending anything.
 *
 * Scripted chips (0.18.0): a chip with a `reply` is answered IN THE BROWSER —
 * the label appears as the visitor's line, a short typing effect plays, then
 * `reply` appears as the assistant's line with the `next` chips under it. No
 * server call and no AI tokens. The taps are sent as page context
 * (`chips_seen`) with the visitor's next typed message, so the assistant knows
 * what was already answered. A chip without `reply` behaves as before.
 */
export interface WidgetChipConfig {
  label: string;
  message?: string;
  /**
   * `link` navigates to `url` (same tab). `compose` puts `message` (or nothing)
   * in the composer and focuses it: the visitor writes to the assistant.
   */
  action?: 'message' | 'demo' | 'booking' | 'link' | 'compose';
  /** Scripted answer shown locally (≤ 400 chars, plain text / the same light markdown as replies). */
  reply?: string;
  /** Chips under the scripted reply. Up to 3 levels in all, 4 chips per level. */
  next?: WidgetChipConfig[];
  /** `action: 'link'` only: an absolute http(s) URL. */
  url?: string;
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

export interface WidgetPricePolicy {
  mode: 'first_ask' | 'evaluation_only' | 'never' | 'script';
  script?: string;
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
  /**
   * The logo for dark header grounds — same slot as `theme.logoOnDarkUrl`,
   * same precedence and the same URL gate as {@link logoUrl}.
   */
  logoOnDarkUrl?: string;
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
  /**
   * Collapsed launcher on desktop in sidebar mode. `tab` (default): the docked
   * side tab with vertical text. `bubble`: a round portrait bottom-right with the
   * online dot and the IA badge; the ask text shows only as a hover/focus tooltip
   * and as the aria-label. `sidetab` (0.18.0): a vertical rectangle docked at the
   * right-centre edge with the portrait and a chat icon, no text (the ask is a
   * hover/focus tooltip and the aria-label). Inline only; phones always get the
   * round portrait.
   */
  launcherStyle?: 'tab' | 'bubble' | 'sidetab';
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
   * Which fictional business demo mode plays, for the server to route the turn
   * (`automotora` or `clinica`). When absent it is read off `demoWorld`'s name,
   * and failing that the server uses the page context's `vertical`.
   */
  demoKind?: 'automotora' | 'clinica';
  /**
   * Page facts the assistant may use for its first answer (spec v3 §5.2), e.g.
   * `{ page_id: 'automotoras', vertical: 'automotriz' }`. Strings only, at most
   * 8 keys; travels with each message.
   */
  pageContext?: Record<string, string>;
  /**
   * How the assistant handles price questions (0.17.4). Sent as `price_policy`
   * on every message; the server only honours it on the demo clinic's key.
   * `script` needs a non-empty `script` (trimmed, cut to 400 chars); an unknown
   * `mode` drops the whole field. Inline only, never read from remote config.
   */
  pricePolicy?: WidgetPricePolicy;
  /**
   * Start a NEW conversation (0.17.4): init forgets this publicKey's stored
   * visitor token first, so no prior history comes back. To restart a chat the
   * host calls `destroy()` then `init({ ...same, freshConversation: true })`.
   */
  freshConversation?: boolean;
  /**
   * Show the typing dots from the moment the visitor's message is accepted
   * until a reply lands (0.18.0), not only while the server says someone is
   * composing. After 12 s the dots read «Sigue escribiendo…»; after 60 s
   * without a reply they go away. Off by default: on a workspace where a
   * person answers later, dots would promise a reply that is not coming.
   */
  typingOnSend?: boolean;
  /**
   * The small «Con tecnología de Vitrina» credit at the foot of the open
   * panel, linking to vitrinadev.com (0.19.0). On by default; `false` removes
   * it. The link sits inside the widget's open shadow root, in the host page.
   */
  showPoweredBy?: boolean;
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
  /**
   * The unidad of a proyecto the visitor is asking about (set by the floor-plan
   * visor). The next message carries it as `unit_id`; null clears it.
   */
  setUnit(unitId: string | null): void;
  /** Put text in the composer without sending it, and open the panel. */
  prefill(text: string): void;
  /** Open the panel and send `text` as the visitor's message. */
  send(text: string): Promise<boolean>;
  /** Enter demo mode (D60): the next messages go to the demo persona. */
  enterDemo(): void;
  exitDemo(): void;
  /**
   * Temporarily take the whole widget off the page (launcher, peek card, bottom-bar
   * slot and panel). An open panel is closed first and reopened by `show()`; a
   * showing peek card comes back too. Auto-open waits while hidden. Idempotent.
   */
  hide(): void;
  /** Undo `hide()`, restoring what was open. Idempotent; a no-op if never hidden. */
  show(): void;
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
  /** `path` is the chip's place in the tree ("0", "0.2"); `scripted` = answered locally. */
  chip: {
    index: number;
    label: string;
    action: 'message' | 'demo' | 'booking' | 'link' | 'compose';
    path: string;
    scripted: boolean;
  };
  message: { clientMessageId: string };
  handoff_whatsapp: { ref: string | null };
  /** `typed` = the visitor wrote «quiero probar» and said yes. `world` is the business played. */
  demo_enter: { entry: 'api' | 'chip' | 'typed'; world: 'automotora' | 'clinica' | null };
  /** One visitor message sent in demo mode; `turns` counts this stay. */
  demo_turn: { turns: number };
  /**
   * `visitor` = the exit button; `api` = the host; `product` = the visitor asked
   * about the product itself; `turns` = the 12 messages ran out; `idle` = 10
   * minutes without a message.
   */
  demo_exit: { reason: 'api' | 'visitor' | 'product' | 'turns' | 'idle'; turns: number };
  /** The host called `hide()`; the widget is off the page. */
  hide: Record<string, never>;
  /** The host called `show()`; `restored` is what came back. */
  show: { restored: 'panel' | 'teaser' | 'launcher' };
  /** The pinned CTA (or a booking chip) was tapped and the host should act. */
  cta: { source: 'pinned' | 'chip' };
}
export type WidgetEventName = keyof WidgetEventMap;
