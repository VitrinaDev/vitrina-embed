// The booking overlay — a sibling of the transcript inside `.vtr-panel`, laid
// over it and toggled with a `hidden` flip. The conversation is NEVER destroyed
// to make room for a calendar: coming back from booking is not a re-render, it
// is uncovering what was always there.
//
// PRESENTATION ONLY. This module owns no transport state and no flow decisions;
// it paints a BookingViewState and reports intents. booking-controller.ts owns
// the machine. That split is what lets the whole flow be tested through init()
// against a mocked fetch, with no DOM assertions inside the state logic.
//
// XSS SAFETY, same rule as ui.ts: every node is built with createElement /
// createElementNS. There is no innerHTML here, no eval, no remote asset. Server
// strings (a slot label, an A-<n> reference, a customer name) reach the DOM only
// as text nodes.
//
// The `bkt_` management token NEVER enters this file. Visits are addressed by an
// opaque per-session `ref`; the controller keeps the ref→token map. A capability
// in a DOM attribute is a capability in the page's HTML.

import type { StringKey, Translate } from './i18n';
import type { WidgetLocale } from './types';

export type BookingStep =
  | 'fecha'
  | 'hora'
  | 'datos'
  | 'resumen'
  | 'ok'
  | 'mis'
  | 'cancelar'
  | 'cancelado';

/** One slot as the grid needs it: pre-rendered in the DEALER's wall clock. */
export interface BookingSlotView {
  /** ISO with offset — the value posted back, and the slot's identity. */
  startsAt: string;
  endsAt: string;
  /** "10:30" in the dealership's timezone. */
  time: string;
  /** false renders it dimmed + disabled. Never removed: the agenda must look
   *  real, not invented. */
  available: boolean;
}

export interface BookingFormValues {
  name: string;
  phone: string;
  email: string;
  consent: boolean;
}

/** One entry of "Mis visitas", resolved from the server. */
export interface BookingVisitView {
  /** Opaque session id. NOT the management token. */
  ref: string;
  displayId: string;
  startsAt: string;
  /** Long, human day+time in the dealership's clock. */
  when: string;
  status: string;
  /** true when it is still ahead of now and not cancelled. */
  upcoming: boolean;
}

export interface BookingViewState {
  step: BookingStep;
  /** First day of the month on screen (local Date). */
  monthAnchor: Date;
  /** 'YYYY-MM-DD' → number of AVAILABLE slots that day. */
  dayCounts: Record<string, number>;
  /** Slots for `selectedDay`, available and taken alike. */
  daySlots: BookingSlotView[];
  selectedDay: string | null;
  selectedSlot: BookingSlotView | null;
  form: BookingFormValues;
  loading: boolean;
  submitting: boolean;
  /** i18n key of the one line to show, or null. */
  error: StringKey | null;
  /** ISO end of the bookable horizon, or null when the server did not say. */
  horizonEnd: string | null;
  /** Only ever true when the next month has ALREADY been fetched. */
  nextMonthHasSlots: boolean;
  /** Disable forward navigation — the agenda genuinely stops here. */
  nextMonthBlocked: boolean;
  /** The just-confirmed booking. */
  booked: { displayId: string; when: string } | null;
  visits: BookingVisitView[];
  /** The visit a cancel confirmation is about. */
  target: BookingVisitView | null;
  /** Host-supplied vehicle title; rendered only when present. */
  vehicleLabel: string | null;
}

export interface BookingCallbacks {
  onClose(): void;
  onBack(): void;
  onPrevMonth(): void;
  onNextMonth(): void;
  onPickDay(dayKey: string): void;
  onPickSlot(startsAt: string): void;
  onFormChange(patch: Partial<BookingFormValues>): void;
  /** datos → resumen. */
  onSubmitForm(): void;
  /** resumen → POST. */
  onConfirm(): void;
  /** ok → close the overlay. */
  onDone(): void;
  onAskCancel(ref: string): void;
  onKeepVisit(): void;
  onConfirmCancel(): void;
  onBookAgain(): void;
  /** Drop into the chat with a draft — the cross-device and waitlist escapes. */
  onChatFallback(draftKey: 'writeUsDraft' | 'otherDeviceDraft'): void;
  onRetry(): void;
}

