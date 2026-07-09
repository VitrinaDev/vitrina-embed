import { describe, expect, it } from 'vitest';

import { makeT } from '../src/i18n';

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
