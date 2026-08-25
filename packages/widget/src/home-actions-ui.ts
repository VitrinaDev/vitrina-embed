// The Home quick-action overlay — "Comprar un auto", "Vender tu auto" and
// "Lo buscamos por ti". A sibling of the transcript inside `.vtr-panel`, laid
// over it and toggled with a `hidden` flip, exactly like the booking overlay:
// the conversation underneath is never destroyed to make room for a form.
//
// PRESENTATION ONLY, on the same split as booking-ui.ts. This module owns no
// transport state and no flow decisions; it paints a HomeActionViewState and
// reports intents. home-actions-controller.ts owns the machine, which is what
// lets all three flows be driven through init() against a mocked fetch with no
// DOM assertions inside the logic.
//
// XSS SAFETY, same rule as ui.ts: every node is built with createElement /
// createElementNS. There is no innerHTML here and no remote asset. The only
// strings that reach the DOM are our own copy and what the visitor typed, and
// both go in as text nodes.
//
// The small DOM helpers below (el, chevron, checkMark) are deliberately a
// SECOND copy of booking-ui.ts's rather than a shared import: ui.ts and
// booking-ui.ts already each own theirs, and twelve lines is a cheaper price
// than a dependency between two overlays that have nothing else to say to each
// other.

import type { StringKey, Translate } from './i18n';
import type { WidgetHomeAction } from './types';

/**
 * Which screen the overlay is on.
 *
 *   form                          — buy and search: one screen, then the chat
 *   car → details → photos → contact → ok  — sell, the consignment intake
 */
export type HomeActionStep = 'form' | 'car' | 'details' | 'photos' | 'contact' | 'ok';

/**
 * Every field the three flows can hold, in ONE bag.
 *
 * The flows share what they genuinely share — the visitor's own name, phone and
 * email, and the free-text `wanted` / `budget` / `year` / `notes` — because only
 * one flow is ever open and the controller resets the flow-specific fields when
 * it opens. Someone who asks to buy a car and then asks us to find one should
 * not have to type their phone number twice.
 */
export interface HomeActionFormValues {
  name: string;
  phone: string;
  email: string;
  consent: boolean;
  /** buy: the car they want. search: the car we go and find. */
  wanted: string;
  budget: string;
  /** search: optional. sell: the car's year, required. */
  year: string;
  notes: string;
  plate: string;
  make: string;
  model: string;
  km: string;
  version: string;
  price: string;
  /** `plazo_venta`: one of the DEADLINES values. */
  deadline: string;
  /** `region_code`: a two-digit CUT code. */
  region: string;
}

/** One chosen photo, as the list needs it. The File itself stays in the controller. */
export interface HomeActionPhoto {
  name: string;
}

export interface HomeActionViewState {
  kind: WidgetHomeAction;
  step: HomeActionStep;
  form: HomeActionFormValues;
  photos: HomeActionPhoto[];
  submitting: boolean;
  /** i18n key of the one line to show, or null. */
  error: StringKey | null;
}

export interface HomeActionCallbacks {
  onClose(): void;
  onBack(): void;
  onFormChange(patch: Partial<HomeActionFormValues>): void;
  onPickPhotos(files: FileList | null): void;
  onRemovePhoto(index: number): void;
  /**
   * The one CTA: continue, send, or done — the controller knows which from the
   * step. `honeypot` is the overlay's hidden field, read at CLICK time exactly
   * like the composer reads its own: a bot that fills it with `el.value = …`
   * fires no input event, so a value mirrored into state would always be empty.
   */
  onPrimary(honeypot: string): void;
}

export interface HomeActionsUi {
  readonly root: HTMLElement;
  render(state: HomeActionViewState): void;
  /** Re-derive every string painted at construction. */
  setLocale(): void;
}

/** Which of the sell flow's four steps a screen is, or 0 when it has no number. */
const STEP_NUMBER: Record<HomeActionStep, number> = {
  form: 0,
  car: 1,
  details: 2,
  photos: 3,
  contact: 4,
  ok: 0,
};

/** Steps whose back arrow leads somewhere. */
const STEP_HAS_BACK: Record<HomeActionStep, boolean> = {
  form: false,
  car: false,
  details: true,
  photos: true,
  contact: true,
  ok: false,
};

/** Header for a one-screen flow. Search cannot reuse its card title — that is a
 *  question, and a question does not read as a header. */
const KIND_TITLE: Record<WidgetHomeAction, StringKey> = {
  buy: 'homeBuyTitle',
  sell: 'homeSellTitle',
  search: 'haSearchTitle',
};

