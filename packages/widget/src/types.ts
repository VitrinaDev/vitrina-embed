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
}

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
   * Point the current conversation — and any booking started after it — at a
   * vehicle (e.g. on SPA route change).
   *
   * `label` is the optional display title, mirroring `WidgetConfig.vehicleLabel`.
   * Passing `null` for the id clears both, so a route change away from a listing
   * can never leave the previous car's name on a booking summary.
   */
  setVehicle(vehicleId: string | null, label?: string | null): void;
  destroy(): void;
}
