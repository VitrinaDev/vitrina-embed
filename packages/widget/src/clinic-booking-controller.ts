// The CLINIC booking flow's state machine (vitrina-app#3707): servicio →
// profesional (or "cualquiera") → fecha → hora → datos → resumen → ok.
//
// embed#18 finishes it the way the hosted page does:
//   - PAY: a deposit booking shows the clinic's own Mercado Pago link, and the
//     confirmation re-reads the booking until the payment flips it to
//     confirmed (the notification confirms the hold server-side).
//   - RESUME: the details step saves a booking draft (with the unchecked
//     WhatsApp box); the recovery link brings the patient back to this page
//     with `?vt_draft=`, and `resumeDraft` puts them where they stopped.
//   - MANAGE: change and cancel run inline from the confirmation through the
//     booking's own manage token.
//
// A sibling of booking-controller.ts (the dealer's test-drive flow), not a
// branch inside it: the dealer flow's tests pin that module byte for byte, and
// the two flows share the overlay (booking-ui.ts) and the calendar/hour/form
// screens, not their decisions. index.ts constructs exactly one of the two,
// chosen by the tenant's configuration (`clinicBooking` on /widget/config).
//
// The server is the clinic's online-booking landing: services, professionals
// and branding come from `GET /widget/clinic/landing`, hours from the native
// agenda, and the booking goes through the SAME service the hosted booking
// page uses — so the cita, the contact, the deposit hold and the ad click are
// the same whichever front-end took them.
//
// NOTHING HERE THROWS, and every failure has a screen — same rule as the
// dealer controller.

import type { BookingController } from './booking-controller';
import type {
  BookingCallbacks,
  BookingSlotView,
  BookingViewState,
  ClinicFlowView,
} from './booking-ui';
import { formatDayLong } from './booking-ui';
import type {
  ClinicAttribution,
  ClinicAvailableDays,
  ClinicDraftInput,
  ClinicLanding,
  ClinicManagedAppointment,
  ClinicSlot,
} from './clinic-types';
import type { StringKey } from './i18n';
import type { VitrinaTransport } from './transport';
import type { TurnstileGate } from './turnstile';
import type { WidgetLocale } from './types';

export type ClinicBookingTransport = Pick<
  VitrinaTransport,
  | 'fetchClinicLanding'
  | 'fetchClinicAvailability'
  | 'fetchClinicAvailableDays'
  | 'bookClinic'
  | 'saveClinicDraft'
  | 'fetchClinicDraft'
  | 'fetchClinicAppointment'
  | 'fetchClinicAppointmentAvailability'
  | 'actOnClinicAppointment'
>;

export interface ClinicBookingControllerDeps {
  transport: ClinicBookingTransport;
  /** The landing slug from the snippet, or null for the clinic's main one. */
  landing: string | null;
  getLocale(): WidgetLocale;
  /** The ad click to send with the booking — read at confirm time. */
  getAttribution(): ClinicAttribution | null;
  /** The page the widget is on, for the draft's recovery link. */
  getReturnUrl(): string | null;
  onRender(state: BookingViewState): void;
  onChatFallback(draftKey: 'writeUsDraft' | 'otherDeviceDraft'): void;
  onClose(): void;
  turnstile: TurnstileGate | null;
}

/** The calls the overlay makes that the clinic flow adds to the dealer's. */
export interface ClinicBookingController extends BookingController {
  readonly callbacks: BookingCallbacks &
    Required<
      Pick<BookingCallbacks, 'onPickService' | 'onPickProfessional' | 'onManage' | 'onConfirmMove'>
    >;
  /** Reopen the flow at a booking draft (the recovery link's `vt_draft`). */
  resumeDraft(token: string): void;
}

/** How long the details step waits after the last keystroke to save. */
const DRAFT_SAVE_DELAY_MS = 400;
/** How often an unpaid hold is re-read while the confirmation is visible. */
const PAYMENT_POLL_MS = 5_000;
/** And for how long, before the patient has to reopen to see it. */
const PAYMENT_WATCH_MS = 30 * 60_000;

/** A phone worth saving a draft for: at least eight digits (the hosted
 *  page's rule; the server would refuse fewer anyway). */
function phoneWorthSaving(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 8;
}

/** The server's appointment status, as the confirmation speaks of it. */
function bookedStatusOf(status: string): 'pending' | 'confirmed' | 'cancelled' {
  if (status === 'pending_hold' || status === 'pending') return 'pending';
  if (/cancel|expired|no_show/.test(status)) return 'cancelled';
  return 'confirmed';
}

