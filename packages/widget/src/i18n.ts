// Widget-chrome i18n. A flat es/en dictionary covering ONLY the widget's own
// copy (launcher label, panel title, composer, status banners) — NEVER message
// content, which is server data rendered verbatim. `es` is the default and the
// fallback (Chilean market), mirroring the app's custom t() convention: no
// external i18n lib, zero deps (MEMORY: es/en parity).

import type { WidgetLocale } from './types';

/** The set of chrome strings the UI needs. Keep in sync across locales. */
export interface WidgetStrings {
  launcherLabel: string;
  title: string;
  placeholder: string;
  send: string;
  close: string;
  welcome: string;
  offline: string;
  /** The realtime stream dropped and a backoff is running. */
  reconnecting: string;
  error: string;
  sending: string;
  poweredBy: string;
  /** Inline label on a message whose send failed. */
  notSent: string;
  /** Button that re-sends a failed message with its original client id. */
  retry: string;
  /** Suffix in the launcher's aria-label when replies are waiting. */
  unread: string;
  /** Screen-reader label for the typing indicator. Names nobody. */
  typing: string;
  /** Centered system line when a person takes over. Names nobody. */
  advisorJoined: string;
  /** Link on a vehicle card, when the listing has a URL. */
  viewVehicle: string;

  // --- Booking (S15-21) -----------------------------------------------------
  // Tone: es-CL, "tú", never "usted". Copy states facts the visitor can act on;
  // no screen is ever empty and mute.

  /**
   * Chip over the composer that opens the booking overlay — the DEFAULT copy.
   * A tenant who sets `bookingLabel` replaces it verbatim, in which case this
   * string is never painted (see ui.ts). Every OTHER string in this block has to
   * still read correctly next to "Agendar demo" or "Reservar hora", which is why
   * the flow says "reserva"/"hora" and not "visita" anywhere below.
   */
  bookVisit: string;
  /** Second chip, present only when this browser holds a booking. */
  myVisits: string;
  /** Back arrow's accessible name inside the overlay. */
  back: string;
  /** Step counter — rendered as "<stepLabel> 2 <stepOf> 4". */
  stepLabel: string;
  stepOf: string;
  stepDateTitle: string;
  stepTimeTitle: string;
  stepFormTitle: string;
  stepSummaryTitle: string;
  stepDoneTitle: string;
  cancelTitle: string;
  cancelledTitle: string;
  /** Month navigation, accessible names only. */
  prevMonth: string;
  nextMonth: string;
  /** Counter under the grid: "4 <daysWithSlots>" / "1 <dayWithSlots>". */
  daysWithSlots: string;
  dayWithSlots: string;
  /** Empty month, rendered as "<monthEmpty> agosto". */
  monthEmpty: string;
  /** Shown only when the NEXT month is already known to have hours. */
  nextMonthHint: string;
  /** Horizon line, rendered as "<horizonNote> 15 de agosto." */
  horizonNote: string;
  loading: string;
  loadFailed: string;
  /** Low-tone escape hatch on an empty month → drops into the chat. */
  writeUsCta: string;
  writeUsDraft: string;
  /** Low-tone escape hatch on "Mis reservas" → drops into the chat. */
  otherDeviceQ: string;
  otherDeviceDraft: string;
  noTimesForDay: string;
  /** Accessible name on a slot that is already taken (rendered dimmed). */
  slotTaken: string;
  fieldName: string;
  fieldNamePlaceholder: string;
  fieldPhone: string;
  fieldPhonePlaceholder: string;
  fieldEmail: string;
  fieldEmailPlaceholder: string;
  consentLabel: string;
  privacyNote: string;
  continueCta: string;
  summaryYourDetails: string;
  summaryVehicle: string;
  /** The trust line: this is the team's real calendar, not a lead form. */
  trustLine: string;
  confirmCta: string;
  confirming: string;
  /** Label above the A-<n> reference on the confirmation. */
  bookingCodeLabel: string;
  saveCodeNote: string;
  doneCta: string;
  upcoming: string;
  history: string;
  noVisits: string;
  cancelVisitCta: string;
  statusScheduled: string;
  statusCancelled: string;
  statusCompleted: string;
  cancelWarning: string;
  keepVisitCta: string;
  confirmCancelCta: string;
  cancelling: string;
  cancelledNote: string;
  bookAgainCta: string;
  /** Refusal copy, one line per machine-readable reason. */
  errSlotTaken: string;
  errVehicleTaken: string;
  errNotConfigured: string;
  errBookingGeneric: string;
}

