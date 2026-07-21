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
  /** Point the current conversation at a vehicle (e.g. on SPA route change). */
  setVehicle(vehicleId: string | null): void;
  destroy(): void;
}
