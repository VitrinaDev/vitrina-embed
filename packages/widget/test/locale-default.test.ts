// The widget speaks the BUSINESS's language, not the browser's (vitrina-app#3957).
//
// The prod widget E2E: an English browser got English chrome on a Chilean
// clinic's page. Order now: the snippet's `locale` > the server's `locale`
// (pinned, or the business's only language) > the browser, only when the
// business offers several languages and only among those > the business's
// `defaultLocale` > Spanish. The test DOM's browser reports English.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig, resolveLocale } from '../src/config';
import { coerceRemoteConfig } from '../src/remote-config';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

function browserSpeaks(...languages: string[]): void {
  vi.spyOn(globalThis.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(globalThis.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '');
}

afterEach(() => vi.restoreAllMocks());

describe('widget language', () => {
  it("an English browser on a Spanish-only business reads Spanish", () => {
    browserSpeaks('en-US', 'en');
    expect(resolveLocale(undefined, { locale: 'es', defaultLocale: 'es' })).toBe('es');
  });

  it('defaults to Spanish, not the browser, before the server has answered', () => {
    browserSpeaks('en-US');
    expect(resolveConfig({ publicKey: PK, apiBaseUrl: BASE }, null).locale).toBe('es');
    expect(resolveLocale(undefined, {})).toBe('es');
  });

  it("falls back to the business's language when nothing else decides", () => {
    browserSpeaks('en-US');
    expect(resolveLocale(undefined, { defaultLocale: 'en' })).toBe('en');
  });

  it('follows the browser only when the business offers several languages', () => {
    browserSpeaks('en-GB', 'en');
    expect(
      resolveLocale(undefined, { defaultLocale: 'es', browserLocales: ['es', 'en'] }),
    ).toBe('en');
  });

  it("uses the business's language when the browser speaks none it offers", () => {
    browserSpeaks('fr-FR', 'de');
    expect(
      resolveLocale(undefined, { defaultLocale: 'es', browserLocales: ['es', 'en'] }),
    ).toBe('es');
  });

  it("walks the browser's preference list, not just its first entry", () => {
    browserSpeaks('fr-FR', 'es-CL');
    expect(
      resolveLocale(undefined, { defaultLocale: 'en', browserLocales: ['en', 'es'] }),
    ).toBe('es');
  });

  it('an explicit locale in the snippet always wins', () => {
    browserSpeaks('es-CL');
    expect(
      resolveConfig(
        { publicKey: PK, apiBaseUrl: BASE, locale: 'en' },
        { locale: 'es', defaultLocale: 'es' },
      ).locale,
    ).toBe('en');
    expect(
      resolveLocale('es', { defaultLocale: 'en', browserLocales: ['en', 'es'] }),
    ).toBe('es');
  });
});

describe('coerceRemoteConfig — language fields', () => {
  it('keeps defaultLocale and a real choice of browser languages', () => {
    expect(
      coerceRemoteConfig({ defaultLocale: 'es', browserLocales: ['es', 'en'] }),
    ).toEqual({ defaultLocale: 'es', browserLocales: ['es', 'en'] });
  });

  it('drops languages the widget does not ship, and a list that leaves no choice', () => {
    expect(
      coerceRemoteConfig({ defaultLocale: 'pt', browserLocales: ['es', 'pt', 'es'] }),
    ).toEqual({});
    expect(coerceRemoteConfig({ browserLocales: 'en' })).toEqual({});
  });
});