export type StringKey = keyof WidgetStrings;

/**
 * Exported for the parity test, which asserts es and en carry the SAME key set
 * with no empty value. A booking screen half-translated into the visitor's
 * language is worse than one honestly in Spanish.
 */
export const STRINGS: Record<WidgetLocale, WidgetStrings> = {
  es: {
    launcherLabel: 'Abrir chat',
    title: 'Conversemos',
    placeholder: 'Escribe tu mensaje…',
    send: 'Enviar',
    close: 'Cerrar',
    welcome: 'Hola, ¿en qué te puedo ayudar?',
    offline: 'Sin conexión, reintentando…',
    reconnecting: 'Reconectando…',
    error: 'No se pudo enviar. Reintenta.',
    sending: 'Enviando…',
    poweredBy: 'con tecnología de Vitrina',
    notSent: 'No se envió',
    retry: 'Reintentar',
    unread: 'mensajes sin leer',
    typing: 'Escribiendo una respuesta…',
    advisorJoined: 'Un asesor se unió a la conversación',
    viewVehicle: 'Ver el vehículo',

    bookVisit: 'Agendar visita',
    myVisits: 'Mis reservas',
    back: 'Volver',
    stepLabel: 'Paso',
    stepOf: 'de',
    stepDateTitle: 'Elige el día',
    stepTimeTitle: 'Elige la hora',
    stepFormTitle: 'Tus datos',
    stepSummaryTitle: 'Revisa y confirma',
    stepDoneTitle: 'Reserva confirmada',
    cancelTitle: 'Cancelar reserva',
    cancelledTitle: 'Reserva cancelada',
    prevMonth: 'Mes anterior',
    nextMonth: 'Mes siguiente',
    daysWithSlots: 'días con horas',
    dayWithSlots: 'día con horas',
    monthEmpty: 'No hay horas en',
    nextMonthHint: 'El próximo mes tiene horas disponibles.',
    horizonNote: 'El concesionario abre su agenda hasta el',
    loading: 'Cargando la agenda…',
    loadFailed: 'No pudimos cargar la agenda.',
    writeUsCta: 'Escríbenos y te avisamos apenas se abran horas',
    writeUsDraft: 'Hola, quiero reservar una hora. ¿Me avisan cuando haya disponibilidad?',
    otherDeviceQ: '¿Reservaste en otro dispositivo? Escríbenos por acá y lo vemos contigo',
    otherDeviceDraft: 'Hola, reservé una hora desde otro dispositivo y quiero verla.',
    noTimesForDay: 'No quedan horas ese día.',
    slotTaken: 'Hora tomada',
    fieldName: 'Nombre',
    fieldNamePlaceholder: 'Tu nombre y apellido',
    fieldPhone: 'Teléfono',
    fieldPhonePlaceholder: '+56 9 1234 5678',
    fieldEmail: 'Email (opcional)',
    fieldEmailPlaceholder: 'tu@correo.cl',
    consentLabel: 'Autorizo que me contacten para coordinar esta reserva',
    privacyNote: 'Usamos tus datos solo para coordinar la reserva.',
    continueCta: 'Continuar',
    summaryYourDetails: 'Tus datos',
    summaryVehicle: 'Vehículo',
    trustLine: 'Es la agenda real del equipo.',
    confirmCta: 'Confirmar reserva',
    confirming: 'Confirmando…',
    bookingCodeLabel: 'código de reserva',
    saveCodeNote: 'Guarda el código: te lo pedimos al llegar.',
    doneCta: 'Listo',
    upcoming: 'Próximas',
    history: 'Historial',
    noVisits: 'Todavía no tienes reservas agendadas.',
    cancelVisitCta: 'Cancelar reserva',
    statusScheduled: 'Agendada',
    statusCancelled: 'Cancelada',
    statusCompleted: 'Completada',
    cancelWarning: 'Es permanente. La hora se libera para otra persona.',
    keepVisitCta: 'Mantener la reserva',
    confirmCancelCta: 'Sí, cancelar',
    cancelling: 'Cancelando…',
    cancelledNote: 'Liberamos la hora.',
    bookAgainCta: 'Volver a agendar',
    errSlotTaken: 'Esa hora se acaba de tomar.',
    errVehicleTaken: 'Ese auto ya está reservado a esa hora.',
    errNotConfigured: 'La agenda no está disponible ahora.',
    errBookingGeneric: 'No pudimos agendar. Reintenta.',
  },
  en: {
    launcherLabel: 'Open chat',
    title: "Let's chat",
    placeholder: 'Type your message…',
    send: 'Send',
    close: 'Close',
    welcome: 'Hi, how can I help?',
    offline: 'Offline, reconnecting…',
    reconnecting: 'Reconnecting…',
    error: 'Could not send. Retry.',
    sending: 'Sending…',
    poweredBy: 'powered by Vitrina',
    notSent: 'Not sent',
    retry: 'Retry',
    unread: 'unread messages',
    typing: 'Typing a reply…',
    advisorJoined: 'An advisor joined the conversation',
    viewVehicle: 'View the vehicle',

    bookVisit: 'Book a visit',
    myVisits: 'My bookings',
    back: 'Back',
    stepLabel: 'Step',
    stepOf: 'of',
    stepDateTitle: 'Pick a day',
    stepTimeTitle: 'Pick a time',
    stepFormTitle: 'Your details',
    stepSummaryTitle: 'Review and confirm',
    stepDoneTitle: 'Booking confirmed',
    cancelTitle: 'Cancel booking',
    cancelledTitle: 'Booking cancelled',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    daysWithSlots: 'days with times',
    dayWithSlots: 'day with times',
    monthEmpty: 'No times in',
    nextMonthHint: 'Next month has times available.',
    horizonNote: 'This dealership opens its calendar through',
    loading: 'Loading the calendar…',
    loadFailed: 'We could not load the calendar.',
    writeUsCta: 'Message us and we will tell you as soon as times open up',
    writeUsDraft: 'Hi, I want to book a time. Can you let me know when times open up?',
    otherDeviceQ: 'Booked on another device? Message us here and we will sort it out with you',
    otherDeviceDraft: 'Hi, I booked a time from another device and I want to see it.',
    noTimesForDay: 'No times left that day.',
    slotTaken: 'Taken',
    fieldName: 'Name',
    fieldNamePlaceholder: 'Your full name',
    fieldPhone: 'Phone',
    fieldPhonePlaceholder: '+56 9 1234 5678',
    fieldEmail: 'Email (optional)',
    fieldEmailPlaceholder: 'you@email.com',
    consentLabel: 'I agree to be contacted to arrange this booking',
    privacyNote: 'We use your details only to arrange the booking.',
    continueCta: 'Continue',
    summaryYourDetails: 'Your details',
    summaryVehicle: 'Vehicle',
    trustLine: "This is the team's real calendar.",
    confirmCta: 'Confirm booking',
    confirming: 'Confirming…',
    bookingCodeLabel: 'booking code',
    saveCodeNote: 'Save the code: we will ask for it when you arrive.',
    doneCta: 'Done',
    upcoming: 'Upcoming',
    history: 'History',
    noVisits: 'You have no bookings yet.',
    cancelVisitCta: 'Cancel booking',
    statusScheduled: 'Scheduled',
    statusCancelled: 'Cancelled',
    statusCompleted: 'Completed',
    cancelWarning: 'This is permanent. The time is released for someone else.',
    keepVisitCta: 'Keep the booking',
    confirmCancelCta: 'Yes, cancel',
    cancelling: 'Cancelling…',
    cancelledNote: 'We released the time.',
    bookAgainCta: 'Book again',
    errSlotTaken: 'That time was just taken.',
    errVehicleTaken: 'That car is already booked at that time.',
    errNotConfigured: 'The calendar is not available right now.',
    errBookingGeneric: 'We could not book. Retry.',
  },
};

/** Translator: table lookup with an es fallback, then the key itself. */
export type Translate = (key: StringKey) => string;

/**
 * Build a translator for `locale`. Unknown locales fall back to `es`; a missing
 * key falls back to the `es` value, then the raw key — never returns undefined.
 */
export function makeT(locale: WidgetLocale): Translate {
  const table = STRINGS[locale] ?? STRINGS.es;
  return (key: StringKey): string => table[key] ?? STRINGS.es[key] ?? key;
}
