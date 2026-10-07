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
}

export interface ClinicBookingResult {
  displayId: string;
  startsAt: string;
  serviceName: string | null;
  professionalName: string | null;
  locationName: string | null;
  /** The tokenised page where the patient confirms, moves or cancels. */
  manageUrl: string | null;
  deposit: {
    required: boolean;
    amountClp: number | null;
    deadline: string | null;
    instructions: string | null;
  };
}
