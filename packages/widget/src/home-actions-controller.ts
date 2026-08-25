// The Home quick actions' state machine — three flows behind one overlay:
//
//   buy    · form → the conversation
//   search · form → the conversation
//   sell   · car → details → photos → contact → ok
//
// It owns every decision and every call the flows make; home-actions-ui.ts only
// paints what this hands it. Same split, and the same reason, as
// booking-controller.ts: index.ts owns the CHAT state, and a four-step intake
// that validates a plate, caps a photo list and posts a multipart body is not
// chat state.
//
// TWO DESTINATIONS, DELIBERATELY DIFFERENT. Buy and search are messages: they go
// down the ordinary send pipeline, land in the transcript, and the conversation
// itself is the confirmation — so the overlay closes and the visitor is left
// looking at their own thread, where the AI's reply will arrive. Sell is an
// intake: it has a ledger row behind it, a duplicate answer, and photos, so it
// posts to /widget/consignments and earns a confirmation screen.
//
// NOTHING HERE THROWS. Every transport method answers a typed outcome and every
// failure has a line the visitor can act on. The cards-off case never reaches
// this module at all: the controller is only constructed once a card is on.

import {
  canAdvance,
  type HomeActionCallbacks,
  type HomeActionFormValues,
  type HomeActionViewState,
} from './home-actions-ui';
import type { StringKey, Translate } from './i18n';
import type { VitrinaTransport } from './transport';
import type { WidgetHomeAction } from './types';

/** Only the intake method — the rest of the transport is none of our business. */
export type ConsignmentTransport = Pick<VitrinaTransport, 'submitConsignment'>;

/** What the buy/search flows hand to the ordinary send pipeline. */
export interface HomeActionSendInput {
  text: string;
  honeypot: string;
  name: string;
  phone: string;
  email: string;
}

export interface HomeActionsControllerDeps {
  transport: ConsignmentTransport;
  /** Read live: the chrome language can change under an open overlay. */
  getT(): Translate;
  /**
   * Put the composed message in the transcript and start delivering it.
   * Resolves TRUE once the message is a real entry in the list — delivery
   * continues in the background, and a POST that fails afterwards is reported
   * where every other failed message is: on the message itself, with a retry.
   */
  sendMessage(input: HomeActionSendInput): Promise<boolean>;
  /** Repaint the overlay. */
  onRender(state: HomeActionViewState): void;
  /** The message landed in the transcript — uncover it and show Mensajes. */
  onSent(): void;
  /** Close the overlay, leaving the transcript exactly where it was. */
  onClose(): void;
}

export interface HomeActionsController {
  /** Handed straight to createHomeActionsUi. */
  readonly callbacks: HomeActionCallbacks;
  /** Open (or re-open) one flow at its first step. */
  open(kind: WidgetHomeAction): void;
  destroy(): void;
}

/** Photo caps, enforced HERE so a 40MB burst never leaves the browser. */
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Field bounds, mirroring the server's own validation on /widget/consignments. */
const PLATE_MIN = 4;
const PLATE_MAX = 16;
const YEAR_MIN = 1900;
const YEAR_MAX = 2200;
const KM_MAX = 3_000_000;

/**
 * What the visitor agreed to, versioned. Ley 21.719 asks WHICH text was shown,
 * not merely that a box was ticked — so this string changes whenever the consent
 * copy does, and never otherwise.
 */
const CONSENT_TEXT_VERSION = 'widget-0.9';

/** The consent record keeps the page the visitor was on. Bounded, like the server's. */
const MAX_SOURCE_URL = 2048;

/** The sell flow's step order — the only place "what comes next" is written. */
const SELL_STEPS = ['car', 'details', 'photos', 'contact'] as const;

function emptyForm(): HomeActionFormValues {
  return {
    name: '',
    phone: '',
    email: '',
    consent: false,
    wanted: '',
    budget: '',
    year: '',
    notes: '',
    plate: '',
    make: '',
    model: '',
    km: '',
    version: '',
    price: '',
    deadline: '',
    region: '',
  };
}

/**
 * A whole number out of what a Chilean actually types: "42.000", "$ 8.500.000",
 * "2019". Everything that is not a digit is dropped, so the widget never argues
 * with someone about their own thousands separator. Blank ⇒ null.
 */
