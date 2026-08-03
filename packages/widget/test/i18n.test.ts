import { describe, expect, it } from 'vitest';

import { STRINGS, makeT } from '../src/i18n';

describe('makeT', () => {
  it('returns es strings by default', () => {
    const t = makeT('es');
    expect(t('send')).toBe('Enviar');
    expect(t('welcome')).toBe('Hola, ¿en qué te puedo ayudar?');
  });

  it('returns en strings for the en locale', () => {
    const t = makeT('en');
    expect(t('send')).toBe('Send');
    expect(t('title')).toBe("Let's chat");
  });

  it('falls back to es for an unknown locale', () => {
    // Force an unsupported locale through the type boundary.
    const t = makeT('fr' as unknown as 'es');
    expect(t('send')).toBe('Enviar');
  });

  it('covers the same key set in both locales', () => {
    const es = makeT('es');
    const en = makeT('en');
    const keys = ['launcherLabel', 'title', 'placeholder', 'send', 'close', 'welcome', 'offline', 'error', 'sending', 'poweredBy'] as const;
    for (const k of keys) {
      expect(es(k)).toBeTruthy();
      expect(en(k)).toBeTruthy();
      // Distinct copy per locale for at least the visible chrome.
    }
  });
});

// ---------------------------------------------------------------------------
// STRUCTURAL parity, not a hand-maintained list.
//
// The old check enumerated ten keys, so a new string added to `es` and
// forgotten in `en` would sail past it. A booking flow half-translated into the
// visitor's language is worse than one honestly in Spanish — and the calendar
// tripled the size of this dictionary, so the check has to be exhaustive.
// ---------------------------------------------------------------------------
describe('es/en parity', () => {
  it('has the identical key set in both locales', () => {
    const es = Object.keys(STRINGS.es).sort();
    const en = Object.keys(STRINGS.en).sort();
    expect(en).toEqual(es);
  });

  it('has a non-empty string for every key in both locales', () => {
    for (const locale of ['es', 'en'] as const) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('resolves every key through makeT in both locales', () => {
    const keys = Object.keys(STRINGS.es) as (keyof typeof STRINGS.es)[];
    for (const locale of ['es', 'en'] as const) {
      const t = makeT(locale);
      for (const key of keys) expect(t(key), `${locale}.${key}`).toBeTruthy();
    }
  });

  it('translates the booking copy rather than leaving Spanish in the en table', () => {
    // A spot-check that `en` is a real translation and not a copy-paste of the
    // Spanish table — the failure mode a key-set check cannot see.
    const bookingKeys = [
      'bookVisit',
      'myVisits',
      'stepDateTitle',
      'consentLabel',
      'cancelWarning',
      'errSlotTaken',
    ] as const;
    for (const key of bookingKeys) {
      expect(STRINGS.en[key], key).not.toBe(STRINGS.es[key]);
    }
  });
});
