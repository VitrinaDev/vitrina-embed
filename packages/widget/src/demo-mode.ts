// Demo mode (D60) rules that do not need the DOM: which world is being played,
// when a message is really about the product (so the widget leaves the demo to
// answer it), and when a typed message is an invitation to start one. Pure, so
// the cases are tested one by one.

/** Visitor messages one stay in demo mode may hold (spec §5.8). */
export const DEMO_MAX_TURNS = 12;
/** Idle minutes before the widget leaves demo mode on its own. */
export const DEMO_IDLE_MS = 10 * 60_000;

export type DemoKind = 'automotora' | 'clinica';

/** The world being played: the page's explicit kind, else read off the name. */
export function demoKindOf(explicit: string | null | undefined, worldName: string | null): DemoKind | null {
  const e = (explicit ?? '').trim().toLowerCase();
  if (e === 'automotora' || e === 'clinica') return e;
  const n = (worldName ?? '').toLowerCase();
  if (/cl[ií]nica/.test(n)) return 'clinica';
  if (/auto/.test(n)) return 'automotora';
  return null;
}

/**
 * The visitor asks about the product itself (its price, hiring it, a demo with
 * the team, its name) and not about the fictional business. A customer asking
 * «¿cuánto cuesta la RAV4?» stays in the demo: only wording that is about THIS
 * tool counts. When in doubt it does not match: the demo assistant answers that
 * it can only attend as the business and the visitor can leave with the button.
 */
const ABOUT_PRODUCT: readonly RegExp[] = [
  /\bvitrina\b/i,
  /\btom[aá]s\b/i,
  /\b(esto|eso|el sistema|la herramienta|el servicio|el asistente|tu producto|el producto)\b[^.?!]{0,30}\bcu[aá]nto (cuesta|sale|vale|cobran|cobras)\b/i,
  /\bcu[aá]nto (cuesta|sale|vale|cobran|cobras)\b[^.?!]{0,12}\b(esto|el sistema|la herramienta|el servicio|el asistente|usar|contratar|tener un asistente)\b/i,
  /\b(contratar|contrataci[oó]n|suscripci[oó]n|planes? y precios?|precio del (plan|servicio|asistente))\b/i,
  /\b(agendar|reservar|pedir|quiero|quisiera|me interesa) (una )?demo\b/i,
  /\bhablar con (una persona|un humano|un asesor|alguien del equipo)\b/i,
];

export function asksAboutProduct(text: string): boolean {
  return ABOUT_PRODUCT.some((re) => re.test(text));
}

/** «quiero probar», «hazte pasar por un cliente»: an invitation to try the demo. */
const WANTS_DEMO: readonly RegExp[] = [
  /\bquiero (probar|ver c[oó]mo (funciona|responde))/i,
  /\b(pru[eé]balo|probarlo|probar(te)? como)\b/i,
  /\bhazte pasar por\b/i,
  /\b(haz|hazme) de cuenta\b/i,
  /\bcomo (tu |mi )?peor cliente\b/i,
  /\bmodo demo\b/i,
];

export function asksToTryDemo(text: string): boolean {
  return WANTS_DEMO.some((re) => re.test(text));
}

/** A short opaque id for one stay in demo mode (the server counts allowances by it). */
export function newDemoSessionId(): string {
  const bytes = new Uint8Array(8);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `ds_${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('')}`.slice(0, 40);
}
