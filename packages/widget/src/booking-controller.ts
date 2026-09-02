// The booking flow's state machine: fecha → hora → datos → resumen → ok, plus
// mis / cancelar / cancelado. It owns every booking decision and every booking
// call; booking-ui.ts only paints what this hands it.
//
// WHY IT IS ITS OWN MODULE. index.ts owns the CHAT state, and a calendar that
// navigates months, caches availability, holds a half-typed form across a
// slot-taken bounce and fans a keyring out over N round-trips is not chat state.
// Keeping it here also means the whole flow is exercised through init() against
// a mocked fetch, with no DOM assertions living inside the logic.
//
// NOTHING HERE THROWS. Every transport method answers {ok,status[,reason]}, and
// every failure has a screen. The tenant-off case never reaches this module at
// all: the controller is only constructed once `bookingEnabled` is true.

import type { BookingStore } from './booking-store';
import type {
  BookingCallbacks,
  BookingSlotView,
  BookingViewState,
  BookingVisitView,
} from './booking-ui';
import { formatDayLong } from './booking-ui';
import type { AvailabilitySlot, VitrinaTransport } from './transport';
import type { TurnstileGate } from './turnstile';
import type { WidgetLocale } from './types';

/** Only the four booking methods — the rest of the transport is none of our business. */
export type BookingTransport = Pick<
  VitrinaTransport,
  'fetchAvailability' | 'bookAppointment' | 'fetchBooking' | 'cancelBooking'
>;

export interface BookingControllerDeps {
  transport: BookingTransport;
  store: BookingStore;
  /** Read live: an SPA route change can point the widget at another car. */
  getVehicle(): { id: string | null; label: string | null };
  getLocale(): WidgetLocale;
  /** Repaint the overlay. */
  onRender(state: BookingViewState): void;
  /** Chip visibility + the "Mis visitas · N" count. */
  onChip(info: { hasBookings: boolean; upcoming: number }): void;
  /** Close the overlay and hand the visitor to the chat with a draft. */
  onChatFallback(draftKey: 'writeUsDraft' | 'otherDeviceDraft'): void;
  /** Close the overlay, leaving the transcript exactly where it was. */
  onClose(): void;
  /**
   * The Turnstile gate, or null when the server advertised no site key. Null
   * ⇒ bookings POST tokenless and the server fails open, exactly as before
   * this field existed.
   */
  turnstile: TurnstileGate | null;
}

export interface BookingController {
  /** Handed straight to createBookingUi. */
  readonly callbacks: BookingCallbacks;
  /**
   * Swap the Turnstile gate after construction. The gate is decided by the
   * REMOTE config, and a returning visitor's cached config (written by a
   * widget older than the site key, or by a tenant that had no key yet) can
   * build this controller before the live config lands — with no gate. Left
   * that way, every confirm of that pageview POSTs tokenless against a server
   * that now refuses tokenless bookings. `index.ts` calls this once the live
   * config resolves; a null clears the gate (tenant switched Turnstile off).
   */
  setTurnstile(gate: TurnstileGate | null): void;
  /** Chip "Agendar visita". */
  openBooking(): void;
  /** Chip "Mis visitas". */
  openVisits(): void;
  /** Recompute the chip from the keyring (called once on enable). */
  refreshChip(): void;
  destroy(): void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * The UTC offset (`-04:00`) that `timeZone` is on at `date`, or the browser's
 * own when we have not been told a zone yet.
 *
 * There is no date library here and there is not going to be one — the widget
 * has ZERO runtime dependencies and every kilobyte lands on a dealer's page.
 * `longOffset` is the whole trick; an engine too old for it falls back to the
 * visitor's offset, which only ever shifts a month boundary by hours and is
 * clamped server-side anyway.
 */
function zoneOffset(date: Date, timeZone: string | null): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset',
      }).formatToParts(date);
      const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
      const match = /GMT([+-]\d{2}:\d{2})/.exec(name);
      if (match?.[1]) return match[1];
      if (name === 'GMT') return '+00:00';
    } catch {
      /* fall through to the local offset */
    }
  }
  const mins = -date.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** ISO8601 WITH OFFSET for the whole visible month. The server clamps both ends. */
