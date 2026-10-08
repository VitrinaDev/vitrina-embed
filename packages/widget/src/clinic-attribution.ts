// The ad click a clinic booking carries (Website ads, vitrina-app#3707).
//
// What the booking sends is what the Vitrina tag and the page hold: the
// tracker's anonymous visitor id (the JOIN to the visits it recorded), plus the
// UTMs and fbclid/gclid the visitor arrived with. The server cleans every value
// (`normalizeBookingAttribution`); this module only gathers.
//
// THE LANDING URL'S PARAMETERS ARE REMEMBERED FOR THE TAB. A patient lands on
// `/?utm_source=facebook&fbclid=…`, reads two pages, then books from a third
// whose URL carries nothing. The click is captured at init into
// sessionStorage, and a later page that arrives with NEW parameters replaces
// it (that is a new click). Session-scoped on purpose: no cross-visit profile.
//
// NO URL, NO REFERRER, NO PAGE TITLE ever leave here: a clinic's path can name
// a treatment, and nothing health-shaped may reach a record an ad platform
// could see.

import { readTrackerAnonymousId } from './booking-link';
import type { ClinicAttribution } from './clinic-types';

const STORAGE_KEY = 'vitrina_booking_click';
const URL_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
  'fbclid',
  'gclid',
] as const;
/** The hosted page's carry-over param (`booking-link.ts`), read here too. */
const ANON_PARAM = 'vt_aid';
const ANON_ID_SHAPE = /^[A-Za-z0-9_.:-]{8,128}$/;

function fromUrl(search: string): ClinicAttribution {
  const out: ClinicAttribution = {};
  try {
    const params = new URLSearchParams(search);
    for (const key of URL_KEYS) {
      const v = params.get(key);
      if (v) out[key] = v.slice(0, 500);
    }
    const anon = params.get(ANON_PARAM);
    if (anon && ANON_ID_SHAPE.test(anon)) out.anonymous_id = anon;
  } catch {
    /* unparseable — nothing */
  }
  return out;
}

/** Remember the click this page arrived with. Called once at init. */
export function captureLandingClick(win: Window = window): void {
  try {
    const click = fromUrl(win.location?.search ?? '');
    if (Object.keys(click).length === 0) return;
    win.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(click));
  } catch {
    /* storage blocked — the booking still reads the live URL */
  }
}

function stored(win: Window): ClinicAttribution {
  try {
    const raw = win.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: ClinicAttribution = {};
    for (const key of [...URL_KEYS, 'anonymous_id'] as const) {
      const v = parsed[key];
      if (typeof v === 'string' && v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The attribution to send with a booking, or null when there is none. The
 * live URL beats the remembered click; the tracker's own id beats a carried
 * `vt_aid`, because it is the id the tracker is recording visits under now.
 */
export function bookingAttribution(win: Window = window): ClinicAttribution | null {
  const live = fromUrl(win.location?.search ?? '');
  const out: ClinicAttribution = Object.keys(live).some((k) => k !== 'anonymous_id')
    ? { ...live }
    : { ...stored(win), ...live };
  const tracker = readTrackerAnonymousId(win.document);
  if (tracker) out.anonymous_id = tracker;
  return Object.keys(out).length > 0 ? out : null;
}
