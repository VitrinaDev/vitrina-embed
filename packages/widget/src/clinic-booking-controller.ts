// The CLINIC booking flow's state machine (vitrina-app#3707): servicio →
// profesional (or "cualquiera") → fecha → hora → datos → resumen → ok.
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
import type { ClinicAttribution, ClinicLanding, ClinicSlot } from './clinic-types';
import type { VitrinaTransport } from './transport';
import type { TurnstileGate } from './turnstile';
import type { WidgetLocale } from './types';

export type ClinicBookingTransport = Pick<
  VitrinaTransport,
  'fetchClinicLanding' | 'fetchClinicAvailability' | 'bookClinic'
>;

export interface ClinicBookingControllerDeps {
  transport: ClinicBookingTransport;
  /** The landing slug from the snippet, or null for the clinic's main one. */
  landing: string | null;
  getLocale(): WidgetLocale;
  /** The ad click to send with the booking — read at confirm time. */
  getAttribution(): ClinicAttribution | null;
  onRender(state: BookingViewState): void;
  onChatFallback(draftKey: 'writeUsDraft' | 'otherDeviceDraft'): void;
  onClose(): void;
  turnstile: TurnstileGate | null;
}

/** The calls the overlay makes that the clinic flow adds to the dealer's. */
export interface ClinicBookingController extends BookingController {
  readonly callbacks: BookingCallbacks &
    Required<Pick<BookingCallbacks, 'onPickService' | 'onPickProfessional'>>;
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
  return { name: '', phone: '', email: '', consent: false, document: '' };
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

  let serviceId: string | null = null;
  let professional: string | null = null;

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
    const entry = months.get(monthKeyOf(state.monthAnchor));
    if (!entry) return [];
    const seen = new Set<string>();
    const out: BookingSlotView[] = [];
    for (const s of entry.slots) {
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
    if (!serviceId) return;
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

  function resetAgenda(): void {
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
    });
    if (destroyed || gen !== generation) return;
    state.submitting = false;

    if (res.ok) {
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
      bookedExtra = {
        manageUrl: safeUrl(res.data.manageUrl),
        deposit:
          dep.required && dep.amountClp != null
            ? { amount: formatClp(dep.amountClp, loc), dueBy, instructions: dep.instructions }
            : null,
      };
      state.step = 'ok';
      render();
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
      if (state.step === 'profesional') state.step = 'servicio';
      else if (state.step === 'fecha') state.step = showProfessionalStep() ? 'profesional' : 'servicio';
      else if (state.step === 'hora') state.step = 'fecha';
      else if (state.step === 'datos') state.step = 'hora';
      else if (state.step === 'resumen') state.step = 'datos';
      render();
    },
    onPickService: (id: string) => {
      if (!landing?.services.some((s) => s.id === id)) return;
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
    },
    onPickSlot: (startsAt: string) => {
      const slot = state.daySlots.find((s) => s.startsAt === startsAt);
      if (!slot) return;
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
      const f = state.form;
      if (f.name.trim() === '' || f.phone.trim() === '' || !f.consent) return;
      if (landing?.requireDocument && (f.document ?? '').trim() === '') return;
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
    // No "Mis reservas" in the clinic flow: the patient's link to their own
    // cita is the tokenised manage page the confirmation carries.
    onAskCancel: () => {},
    onKeepVisit: () => {},
    onConfirmCancel: () => {},
    onBookAgain: () => {
      api.openBooking();
    },
    onChatFallback: (draftKey) => deps.onChatFallback(draftKey),
    onRetry: () => {
      if (landingFailed || !landing) {
        void loadLanding();
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
    openBooking(): void {
      // Reset the FLOW, keep the FORM: a patient who stepped out should not
      // retype their own name.
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
      months.clear();
      slotIndex.clear();
      state = { ...state, booked: null, form: emptyForm() };
    },
  };
  return api;
}
