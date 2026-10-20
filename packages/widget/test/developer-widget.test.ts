// 0.24.0: the inmobiliaria's Home prompts, the photo gate, the document card
// and the developer item card (subtitle, grid facts, buttons).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig, resolveHomePrompts } from '../src/config';
import { init } from '../src/index';
import { coerceRemoteConfig } from '../src/remote-config';

const BASE = 'https://api.example.com/api/v1';

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}

let history: unknown[] = [];

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  history = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: RequestInit) => {
      const u = String(url);
      if (u.includes('/widget/config')) return Promise.resolve(jsonRes(200, { home: { enabled: true } }));
      if (u.includes('/widget/conversations')) {
        return Promise.resolve(jsonRes(200, { visitorToken: 'vt', conversationExternalId: 'web:a', expiresAt: 'x' }));
      }
      if (u.includes('/widget/messages') && (opts?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonRes(200, { messages: history, conversation: { externalId: 'web:a' } }));
      }
      return Promise.resolve(jsonRes(202, { status: 'accepted', visitorToken: 'vt', conversationExternalId: 'web:a' }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const shadow = (): ShadowRoot =>
  [...document.querySelectorAll('*')].find((e) => e.shadowRoot)!.shadowRoot as ShadowRoot;

async function openChat(): Promise<ReturnType<typeof init>> {
  const w = init({ publicKey: 'pk_test_dev', apiBaseUrl: BASE });
  w.open();
  await new Promise((r) => setTimeout(r, 30));
  (shadow().querySelector('[data-tab="messages"]') as HTMLElement | null)?.click();
  await new Promise((r) => setTimeout(r, 30));
  return w;
}

describe('developer Home prompts and photo gate', () => {
  it('keeps the three developer prompt ids', () => {
    expect(resolveHomePrompts(['projects', 'showroom_visit', 'after_sales', 'nope'])).toEqual([
      'projects',
      'showroom_visit',
      'after_sales',
    ]);
  });

  it('photoUploadEnabled is an explicit true only', () => {
    expect(coerceRemoteConfig({ photoUploadEnabled: true })?.photoUploadEnabled).toBe(true);
    expect(coerceRemoteConfig({ photoUploadEnabled: 'true' })?.photoUploadEnabled).toBeUndefined();
    const base = { publicKey: 'pk_x', apiBaseUrl: BASE };
    expect(resolveConfig(base, { photoUploadEnabled: true }).photoUploadEnabled).toBe(true);
    expect(resolveConfig(base, null).photoUploadEnabled).toBe(false);
  });
});

describe('document card and developer item card', () => {
  it('renders a file row as a card with name, size and the link', async () => {
    history = [
      {
        id: '1',
        createdAt: '2026-10-20T10:00:00.000Z',
        content: 'Aquí está el brochure.',
        direction: 'outbound',
        type: 'file',
        files: [
          { url: 'https://cdn.example.com/b.pdf', filename: 'Brochure Los Cerezos.pdf', mimeType: 'application/pdf', size: 2516582 },
        ],
      },
    ];
    const w = await openChat();
    const file = shadow().querySelector('.vtr-file') as HTMLAnchorElement;
    expect(file.href).toBe('https://cdn.example.com/b.pdf');
    expect(file.querySelector('.vtr-file-name')!.textContent).toBe('Brochure Los Cerezos.pdf');
    expect(file.querySelector('.vtr-file-meta')!.textContent).toMatch(/^PDF · 2[,.]4 MB$/);
    expect(shadow().querySelector('.vtr-media')).toBeNull();
    w.destroy();
  });

  it('treats a document URL in mediaUrls as a file, not an image', async () => {
    history = [
      {
        id: '1',
        createdAt: '2026-10-20T10:00:00.000Z',
        content: '',
        direction: 'outbound',
        type: 'file',
        mediaUrls: ['https://cdn.example.com/cotizacion.pdf'],
      },
    ];
    const w = await openChat();
    expect(shadow().querySelector('.vtr-file-name')!.textContent).toBe('cotizacion.pdf');
    expect(shadow().querySelector('img.vtr-media-img')).toBeNull();
    w.destroy();
  });

  it('renders subtitle, facts and the card buttons the server sent', async () => {
    history = [
      {
        id: '1',
        createdAt: '2026-10-20T10:00:00.000Z',
        content: 'Mira esta tipología.',
        direction: 'outbound',
        type: 'stock_card',
        itemCard: {
          kind: 'property',
          itemId: 'u1',
          title: 'Tipología C · 2D2B',
          subtitle: 'Los Cerezos · Ñuñoa',
          price: 'Desde UF 3.890',
          thumbnailUrl: null,
          listingUrl: null,
          facts: [{ label: 'Superficie útil', value: '48,4 m²' }],
          actions: [
            { label: 'Agendar visita', message: 'Quiero agendar una visita' },
            { label: 'Ver planta', url: 'https://cdn.example.com/planta.png' },
          ],
        },
      },
    ];
    const w = await openChat();
    const card = shadow().querySelector('.vtr-card')!;
    expect(card.querySelector('.vtr-card-sub')!.textContent).toBe('Los Cerezos · Ñuñoa');
    expect([...card.querySelectorAll('.vtr-card-btn')].map((b) => b.textContent)).toEqual([
      'Agendar visita',
      'Ver planta',
    ]);
    expect((card.querySelector('a.vtr-card-btn') as HTMLAnchorElement).href).toBe('https://cdn.example.com/planta.png');
    expect((card.querySelector('button.vtr-card-btn') as HTMLElement).dataset.cardMessage).toBe('Quiero agendar una visita');
    w.destroy();
  });
});
