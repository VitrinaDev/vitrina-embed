// launcherStyle: 'bubble' (0.17.5): the collapsed desktop launcher is a round
// portrait; 'tab' stays the default so other installs keep their look.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';
import { resolveSidebar } from '../src/sidebar-config';
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

const cfg = (extra: Partial<WidgetConfig> = {}): WidgetConfig => ({
  publicKey: 'pk_test_launcher',
  apiBaseUrl: BASE,
  remoteConfig: false,
  layout: 'sidebar',
  agent: { name: 'Tomás', label: 'Asistente IA de Vitrina', status: 'Responde al instante' },
  autoOpen: { enabled: false },
  ...extra,
});
const shadow = (): ShadowRoot => document.querySelector('[data-vitrina-widget]')!.shadowRoot!;
const $ = <T extends Element = HTMLElement>(sel: string): T | null => shadow().querySelector<T>(sel);

describe('launcherStyle config', () => {
  it('defaults to tab and only accepts bubble', () => {
    expect(resolveSidebar({}, null).launcherStyle).toBe('tab');
    expect(resolveSidebar({ launcherStyle: 'bubble' }, null).launcherStyle).toBe('bubble');
    expect(resolveSidebar({ launcherStyle: 'nope' as never }, null).launcherStyle).toBe('tab');
  });
});

describe('launcher DOM', () => {
  it('keeps the side tab with its vertical label by default', () => {
    instance = init(cfg());
    expect($('.vtr-launcher.vtr-sb-tab')).not.toBeNull();
    expect($('.vtr-sbtab-label')?.textContent).toBe('Pregúntale a Tomás');
    expect($('.vtr-sb-bubble')).toBeNull();
    expect($('.vtr-root')!.hasAttribute('data-launcher')).toBe(false);
  });

  it('bubble: portrait, online dot, IA badge, no visible label, tooltip + aria-label', () => {
    instance = init(cfg({ launcherStyle: 'bubble' }));
    const l = $<HTMLButtonElement>('.vtr-launcher.vtr-sb-bubble')!;
    expect(l).not.toBeNull();
    expect(l.querySelector('.vtr-pt')).not.toBeNull();
    expect(l.querySelector('.vtr-pt-on')).not.toBeNull();
    expect(l.querySelector('.vtr-pt-ia')?.textContent).toBe('IA');
    expect(l.querySelector('.vtr-sbtab-label')).toBeNull();
    expect(l.querySelector('.vtr-sbtab-tip')?.textContent).toBe('Pregúntale a Tomás');
    expect(l.getAttribute('aria-label')).toContain('Asistente IA de Vitrina');
    expect($('.vtr-root')!.getAttribute('data-launcher')).toBe('bubble');
    // Real button: keyboard-operable by default, opens the panel.
    expect(l.tagName).toBe('BUTTON');
    l.click();
    expect(instance && $('.vtr-panel')!.hasAttribute('hidden')).toBe(false);
  });

  it('hide() and show() still take the bubble off and back', () => {
    instance = init(cfg({ launcherStyle: 'bubble' }));
    const host = document.querySelector<HTMLElement>('[data-vitrina-widget]')!;
    instance.hide();
    expect(host.style.getPropertyValue('display')).toBe('none');
    instance.show();
    expect(host.style.getPropertyValue('display')).toBe('block');
    expect($<HTMLElement>('.vtr-launcher')!.hidden).toBe(false);
  });
});

describe('bubble stylesheet', () => {
  it('respects reduced motion and avoids a vertical text tab', () => {
    instance = init(cfg({ launcherStyle: 'bubble' }));
    const css = Array.from(shadow().querySelectorAll('style')).map((s) => s.textContent).join('\n');
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*vtr-sb-bubble/);
    expect(css).toContain('.vtr-sb-bubble:focus-visible');
  });
});
