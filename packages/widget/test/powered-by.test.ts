// «Con tecnología de Vitrina» credit in the panel footer (0.19.0): a followed
// backlink, on by default, removed by `showPoweredBy: false`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import type { WidgetConfig, WidgetInstance } from '../src/types';

const BASE = 'https://api.example.com/api/v1';
let instance: WidgetInstance | null;

beforeEach(() => {
  instance = null;
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  instance?.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function start(extra: Partial<WidgetConfig> = {}): ShadowRoot {
  instance = init({ publicKey: 'pk_test_pb', apiBaseUrl: BASE, remoteConfig: false, ...extra } as WidgetConfig);
  return document.querySelector('[data-vitrina-widget]')!.shadowRoot!;
}

describe('powered-by credit', () => {
  it('is shown by default, in Spanish, with a followed, tagged link', () => {
    const sr = start();
    const credit = sr.querySelector('.vtr-credit') as HTMLElement;
    expect(credit.textContent).toBe('Con tecnología de Vitrina');
    const a = credit.querySelector('a') as HTMLAnchorElement;
    expect(a.textContent).toBe('Vitrina');
    expect(a.getAttribute('href')).toBe(
      'https://www.vitrinadev.com/?utm_source=widget&utm_medium=referral&utm_campaign=powered_by',
    );
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.getAttribute('rel')).not.toMatch(/nofollow/);
    expect((sr.querySelector('.vtr-footer') as HTMLElement).hidden).toBe(false);
  });

  it('showPoweredBy: false removes the credit and the empty footer', () => {
    const sr = start({ showPoweredBy: false });
    expect(sr.querySelector('.vtr-credit a')).toBeNull();
    expect(sr.querySelector('.vtr-credit')!.textContent).toBe('');
    expect((sr.querySelector('.vtr-footer') as HTMLElement).hidden).toBe(true);
  });

  it('follows the locale', () => {
    const sr = start({ locale: 'en' });
    expect(sr.querySelector('.vtr-credit')!.textContent).toBe('Powered by Vitrina');
    expect(sr.querySelector('.vtr-credit a')!.textContent).toBe('Vitrina');
  });

  it('keeps the AI disclaimer and the credit side by side in sidebar mode', () => {
    const sr = start({ layout: 'sidebar', agent: { name: 'Tomás', label: 'IA', status: 'ok' } });
    expect(sr.querySelector('.vtr-footer-note')!.textContent).toBe('Tomás es una IA y puede equivocarse');
    expect(sr.querySelector('.vtr-credit a')).not.toBeNull();
  });

  it('sidebar with the opt-out keeps only the disclaimer', () => {
    const sr = start({ layout: 'sidebar', showPoweredBy: false, agent: { name: 'Tomás', label: 'IA', status: 'ok' } });
    expect((sr.querySelector('.vtr-footer') as HTMLElement).hidden).toBe(false);
    expect(sr.querySelector('.vtr-credit a')).toBeNull();
  });
});