/** Header per sell step. Step 4 reuses the booking form's "Tus datos". */
const SELL_STEP_TITLE: Record<HomeActionStep, StringKey> = {
  form: 'homeSellTitle',
  car: 'haSellCarTitle',
  details: 'haSellDetailsTitle',
  photos: 'haSellPhotosTitle',
  contact: 'stepFormTitle',
  ok: 'haSellOkTitle',
};

/** `plazo_venta` — the wire value, and the copy that names it. */
const DEADLINES: ReadonlyArray<readonly [string, StringKey]> = [
  ['7d', 'haDeadline7d'],
  ['15d', 'haDeadline15d'],
  ['30d', 'haDeadline30d'],
  ['cotizando', 'haDeadlineQuote'],
];

/**
 * `region_code` — Chile's sixteen regions with their CUT codes, in CUT order.
 *
 * The names are proper nouns and stay identical in both locales, so they are
 * NOT i18n keys: translating "Ñuble" would be inventing a place.
 */
const REGIONS: ReadonlyArray<readonly [string, string]> = [
  ['01', 'Tarapacá'],
  ['02', 'Antofagasta'],
  ['03', 'Atacama'],
  ['04', 'Coquimbo'],
  ['05', 'Valparaíso'],
  ['06', "O'Higgins"],
  ['07', 'Maule'],
  ['08', 'Biobío'],
  ['09', 'La Araucanía'],
  ['10', 'Los Lagos'],
  ['11', 'Aysén'],
  ['12', 'Magallanes'],
  ['13', 'Metropolitana'],
  ['14', 'Los Ríos'],
  ['15', 'Arica y Parinacota'],
  ['16', 'Ñuble'],
];

/** Every form key that holds a string — i.e. everything except the checkbox. */
type TextKey = Exclude<keyof HomeActionFormValues, 'consent'>;

/**
 * Whether the CTA on this screen is live.
 *
 * EXPORTED because the controller guards on exactly the same answer: a disabled
 * button and an ignored click have to agree, or a keyboard visitor finds a
 * third behaviour. Presence only — ranges (a year of 3050, a 9-digit odometer)
 * are checked on submit, where there is somewhere to SAY what is wrong.
 */
