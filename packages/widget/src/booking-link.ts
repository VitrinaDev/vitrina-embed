// Cross-domain attribution for the hosted booking page (vitrina-app#3701,
// "Website ads").
//
// A clinic's "Agendar" button on its own site links to Vitrina's hosted
// booking page (`https://app.vitrinadev.com/reserva/<token>`) — a different
// domain, so the tracker's anonymous visitor id stays behind and the booking
// cannot be joined to the ad visit that led to it. The fix is the one the
// tracker already uses for WhatsApp links: decorate the outbound link at the
// moment it is used. The tag appends `?vt_aid=<anonymous id>` to every link
// (and booking iframe) that points at the booking page; the page reads it back
// and sends it with the booking as `attribution.anonymous_id`.
//
// WHICH LINKS is the server's answer, never a guess: `tag-config` returns
// `booking_link: { origin, path_prefix, param }` (null when the deployment has
// no public booking page). Nothing else on the page is touched.
//
// WHICH ID is the tracker's own readable one — `atribu_anon_id` in
// localStorage, else the `atribu_visitor_id` cookie — read at click time, so a
// tracker that booted after the tag is still seen. No id (consent denied, the
// tracker not loaded, storage blocked) means the link is left exactly as it
// was: a booking without the join, never a broken link.
//
// Defensive throughout: never throws into the host page.

export interface BookingLinkConfig {
  origin: string;
  path_prefix: string;
  param: string;
}

/** How many times (one a second) to wait for the tracker's id before giving
 *  up on decorating a booking iframe. */
const MAX_IFRAME_ATTEMPTS = 6;

/** Same opaque shape vitrina-app accepts for the tracker's id. */
const ANON_ID_SHAPE = /^[A-Za-z0-9_.:-]{8,128}$/;
const ANON_ID_STORAGE_KEY = 'atribu_anon_id';
const VISITOR_COOKIE = 'atribu_visitor_id';

/** The tracker's anonymous visitor id on this page, or null. */
export function readTrackerAnonymousId(doc: Document = document): string | null {
  try {
    const stored = window.localStorage?.getItem(ANON_ID_STORAGE_KEY);
    if (stored && ANON_ID_SHAPE.test(stored)) return stored;
  } catch {
    /* storage blocked — fall through to the cookie */
  }
  try {
    for (const part of (doc.cookie || '').split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === VISITOR_COOKIE) {
        const value = decodeURIComponent(rest.join('='));
        if (ANON_ID_SHAPE.test(value)) return value;
      }
    }
  } catch {
    /* unreadable cookie jar */
  }
  return null;
}

/**
 * `href` with the anonymous id appended when it points at the booking page,
 * else null (not ours, already decorated, unparseable). Pure.
 */
export function decorateBookingUrl(
  href: string,
  config: BookingLinkConfig,
  anonymousId: string,
  baseHref?: string,
): string | null {
  try {
    const url = new URL(href, baseHref);
    if (url.origin !== config.origin) return null;
    if (!url.pathname.startsWith(config.path_prefix)) return null;
    if (url.searchParams.has(config.param)) return null;
    url.searchParams.set(config.param, anonymousId);
    return url.toString();
  } catch {
    return null;
  }
}

function isUsableConfig(config: unknown): config is BookingLinkConfig {
  const c = config as Partial<BookingLinkConfig> | null | undefined;
  return Boolean(
    c &&
      typeof c.origin === 'string' &&
      c.origin &&
      typeof c.path_prefix === 'string' &&
      c.path_prefix &&
      typeof c.param === 'string' &&
      c.param,
  );
}

function closestAnchor(event: Event): HTMLAnchorElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path.slice(0, 8)) {
    if (node instanceof HTMLAnchorElement && node.href) return node;
  }
  const target = event.target as Element | null;
  const anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

function decorateIframes(doc: Document, config: BookingLinkConfig): boolean {
  const anonymousId = readTrackerAnonymousId(doc);
  if (!anonymousId) return false;
  doc.querySelectorAll('iframe[src]').forEach((frame) => {
    const src = frame.getAttribute('src');
    if (!src) return;
    const next = decorateBookingUrl(src, config, anonymousId, doc.location?.href);
    if (next) frame.setAttribute('src', next);
  });
  return true;
}

/**
 * Wire the decoration: links at the moment they are used (click, middle
 * click, the context menu's "open in new tab"), and booking iframes once the
 * tracker has an id — retried for a few seconds, because on a first visit the
 * tracker boots after the tag.
 */
export function installBookingLinkDecoration(
  config: BookingLinkConfig | null | undefined,
  doc: Document = document,
): () => void {
  if (!isUsableConfig(config)) return () => undefined;
  const onUse = (event: Event): void => {
    try {
      const anchor = closestAnchor(event);
      if (!anchor) return;
      const anonymousId = readTrackerAnonymousId(doc);
      if (!anonymousId) return;
      const next = decorateBookingUrl(
        anchor.getAttribute('href') ?? anchor.href,
        config,
        anonymousId,
        doc.location?.href,
      );
      if (next) anchor.setAttribute('href', next);
    } catch {
      /* never break the host page's link */
    }
  };
  doc.addEventListener('click', onUse, true);
  doc.addEventListener('auxclick', onUse, true);
  doc.addEventListener('contextmenu', onUse, true);

  let attempts = 0;
  const tryIframes = (): void => {
    attempts += 1;
    let done = false;
    try {
      done = decorateIframes(doc, config);
    } catch {
      done = true;
    }
    if (!done && attempts < MAX_IFRAME_ATTEMPTS) setTimeout(tryIframes, 1000);
  };
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', tryIframes, { once: true });
  } else {
    tryIframes();
  }
  return () => {
    doc.removeEventListener('click', onUse, true);
    doc.removeEventListener('auxclick', onUse, true);
    doc.removeEventListener('contextmenu', onUse, true);
    attempts = Number.POSITIVE_INFINITY;
  };
}