const INTL_LOCALE: Record<WidgetLocale, string> = { es: 'es-CL', en: 'en-US' };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** The clinic's wall clock for an instant: day key + "10:30". */
function wallClock(iso: string, timeZone: string): { day: string; time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: '', time: '' };
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
  } catch {
    return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
}

function formatClp(amount: number, locale: WidgetLocale): string {
  try {
    return new Intl.NumberFormat(INTL_LOCALE[locale], {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

/** Only an http(s) link becomes an anchor's href. */
function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function emptyForm(): BookingViewState['form'] {
  return { name: '', phone: '', email: '', consent: false, document: '', consentWhatsapp: false };
}

interface MonthEntry {
  slots: ClinicSlot[];
  counts: Record<string, number>;
}

export function createClinicBookingController(
  deps: ClinicBookingControllerDeps,
): ClinicBookingController {
  const { transport } = deps;
  let turnstile: TurnstileGate | null = deps.turnstile;
  let destroyed = false;
  let generation = 0;

  let landing: ClinicLanding | null = null;
  let landingFailed = false;
  let timezone = 'America/Santiago';
  /** Hours per visible month, for the chosen service + professional. */
  const months = new Map<string, MonthEntry>();
  /** startsAt → the slot posted back (its ref and its professional). */
  let slotIndex = new Map<string, ClinicSlot>();

  // vitrina-app#3833 — days first, then one day's hours. The calendar's days
  // come from ONE read of the whole booking window; a day's hours are read
  // when the patient opens it. `null` = not read yet for this service +
  // professional. An API that predates the days read (404) falls back to the
  // per-month read below, which a capped list made blind past the fortnight.
  let windowDays: ClinicAvailableDays | null = null;
  let daysSupported = true;
  /** day → its hours, for the chosen service + professional. */
  const dayHours = new Map<string, ClinicSlot[]>();

  let serviceId: string | null = null;
  let professional: string | null = null;

  // embed#18 — the draft, the notice line, manage and the payment watch.
  let draftToken: string | null = null;
  let draftSavedSignature: string | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let notice: StringKey | null = null;
  let mode: 'book' | 'reschedule' = 'book';
  let manageToken: string | null = null;
  let move: { from: string; to: string } | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let watchUntil = 0;
  let refreshing = false;
  let onVisible: (() => void) | null = null;

  const today = new Date();
  let state: BookingViewState = {
    step: 'servicio',
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
    clinic: null,
  };
  let bookedExtra: ClinicFlowView['booked'] = null;

  const t = (): WidgetLocale => deps.getLocale();

  function service() {
    return landing?.services.find((s) => s.id === serviceId) ?? null;
  }

  /** Who performs the chosen service. An empty eligibility list means all. */
  function eligibleProfessionals() {
    if (!landing) return [];
    const sid = serviceId;
    return landing.professionals.filter(
      (p) => !sid || p.serviceIds.length === 0 || p.serviceIds.includes(sid),
    );
  }

  function showProfessionalStep(): boolean {
    const pros = eligibleProfessionals();
    // One professional and no "anyone" option is not a choice — skip it.
    return pros.length > 1 || (pros.length === 1 && landing?.allowAnyProfessional === true);
  }

  function professionalName(): string | null {
    if (professional && professional !== 'any') {
      return landing?.professionals.find((p) => p.id === professional)?.name ?? null;
    }
    // "Anyone": the hour picked decides who.
    const slot = state.selectedSlot ? slotIndex.get(state.selectedSlot.startsAt) : null;
    return slot?.professionalName ?? null;
  }

  function clinicView(): ClinicFlowView {
    const loc = t();
    const svc = service();
    return {
      title: landing?.title ?? null,
      intro: landing?.welcomeText ?? null,
      loaded: landing !== null,
      services: (landing?.services ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        meta: [
          s.durationMinutes ? `${s.durationMinutes} min` : null,
          s.priceClp != null ? formatClp(s.priceClp, loc) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        deposit:
          s.depositRequired && s.depositAmountClp != null
            ? `${depositPrefix(loc)} ${formatClp(s.depositAmountClp, loc)}`
            : null,
      })),
      professionals: eligibleProfessionals().map((p) => ({
        id: p.id,
        name: p.name,
        specialty: p.specialty,
      })),
      allowAny: landing?.allowAnyProfessional === true,
      showProfessionalStep: showProfessionalStep(),
      selectedServiceId: serviceId,
      selectedProfessional: professional,
      requireDocument: landing?.requireDocument === true,
      summary: {
        service: svc?.name ?? null,
        professional: professionalName(),
        price: svc?.priceClp != null ? formatClp(svc.priceClp, loc) : null,
        deposit:
          svc?.depositRequired && svc.depositAmountClp != null
            ? formatClp(svc.depositAmountClp, loc)
            : null,
        location: landing?.location?.name ?? null,
      },
      booked: bookedExtra,
      mode,
      notice,
      move,
    };
  }

  /** i18n lives in the UI; the one phrase the controller pre-formats. */
  function depositPrefix(loc: WidgetLocale): string {
    return loc === 'en' ? 'Deposit' : 'Abono';
  }

  function render(): void {
    if (destroyed) return;
    state.clinic = clinicView();
    deps.onRender(state);
  }

  async function loadLanding(): Promise<void> {
    if (landing) return;
    const gen = ++generation;
    state.loading = true;
    state.error = null;
    render();
    const res = await transport.fetchClinicLanding(deps.landing);
    if (destroyed || gen !== generation) return;
    state.loading = false;
    if (!res.ok) {
      landingFailed = true;
      state.error = 'loadFailed';
      render();
      return;
    }
    landingFailed = false;
    landing = res.data;
    timezone = landing.timezone || timezone;
    state.horizonEnd = new Date(Date.now() + landing.horizonDays * 86_400_000).toISOString();
    render();
  }

  function computeNextBlocked(anchor: Date): boolean {
    if (!state.horizonEnd) return false;
    const end = Date.parse(state.horizonEnd);
    const nextStart = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).getTime();
    return Number.isFinite(end) && nextStart > end;
  }

  function slotsForDay(day: string): BookingSlotView[] {
    const source =
      mode === 'book' && windowDays ? dayHours.get(day) : months.get(monthKeyOf(state.monthAnchor))?.slots;
    if (!source) return [];
    const seen = new Set<string>();
    const out: BookingSlotView[] = [];
    for (const s of source) {
      const clock = wallClock(s.startsAt, timezone);
      if (clock.day !== day || seen.has(s.startsAt)) continue;
      // "Anyone": two professionals free at 10:00 are ONE hour for the
      // patient; the first one's slot is the one posted back.
      seen.add(s.startsAt);
      out.push({ startsAt: s.startsAt, endsAt: s.endsAt, time: clock.time, available: true });
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async function loadMonth(anchor: Date, force = false): Promise<void> {
    if (mode === 'reschedule') {
      // Moving a booking: every free hour came in one read (the manage
      // route's), already split by month — nothing to fetch per month.
      const key = monthKeyOf(anchor);
      state.monthAnchor = anchor;
      state.dayCounts = months.get(key)?.counts ?? {};
      const later = Array.from(months.keys()).some((k) => k > key);
      state.nextMonthBlocked = !later;
      state.nextMonthHasSlots = months.has(monthKeyOf(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)));
      state.loading = false;
      if (state.selectedDay) state.daySlots = slotsForDay(state.selectedDay);
      render();
      return;
    }
    if (!serviceId) return;
    if (daysSupported) {
      await loadWindowMonth(anchor, force);
      if (daysSupported) return;
    }
    const key = monthKeyOf(anchor);
    const cached = months.get(key);
    state.monthAnchor = anchor;
    if (cached && !force) {
      state.dayCounts = cached.counts;
      state.nextMonthBlocked = computeNextBlocked(anchor);
      state.loading = false;
      render();
      return;
    }
    const gen = ++generation;
    state.loading = true;
    if (state.error === 'loadFailed') state.error = null;
    render();
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const res = await transport.fetchClinicAvailability({
      landing: deps.landing,
      serviceId,
      professionalId: professional && professional !== 'any' ? professional : null,
      from: `${y}-${pad2(m + 1)}-01`,
      to: `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`,
    });
    if (destroyed || gen !== generation) return;
    state.loading = false;
    if (!res.ok) {
      state.error = res.reason === undefined && res.status === 409 ? 'errServiceUnavailable' : 'loadFailed';
      render();
      return;
    }
    if (res.data.timezone) timezone = res.data.timezone;
    const counts: Record<string, number> = {};
    const seen = new Set<string>();
    for (const s of res.data.slots) {
      if (!slotIndex.has(s.startsAt)) slotIndex.set(s.startsAt, s);
      if (seen.has(s.startsAt)) continue;
      seen.add(s.startsAt);
      const { day } = wallClock(s.startsAt, timezone);
      if (day) counts[day] = (counts[day] ?? 0) + 1;
    }
    const entry = { slots: res.data.slots, counts };
    months.set(key, entry);
    state.dayCounts = counts;
    state.nextMonthBlocked = computeNextBlocked(anchor);
    const nextKey = monthKeyOf(new Date(y, m + 1, 1));
    state.nextMonthHasSlots = Object.keys(months.get(nextKey)?.counts ?? {}).length > 0;
    if (state.selectedDay) state.daySlots = slotsForDay(state.selectedDay);
    render();
  }

  /** The calendar for `anchor`'s month from the window's days (#3833). */
  async function loadWindowMonth(anchor: Date, force: boolean): Promise<void> {
    state.monthAnchor = anchor;
    if (!windowDays || force) {
      const gen = ++generation;
      state.loading = true;
      if (state.error === 'loadFailed') state.error = null;
      render();
      const res = await transport.fetchClinicAvailableDays({
        landing: deps.landing,
        serviceId: serviceId as string,
        professionalId: professional && professional !== 'any' ? professional : null,
      });
      if (destroyed || gen !== generation) return;
      if (!res.ok && res.status === 404 && res.reason === undefined) {
        // An API without the days read: the old per-month read takes over.
        daysSupported = false;
        state.loading = false;
        return;
      }
      if (!res.ok) {
        state.loading = false;
        state.error = res.status === 409 ? 'errServiceUnavailable' : 'loadFailed';
        render();
        return;
      }
      windowDays = res.data;
      if (res.data.timezone) timezone = res.data.timezone;
      // The window's own end, as the clinic counts it — the horizon note
      // names this day.
      state.horizonEnd = `${res.data.to}T12:00:00.000Z`;
      dayHours.clear();
      if (force && state.selectedDay) {
        // A re-read (slot taken, retry) refreshes the open day too.
        state.loading = false;
        await loadDayHours(state.selectedDay);
        return finishWindowMonth();
      }
    }
    finishWindowMonth();
    if (state.selectedDay && !dayHours.has(state.selectedDay)) {
      await loadDayHours(state.selectedDay);
    }
  }

  function finishWindowMonth(): void {
    if (!windowDays) return;
    const anchor = state.monthAnchor;
    const key = monthKeyOf(anchor);
    const nextKey = monthKeyOf(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
    state.dayCounts = windowDays.counts;
    state.nextMonthBlocked = windowDays.to.slice(0, 7) <= key;
    state.nextMonthHasSlots = Object.keys(windowDays.counts).some((d) => d.startsWith(nextKey));
    state.loading = false;
    if (state.selectedDay) state.daySlots = slotsForDay(state.selectedDay);
    render();
  }

  /** Every hour of one day (#3833). */
  async function loadDayHours(day: string): Promise<void> {
    if (!serviceId) return;
    const gen = ++generation;
    state.loading = true;
    render();
    const res = await transport.fetchClinicAvailability({
      landing: deps.landing,
      serviceId,
      professionalId: professional && professional !== 'any' ? professional : null,
      date: day,
    });
    if (destroyed || gen !== generation) return;
    state.loading = false;
    if (!res.ok) {
      state.error = res.status === 409 ? 'errServiceUnavailable' : 'loadFailed';
      render();
      return;
    }
    if (res.data.timezone) timezone = res.data.timezone;
    for (const s of res.data.slots) {
      if (!slotIndex.has(s.startsAt)) slotIndex.set(s.startsAt, s);
    }
    dayHours.set(day, res.data.slots);
    if (state.selectedDay === day) state.daySlots = slotsForDay(day);
    render();
  }

  function resetAgenda(): void {
    windowDays = null;
    dayHours.clear();
    months.clear();
    slotIndex = new Map();
    state.selectedDay = null;
    state.selectedSlot = null;
    state.daySlots = [];
    state.dayCounts = {};
  }

  function goToCalendar(): void {
    state.step = 'fecha';
    state.error = null;
    const now = new Date();
    void loadMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  // --- the booking draft (vitrina-app#3706) ---------------------------------
  // Once the patient is on the details step with an hour picked and a phone
  // typed, the draft is saved (and re-saved when something changes). A save
  // that fails is ignored ON PURPOSE: it costs one possible recovery message,
  // and it must never stand between the patient and their hour.

  function draftInput(): ClinicDraftInput | null {
    const picked = state.selectedSlot;
    if (!serviceId || !picked || !phoneWorthSaving(state.form.phone)) return null;
    const slot = slotIndex.get(picked.startsAt);
    return {
      landing: deps.landing,
      draftToken,
      serviceId,
      professionalId:
        professional && professional !== 'any' ? professional : (slot?.professionalId ?? null),
      slotRef: slot?.slotRef ?? null,
      startsAt: picked.startsAt,
      endsAt: picked.endsAt,
      name: state.form.name,
      phone: state.form.phone,
      email: state.form.email,
      document: state.form.document ?? '',
      consentWhatsapp: state.form.consentWhatsapp === true,
      attribution: deps.getAttribution(),
      returnUrl: deps.getReturnUrl(),
    };
  }

  function scheduleDraftSave(): void {
    if (state.step !== 'datos' && state.step !== 'resumen') return;
    const input = draftInput();
    if (!input) return;
    const { draftToken: _token, attribution: _click, ...rest } = input;
    const signature = JSON.stringify(rest);
    if (signature === draftSavedSignature) return;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      void transport.saveClinicDraft({ ...input, draftToken }).then((res) => {
        if (destroyed || !res.ok) return;
        draftToken = res.data.draftToken;
        draftSavedSignature = signature;
      });
    }, DRAFT_SAVE_DELAY_MS);
  }

  function forgetDraft(): void {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = null;
    draftToken = null;
    draftSavedSignature = null;
  }

  async function resumeDraft(token: string): Promise<void> {
    stopWatch();
    mode = 'book';
    move = null;
    state.step = 'servicio';
    state.booked = null;
    bookedExtra = null;
    state.error = null;
    notice = null;
    render();
    await loadLanding();
    if (destroyed || !landing) return;
    const res = await transport.fetchClinicDraft(token);
    if (destroyed) return;
    if (!res.ok) {
      notice = 'draftLinkGone';
      render();
      return;
    }
    const d = res.data;
    if (d.status !== 'open') {
      // Already booked (or recovered): the start, with a note — and no token,
      // so a new booking starts a new draft.
      notice = 'draftAlreadyBooked';
      render();
      return;
    }
    draftToken = token;
    draftSavedSignature = null;
    state.form = {
      ...state.form,
      name: d.name,
      phone: d.phone,
      email: d.email,
      document: d.document,
      consentWhatsapp: d.consentWhatsapp,
    };
    // A service or professional this landing no longer offers is dropped,
    // never trusted: the widget asks again.
    const svc =
      landing.services.find((x) => x.id === d.serviceId) ??
      (landing.services.length === 1 ? landing.services[0] : null);
    notice = 'draftResumed';
    if (!svc) {
      render();
      return;
    }
    serviceId = svc.id;
    resetAgenda();
    const pros = eligibleProfessionals();
    const pro = d.professionalId ? pros.find((x) => x.id === d.professionalId) : undefined;
    if (pro) professional = pro.id;
    else if (!showProfessionalStep()) professional = pros.length === 1 ? pros[0].id : 'any';
    else professional = null;

    if (d.startsAt && d.endsAt && d.slotAvailable === true) {
      // The hour is still free: straight back to the details, filled in.
      const clock = wallClock(d.startsAt, timezone);
      slotIndex.set(d.startsAt, {
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        label: '',
        slotRef: d.slotRef,
        professionalId: pro?.id ?? d.professionalId,
        professionalName: pro?.name ?? null,
      });
      state.selectedDay = clock.day;
      state.selectedSlot = { startsAt: d.startsAt, endsAt: d.endsAt, time: clock.time, available: true };
      const [y, m] = clock.day.split('-').map(Number);
      state.step = 'datos';
      render();
      // The month behind it, so "back" shows real hours.
      if (y && m) void loadMonth(new Date(y, m - 1, 1));
      return;
    }
    if (d.startsAt && d.slotAvailable === false && professional) {
      // Taken (or passed): the hours of that day, the details kept.
      const clock = wallClock(d.startsAt, timezone);
      const [y, m] = clock.day.split('-').map(Number);
      notice = 'draftSlotTaken';
      state.selectedDay = clock.day;
      state.selectedSlot = null;
      state.step = 'hora';
      render();
      if (y && m) await loadMonth(new Date(y, m - 1, 1));
      return;
    }
    if (!professional) {
      state.step = 'profesional';
      render();
      return;
    }
    goToCalendar();
  }

  // --- the booking after it is made: payment watch + manage (embed#18) -----

  function applyManaged(view: ClinicManagedAppointment): void {
    if (!bookedExtra) return;
    const before = bookedExtra.status;
    bookedExtra = {
      ...bookedExtra,
      status: bookedStatusOf(view.status),
      canManage: view.canManage,
    };
    if (view.timezone) timezone = view.timezone;
    const clock = wallClock(view.startsAt, timezone);
    if (state.booked) {
      state.booked = {
        ...state.booked,
        when: [clock.day ? formatDayLong(clock.day, t()) : '', clock.time].filter(Boolean).join(' · '),
      };
    }
    if (before === 'pending' && bookedExtra.status === 'confirmed') notice = 'paymentReceived';
  }

  async function refreshBooked(): Promise<void> {
    if (!manageToken || refreshing || destroyed) return;
    if (Date.now() > watchUntil) {
      stopWatch();
      return;
    }
    refreshing = true;
    let res: Awaited<ReturnType<ClinicBookingTransport['fetchClinicAppointment']>>;
    try {
      res = await transport.fetchClinicAppointment(manageToken);
    } catch {
      return;
    } finally {
      refreshing = false;
    }
    if (destroyed || !res.ok || !bookedExtra) return;
    applyManaged(res.data);
    if (bookedExtra.status !== 'pending') stopWatch();
    if (state.step === 'ok') render();
  }

  /** Re-read an unpaid hold until it is paid: every few seconds while the
   *  page is visible, and at once when the patient comes back to the tab
   *  from Mercado Pago. */
  function startWatch(): void {
    stopWatch();
    if (!manageToken || typeof document === 'undefined') return;
    watchUntil = Date.now() + PAYMENT_WATCH_MS;
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void refreshBooked();
    }, PAYMENT_POLL_MS);
    onVisible = () => {
      if (document.visibilityState !== 'hidden') void refreshBooked();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
  }

  function stopWatch(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (onVisible) {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      onVisible = null;
    }
  }

  function leaveReschedule(): void {
    mode = 'book';
    move = null;
    resetAgenda();
  }

  async function startReschedule(): Promise<void> {
    if (!manageToken) return;
    const gen = ++generation;
    mode = 'reschedule';
    notice = null;
    move = null;
    resetAgenda();
    state.step = 'fecha';
    state.error = null;
    state.loading = true;
    state.horizonEnd = null;
    render();
    const res = await transport.fetchClinicAppointmentAvailability(manageToken);
    if (destroyed || gen !== generation || mode !== 'reschedule') return;
    state.loading = false;
    if (!res.ok) {
      state.error = 'loadFailed';
      render();
      return;
    }
    if (res.data.timezone) timezone = res.data.timezone;
    for (const slot of res.data.slots) {
      const { day } = wallClock(slot.startsAt, timezone);
      if (!day) continue;
      const [y, m] = day.split('-').map(Number);
      const key = monthKeyOf(new Date(y, m - 1, 1));
      const entry = months.get(key) ?? { slots: [], counts: {} };
      if (!slotIndex.has(slot.startsAt)) {
        slotIndex.set(slot.startsAt, slot);
        entry.counts[day] = (entry.counts[day] ?? 0) + 1;
      }
      entry.slots.push(slot);
      months.set(key, entry);
    }
    if (res.data.slots.length === 0) notice = 'noOtherTimes';
    const first = Array.from(months.keys()).sort()[0];
    const now = new Date();
    const anchor = first
      ? new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    await loadMonth(anchor);
  }

  async function confirmMove(): Promise<void> {
    const picked = state.selectedSlot;
    if (!manageToken || !picked || state.submitting) return;
    const slot = slotIndex.get(picked.startsAt);
    const gen = ++generation;
    state.submitting = true;
    state.error = null;
    render();
    const res = await transport.actOnClinicAppointment(manageToken, {
      action: 'reschedule',
      startsAt: picked.startsAt,
      endsAt: picked.endsAt,
      slotRef: slot?.slotRef ?? null,
    });
    if (destroyed || gen !== generation) return;
    state.submitting = false;
    if (res.ok) {
      applyManaged(res.data);
      leaveReschedule();
      notice = 'movedNote';
      state.selectedSlot = null;
      state.step = 'ok';
      render();
      return;
    }
    // Taken while the patient read the summary, or refused: back to the
    // hours, re-read.
    state.error = 'errMoveFailed';
    state.selectedSlot = null;
    await startReschedule();
    if (destroyed) return;
    state.error = 'errMoveFailed';
    render();
  }

  async function confirmCancel(): Promise<void> {
    if (!manageToken || state.submitting) return;
    const gen = ++generation;
    state.submitting = true;
    state.error = null;
    render();
    const res = await transport.actOnClinicAppointment(manageToken, { action: 'cancel' });
    if (destroyed || gen !== generation) return;
    state.submitting = false;
    if (res.ok) {
      applyManaged(res.data);
      stopWatch();
      notice = null;
      state.step = 'cancelado';
      render();
      return;
    }
    state.error = 'errCancelFailed';
    render();
  }

  async function confirm(): Promise<void> {
    const picked = state.selectedSlot;
    if (!picked || !serviceId || state.submitting) return;
    const slot = slotIndex.get(picked.startsAt);
    const gen = ++generation;
    state.submitting = true;
    state.error = null;
    render();
    const turnstileToken = turnstile ? await turnstile.token() : null;
    if (destroyed || gen !== generation) return;
    const res = await transport.bookClinic({
      landing: deps.landing,
      serviceId,
      // "Anyone" books the professional whose hour it is.
      professionalId:
        professional && professional !== 'any' ? professional : (slot?.professionalId ?? null),
      slotRef: slot?.slotRef ?? null,
      startsAt: picked.startsAt,
      endsAt: picked.endsAt,
      name: state.form.name.trim(),
      phone: state.form.phone.trim(),
      email: state.form.email.trim() || undefined,
      document: (state.form.document ?? '').trim() || undefined,
      turnstileToken: turnstileToken ?? undefined,
      attribution: deps.getAttribution(),
      draftToken,
    });
    if (destroyed || gen !== generation) return;
    state.submitting = false;

    if (res.ok) {
      // The booking closed the draft server-side.
      forgetDraft();
      notice = null;
      const loc = t();
      const clock = wallClock(res.data.startsAt, timezone);
      state.booked = {
        displayId: res.data.displayId,
        when: [clock.day ? formatDayLong(clock.day, loc) : '', clock.time].filter(Boolean).join(' · '),
      };
      const dep = res.data.deposit;
      let dueBy: string | null = null;
      if (dep.deadline) {
        const due = wallClock(dep.deadline, timezone);
        dueBy = [due.day ? formatDayLong(due.day, loc) : '', due.time].filter(Boolean).join(', ');
      }
      const depositDue = dep.required && dep.amountClp != null;
      manageToken = res.data.manageToken;
      bookedExtra = {
        manageUrl: safeUrl(res.data.manageUrl),
        manageInline: manageToken !== null,
        status: depositDue ? 'pending' : 'confirmed',
        canManage: true,
        deposit:
          depositDue && dep.amountClp != null
            ? {
                amount: formatClp(dep.amountClp, loc),
                dueBy,
                checkoutUrl: dep.checkoutUrl,
                accounts: dep.accounts.map((a) => ({
                  title: [a.bank, a.accountType].filter(Boolean).join(' · '),
                  number: a.accountNumber,
                  holder: [a.holderName, a.holderRut].filter(Boolean).join(' · '),
                })),
              }
            : null,
      };
      state.step = 'ok';
      render();
      if (depositDue) startWatch();
      return;
    }

    // Slot taken while the patient typed: back to the hours, form kept, the
    // grid re-read so the hour that went is gone.
    if (res.reason === 'slot_taken') {
      state.selectedSlot = null;
      state.step = 'hora';
      state.error = 'errSlotTaken';
      render();
      months.delete(monthKeyOf(state.monthAnchor));
      dayHours.clear();
      slotIndex = new Map();
      await loadMonth(state.monthAnchor, true);
      if (destroyed) return;
      state.step = 'hora';
      state.error = 'errSlotTaken';
      render();
      return;
    }
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
    state.error = 'errBookingGeneric';
    render();
  }

  const callbacks: ClinicBookingController['callbacks'] = {
    onClose: () => deps.onClose(),
    onBack: () => {
      state.error = null;
      if (mode === 'reschedule') {
        if (state.step === 'mover') state.step = 'hora';
        else if (state.step === 'hora') state.step = 'fecha';
        else {
          leaveReschedule();
          state.step = 'ok';
        }
        render();
        return;
      }
      if (state.step === 'cancelar') {
        state.step = 'ok';
        render();
        return;
      }
      notice = null;
      if (state.step === 'profesional') state.step = 'servicio';
      else if (state.step === 'fecha') state.step = showProfessionalStep() ? 'profesional' : 'servicio';
      else if (state.step === 'hora') state.step = 'fecha';
      else if (state.step === 'datos') state.step = 'hora';
      else if (state.step === 'resumen') state.step = 'datos';
      render();
    },
    onPickService: (id: string) => {
      if (!landing?.services.some((s) => s.id === id)) return;
      notice = null;
      if (serviceId !== id) {
        serviceId = id;
        professional = null;
        resetAgenda();
      }
      state.error = null;
      if (showProfessionalStep()) {
        state.step = 'profesional';
        render();
        return;
      }
      // Nothing to choose: the one professional, or the landing's anyone.
      const pros = eligibleProfessionals();
      professional = pros.length === 1 ? pros[0].id : 'any';
      goToCalendar();
    },
    onPickProfessional: (choice: string) => {
      const valid =
        (choice === 'any' && landing?.allowAnyProfessional) ||
        eligibleProfessionals().some((p) => p.id === choice);
      if (!valid) return;
      notice = null;
      if (professional !== choice) {
        professional = choice;
        resetAgenda();
      }
      goToCalendar();
    },
    onPrevMonth: () => {
      void loadMonth(new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() - 1, 1));
    },
    onNextMonth: () => {
      if (state.nextMonthBlocked) return;
      void loadMonth(new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() + 1, 1));
    },
    onPickDay: (day: string) => {
      state.selectedDay = day;
      state.daySlots = slotsForDay(day);
      state.selectedSlot = null;
      state.step = 'hora';
      state.error = null;
      render();
      if (mode === 'book' && windowDays && !dayHours.has(day)) void loadDayHours(day);
    },
    onPickSlot: (startsAt: string) => {
      const slot = state.daySlots.find((s) => s.startsAt === startsAt);
      if (!slot) return;
      state.selectedSlot = slot;
      state.error = null;
      if (mode === 'reschedule') {
        const when = [state.selectedDay ? formatDayLong(state.selectedDay, t()) : '', slot.time]
          .filter(Boolean)
          .join(' · ');
        move = { from: state.booked?.when ?? '', to: when };
        state.step = 'mover';
        render();
        return;
      }
      // A new hour answers the "pick another" notice.
      if (notice === 'draftSlotTaken') notice = null;
      state.step = 'datos';
      render();
      scheduleDraftSave();
    },
    onFormChange: (patch) => {
      state.form = { ...state.form, ...patch };
      render();
      scheduleDraftSave();
    },
    onSubmitForm: () => {
      const f = state.form;
      if (f.name.trim() === '' || f.phone.trim() === '' || !f.consent) return;
      if (landing?.requireDocument && (f.document ?? '').trim() === '') return;
      notice = null;
      state.step = 'resumen';
      state.error = null;
      render();
      scheduleDraftSave();
    },
    onConfirm: () => {
      void confirm();
    },
    onTurnstileSlot: (el: HTMLElement) => {
      turnstile?.mountFresh(el);
    },
    onDone: () => deps.onClose(),
    // No "Mis reservas" in the clinic flow: the patient manages the booking
    // from its confirmation, through its own manage token.
    onAskCancel: () => {},
    onManage: (action) => {
      if (!manageToken || !bookedExtra?.canManage) return;
      state.error = null;
      notice = null;
      if (action === 'reschedule') {
        void startReschedule();
        return;
      }
      state.target = {
        ref: 'booked',
        displayId: state.booked?.displayId ?? '',
        startsAt: '',
        when: state.booked?.when ?? '',
        status: 'scheduled',
        upcoming: true,
      };
      state.step = 'cancelar';
      render();
    },
    onConfirmMove: () => {
      void confirmMove();
    },
    onKeepVisit: () => {
      state.error = null;
      state.step = 'ok';
      render();
    },
    onConfirmCancel: () => {
      void confirmCancel();
    },
    onBookAgain: () => {
      api.openBooking();
    },
    onChatFallback: (draftKey) => deps.onChatFallback(draftKey),
    onRetry: () => {
      if (landingFailed || !landing) {
        void loadLanding();
        return;
      }
      if (mode === 'reschedule') {
        void startReschedule();
        return;
      }
      void loadMonth(state.monthAnchor, true);
    },
  };

  const api: ClinicBookingController = {
    callbacks,
    setTurnstile(gate: TurnstileGate | null): void {
      if (destroyed || gate === turnstile) return;
      turnstile = gate;
      state.turnstileRequired = gate !== null;
      if (state.step === 'resumen') render();
    },
    resumeDraft(token: string): void {
      void resumeDraft(token);
    },
    openBooking(): void {
      // Reset the FLOW, keep the FORM: a patient who stepped out should not
      // retype their own name.
      stopWatch();
      if (mode === 'reschedule') leaveReschedule();
      notice = null;
      manageToken = null;
      state.step = 'servicio';
      state.booked = null;
      bookedExtra = null;
      state.error = null;
      state.selectedSlot = null;
      state.selectedDay = null;
      render();
      void loadLanding();
    },
    openVisits(): void {
      api.openBooking();
    },
    refreshChip(): void {
      // The clinic flow keeps no keyring, so there is no "Mis reservas" chip.
    },
    destroy(): void {
      destroyed = true;
      stopWatch();
      if (draftTimer) clearTimeout(draftTimer);
      months.clear();
      dayHours.clear();
      slotIndex.clear();
      state = { ...state, booked: null, form: emptyForm() };
    },
  };
  return api;
}
