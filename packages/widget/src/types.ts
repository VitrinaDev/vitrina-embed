// Public configuration surface for the Vitrina chat widget. This is the
// contract a dealer site (or the storefront template's <ChatWidget>) passes to
// VitrinaChat.init(). Kept deliberately small and stable — additive changes
// only; the widget reads sensible defaults for everything omitted.

export type WidgetLocale = 'es' | 'en';

export interface WidgetTheme {
  /** Brand accent for the launcher + agent bubbles. Any CSS color. */
  accent?: string;
  /** Launcher corner. Default 'br'. */
  position?: 'br' | 'bl';
  /** Optional logo shown in the panel header (absolute URL). */
  logoUrl?: string;
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
  /** Greeting shown before the visitor sends the first message. */
  welcomeMessage?: string;
  /**
   * Fetch the dealer's appearance from Vitrina at init (default `true`).
   *
   * With it on, `theme` / `welcomeMessage` / `locale` can be managed from the
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
