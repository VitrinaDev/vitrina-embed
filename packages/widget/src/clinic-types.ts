// Wire shapes of the clinic booking routes (`/widget/clinic/*`,
// vitrina-app#3707), coerced to camelCase by the transport. The server is the
// clinic's online-booking landing: what it offers, how it looks, how it books.

export interface ClinicService {
  id: string;
  name: string;
  durationMinutes: number | null;
  priceClp: number | null;
  depositRequired: boolean;
  depositAmountClp: number | null;
}

export interface ClinicProfessional {
  id: string;
  name: string;
  specialty: string | null;
  /** Services this person performs. Empty ⇒ all of them. */
  serviceIds: string[];
}

export interface ClinicLanding {
  slug: string;
  title: string | null;
  welcomeText: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  timezone: string;
  allowAnyProfessional: boolean;
  requireDocument: boolean;
  horizonDays: number;
  location: { name: string; address: string | null } | null;
  services: ClinicService[];
  professionals: ClinicProfessional[];
}

export interface ClinicSlot {
  startsAt: string;
  endsAt: string;
  /** The engine's own wall-clock label, "2026-10-12 10:00". */
  label: string;
  slotRef: string | null;
  professionalId: string | null;
  professionalName: string | null;
}

/** The ad click the booking carries — what the Vitrina tag and the URL hold. */
export interface ClinicAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
  anonymous_id?: string;
}

export interface ClinicBookInput {
  landing: string | null;
  serviceId: string;
  professionalId: string | null;
  slotRef: string | null;
  startsAt: string;
  endsAt: string;
  name: string;
  phone: string;
  email?: string;
  document?: string;
  turnstileToken?: string;
  attribution: ClinicAttribution | null;
  /** The booking draft this booking finishes (embed#18 / vitrina-app#3706). */
  draftToken?: string | null;
}

/**
 * `POST /widget/clinic/drafts` (vitrina-app#3706): what the patient has on the
 * details step, saved so the clinic can send ONE WhatsApp with a resume link —
 * only when `consentWhatsapp` is ticked. No notes, ever: free text can carry
 * health context and a draft never stores it.
 */
export interface ClinicDraftInput {
  landing: string | null;
  draftToken: string | null;
  serviceId: string | null;
  professionalId: string | null;
  slotRef: string | null;
  startsAt: string | null;
  endsAt: string | null;
  name: string;
  phone: string;
  email: string;
  document: string;
  consentWhatsapp: boolean;
  attribution: ClinicAttribution | null;
  /** The page the widget is on — where the recovery link reopens it. */
  returnUrl: string | null;
}

/** `GET /widget/clinic/drafts/:token` — a draft reopened from its link. */
export interface ClinicDraftResume {
  status: 'open' | 'completed' | 'recovered' | 'expired';
  serviceId: string | null;
  professionalId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  slotRef: string | null;
  /** true: the hour is still free; false: taken or past; null: not known. */
  slotAvailable: boolean | null;
  name: string;
  phone: string;
  email: string;
  document: string;
  consentWhatsapp: boolean;
}

/**
 * `/widget/clinic/appointments/:token` (embed#18): the booking as its manage
 * link sees it. `pending_hold` until the deposit is paid; the Mercado Pago
 * payment flips it to `confirmed` server-side.
 */
export interface ClinicManagedAppointment {
  displayId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  professionalName: string | null;
  timezone: string | null;
  canManage: boolean;
  /** The server's own sentence when it can no longer be managed. */
  reason: string | null;
}

export type ClinicManageAction =
  | { action: 'cancel' }
  | { action: 'reschedule'; startsAt: string; endsAt: string; slotRef: string | null };

export interface ClinicDepositAccount {
  bank: string;
  accountType: string;
  accountNumber: string;
  holderName: string;
  holderRut: string;
}

export interface ClinicBookingResult {
  displayId: string;
  startsAt: string;
  serviceName: string | null;
  professionalName: string | null;
  locationName: string | null;
  /** The tokenised page where the patient confirms, moves or cancels. */
  manageUrl: string | null;
  /** That page's capability token — what the widget's own manage calls
   *  carry. Null when the link is absent or not in the shape we know. */
  manageToken: string | null;
  deposit: {
    required: boolean;
    amountClp: number | null;
    deadline: string | null;
    /** The clinic's transfer accounts. The server's `instructions` string is
     *  written for the AI agent, not for a patient, and is never read. */
    accounts: ClinicDepositAccount[];
    /** The clinic's own Mercado Pago checkout for THIS booking's deposit
     *  (vitrina-app#3705). https only; null without a connection. */
    checkoutUrl: string | null;
  };
}