export interface BookingUi {
  readonly root: HTMLElement;
  render(state: BookingViewState): void;
  /** Re-derive every string painted at construction. */
  setLocale(): void;
}

/** Widget locale → the Intl locale whose formatting we actually want. */
const INTL_LOCALE: Record<WidgetLocale, string> = { es: 'es-CL', en: 'en-US' };

/** Which of the four flow steps a screen is, or 0 when it is outside the flow. */
const STEP_NUMBER: Record<BookingStep, number> = {
  fecha: 1,
  hora: 2,
  datos: 3,
  resumen: 4,
  ok: 0,
  mis: 0,
  cancelar: 0,
  cancelado: 0,
};

const STEP_TITLE: Record<BookingStep, StringKey> = {
  fecha: 'stepDateTitle',
  hora: 'stepTimeTitle',
  datos: 'stepFormTitle',
  resumen: 'stepSummaryTitle',
  ok: 'stepDoneTitle',
  mis: 'myVisits',
  cancelar: 'cancelTitle',
  cancelado: 'cancelledTitle',
};

/** Steps whose back arrow leads somewhere. */
const STEP_HAS_BACK: Record<BookingStep, boolean> = {
  fecha: false,
  hora: true,
  datos: true,
  resumen: true,
  ok: false,
  mis: false,
  cancelar: true,
  cancelado: false,
};

const APPT_STATUS_STRING: Record<string, StringKey> = {
  scheduled: 'statusScheduled',
  confirmed: 'statusScheduled',
  cancelled: 'statusCancelled',
  canceled: 'statusCancelled',
  completed: 'statusCompleted',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayKey(y: number, monthIndex: number, day: number): string {
  return `${y}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

/**
 * Seven weekday abbreviations, MONDAY FIRST, in the visitor's chrome language.
 * Derived from Intl rather than hand-listed so `en` is not a Spanish calendar
 * wearing English labels. 2024-01-01 is a Monday; UTC keeps the walk honest.
 */
function weekdayHeaders(locale: WidgetLocale): string[] {
  const out: string[] = [];
  try {
    const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      weekday: 'short',
      timeZone: 'UTC',
    });
    for (let i = 0; i < 7; i += 1) {
      out.push(fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
    }
  } catch {
    return ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  }
  return out;
}

function formatMonth(anchor: Date, locale: WidgetLocale): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      month: 'long',
      year: 'numeric',
    }).format(anchor);
  } catch {
    return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}`;
  }
}

/** Just the month name, for "No hay horas en agosto". */
function formatMonthName(anchor: Date, locale: WidgetLocale): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: 'long' }).format(anchor);
  } catch {
    return String(anchor.getMonth() + 1);
  }
}

/** "miércoles, 12 de agosto" from a 'YYYY-MM-DD' key. */
export function formatDayLong(key: string, locale: WidgetLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date);
  } catch {
    return key;
  }
}

