import { describe, expect, it } from 'vitest';

import { coerceRemoteConfig } from '../src/remote-config';
import {
  normalizeWhatsAppNumber,
  resolveAgent,
  resolveAutoOpen,
  resolveChips,
  resolvePageContext,
  resolveSidebar,
} from '../src/sidebar-config';

describe('resolveSidebar defaults (backwards compatible)', () => {
  it('an install that says nothing keeps the bubble widget with nothing proactive', () => {
    const s = resolveSidebar({}, null);
    expect(s.layout).toBe('bubble');
    expect(s.preset).toBe('default');
    expect(s.anchor).toBe('auto');
    expect(s.agent).toBeNull();
    expect(s.autoOpen.enabled).toBe(false);
    expect(s.chips).toEqual([]);
    expect(s.whatsapp).toBeNull();
    expect(s.pageContext).toEqual({});
    expect(s.ctaLabel).toBeNull();
    expect(s.ctaTarget).toBe('auto');
  });

  it('unknown layout / preset values collapse to the defaults', () => {
    const s = resolveSidebar({ layout: 'drawer' as never, preset: 'neon' as never }, null);
    expect(s.layout).toBe('bubble');
    expect(s.preset).toBe('default');
  });
});

describe('inline over remote', () => {
  it('inline wins per field; agent and autoOpen merge field-wise; chips replace wholesale', () => {
    const s = resolveSidebar(
      {
        layout: 'sidebar',
        agent: { name: 'Tomás' },
        autoOpen: { delaySeconds: 25 },
        chips: [{ label: 'Hola' }],
      },
      {
        layout: 'bubble',
        preset: 'cream',
        agent: { name: 'Otro', label: 'Asistente IA de Vitrina' },
        autoOpen: { enabled: true, delaySeconds: 10, desktop: 'teaser' },
        chips: [{ label: 'A' }, { label: 'B' }],
      },
    );
    expect(s.layout).toBe('sidebar');
    expect(s.preset).toBe('cream');
    expect(s.agent).toEqual({
      name: 'Tomás',
      label: 'Asistente IA de Vitrina',
      status: null,
      avatarUrl: null,
    });
    expect(s.autoOpen).toMatchObject({ enabled: true, delayMs: 25_000, desktop: 'teaser' });
    expect(s.chips.map((c) => c.label)).toEqual(['Hola']);
  });
});

describe('agent disclosure', () => {
  it('never resolves a portrait without its AI label', () => {
    expect(resolveAgent({ name: 'Tomás', avatarUrl: 'https://x.test/t.png' })).toBeNull();
    expect(resolveAgent({ label: 'Asistente IA de Vitrina' })).toBeNull();
  });

  it('rejects non-http avatar URLs but keeps the agent', () => {
    const a = resolveAgent({ name: 'Tomás', label: 'Asistente IA', avatarUrl: 'javascript:alert(1)' });
    expect(a?.avatarUrl).toBeNull();
    expect(a?.name).toBe('Tomás');
  });
});

describe('resolveAutoOpen', () => {
  it('defaults to 10 s, panel on desktop, teaser on mobile, off unless enabled', () => {
    expect(resolveAutoOpen(undefined)).toEqual({
      enabled: false,
      delayMs: 10_000,
      mobileDelayMs: 10_000,
      desktop: 'panel',
      mobile: 'teaser',
      excludePaths: [],
      variant: null,
      requireScroll: null,
    });
  });

  it('a phone never gets the full panel on its own (D15)', () => {
    expect(resolveAutoOpen({ mobile: 'panel' as never }).mobile).toBe('teaser');
    expect(resolveAutoOpen({ mobile: 'off' }).mobile).toBe('off');
  });

  it('clamps delays and keeps a separate mobile delay', () => {
    const a = resolveAutoOpen({ delaySeconds: 0, mobileDelaySeconds: 9999 });
    expect(a.delayMs).toBe(1_000);
    expect(a.mobileDelayMs).toBe(600_000);
    expect(resolveAutoOpen({ delaySeconds: 15 }).mobileDelayMs).toBe(15_000);
  });

  it('keeps only well-formed exclude patterns', () => {
    const a = resolveAutoOpen({ excludePaths: ['/agendar', '/agendar/*', 'nope', '/a b', 5 as never] });
    expect(a.excludePaths).toEqual(['/agendar', '/agendar/*']);
  });
});

describe('resolveChips', () => {
  it('drops malformed chips one by one and caps at 4', () => {
    const chips = resolveChips([
      { label: '¿Cuánto cuesta?' },
      { label: '' },
      null,
      { label: 'Pruébalo', action: 'demo', message: 'Quiero probar' },
      { label: 'Agendar', action: 'booking' },
      { label: 'x', action: 'weird' },
      { label: 'quinto' },
    ]);
    expect(chips).toEqual([
      { label: '¿Cuánto cuesta?', message: '¿Cuánto cuesta?', action: 'message' },
      { label: 'Pruébalo', message: 'Quiero probar', action: 'demo' },
      { label: 'Agendar', message: 'Agendar', action: 'booking' },
      { label: 'x', message: 'x', action: 'message' },
    ]);
  });
});

describe('WhatsApp + page context', () => {
  it('normalises numbers to wa.me digits', () => {
    expect(normalizeWhatsAppNumber('+56 9 1234 5678')).toBe('56912345678');
    expect(normalizeWhatsAppNumber('abc')).toBeNull();
    expect(normalizeWhatsAppNumber('123')).toBeNull();
  });

  it('page context keeps only snake_case keys with short string values', () => {
    expect(
      resolvePageContext({ page_id: 'automotoras', Bad: 'x', vertical: 'automotriz', n: 3, long: 'x'.repeat(81) }),
    ).toEqual({ page_id: 'automotoras', vertical: 'automotriz' });
  });
});

describe('remote coercion (also the localStorage read path)', () => {
  it('passes the sanitized sidebar fields and drops garbage', () => {
    const out = coerceRemoteConfig({
      layout: 'sidebar',
      preset: 'cream',
      agent: { name: 'Tomás', label: 'Asistente IA de Vitrina', avatarUrl: 'data:x' },
      autoOpen: { enabled: true, delaySeconds: 10, desktop: 'panel', mobile: 'panel', excludePaths: ['/agendar/*'] },
      chips: [{ label: 'Hola' }, { nope: 1 }],
      whatsapp: { number: '+56 9 1234 5678' },
      evil: '<script>',
    });
    expect(out).toMatchObject({
      layout: 'sidebar',
      preset: 'cream',
      agent: { name: 'Tomás', label: 'Asistente IA de Vitrina' },
      autoOpen: { enabled: true, delaySeconds: 10, desktop: 'panel', excludePaths: ['/agendar/*'] },
      chips: [{ label: 'Hola', message: 'Hola', action: 'message' }],
      whatsapp: { number: '56912345678' },
    });
    expect(out?.agent?.avatarUrl).toBeUndefined();
    // 'panel' is not a mobile value, so the key is simply absent.
    expect(out?.autoOpen?.mobile).toBeUndefined();
    expect((out as Record<string, unknown>).evil).toBeUndefined();
  });

  it('a config with no sidebar fields gains no keys', () => {
    expect(coerceRemoteConfig({ welcomeMessage: 'hola' })).toEqual({ welcomeMessage: 'hola' });
  });
});