function monthRange(anchor: Date, timeZone: string | null): { from: string; to: string } {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const first = new Date(y, m, 1);
  return {
    from: `${y}-${pad2(m + 1)}-01T00:00:00${zoneOffset(first, timeZone)}`,
    to: `${y}-${pad2(m + 1)}-${pad2(last)}T23:59:59${zoneOffset(new Date(y, m, last), timeZone)}`,
  };
}

/**
 * The DEALERSHIP's wall clock for an instant. Prefer the server's own `label`
 * ("2026-08-12 10:00") — it was rendered in their timezone by the machine that
 * owns the schedule, and trusting it means the widget never converts a zone.
 */
function wallClock(iso: string, timeZone: string | null): { day: string; time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: '', time: '' };
  try {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    if (timeZone) opts.timeZone = timeZone;
    const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(date);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
  } catch {
    return { day: '', time: '' };
  }
}

function slotDay(slot: AvailabilitySlot, timeZone: string | null): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(slot.label)) return slot.label.slice(0, 10);
  return wallClock(slot.startsAt, timeZone).day;
}

function slotTime(slot: AvailabilitySlot, timeZone: string | null): string {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(slot.label)) return slot.label.slice(11, 16);
  return wallClock(slot.startsAt, timeZone).time;
}

interface MonthEntry {
  slots: AvailabilitySlot[];
  counts: Record<string, number>;
}

function emptyForm(): BookingViewState['form'] {
  return { name: '', phone: '', email: '', consent: false };
}

