// X8 — a closed panel badges its unread replies.
//
// Nothing new is fetched here. The realtime poke already arrives whether or not
// the panel is open, and the widget already refetches on it. It simply did not
// count. A visitor could browse the dealership's inventory with the panel shut
// and never learn that an answer was waiting.
//
// Explicitly NOT built: sound, browser notifications, favicon dots, title
// flashing. A count is a signal; the rest is an interruption.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { init } from '../src/index';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

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

function controllableStream(signal?: AbortSignal): { res: Response; emit: (frame: string) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(new TextEncoder().encode(': connected\n\n'));
      signal?.addEventListener('abort', () => {
        try {
          const err = new Error('aborted');
          err.name = 'AbortError';
          controller.error(err);
        } catch {
          /* closed */
        }
      });
    },
  });
  return {
    res: { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response,
    emit: (frame) => {
      try {
        controller.enqueue(new TextEncoder().encode(frame));
      } catch {
        /* closed */
      }
    },
  };
}

interface Row {
  id: string;
  createdAt: string;
  content: string;
  direction: 'inbound' | 'outbound';
  type: string | null;
  clientMessageId?: string;
}

let history: Row[];
let emitSse: ((frame: string) => void) | null;
let seq: number;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  history = [];
  emitSse = null;
  seq = 0;

  fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    if (u.includes('/widget/conversations')) {
      return Promise.resolve(
        jsonRes(200, { visitorToken: 'vt_srv', conversationExternalId: 'web:a', expiresAt: 'x' }),
      );
    }
    if (u.includes('/widget/messages') && method === 'POST') {
      const body = JSON.parse(opts?.body as string) as { message: string; client_message_id?: string };
      seq += 1;
      history.push({
        id: `in_${seq}`,
        createdAt: new Date(2026, 6, 1, 0, 0, seq).toISOString(),
        content: body.message,
        direction: 'inbound',
        type: 'text',
        ...(body.client_message_id ? { clientMessageId: body.client_message_id } : {}),
      });
      return Promise.resolve(
        jsonRes(202, { status: 'accepted', visitorToken: 'vt_srv', conversationExternalId: 'web:a' }),
      );
    }
    if (u.includes('/widget/messages')) {
      return Promise.resolve(
        jsonRes(200, { messages: history, conversation: history.length ? { externalId: 'web:a' } : null }),
      );
    }
    if (u.includes('/widget/stream')) {
      const { res, emit } = controllableStream(opts?.signal ?? undefined);
      emitSse = emit;
      return Promise.resolve(res);
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

const shadowOf = (): ShadowRoot => {
  const host = document.querySelector('[data-vitrina-widget]') as HTMLElement;
  return host.shadowRoot!;
};
const badgeOf = (): HTMLElement => shadowOf().querySelector('.vtr-badge') as HTMLElement;
const launcherOf = (): HTMLElement => shadowOf().querySelector('.vtr-launcher') as HTMLElement;

/** Push a dealer reply into history and poke the visitor, as the server would. */
function dealerReplies(content: string): void {
  seq += 1;
  const at = new Date(2026, 6, 2, 0, 0, seq).toISOString();
  history.push({ id: `out_${seq}`, createdAt: at, content, direction: 'outbound', type: 'text' });
  emitSse!(`event: message.created\nid: ${at}\ndata: {}\n\n`);
}

describe('X8: a closed panel badges its unread replies', () => {
  it('counts outbound replies that arrive while the panel is closed', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open(); // opens the session + stream
    await vi.waitFor(() => expect(emitSse).toBeTruthy());
    expect(badgeOf().hidden).toBe(true);

    w.close();
    dealerReplies('sí, disponible');
    await vi.waitFor(() => {
      expect(badgeOf().hidden).toBe(false);
      expect(badgeOf().textContent).toBe('1');
    });

    dealerReplies('¿cuándo lo quieres ver?');
    await vi.waitFor(() => expect(badgeOf().textContent).toBe('2'));

    w.destroy();
  });

  it('opening the panel clears the count', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    w.close();
    dealerReplies('hola');
    await vi.waitFor(() => expect(badgeOf().textContent).toBe('1'));

    w.open();
    expect(badgeOf().hidden).toBe(true);
    expect(badgeOf().textContent).toBe('');

    w.destroy();
  });

  it('does NOT count while the panel is open', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    dealerReplies('estoy aquí');
    await vi.waitFor(() => {
      expect(shadowOf().querySelectorAll('.vtr-msg[data-dir="outbound"][data-id^="out_"]').length).toBe(1);
    });
    expect(badgeOf().hidden).toBe(true);

    w.destroy();
  });

  it('the visitor’s OWN messages never increment it', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    // Send, then close, then let a refetch bring our own inbound row back.
    const input = shadowOf().querySelector('.vtr-input') as HTMLTextAreaElement;
    const form = shadowOf().querySelector('.vtr-composer') as HTMLFormElement;
    input.value = 'hola';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() => expect(history.some((r) => r.direction === 'inbound')).toBe(true));

    w.close();
    // A poke with only the visitor's own row in history.
    emitSse!('event: message.created\nid: 2026-07-02T00:00:00.000Z\ndata: {}\n\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(badgeOf().hidden).toBe(true);

    w.destroy();
  });

  it('a re-delivered row (the INCLUSIVE since boundary) does not double-count', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    w.close();
    dealerReplies('uno');
    await vi.waitFor(() => expect(badgeOf().textContent).toBe('1'));

    // Poke again with no new rows: the same row comes back on the boundary.
    emitSse!('event: message.created\nid: 2026-07-02T00:00:09.000Z\ndata: {}\n\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(badgeOf().textContent).toBe('1');

    w.destroy();
  });

  it('announces the count to a screen reader through the launcher, not the badge', async () => {
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.waitFor(() => expect(emitSse).toBeTruthy());

    w.close();
    dealerReplies('hola');
    await vi.waitFor(() => expect(badgeOf().textContent).toBe('1'));

    // The badge glyph itself is hidden from assistive tech; the launcher says it.
    expect(badgeOf().getAttribute('aria-hidden')).toBe('true');
    expect(launcherOf().getAttribute('aria-label')).toBe('Abrir chat — 1 mensajes sin leer');

    w.open();
    expect(launcherOf().getAttribute('aria-label')).toBe('Abrir chat');

    w.destroy();
  });

  it('introduces no sound, notification, favicon or title manipulation', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const code = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\bnew Audio\b|\bAudioContext\b|\bNotification\b|document\s*\.\s*title\s*=|rel=["']icon/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
