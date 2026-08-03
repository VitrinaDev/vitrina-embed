// The visitor's booking keyring — how "see and cancel your own booking without
// an account" is satisfied with no account, no password and no server-side
// enumeration surface.
//
// SENSITIVITY. This is NOT the visitor token. A `vt_` is a non-secret id the
// server re-issues on demand; a `bkt_` is a CAPABILITY — it is the only thing
// that can read or cancel a booking, it is returned exactly once (in the POST
// 201) and only its sha256 is stored server-side. Losing it loses the booking;
// leaking it lets a stranger cancel someone's visit. So it is never logged,
// never rendered, never put in a DOM attribute, and never sent anywhere except
// the two routes that exist to consume it.
//
// The server deliberately offers no "list my bookings" route (that would be an
// enumeration oracle on a public endpoint), so the browser holds its own ring
// and fans out. An entry whose GET answers 404 — cancelled and purged, wrong
// tenant, a key rotated underneath us — is DROPPED, because a token the server
// will not resolve is not a booking, it is litter.
//
// Namespaced by publicKey exactly like the visitor token, and every storage
// access degrades to memory rather than throwing into the host page.

import { safeLocalStorage, storageKey } from './storage';

const KEY_SUFFIX = ':bookings';

/**
 * One key on the ring. `displayId` and `startsAt` are cached alongside the
 * token ONLY so "Mis visitas" can be ordered and labelled before any network
 * round-trip resolves; the server's answer always wins once it lands.
 */
export interface BookingRecord {
  token: string;
  displayId: string;
  startsAt: string;
}

export interface BookingStore {
  /** Every held record, oldest visit first. Never throws, never null. */
  list(): BookingRecord[];
  /** Add or replace by token, then persist. */
  add(record: BookingRecord): void;
  /** Drop one token — used when its GET 404s. */
  remove(token: string): void;
}

/** Coerce a stored array, dropping anything that is not a usable record. */
function coerceRecords(input: unknown): BookingRecord[] {
  if (!Array.isArray(input)) return [];
  const out: BookingRecord[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.token !== 'string' || raw.token === '') continue;
    out.push({
      token: raw.token,
      displayId: typeof raw.displayId === 'string' ? raw.displayId : '',
      startsAt: typeof raw.startsAt === 'string' ? raw.startsAt : '',
    });
  }
  return out;
}

/** Oldest visit first, so "próximas" and "historial" split on one comparison. */
function byStartsAt(a: BookingRecord, b: BookingRecord): number {
  const ta = Date.parse(a.startsAt);
  const tb = Date.parse(b.startsAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return a.token.localeCompare(b.token);
}

/**
 * Create a namespaced booking keyring. Falls back to an in-memory ring when
 * localStorage is unusable — the visitor then keeps their booking for the
 * pageview and loses it on reload, which is strictly better than the widget
 * throwing on a dealer's site.
 */
export function createBookingStore(publicKey: string): BookingStore {
  const key = storageKey(publicKey, KEY_SUFFIX);
  const ls = safeLocalStorage();
  let memory: BookingRecord[] | null = null;

  function read(): BookingRecord[] {
    if (memory) return memory;
    if (!ls) {
      memory = [];
      return memory;
    }
    try {
      const raw = ls.getItem(key);
      memory = raw ? coerceRecords(JSON.parse(raw)) : [];
    } catch {
      // Corrupt entry or blocked storage. An unreadable ring is an empty ring;
      // it must never take the widget down with it.
      memory = [];
    }
    return memory;
  }

  function write(records: BookingRecord[]): void {
    memory = records;
    if (!ls) return;
    try {
      ls.setItem(key, JSON.stringify(records));
    } catch {
      /* keep the in-memory ring; storage full/blocked */
    }
  }

  return {
    list(): BookingRecord[] {
      return [...read()].sort(byStartsAt);
    },
    add(record: BookingRecord): void {
      if (!record?.token) return;
      const next = read().filter((r) => r.token !== record.token);
      next.push({
        token: record.token,
        displayId: record.displayId,
        startsAt: record.startsAt,
      });
      write(next);
    },
    remove(token: string): void {
      const current = read();
      const next = current.filter((r) => r.token !== token);
      if (next.length !== current.length) write(next);
    },
  };
}