export function createBookingController(deps: BookingControllerDeps): BookingController {
  let turnstile: TurnstileGate | null = deps.turnstile;
  const { transport, store } = deps;

  let destroyed = false;
  let timezone: string | null = null;
  let horizonEnd: string | null = null;
  /** Availability per visible month. Navigation is free after the first look. */
  const months = new Map<string, MonthEntry>();
  /** ref → bkt_. The token never leaves this map; the DOM only ever sees a ref. */
  const tokensByRef = new Map<string, string>();
  let refSeq = 0;
  /** Guards a slow fan-out from painting over a newer one. */
  let generation = 0;
  /** Last server-resolved visit list, so the chip counts truth, not the ring. */
  let resolvedVisits: BookingVisitView[] | null = null;

  const today = new Date();
  let state: BookingViewState = {
    step: 'fecha',
    monthAnchor: new Date(today.getFullYear(), today.getMonth(), 1),
    dayCounts: {},
    daySlots: [],
    selectedDay: null,
    selectedSlot: null,
    form: emptyForm(),
    loading: false,
    submitting: false,
    error: null,
    horizonEnd: null,
    nextMonthHasSlots: false,
    nextMonthBlocked: false,
    booked: null,
    visits: [],
    target: null,
    vehicleLabel: null,
    turnstileRequired: turnstile !== null,
  };

  function render(): void {
    if (destroyed) return;
    const vehicle = deps.getVehicle();
    // Render vehicle context ONLY when the host page gave us both halves. There
    // is no public route that turns an opaque vehicle id into a title, so an
    // id-without-label would be a card with nothing in it.
    state.vehicleLabel = vehicle.id && vehicle.label ? vehicle.label : null;
    state.horizonEnd = horizonEnd;
    deps.onRender(state);
  }

  function refreshChip(): void {
    if (destroyed) return;
    const ring = store.list();
    const upcoming = resolvedVisits
      ? resolvedVisits.filter((v) => v.upcoming).length
      : ring.filter((r) => {
          const at = Date.parse(r.startsAt);
          return Number.isFinite(at) && at > Date.now();
        }).length;
    deps.onChip({ hasBookings: ring.length > 0, upcoming });
  }

  /** Next month is blocked when the agenda provably does not reach into it. */
  function computeNextBlocked(anchor: Date): boolean {
    if (!horizonEnd) return false;
    const end = Date.parse(horizonEnd);
    if (!Number.isFinite(end)) return false;
    const nextStart = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).getTime();
    return nextStart > end;
  }

  function applyMonth(anchor: Date, entry: MonthEntry): void {
    state.monthAnchor = anchor;
    state.dayCounts = entry.counts;
    state.nextMonthBlocked = computeNextBlocked(anchor);
    // Only ever true for a month we have ALREADY fetched. The widget never
    // prefetches ahead to answer this — one extra call per month change is the
    // budget, and it shares a per-IP rate-limit bucket with chat.
    const nextKey = monthKeyOf(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
    const next = months.get(nextKey);
    state.nextMonthHasSlots = !!next && Object.keys(next.counts).length > 0;
  }

  function indexSlots(slots: AvailabilitySlot[]): MonthEntry {
    const counts: Record<string, number> = {};
    for (const slot of slots) {
      // `available` ABSENT means the server answered available-only, so every
      // slot it sent is bookable. Present-and-false is a real taken hour.
      if (slot.available === false) continue;
      const day = slotDay(slot, timezone);
      if (!day) continue;
      counts[day] = (counts[day] ?? 0) + 1;
    }
    return { slots, counts };
  }

  async function loadMonth(anchor: Date, force = false): Promise<void> {
    const key = monthKeyOf(anchor);
    const cached = months.get(key);
    if (cached && !force) {
      applyMonth(anchor, cached);
      state.loading = false;
      render();
      return;
    }
    const gen = ++generation;
    state.monthAnchor = anchor;
    state.loading = true;
    state.error = state.error === 'loadFailed' ? null : state.error;
    render();

    const { from, to } = monthRange(anchor, timezone);
    const vehicle = deps.getVehicle();
    const res = await transport.fetchAvailability({
      from,
      to,
      vehicleId: vehicle.id,
      includeTaken: true,
    });
    if (destroyed || gen !== generation) return;
    state.loading = false;
    if (!res.ok) {
      state.error = 'loadFailed';
      render();
      return;
    }
    timezone = res.data.timezone ?? timezone;
    if (res.data.horizonEnd) horizonEnd = res.data.horizonEnd;
    const entry = indexSlots(res.data.slots);
    months.set(key, entry);
    applyMonth(anchor, entry);
    // A reload while the visitor is looking at an hour grid must refresh THAT
    // grid too, or a retry repaints the same stale hours it just re-read.
    if (state.selectedDay) state.daySlots = slotsForDay(state.selectedDay);
    state.error = null;
    render();
  }

  function slotsForDay(day: string): BookingSlotView[] {
    const entry = months.get(monthKeyOf(state.monthAnchor));
    if (!entry) return [];
    return entry.slots
      .filter((s) => slotDay(s, timezone) === day)
      .map((s) => ({
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        time: slotTime(s, timezone),
        available: s.available !== false,
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  /** Long, human "miércoles, 12 de agosto · 10:30" in the dealer's clock. */
  function whenLabel(iso: string, fallbackTime?: string): string {
    const clock = wallClock(iso, timezone);
    const day = clock.day ? formatDayLong(clock.day, deps.getLocale()) : '';
    const time = clock.time || fallbackTime || '';
    return [day, time].filter(Boolean).join(' · ');
  }

  function toVisit(
    ref: string,
    displayId: string,
    startsAt: string,
    status: string,
  ): BookingVisitView {
    const at = Date.parse(startsAt);
    const cancelled = status === 'cancelled' || status === 'canceled';
    return {
      ref,
      displayId,
      startsAt,
      when: whenLabel(startsAt),
      status,
      upcoming: !cancelled && Number.isFinite(at) && at > Date.now(),
    };
  }

  async function loadVisits(): Promise<void> {
    const gen = ++generation;
    state.step = 'mis';
    state.loading = true;
    state.error = null;
    render();

    const records = store.list();
    tokensByRef.clear();
    const visits: BookingVisitView[] = [];
    for (const record of records) {
      const res = await transport.fetchBooking(record.token);
      if (destroyed || gen !== generation) return;
      if (!res.ok && res.status === 404) {
        // A token the server will not resolve is not a booking, it is litter:
        // cancelled-and-purged, a rotated key, another tenant. Drop it.
        store.remove(record.token);
        continue;
      }
      refSeq += 1;
      const ref = `v${refSeq}`;
      tokensByRef.set(ref, record.token);
      if (res.ok) {
        visits.push(toVisit(ref, res.data.displayId, res.data.startsAt, res.data.status));
      } else {
        // A transient failure must not make a real booking disappear: fall back
        // to what the ring itself remembers.
        visits.push(toVisit(ref, record.displayId, record.startsAt, 'scheduled'));
      }
    }
    if (destroyed || gen !== generation) return;
    visits.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    resolvedVisits = visits;
    state.visits = visits;
    state.loading = false;
    render();
    refreshChip();
  }

  async function confirm(): Promise<void> {
    const slot = state.selectedSlot;
    if (!slot || state.submitting) return;
    const gen = ++generation;
    state.submitting = true;
    state.error = null;
    render();

    const vehicle = deps.getVehicle();
    // The gate resolves instantly when the visitor already passed the
    // challenge on the resumen pane; otherwise it waits for them to. Null
    // (no script, no mount, timeout) sends nothing — the server's verdict
    // stays the single source of truth.
    const turnstileToken = turnstile ? await turnstile.token() : null;
    if (destroyed || gen !== generation) return;
    const res = await transport.bookAppointment({
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      name: state.form.name.trim(),
      phone: state.form.phone.trim() || undefined,
      email: state.form.email.trim() || undefined,
      vehicleId: vehicle.id,
      turnstileToken: turnstileToken ?? undefined,
    });
    if (destroyed || gen !== generation) return;
    state.submitting = false;

    if (res.ok) {
      const appt = res.data.appointment;
      store.add({
        token: res.data.managementToken,
        displayId: appt.displayId,
        startsAt: appt.startsAt,
      });
      resolvedVisits = null;
      state.booked = { displayId: appt.displayId, when: whenLabel(appt.startsAt, slot.time) };
      state.step = 'ok';
      state.error = null;
      render();
      refreshChip();
      return;
    }

    // A refusal is branched on the machine-readable reason, NEVER on the
    // server's English sentence. The form is preserved in every branch: losing
    // what someone just typed because a stranger booked first is not an error
    // message, it is a second failure.
    if (res.reason === 'slot_taken' || res.reason === 'vehicle_taken') {
      state.error = res.reason === 'slot_taken' ? 'errSlotTaken' : 'errVehicleTaken';
      state.selectedSlot = null;
      state.step = 'hora';
      render();
      // Refetch: the grid the visitor is bouncing back to must show the hour
      // that was just taken as taken.
      const anchor = state.monthAnchor;
      await loadMonth(anchor, true);
      if (destroyed) return;
      if (state.selectedDay) state.daySlots = slotsForDay(state.selectedDay);
      state.step = 'hora';
      state.error = res.reason === 'slot_taken' ? 'errSlotTaken' : 'errVehicleTaken';
      render();
      return;
    }
    // A Turnstile refusal renders its own line, and the render itself
    // re-paints the resumen pane — which remounts a FRESH challenge (tokens
    // are single-use, so a retry with the rejected one could only fail).
    if (
      res.reason === 'missing_token' ||
      res.reason === 'invalid_token' ||
      res.reason === 'timeout_or_duplicate' ||
      res.reason === 'outage'
    ) {
      state.error = 'errVerification';
      render();
      return;
    }
    state.error = res.reason === 'not_configured' ? 'errNotConfigured' : 'errBookingGeneric';
    render();
  }

  async function confirmCancel(): Promise<void> {
    const target = state.target;
    if (!target || state.submitting) return;
    const token = tokensByRef.get(target.ref);
    if (!token) return;
    const gen = ++generation;
    state.submitting = true;
    state.error = null;
    render();

    const res = await transport.cancelBooking(token);
    if (destroyed || gen !== generation) return;
    state.submitting = false;
    if (!res.ok) {
      if (res.status === 404) {
        // Already gone server-side. The visitor's intent is satisfied; drop the
        // dead key and show them the cancelled screen rather than an error.
        store.remove(token);
        tokensByRef.delete(target.ref);
        state.target = { ...target, status: 'cancelled', upcoming: false };
        state.step = 'cancelado';
        resolvedVisits = null;
        render();
        refreshChip();
        return;
      }
      state.error = 'errBookingGeneric';
      render();
      return;
    }
    const updated = toVisit(target.ref, res.data.displayId, res.data.startsAt, res.data.status);
    state.target = updated;
    // The cancelled booking STAYS on the ring: it is the visitor's receipt, and
    // the server still resolves it, so "historial" survives a reload.
    state.visits = state.visits.map((v) => (v.ref === updated.ref ? updated : v));
    resolvedVisits = state.visits;
    state.step = 'cancelado';
    render();
    refreshChip();
  }

  const callbacks: BookingCallbacks = {
    onClose: () => deps.onClose(),
    onBack: () => {
      if (state.step === 'hora') state.step = 'fecha';
      else if (state.step === 'datos') state.step = 'hora';
      else if (state.step === 'resumen') state.step = 'datos';
      else if (state.step === 'cancelar') state.step = 'mis';
      state.error = null;
      render();
    },
    onPrevMonth: () => {
      const anchor = new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() - 1, 1);
      void loadMonth(anchor);
    },
    onNextMonth: () => {
      if (state.nextMonthBlocked) return;
      const anchor = new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() + 1, 1);
      void loadMonth(anchor);
    },
    onPickDay: (day: string) => {
      state.selectedDay = day;
      state.daySlots = slotsForDay(day);
      state.selectedSlot = null;
      state.step = 'hora';
      state.error = null;
      render();
    },
    onPickSlot: (startsAt: string) => {
      const slot = state.daySlots.find((s) => s.startsAt === startsAt);
      if (!slot || !slot.available) return;
      state.selectedSlot = slot;
      state.step = 'datos';
      state.error = null;
      render();
    },
    onFormChange: (patch) => {
      state.form = { ...state.form, ...patch };
      render();
    },
    onSubmitForm: () => {
      if (
        state.form.name.trim() === '' ||
        state.form.phone.trim() === '' ||
        !state.form.consent
      ) {
        return;
      }
      state.step = 'resumen';
      state.error = null;
      render();
    },
    onConfirm: () => {
      void confirm();
    },
    onTurnstileSlot: (el: HTMLElement) => {
      turnstile?.mountFresh(el);
    },
    onDone: () => deps.onClose(),
    onAskCancel: (ref: string) => {
      const visit = state.visits.find((v) => v.ref === ref);
      if (!visit) return;
      state.target = visit;
      state.step = 'cancelar';
      state.error = null;
      render();
    },
    onKeepVisit: () => {
      state.step = 'mis';
      state.target = null;
      state.error = null;
      render();
    },
    onConfirmCancel: () => {
      void confirmCancel();
    },
    onBookAgain: () => {
      state.step = 'fecha';
      state.target = null;
      state.selectedDay = null;
      state.selectedSlot = null;
      state.booked = null;
      state.error = null;
      void loadMonth(state.monthAnchor, true);
    },
    onChatFallback: (draftKey) => deps.onChatFallback(draftKey),
    onRetry: () => {
      void loadMonth(state.monthAnchor, true);
    },
  };

  return {
    callbacks,
    setTurnstile(gate: TurnstileGate | null): void {
      if (destroyed || gate === turnstile) return;
      turnstile = gate;
      state.turnstileRequired = gate !== null;
      // The resumen pane owns the challenge slot: repaint it so the slot
      // appears (or disappears) and `onTurnstileSlot` mounts the fresh widget.
      if (state.step === 'resumen') render();
    },
    openBooking(): void {
      // Reset the FLOW, keep the FORM. A visitor who stepped out and came back
      // should not retype their own name.
      state.step = 'fecha';
      state.selectedDay = null;
      state.selectedSlot = null;
      state.daySlots = [];
      state.booked = null;
      state.target = null;
      state.error = null;
      const now = new Date();
      const anchor =
        state.monthAnchor.getTime() > 0 ? state.monthAnchor : new Date(now.getFullYear(), now.getMonth(), 1);
      void loadMonth(anchor);
    },
    openVisits(): void {
      void loadVisits();
    },
    refreshChip,
    destroy(): void {
      destroyed = true;
      months.clear();
      tokensByRef.clear();
      state = { ...state, visits: [], target: null, booked: null, form: emptyForm() };
    },
  };
}
