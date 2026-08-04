// Attachment photos in the transcript — the images an agent sent with
// send_attachment, projected by the server as `mediaUrls` on a media row.
//
// Photos ride ABOVE the caption inside the same bubble (WhatsApp reading
// order), each linking out to its original. The image ENHANCES the caption;
// a row whose every URL fails validation is simply its caption — never a
// blank bubble, never a broken <img>, and never a javascript:/data: URI in
// the DOM of an anonymous third-party page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

interface Row {
  id: string;
  createdAt: string;
  content: string;
  direction: 'inbound' | 'outbound';
  type: string | null;
  mediaUrls?: string[];
}

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
}
function emptyRes(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('no body');
    },
  } as unknown as Response;
}

let history: Row[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  history = [];
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(
        jsonRes(200, { messages: history, conversation: history.length ? { externalId: 'web:a' } : null }),
      );
    }
    if (u.includes('/widget/stream')) {
      return Promise.resolve(emptyRes(200));
    }
    return Promise.resolve(emptyRes(404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
});

const shadowOf = (): ShadowRoot =>
  (document.querySelector('[data-vitrina-widget]') as HTMLElement).shadowRoot!;

const mediaRow = (mediaUrls: string[], content = 'Jeep Wrangler 2020'): Row[] => [
  {
    id: 'srv_media',
    createdAt: '2026-08-04T00:00:00.000Z',
    content,
    direction: 'outbound',
    type: 'image',
    mediaUrls,
  },
];

describe('mediaUrls: attachment photos in the transcript', () => {
  it('renders each image above the caption, linked to its original', async () => {
    history = mediaRow([
      'https://pictures.veekls.com/abc',
      'https://pictures.veekls.com/def',
    ]);
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();

    await vi.waitFor(() => {
      expect(shadowOf().querySelector('.vtr-media')).toBeTruthy();
    });
    const bubble = shadowOf().querySelector('.vtr-msg[data-id="srv_media"]') as HTMLElement;
    // The caption is still there — the photos did not replace the message.
    expect(bubble.textContent).toContain('Jeep Wrangler 2020');
    // Photos come FIRST (reading order: image, then its caption).
    expect((bubble.firstElementChild as HTMLElement).classList.contains('vtr-media')).toBe(true);

    const imgs = [...bubble.querySelectorAll('.vtr-media-img')] as HTMLImageElement[];
    expect(imgs.map((i) => i.src)).toEqual([
      'https://pictures.veekls.com/abc',
      'https://pictures.veekls.com/def',
    ]);
    const link = imgs[0].closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');

    w.destroy();
  });

  it('skips non-http(s) URLs; a row with none left is just its caption', async () => {
    history = mediaRow([['javascript', 'alert(1)'].join(':'), 'data:text/html,x']);
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();

    await vi.waitFor(() => {
      expect(shadowOf().querySelector('.vtr-msg[data-id="srv_media"]')).toBeTruthy();
    });
    const bubble = shadowOf().querySelector('.vtr-msg[data-id="srv_media"]') as HTMLElement;
    expect(bubble.querySelector('.vtr-media')).toBeNull();
    expect(bubble.querySelector('img')).toBeNull();
    expect(bubble.textContent).toContain('Jeep Wrangler 2020');

    w.destroy();
  });

  it('a plain text row renders exactly as before — no media wrapper at all', async () => {
    history = [
      {
        id: 'srv_text',
        createdAt: '2026-08-04T00:00:00.000Z',
        content: 'hola',
        direction: 'outbound',
        type: 'text',
      },
    ];
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();

    await vi.waitFor(() => {
      expect(shadowOf().querySelector('.vtr-msg[data-id="srv_text"]')).toBeTruthy();
    });
    expect(shadowOf().querySelector('.vtr-media')).toBeNull();

    w.destroy();
  });
});
