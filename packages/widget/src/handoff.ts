// WhatsApp continuation (embed#25, D36 a; spec v3 §5.6, §6.3).
//
// The link is a plain wa.me URL the visitor TAPS — no window.open, no popup,
// nothing an in-app browser blocks. The prefilled text carries a short
// reference code derived from the web conversation's external id, so the
// server can join the WhatsApp thread that follows to the web one.
//
// The derivation is a CONTRACT with vitrina-app (resolution lives there, see
// the fleet note contracts/widget-wa-ref.md): FNV-1a 32-bit over the UTF-8
// bytes of the conversation external id, rendered as 6 Crockford base32
// characters (30 bits, most significant first). Short enough to read aloud,
// no ambiguous characters (no I, L, O, U), and recomputable server-side
// without storing anything.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const REF_LENGTH = 6;
export const REF_PATTERN = /\(ref ([0-9A-HJKMNP-TV-Z]{6})\)/;

export function fnv1a32(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The reference code for a web conversation, e.g. "K7Q2XM". */
export function conversationRef(conversationExternalId: string): string {
  // Top 30 of the 32 bits, 5 bits per character.
  let v = fnv1a32(conversationExternalId) >>> 2;
  let out = '';
  for (let i = 0; i < REF_LENGTH; i += 1) {
    out = CROCKFORD[v & 31] + out;
    v >>>= 5;
  }
  return out;
}

/**
 * The prefilled text: `{ref}` replaced when the template has it, otherwise the
 * code appended as " (ref XXXXXX)" so the server's parser always finds it in
 * the same shape. No conversation yet ⇒ the template without any ref line.
 */
export function handoffText(template: string, ref: string | null): string {
  if (ref === null) {
    return template
      .replace(/\s*\(ref \{ref\}\)/g, '')
      .replace(/\{ref\}/g, '')
      .trim();
  }
  return template.includes('{ref}') ? template.replace(/\{ref\}/g, ref) : `${template} (ref ${ref})`;
}

export function whatsappHandoffUrl(number: string, template: string, ref: string | null): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(handoffText(template, ref))}`;
}