export function canAdvance(state: HomeActionViewState): boolean {
  const f = state.form;
  const has = (value: string): boolean => value.trim() !== '';
  switch (state.step) {
    case 'form':
      return has(f.name) && has(f.phone) && has(f.wanted) && f.consent;
    case 'car':
      return has(f.plate) && has(f.make) && has(f.model) && has(f.year) && has(f.km);
    case 'details':
      return has(f.deadline) && has(f.region);
    case 'contact':
      // Phone OR email is required too, but it is NOT checked here: leaving the
      // button live and answering with "déjanos un teléfono o un correo" says
      // what is missing, where a button that simply stays dim says nothing.
      return has(f.name) && f.consent;
    case 'photos':
    case 'ok':
      return true;
    default:
      return false;
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(className: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = className;
  btn.type = 'button';
  return btn;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function strokePath(d: string, width = '2'): SVGElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', width);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  return path;
}

/** A chevron, drawn as a path. Rotated per direction by CSS, not by markup. */
function chevron(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.appendChild(strokePath('M15 5l-7 7 7 7'));
  return svg;
}

/** The confirmation check. */
function checkMark(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.appendChild(strokePath('M4 12.5l5.2 5.2L20 7', '2.4'));
  return svg;
}

export interface HomeActionsUiOptions {
  /** Read on every paint, so a locale swap needs no re-wiring. */
  getT(): Translate;
  callbacks: HomeActionCallbacks;
  /** Register a listener the panel will tear down on destroy(). */
  on(target: EventTarget, type: string, handler: EventListener): void;
}

/** One control wired to one field: its node, and how to repaint it from state. */
interface Bound {
  node: HTMLElement;
  sync(state: HomeActionViewState): void;
}

/** One screen's body: built ONCE, then synced on every paint. */
interface StepView {
  node: HTMLElement;
  sync(state: HomeActionViewState): void;
}

export function createHomeActionsUi(opts: HomeActionsUiOptions): HomeActionsUi {
  const { callbacks, on } = opts;
  const t = (): Translate => opts.getT();

  const root = el('div', 'vtr-ha');
  root.setAttribute('role', 'dialog');
  root.hidden = true;

  // --- Chrome (persistent) ---
  const head = el('div', 'vtr-ha-head');
  const backBtn = iconButton('vtr-ha-back');
  backBtn.appendChild(chevron());
  const titleEl = el('span', 'vtr-ha-title');
  const closeBtn = iconButton('vtr-ha-close');
  closeBtn.textContent = '×';
  head.append(backBtn, titleEl, closeBtn);

  const stepEl = el('div', 'vtr-ha-step');
  const body = el('div', 'vtr-ha-body');

  // --- Foot (persistent, so a repaint never steals focus from the CTA) ---
  // Two nodes, not booking's three: no screen in these flows has a second
  // action — continuing IS skipping on the photos step, and every failure is
  // retried with the same button that produced it.
  const foot = el('div', 'vtr-ha-foot');
  const errorEl = el('div', 'vtr-ha-error');
  errorEl.setAttribute('role', 'status');
  errorEl.hidden = true;
  const primaryBtn = document.createElement('button');
  primaryBtn.className = 'vtr-ha-primary';
  primaryBtn.type = 'button';
  foot.append(errorEl, primaryBtn);

  // ONE honeypot for the whole overlay rather than one per form: it lives in the
  // chrome, so it is in the DOM for all three flows and there is a single place
  // to read it from. Same class as the composer's, so it is hidden the same way
  // — off-screen, never display:none, which bots skip.
  const honeypot = document.createElement('input');
  honeypot.className = 'vtr-hp';
  honeypot.type = 'text';
  honeypot.name = 'hp_website';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');

  root.append(head, stepEl, body, foot, honeypot);

  // --- Controls -------------------------------------------------------------
  // Built ONCE per screen and never rebuilt. A repaint fires on every keystroke
  // (the CTA is gated on the field values), so rebuilding an input would blow
  // away focus and the caret on every character typed.

  function textInput(type: string, autocomplete?: AutoFill): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'vtr-ha-input';
    input.type = type;
    if (autocomplete) input.autocomplete = autocomplete;
    return input;
  }

  /** A number the visitor types with dots ("42.000"): text + a numeric keypad. */
  function numberInput(): HTMLInputElement {
    const input = textInput('text');
    input.inputMode = 'numeric';
    return input;
  }

  function textArea(): HTMLTextAreaElement {
    const area = document.createElement('textarea');
    area.className = 'vtr-ha-input vtr-ha-area';
    area.rows = 3;
    return area;
  }

  /** A labelled control bound to one string field of the form state. */
  function field(
    control: HTMLInputElement | HTMLTextAreaElement,
    labelKey: StringKey,
    placeholderKey: StringKey | null,
    key: TextKey,
  ): Bound {
    const node = el('label', 'vtr-ha-label');
    const text = el('span', 'vtr-ha-label-text');
    // The field's own name on the node. It is what a host page's CSS, and this
    // package's tests, address a control by — never its position in the form.
    control.dataset.field = key;
    node.append(text, control);
    on(control, 'input', () =>
      callbacks.onFormChange({ [key]: control.value } as Partial<HomeActionFormValues>),
    );
    return {
      node,
      sync(state) {
        text.textContent = t()(labelKey);
        if (placeholderKey) control.placeholder = t()(placeholderKey);
        // Assign only on a real difference: writing an identical value still
        // resets the caret in some engines, and this runs on every keystroke.
        const value = state.form[key];
        if (control.value !== value) control.value = value;
      },
    };
  }

  /** A labelled <select> whose first option is a placeholder, never a default. */
  function selectField(
    labelKey: StringKey,
    key: TextKey,
    values: readonly string[],
    labelOf: (value: string) => string,
  ): Bound {
    const control = document.createElement('select');
    control.className = 'vtr-ha-input';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    control.appendChild(placeholder);
    const options = values.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      control.appendChild(option);
      return option;
    });
    const node = el('label', 'vtr-ha-label');
    const text = el('span', 'vtr-ha-label-text');
    control.dataset.field = key;
    node.append(text, control);
    on(control, 'change', () =>
      callbacks.onFormChange({ [key]: control.value } as Partial<HomeActionFormValues>),
    );
    return {
      node,
      sync(state) {
        text.textContent = t()(labelKey);
        placeholder.textContent = t()('haSelectPlaceholder');
        // Re-derived on every paint so a locale swap relabels the open list too.
        options.forEach((option, i) => {
          option.textContent = labelOf(values[i]);
        });
        const value = state.form[key];
        if (control.value !== value) control.value = value;
      },
    };
  }

  /** Name, phone, email — the three the dealer needs to answer anybody. */
  function contactFields(): Bound[] {
    return [
      field(textInput('text', 'name'), 'fieldName', 'fieldNamePlaceholder', 'name'),
      field(textInput('tel', 'tel'), 'fieldPhone', 'fieldPhonePlaceholder', 'phone'),
      field(textInput('email', 'email'), 'fieldEmail', 'fieldEmailPlaceholder', 'email'),
    ];
  }

  /**
   * The consent tick and the line under it. The checkbox is real: it gates the
   * CTA and it is sent, because a decorative consent tick on a public form
   * collecting a Chilean phone number would be worse than none.
   */
  function consentFields(): Bound[] {
    const label = el('label', 'vtr-ha-consent');
    const input = document.createElement('input');
    input.className = 'vtr-ha-check';
    input.type = 'checkbox';
    input.dataset.field = 'consent';
    const text = el('span');
    label.append(input, text);
    const note = el('div', 'vtr-ha-note');
    on(input, 'change', () => callbacks.onFormChange({ consent: input.checked }));
    return [
      {
        node: label,
        sync(state) {
          text.textContent = t()('haConsentLabel');
          if (input.checked !== state.form.consent) input.checked = state.form.consent;
        },
      },
      {
        node: note,
        sync() {
          note.textContent = t()('haPrivacyNote');
        },
      },
    ];
  }

  function composite(bound: Bound[]): StepView {
    const node = el('div', 'vtr-ha-form');
    for (const item of bound) node.appendChild(item.node);
    return {
      node,
      sync(state) {
        for (const item of bound) item.sync(state);
      },
    };
  }

  /** The photos step: a file picker, the chosen names, and a way back out of each. */
  function photosStep(): StepView {
    const node = el('div', 'vtr-ha-form');
    const label = el('div', 'vtr-ha-label-text');
    // The native control is hidden INSIDE its own label rather than styled: a
    // file input cannot be restyled across browsers, and a raw "Choose Files"
    // button is the one place a dealer's panel stops looking like the panel.
    // Clicking the label opens the picker, keyboard and screen reader included.
    const pick = el('label', 'vtr-ha-pick');
    const picker = document.createElement('input');
    picker.className = 'vtr-ha-fileinput';
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = 'image/*';
    const pickText = el('span');
    pick.append(picker, pickText);
    const list = el('div', 'vtr-ha-files');
    const note = el('div', 'vtr-ha-note');
    node.append(label, pick, list, note);

    on(picker, 'change', () => {
      callbacks.onPickPhotos(picker.files);
      // Clear it so re-picking the SAME file fires change again — the visitor
      // who removed a photo by accident must be able to add it straight back.
      picker.value = '';
    });
    // ONE delegated listener: the rows are rebuilt on every paint.
    on(list, 'click', (e) => {
      const btn = (e.target as Element | null)?.closest?.('[data-ha-photo]') as HTMLElement | null;
      const index = btn?.dataset.haPhoto;
      if (index !== undefined) callbacks.onRemovePhoto(Number(index));
    });

    return {
      node,
      sync(state) {
        label.textContent = t()('haPhotosLabel');
        pickText.textContent = t()('haPhotosPick');
        note.textContent = t()('haPhotosNote');
        list.replaceChildren();
        state.photos.forEach((photo, i) => {
          const row = el('div', 'vtr-ha-file');
          row.appendChild(el('span', 'vtr-ha-filename', photo.name));
          const remove = iconButton('vtr-ha-fileremove');
          remove.dataset.haPhoto = String(i);
          remove.textContent = '×';
          remove.setAttribute('aria-label', `${t()('haPhotoRemove')}: ${photo.name}`);
          row.appendChild(remove);
          list.appendChild(row);
        });
      },
    };
  }

  // Screens are built on FIRST use and cached: a tenant with only the sell card
  // never constructs the buy form, and a visitor who never reaches step 3 never
  // constructs a file picker.
  const steps = new Map<string, StepView>();

  function stepFor(state: HomeActionViewState): StepView {
    const key = `${state.kind}:${state.step}`;
    const cached = steps.get(key);
    if (cached) return cached;
    let view: StepView;
    switch (state.step) {
      case 'form':
        view =
          state.kind === 'search'
            ? composite([
                ...contactFields(),
                field(textArea(), 'haSearchWanted', 'haSearchWantedPlaceholder', 'wanted'),
                field(numberInput(), 'haYear', 'haYearPlaceholder', 'year'),
                field(textInput('text'), 'haBudget', 'haBudgetPlaceholder', 'budget'),
                field(textArea(), 'haNotes', 'haNotesPlaceholder', 'notes'),
                ...consentFields(),
              ])
            : composite([
                ...contactFields(),
                field(textArea(), 'haBuyWanted', 'haBuyWantedPlaceholder', 'wanted'),
                field(textInput('text'), 'haBudget', 'haBudgetPlaceholder', 'budget'),
                ...consentFields(),
              ]);
        break;
      case 'car':
        view = composite([
          field(textInput('text'), 'haPlate', 'haPlatePlaceholder', 'plate'),
          field(textInput('text'), 'haMake', 'haMakePlaceholder', 'make'),
          field(textInput('text'), 'haModel', 'haModelPlaceholder', 'model'),
          field(numberInput(), 'haCarYear', 'haYearPlaceholder', 'year'),
          field(numberInput(), 'haKm', 'haKmPlaceholder', 'km'),
        ]);
        break;
      case 'details':
        view = composite([
          field(textInput('text'), 'haVersion', 'haVersionPlaceholder', 'version'),
          field(numberInput(), 'haPrice', 'haPricePlaceholder', 'price'),
          selectField(
            'haDeadline',
            'deadline',
            DEADLINES.map(([value]) => value),
            (value) => t()(DEADLINES.find(([v]) => v === value)?.[1] ?? 'haSelectPlaceholder'),
          ),
          selectField(
            'haRegion',
            'region',
            REGIONS.map(([code]) => code),
            (code) => REGIONS.find(([c]) => c === code)?.[1] ?? code,
          ),
          field(textArea(), 'haNotes', 'haNotesPlaceholder', 'notes'),
        ]);
        break;
      case 'photos':
        view = photosStep();
        break;
      default:
        view = composite([...contactFields(), ...consentFields()]);
        break;
    }
    steps.set(key, view);
    return view;
  }

  /** Swap the body's single child without disturbing a node already in place. */
  function setBody(node: Node): void {
    if (body.childNodes.length === 1 && body.firstChild === node) return;
    body.replaceChildren(node);
  }

  /** The confirmation. Rebuilt on every paint — it holds no input to protect. */
  function renderOk(): Node {
    const wrap = document.createDocumentFragment();
    const mark = el('div', 'vtr-ha-done');
    mark.appendChild(checkMark());
    wrap.appendChild(mark);
    // The header already says "Datos recibidos"; repeating it here would make
    // the screen say the same thing twice and the useful sentence third.
    wrap.appendChild(el('div', 'vtr-ha-oktitle', t()('haSellOkNote')));
    return wrap;
  }

  /** The CTA per screen — the only place button copy is decided. */
  function paintFoot(state: HomeActionViewState): void {
    let primary: StringKey;
    switch (state.step) {
      case 'form':
      case 'contact':
        primary = state.submitting ? 'sending' : 'send';
        break;
      case 'ok':
        primary = 'doneCta';
        break;
      default:
        primary = 'continueCta';
        break;
    }
    primaryBtn.textContent = t()(primary);
    primaryBtn.disabled = state.submitting || !canAdvance(state);

    if (state.error) {
      errorEl.hidden = false;
      errorEl.textContent = t()(state.error);
    } else {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
  }

  let current: HomeActionViewState | null = null;

  const ui: HomeActionsUi = {
    root,
    render(state: HomeActionViewState): void {
      current = state;
      const titleKey =
        state.kind === 'sell' ? SELL_STEP_TITLE[state.step] : KIND_TITLE[state.kind];
      titleEl.textContent = t()(titleKey);
      root.setAttribute('aria-label', titleEl.textContent);
      root.dataset.kind = state.kind;
      root.dataset.step = state.step;
      backBtn.hidden = !STEP_HAS_BACK[state.step];
      backBtn.setAttribute('aria-label', t()('back'));
      closeBtn.setAttribute('aria-label', t()('close'));

      // Only the sell flow is long enough to owe the visitor a step counter.
      const n = state.kind === 'sell' ? STEP_NUMBER[state.step] : 0;
      stepEl.hidden = n === 0;
      if (n > 0) stepEl.textContent = `${t()('stepLabel')} ${n} ${t()('stepOf')} 4`;

      if (state.step === 'ok') {
        setBody(renderOk());
      } else {
        const view = stepFor(state);
        setBody(view.node);
        view.sync(state);
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
  on(primaryBtn, 'click', () => callbacks.onPrimary(honeypot.value));

  return ui;
}