/** "15 de agosto" from an ISO instant — the horizon line's date. */
function formatDateShort(iso: string, locale: WidgetLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      day: 'numeric',
      month: 'long',
    }).format(date);
  } catch {
    return iso;
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A chevron, drawn as a path. Rotated per direction by CSS, not by markup. */
function chevron(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M15 5l-7 7 7 7');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

/** The confirmation check. */
function checkMark(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4 12.5l5.2 5.2L20 7');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

export interface BookingUiOptions {
  /** Read on every paint, so a locale swap needs no re-wiring. */
  getT(): Translate;
  getLocale(): WidgetLocale;
  callbacks: BookingCallbacks;
  /** Register a listener the panel will tear down on destroy(). */
  on(target: EventTarget, type: string, handler: EventListener): void;
}

export function createBookingUi(opts: BookingUiOptions): BookingUi {
  const { callbacks, on } = opts;
  const t = (): Translate => opts.getT();
  const locale = (): WidgetLocale => opts.getLocale();

  const root = el('div', 'vtr-booking');
  root.setAttribute('role', 'dialog');
  root.hidden = true;

  // --- Chrome (persistent) ---
  const head = el('div', 'vtr-bk-head');
  const backBtn = document.createElement('button');
  backBtn.className = 'vtr-bk-back';
  backBtn.type = 'button';
  backBtn.appendChild(chevron());
  const titleEl = el('span', 'vtr-bk-title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'vtr-bk-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  head.append(backBtn, titleEl, closeBtn);

  const stepEl = el('div', 'vtr-bk-step');
  const body = el('div', 'vtr-bk-body');

  // --- Foot (persistent, so a repaint never steals focus from a CTA) ---
  const foot = el('div', 'vtr-bk-foot');
  const errorEl = el('div', 'vtr-bk-error');
  errorEl.setAttribute('role', 'status');
  errorEl.hidden = true;
  const secondaryBtn = document.createElement('button');
  secondaryBtn.className = 'vtr-bk-secondary';
  secondaryBtn.type = 'button';
  secondaryBtn.hidden = true;
  const primaryBtn = document.createElement('button');
  primaryBtn.className = 'vtr-bk-primary';
  primaryBtn.type = 'button';
  primaryBtn.hidden = true;
  foot.append(errorEl, secondaryBtn, primaryBtn);

  root.append(head, stepEl, body, foot);

  // --- The datos form: built ONCE and never rebuilt ---------------------------
  // A repaint fires on every keystroke (the confirm button is gated on the
  // field values), so rebuilding these nodes would blow away focus and the
  // caret on every character typed. The wrapper is re-appended, not recreated,
  // and setBody() no-ops when it is already in place.
  const datosEl = el('div', 'vtr-bk-form');
  const nameLabel = el('label', 'vtr-bk-label');
  const nameText = el('span', 'vtr-bk-label-text');
  const nameInput = document.createElement('input');
  nameInput.className = 'vtr-bk-input';
  nameInput.type = 'text';
  nameInput.autocomplete = 'name';
  nameLabel.append(nameText, nameInput);

  const phoneLabel = el('label', 'vtr-bk-label');
  const phoneText = el('span', 'vtr-bk-label-text');
  const phoneInput = document.createElement('input');
  phoneInput.className = 'vtr-bk-input';
  phoneInput.type = 'tel';
  phoneInput.autocomplete = 'tel';
  phoneLabel.append(phoneText, phoneInput);

  const emailLabel = el('label', 'vtr-bk-label');
  const emailText = el('span', 'vtr-bk-label-text');
  const emailInput = document.createElement('input');
  emailInput.className = 'vtr-bk-input';
  emailInput.type = 'email';
  emailInput.autocomplete = 'email';
  emailLabel.append(emailText, emailInput);

  const consentLabel = el('label', 'vtr-bk-consent');
  const consentInput = document.createElement('input');
  consentInput.className = 'vtr-bk-check';
  consentInput.type = 'checkbox';
  const consentText = el('span');
  consentLabel.append(consentInput, consentText);

  const privacyEl = el('div', 'vtr-bk-note');
  datosEl.append(nameLabel, phoneLabel, emailLabel, consentLabel, privacyEl);

  /** Swap the body's single child without disturbing a node already in place. */
  function setBody(node: Node): void {
    if (body.childNodes.length === 1 && body.firstChild === node) return;
    body.replaceChildren(node);
  }

  /** A low-tone line that hands the visitor to a human instead of a dead end. */
  function fallbackLine(key: 'writeUsDraft' | 'otherDeviceDraft', copy: StringKey): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'vtr-bk-fallback';
    btn.type = 'button';
    btn.dataset.bkFallback = key;
    btn.textContent = t()(copy);
    return btn;
  }

  // --- fecha ----------------------------------------------------------------
  function renderFecha(state: BookingViewState): Node {
    const wrap = document.createDocumentFragment();
    const loc = locale();

    const nav = el('div', 'vtr-bk-nav');
    const prev = document.createElement('button');
    prev.className = 'vtr-bk-navbtn';
    prev.type = 'button';
    prev.dataset.bkNav = 'prev';
    prev.setAttribute('aria-label', t()('prevMonth'));
    prev.appendChild(chevron());
    const monthEl = el('span', 'vtr-bk-month', formatMonth(state.monthAnchor, loc));
    const next = document.createElement('button');
    next.className = 'vtr-bk-navbtn vtr-bk-navnext';
    next.type = 'button';
    next.dataset.bkNav = 'next';
    next.setAttribute('aria-label', t()('nextMonth'));
    next.appendChild(chevron());
    next.disabled = state.nextMonthBlocked;
    nav.append(prev, monthEl, next);
    wrap.appendChild(nav);

    const heads = el('div', 'vtr-bk-week');
    for (const label of weekdayHeaders(loc)) {
      heads.appendChild(el('span', 'vtr-bk-wd', label));
    }
    wrap.appendChild(heads);

    const grid = el('div', 'vtr-bk-grid');
    const y = state.monthAnchor.getFullYear();
    const m = state.monthAnchor.getMonth();
    // Monday-first: JS weeks start on Sunday, Chilean calendars do not.
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    for (let i = 0; i < lead; i += 1) grid.appendChild(el('span', 'vtr-bk-pad'));
    const days = new Date(y, m + 1, 0).getDate();
    let withSlots = 0;
    for (let d = 1; d <= days; d += 1) {
      const key = dayKey(y, m, d);
      const count = state.dayCounts[key] ?? 0;
      if (count > 0) withSlots += 1;
      const btn = document.createElement('button');
      btn.className = 'vtr-bk-day';
      btn.type = 'button';
      btn.dataset.bkDay = key;
      btn.disabled = count === 0 || state.loading;
      if (state.selectedDay === key) btn.setAttribute('aria-current', 'date');
      btn.appendChild(el('span', 'vtr-bk-daynum', String(d)));
      // The ember dot is the whole trust device on a thin agenda: it makes
      // "four free days in August" legible instead of looking like an outage.
      if (count > 0) btn.appendChild(el('span', 'vtr-bk-dot'));
      grid.appendChild(btn);
    }
    wrap.appendChild(grid);

    if (state.loading) {
      wrap.appendChild(el('div', 'vtr-bk-note', t()('loading')));
    } else if (withSlots > 0) {
      const word = withSlots === 1 ? t()('dayWithSlots') : t()('daysWithSlots');
      wrap.appendChild(el('div', 'vtr-bk-count', `${withSlots} ${word}`));
    } else {
      // Never a month that is empty AND mute: say what happened, then offer the
      // next thing the visitor can actually do.
      const empty = el('div', 'vtr-bk-empty');
      empty.appendChild(
        el('div', 'vtr-bk-empty-title', `${t()('monthEmpty')} ${formatMonthName(state.monthAnchor, loc)}`),
      );
      if (state.nextMonthHasSlots) {
        empty.appendChild(el('div', 'vtr-bk-note', t()('nextMonthHint')));
      }
      empty.appendChild(fallbackLine('writeUsDraft', 'writeUsCta'));
      wrap.appendChild(empty);
    }

    if (state.nextMonthBlocked && state.horizonEnd) {
      wrap.appendChild(
        el(
          'div',
          'vtr-bk-note',
          `${t()('horizonNote')} ${formatDateShort(state.horizonEnd, loc)}.`,
        ),
      );
    }
    return wrap;
  }

  // --- hora -----------------------------------------------------------------
  function renderHora(state: BookingViewState): Node {
    const wrap = document.createDocumentFragment();
    if (state.selectedDay) {
      wrap.appendChild(
        el('div', 'vtr-bk-daylabel', formatDayLong(state.selectedDay, locale())),
      );
    }
    if (state.loading) {
      wrap.appendChild(el('div', 'vtr-bk-note', t()('loading')));
      return wrap;
    }
    if (state.daySlots.length === 0) {
      wrap.appendChild(el('div', 'vtr-bk-note', t()('noTimesForDay')));
      return wrap;
    }
    const grid = el('div', 'vtr-bk-slots');
    for (const slot of state.daySlots) {
      const btn = document.createElement('button');
      btn.className = 'vtr-bk-slot';
      btn.type = 'button';
      btn.dataset.bkSlot = slot.startsAt;
      btn.textContent = slot.time;
      // A taken hour is DIMMED, never removed. Removing it would make the
      // dealership's day look emptier than it is, and a visitor who sees only
      // three hours all week reads that as "they never open".
      if (!slot.available) {
        btn.disabled = true;
        btn.setAttribute('data-taken', '1');
        btn.setAttribute('aria-label', `${slot.time} — ${t()('slotTaken')}`);
      }
      if (state.selectedSlot?.startsAt === slot.startsAt) {
        btn.setAttribute('aria-current', 'true');
      }
      grid.appendChild(btn);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  // --- datos ----------------------------------------------------------------
  function syncForm(state: BookingViewState): void {
    nameText.textContent = t()('fieldName');
    nameInput.placeholder = t()('fieldNamePlaceholder');
    phoneText.textContent = t()('fieldPhone');
    phoneInput.placeholder = t()('fieldPhonePlaceholder');
    emailText.textContent = t()('fieldEmail');
    emailInput.placeholder = t()('fieldEmailPlaceholder');
    consentText.textContent = t()('consentLabel');
    privacyEl.textContent = t()('privacyNote');
    // Assign only on a real difference: writing an identical value still resets
    // the caret in some engines, and this runs on every keystroke.
    if (nameInput.value !== state.form.name) nameInput.value = state.form.name;
    if (phoneInput.value !== state.form.phone) phoneInput.value = state.form.phone;
    if (emailInput.value !== state.form.email) emailInput.value = state.form.email;
    if (consentInput.checked !== state.form.consent) consentInput.checked = state.form.consent;
  }

  // --- resumen --------------------------------------------------------------
  function renderResumen(state: BookingViewState): Node {
    const wrap = document.createDocumentFragment();
    const card = el('div', 'vtr-bk-card');
    if (state.selectedDay) {
      card.appendChild(el('div', 'vtr-bk-when', formatDayLong(state.selectedDay, locale())));
    }
    if (state.selectedSlot) {
      card.appendChild(el('div', 'vtr-bk-time', state.selectedSlot.time));
    }
    if (state.vehicleLabel) {
      const row = el('div', 'vtr-bk-row');
      row.append(
        el('span', 'vtr-bk-rowkey', t()('summaryVehicle')),
        el('span', 'vtr-bk-rowval', state.vehicleLabel),
      );
      card.appendChild(row);
    }
    const who = el('div', 'vtr-bk-row');
    who.append(
      el('span', 'vtr-bk-rowkey', t()('summaryYourDetails')),
      el('span', 'vtr-bk-rowval', [state.form.name, state.form.phone].filter(Boolean).join(' · ')),
    );
    card.appendChild(who);
    wrap.appendChild(card);
    wrap.appendChild(el('div', 'vtr-bk-note', t()('trustLine')));
    return wrap;
  }

  // --- ok -------------------------------------------------------------------
  function renderOk(state: BookingViewState): Node {
    const wrap = document.createDocumentFragment();
    const mark = el('div', 'vtr-bk-done');
    mark.appendChild(checkMark());
    wrap.appendChild(mark);
    if (state.booked) {
      wrap.appendChild(el('div', 'vtr-bk-when', state.booked.when));
      wrap.appendChild(el('div', 'vtr-bk-codelabel', t()('bookingCodeLabel')));
      // The dealer's OWN reference. Inventing a second id would give one visit
      // two names and guarantee a support call.
      wrap.appendChild(el('div', 'vtr-bk-code', state.booked.displayId));
    }
    wrap.appendChild(el('div', 'vtr-bk-note', t()('saveCodeNote')));
    return wrap;
  }

  // --- mis ------------------------------------------------------------------
  function visitRow(visit: BookingVisitView, withCancel: boolean): HTMLElement {
    const row = el('div', 'vtr-bk-visit');
    row.dataset.status = visit.status;
    const when = el('div', 'vtr-bk-visit-when', visit.when);
    if (!visit.upcoming && APPT_STATUS_STRING[visit.status] === 'statusCancelled') {
      // The freed hour stays visible and struck through: the visitor should see
      // that the slot they gave up is gone, not that the row vanished.
      when.setAttribute('data-struck', '1');
    }
    row.appendChild(when);
    const meta = el('div', 'vtr-bk-visit-meta');
    meta.append(
      el('span', 'vtr-bk-code-inline', visit.displayId),
      el('span', 'vtr-bk-visit-status', t()(APPT_STATUS_STRING[visit.status] ?? 'statusScheduled')),
    );
    row.appendChild(meta);
    if (withCancel) {
      const btn = document.createElement('button');
      btn.className = 'vtr-bk-linkbtn';
      btn.type = 'button';
      // An opaque session ref — never the bkt_ token.
      btn.dataset.bkCancel = visit.ref;
      btn.textContent = t()('cancelVisitCta');
      row.appendChild(btn);
    }
    return row;
  }

  function renderMis(state: BookingViewState): Node {
    const wrap = document.createDocumentFragment();
    if (state.loading) {
      wrap.appendChild(el('div', 'vtr-bk-note', t()('loading')));
      return wrap;
    }
    const upcoming = state.visits.filter((v) => v.upcoming);
    const past = state.visits.filter((v) => !v.upcoming);
    if (upcoming.length === 0 && past.length === 0) {
      wrap.appendChild(el('div', 'vtr-bk-note', t()('noVisits')));
    }
    if (upcoming.length > 0) {
      wrap.appendChild(el('div', 'vtr-bk-section', t()('upcoming')));
      for (const v of upcoming) wrap.appendChild(visitRow(v, true));
    }
    if (past.length > 0) {
      wrap.appendChild(el('div', 'vtr-bk-section', t()('history')));
      for (const v of past) wrap.appendChild(visitRow(v, false));
    }
    // The cross-device case, without an OTP: a token in THIS browser is the
    // whole identity, so anyone who booked elsewhere gets a human, not a wall.
    wrap.appendChild(fallbackLine('otherDeviceDraft', 'otherDeviceQ'));
    return wrap;
  }

  // --- cancelar / cancelado --------------------------------------------------
  function renderCancelar(state: BookingViewState): Node {
    const wrap = document.createDocumentFragment();
    if (state.target) {
      wrap.appendChild(el('div', 'vtr-bk-when', state.target.when));
      wrap.appendChild(el('div', 'vtr-bk-code', state.target.displayId));
    }
    wrap.appendChild(el('div', 'vtr-bk-warn', t()('cancelWarning')));
    return wrap;
  }

  function renderCancelado(state: BookingViewState): Node {
    const wrap = document.createDocumentFragment();
    if (state.target) {
      const when = el('div', 'vtr-bk-when', state.target.when);
      when.setAttribute('data-struck', '1');
      wrap.appendChild(when);
    }
    wrap.appendChild(el('div', 'vtr-bk-note', t()('cancelledNote')));
    return wrap;
  }

  /** Primary/secondary CTA per screen — the only place button copy is decided. */
  function paintFoot(state: BookingViewState): void {
    let primary: StringKey | null = null;
    let secondary: StringKey | null = null;
    let disabled = false;

    switch (state.step) {
      case 'datos':
        primary = 'continueCta';
        // Name + phone + consent. The checkbox is real: it gates the button and
        // it is sent, because a decorative consent tick on a public form
        // collecting a Chilean phone number would be worse than none.
        disabled =
          state.form.name.trim() === '' ||
          state.form.phone.trim() === '' ||
          !state.form.consent;
        break;
      case 'resumen':
        primary = state.submitting ? 'confirming' : 'confirmCta';
        disabled = state.submitting;
        break;
      case 'ok':
        primary = 'doneCta';
        break;
      case 'cancelar':
        // The soft path carries the visual weight; the destructive one is a
        // quiet secondary. Cancelling should never be the easy accident.
        primary = 'keepVisitCta';
        secondary = state.submitting ? 'cancelling' : 'confirmCancelCta';
        disabled = state.submitting;
        break;
      case 'cancelado':
        primary = 'bookAgainCta';
        break;
      default:
        break;
    }

    primaryBtn.hidden = primary === null;
    if (primary) {
      primaryBtn.textContent = t()(primary);
      primaryBtn.disabled = state.step === 'cancelar' ? false : disabled;
    }
    secondaryBtn.hidden = secondary === null;
    if (secondary) {
      secondaryBtn.textContent = t()(secondary);
      secondaryBtn.disabled = state.submitting;
    }

    if (state.error) {
      errorEl.hidden = false;
      errorEl.textContent = t()(state.error);
      // A failed availability read is the one error with a retry affordance;
      // the rest are statements about the booking the visitor just attempted.
      if (state.error === 'loadFailed') {
        errorEl.replaceChildren(document.createTextNode(`${t()('loadFailed')} `));
        const retry = document.createElement('button');
        retry.className = 'vtr-bk-linkbtn';
        retry.type = 'button';
        retry.dataset.bkRetry = '1';
        retry.textContent = t()('retry');
        errorEl.appendChild(retry);
      }
    } else {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }

    // Fecha, hora and mis advance on a tap inside the body — they have no CTA
    // and no error to show, and a bordered empty strip under them reads as a
    // button that failed to render.
    foot.hidden = primaryBtn.hidden && secondaryBtn.hidden && errorEl.hidden;
  }

  let current: BookingViewState | null = null;

  const ui: BookingUi = {
    root,
    render(state: BookingViewState): void {
      current = state;
      titleEl.textContent = t()(STEP_TITLE[state.step]);
      root.setAttribute('aria-label', titleEl.textContent);
      root.dataset.step = state.step;
      backBtn.hidden = !STEP_HAS_BACK[state.step];
      backBtn.setAttribute('aria-label', t()('back'));
      closeBtn.setAttribute('aria-label', t()('close'));

      const n = STEP_NUMBER[state.step];
      stepEl.hidden = n === 0;
      if (n > 0) stepEl.textContent = `${t()('stepLabel')} ${n} ${t()('stepOf')} 4`;

      switch (state.step) {
        case 'fecha':
          setBody(renderFecha(state));
          break;
        case 'hora':
          setBody(renderHora(state));
          break;
        case 'datos':
          setBody(datosEl);
          syncForm(state);
          break;
        case 'resumen':
          setBody(renderResumen(state));
          break;
        case 'ok':
          setBody(renderOk(state));
          break;
        case 'mis':
          setBody(renderMis(state));
          break;
        case 'cancelar':
          setBody(renderCancelar(state));
          break;
        case 'cancelado':
          setBody(renderCancelado(state));
          break;
        default:
          break;
      }
      paintFoot(state);
    },
    setLocale(): void {
      if (current) ui.render(current);
    },
  };

  // --- wiring ---------------------------------------------------------------
  on(backBtn, 'click', () => callbacks.onBack());
  on(closeBtn, 'click', () => callbacks.onClose());

  on(primaryBtn, 'click', () => {
    if (!current) return;
    switch (current.step) {
      case 'datos':
        callbacks.onSubmitForm();
        break;
      case 'resumen':
        callbacks.onConfirm();
        break;
      case 'ok':
        callbacks.onDone();
        break;
      case 'cancelar':
        callbacks.onKeepVisit();
        break;
      case 'cancelado':
        callbacks.onBookAgain();
        break;
      default:
        break;
    }
  });
  on(secondaryBtn, 'click', () => {
    if (current?.step === 'cancelar') callbacks.onConfirmCancel();
  });

  // ONE delegated listener for every rebuilt control (days, slots, cancel
  // links, fallbacks, nav). Binding per-node would grow the tracked-listener
  // array without bound, since the body is rebuilt on each paint.
  const delegate = (e: Event): void => {
    const start = e.target as HTMLElement | null;
    const target = start?.closest?.('[data-bk-day],[data-bk-slot],[data-bk-nav],[data-bk-cancel],[data-bk-fallback],[data-bk-retry]') as
      | HTMLElement
      | null;
    if (!target) return;
    const data = target.dataset;
    if (data.bkDay) return callbacks.onPickDay(data.bkDay);
    if (data.bkSlot) return callbacks.onPickSlot(data.bkSlot);
    if (data.bkNav) return data.bkNav === 'prev' ? callbacks.onPrevMonth() : callbacks.onNextMonth();
    if (data.bkCancel) return callbacks.onAskCancel(data.bkCancel);
    if (data.bkFallback === 'writeUsDraft' || data.bkFallback === 'otherDeviceDraft') {
      return callbacks.onChatFallback(data.bkFallback);
    }
    if (data.bkRetry) return callbacks.onRetry();
  };
  on(body, 'click', delegate);
  on(errorEl, 'click', delegate);

  on(nameInput, 'input', () => callbacks.onFormChange({ name: nameInput.value }));
  on(phoneInput, 'input', () => callbacks.onFormChange({ phone: phoneInput.value }));
  on(emailInput, 'input', () => callbacks.onFormChange({ email: emailInput.value }));
  on(consentInput, 'change', () => callbacks.onFormChange({ consent: consentInput.checked }));

  return ui;
}