function toInteger(input: string): number | null {
  const digits = input.replace(/\D+/g, '');
  if (digits === '') return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** The host page's URL for the consent record, or '' when there is no location. */
function sourceUrl(): string {
  try {
    return (globalThis.location?.href ?? '').slice(0, MAX_SOURCE_URL);
  } catch {
    return '';
  }
}

export function createHomeActionsController(
  deps: HomeActionsControllerDeps,
): HomeActionsController {
  const { transport } = deps;
  const t = (): Translate => deps.getT();

  let destroyed = false;
  /** The real Files. Only their names ever reach the view. */
  let photos: File[] = [];
  /** Guards a slow submit from painting over a newer one. */
  let generation = 0;

  let state: HomeActionViewState = {
    kind: 'buy',
    step: 'form',
    form: emptyForm(),
    photos: [],
    submitting: false,
    error: null,
  };

  function render(): void {
    if (destroyed) return;
    state.photos = photos.map((file) => ({ name: file.name }));
    deps.onRender(state);
  }

  /** The message a buy/search submit puts in the dealer's inbox. */
  function composeMessage(): string {
    const tr = t();
    const f = state.form;
    const budget = f.budget.trim() || tr('haMsgBudgetTbd');
    if (state.kind === 'search') {
      const year = f.year.trim();
      const lines = [
        tr('haMsgSearch'),
        `${tr('haMsgSearchCar')} ${f.wanted.trim()}${year ? ` ${year}` : ''}`,
        `${tr('haMsgBudget')} ${budget}`,
      ];
      const notes = f.notes.trim();
      if (notes) lines.push(`${tr('haMsgNotes')} ${notes}`);
      return lines.join('\n');
    }
    return [
      tr('haMsgBuy'),
      `${tr('haMsgBuyWanted')} ${f.wanted.trim()}`,
      `${tr('haMsgBudget')} ${budget}`,
    ].join('\n');
  }

  /** Range checks for the sell flow's first step. null ⇒ nothing to say. */
  function checkCar(): StringKey | null {
    const f = state.form;
    const plate = f.plate.trim();
    if (plate.length < PLATE_MIN || plate.length > PLATE_MAX) return 'haErrPlate';
    const year = toInteger(f.year);
    if (year === null || year < YEAR_MIN || year > YEAR_MAX) return 'haErrYear';
    const km = toInteger(f.km);
    if (km === null || km > KM_MAX) return 'haErrKm';
    return null;
  }

  function checkDetails(): StringKey | null {
    const price = state.form.price.trim();
    if (price !== '' && toInteger(price) === null) return 'haErrPrice';
    return null;
  }

  function checkContact(): StringKey | null {
    const f = state.form;
    if (f.phone.trim() === '' && f.email.trim() === '') return 'haErrContact';
    return null;
  }

  async function submitLead(honeypot: string): Promise<void> {
    if (state.submitting || !canAdvance(state)) return;
    const gen = ++generation;
    state.submitting = true;
    state.error = null;
    render();

    const f = state.form;
    const accepted = await deps.sendMessage({
      text: composeMessage(),
      honeypot,
      name: f.name.trim(),
      phone: f.phone.trim(),
      email: f.email.trim(),
    });
    if (destroyed || gen !== generation) return;
    state.submitting = false;
    if (!accepted) {
      // Nothing was written anywhere, so the form is still the only copy of what
      // they typed. Keep it, say so, and let the same button try again.
      state.error = 'haErrSend';
      render();
      return;
    }
    render();
    // The transcript now holds the message, which IS the confirmation — there is
    // no second success screen to invent.
    deps.onSent();
  }

  async function submitConsignment(honeypot: string): Promise<void> {
    if (state.submitting) return;
    const problem = checkContact();
    if (problem) {
      state.error = problem;
      render();
      return;
    }
    const gen = ++generation;
    state.submitting = true;
    state.error = null;
    render();

    const f = state.form;
    // snake_case, exactly as POST /widget/consignments reads it. The three
    // consent fields travel together or not at all: a ticked box with no record
    // of WHICH text was ticked is not consent anybody can audit.
    const fields: Record<string, string> = {
      // Uppercased so "bcdf12" and "BCDF12" are one car on the ledger, not two.
      patente: f.plate.trim().toUpperCase(),
      marca: f.make.trim(),
      modelo: f.model.trim(),
      anio: String(toInteger(f.year) ?? ''),
      kilometros: String(toInteger(f.km) ?? ''),
      plazo_venta: f.deadline,
      region_code: f.region,
      nombre: f.name.trim(),
      consent_granted: 'true',
      consent_source_url: sourceUrl(),
      consent_text_version: CONSENT_TEXT_VERSION,
      hp_website: honeypot,
    };
    const version = f.version.trim();
    if (version) fields.version = version;
    const price = toInteger(f.price);
    if (price !== null) fields.precio_esperado_clp = String(price);
    const phone = f.phone.trim();
    if (phone) fields.telefono = phone;
    const email = f.email.trim();
    if (email) fields.email = email;
    const notes = f.notes.trim();
    if (notes) fields.comentarios = notes;

    const res = await transport.submitConsignment(fields, photos);
    if (destroyed || gen !== generation) return;
    state.submitting = false;
    if (res.ok) {
      // 'duplicate' is a success on purpose: the dealer already has this car, so
      // the visitor's ask is answered. Telling them their own car is a duplicate
      // would be reporting our bookkeeping as their problem.
      state.step = 'ok';
      state.error = null;
      render();
      return;
    }
    state.error = res.reason === 'photos' ? 'haErrPhotos' : 'haErrConsignment';
    render();
  }

  /** Take what fits, and say what did not. Never silently drop a photo. */
  function addPhotos(files: FileList | null): void {
    if (!files || files.length === 0) return;
    let error: StringKey | null = null;
    for (const file of Array.from(files)) {
      if (photos.length >= MAX_PHOTOS) {
        error = 'haErrPhotoTooMany';
        break;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        error = 'haErrPhotoTooLarge';
        continue;
      }
      photos.push(file);
    }
    state.error = error;
    render();
  }

  const callbacks: HomeActionCallbacks = {
    onClose: () => deps.onClose(),
    onBack: () => {
      const index = SELL_STEPS.indexOf(state.step as (typeof SELL_STEPS)[number]);
      if (index > 0) state.step = SELL_STEPS[index - 1];
      state.error = null;
      render();
    },
    onFormChange: (patch) => {
      state.form = { ...state.form, ...patch };
      render();
    },
    onPickPhotos: (files) => addPhotos(files),
    onRemovePhoto: (index) => {
      if (index < 0 || index >= photos.length) return;
      photos = photos.filter((_, i) => i !== index);
      state.error = null;
      render();
    },
    onPrimary: (honeypot) => {
      if (!canAdvance(state)) return;
      switch (state.step) {
        case 'form':
          void submitLead(honeypot);
          return;
        case 'car': {
          const problem = checkCar();
          state.error = problem;
          if (!problem) state.step = 'details';
          render();
          return;
        }
        case 'details': {
          const problem = checkDetails();
          state.error = problem;
          if (!problem) state.step = 'photos';
          render();
          return;
        }
        case 'photos':
          state.error = null;
          state.step = 'contact';
          render();
          return;
        case 'contact':
          void submitConsignment(honeypot);
          return;
        case 'ok':
          deps.onClose();
          return;
        default:
          return;
      }
    },
  };

  return {
    callbacks,
    open(kind: WidgetHomeAction): void {
      // Reset the FLOW, keep the PERSON. A visitor who asked us to find a car
      // and then decides to sell theirs should not retype their own name.
      state.kind = kind;
      state.step = kind === 'sell' ? 'car' : 'form';
      state.form = {
        ...emptyForm(),
        name: state.form.name,
        phone: state.form.phone,
        email: state.form.email,
        consent: state.form.consent,
      };
      photos = [];
      state.submitting = false;
      state.error = null;
      generation += 1;
      render();
    },
    destroy(): void {
      destroyed = true;
      photos = [];
      state = { ...state, form: emptyForm(), photos: [], submitting: false, error: null };
    },
  };
}
