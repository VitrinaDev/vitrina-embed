// X3 — the visitor sees that a reply is being composed.
//
// One event, two producers (the AI's turn, and a salesperson's keystrokes), and
// the visitor cannot tell which. Deliberately: a dealership answering a buyer
// presents one voice, and un-leaking an operator's name after it has been
// broadcast to every browser on a dealer's site is not a change one can make.
//
// The indicator clears on whichever comes first — a message arriving, or the
// event's TTL elapsing — so a producer that crashes mid-turn cannot leave a
// permanent lie on the visitor's screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VitrinaTransport } from '../src/transport';
import type { TokenStore } from '../src/token-store';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

function memStore(initial: string | null = 'vt_1'): TokenStore {
  let value = initial;
  return {
    get: () => value,
    set: (t) => {
      value = t;
    },
    clear: () => {
      value = null;
    },
  };
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

function streamRes(chunks: string[], signal?: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
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
  return { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function openWith(frames: string[]) {
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (!String(url).includes('/widget/stream')) return Promise.resolve(emptyRes(404));
    return Promise.resolve(streamRes(frames, opts?.signal ?? undefined));
  });
  return new VitrinaTransport({ apiBaseUrl: BASE, publicKey: PK }, memStore());
}

describe('openStream surfaces agent.typing', () => {
  it('reports the TTL the server sent', async () => {
    const t = openWith([
      'event: agent.typing\ndata: {"type":"agent.typing","at":"2026-07-09T12:00:00.000Z","ttlMs":6000}\n\n',
    ]);
    const onTyping = vi.fn();
    const close = t.openStream({ onInvalidation: () => {}, onTyping });

    await vi.advanceTimersByTimeAsync(50);
    expect(onTyping).toHaveBeenCalledTimes(1);
    expect(onTyping).toHaveBeenCalledWith(6000);

    close();
  });

  it('a typing frame never triggers a refetch', async () => {
    const t = openWith(['event: agent.typing\ndata: {"ttlMs":6000}\n\n']);
    const onInvalidation = vi.fn();
    const close = t.openStream({ onInvalidation, onTyping: () => {} });

    await vi.advanceTimersByTimeAsync(50);
    expect(onInvalidation).not.toHaveBeenCalled();

    close();
  });

  it('degrades a missing, non-numeric, or absurd TTL to a sane default', async () => {
    const t = openWith([
      'event: agent.typing\ndata: {}\n\n',
      'event: agent.typing\ndata: {"ttlMs":"forever"}\n\n',
      'event: agent.typing\ndata: not-json\n\n',
      'event: agent.typing\ndata: {"ttlMs":-1}\n\n',
      // An hour would pin the indicator on screen; clamped.
      'event: agent.typing\ndata: {"ttlMs":3600000}\n\n',
    ]);
    const onTyping = vi.fn();
    const close = t.openStream({ onInvalidation: () => {}, onTyping });

    await vi.advanceTimersByTimeAsync(50);
    const ttls = onTyping.mock.calls.map(([ms]) => ms);
    expect(ttls).toHaveLength(5);
    for (const ms of ttls) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(30_000);
    }

    close();
  });

  it('a throwing onTyping never breaks the stream loop', async () => {
    const t = openWith([
      'event: agent.typing\ndata: {"ttlMs":6000}\n\n',
      'event: message.created\nid: 2026-07-09T12:00:01.000Z\ndata: {}\n\n',
    ]);
    const onInvalidation = vi.fn();
    const close = t.openStream({
      onInvalidation,
      onTyping: () => {
        throw new Error('UI exploded');
      },
    });

    await vi.advanceTimersByTimeAsync(50);
    // The message that followed the exploding callback still arrived.
    expect(onInvalidation).toHaveBeenCalledTimes(1);

    close();
  });

  it('a widget with NO onTyping handler ignores the event (old widget, new server)', async () => {
    const t = openWith([
      'event: agent.typing\ndata: {"ttlMs":6000}\n\n',
      'event: message.created\nid: 2026-07-09T12:00:01.000Z\ndata: {}\n\n',
    ]);
    const onInvalidation = vi.fn();
    const close = t.openStream({ onInvalidation });

    await expect(vi.advanceTimersByTimeAsync(50)).resolves.not.toThrow();
    expect(onInvalidation).toHaveBeenCalledTimes(1);

    close();
  });
});

// ---------------------------------------------------------------------------
// The indicator, end to end in the widget.
// ---------------------------------------------------------------------------
describe('the widget shows and clears the typing indicator', () => {
  interface Row {
    id: string;
    createdAt: string;
    content: string;
    direction: 'inbound' | 'outbound';
    type: string | null;
  }
  let history: Row[];
  let emitSse: ((frame: string) => void) | null;

  function jsonRes(status: number, data: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as unknown as Response;
  }

  function controllableStream(signal?: AbortSignal): { res: Response; emit: (f: string) => void } {
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
      emit: (f) => {
        try {
          controller.enqueue(new TextEncoder().encode(f));
        } catch {
          /* closed */
        }
      },
    };
  }

  beforeEach(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* ignore */
    }
    history = [];
    emitSse = null;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
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
        const { res, emit } = controllableStream(opts?.signal ?? undefined);
        emitSse = emit;
        return Promise.resolve(res);
      }
      return Promise.resolve(emptyRes(404));
    });
  });

  afterEach(() => {
    document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
  });

  const typingEl = (): HTMLElement => {
    const host = document.querySelector('[data-vitrina-widget]') as HTMLElement;
    return host.shadowRoot!.querySelector('.vtr-typing') as HTMLElement;
  };

  it('shows on the event and clears when the TTL elapses (a crashed producer cannot lie forever)', async () => {
    const { init } = await import('../src/index');
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.advanceTimersByTimeAsync(50);
    expect(typingEl().hidden).toBe(true);

    emitSse!('event: agent.typing\ndata: {"ttlMs":6000}\n\n');
    await vi.advanceTimersByTimeAsync(20);
    expect(typingEl().hidden).toBe(false);

    // No reply ever comes. The indicator gives up on its own.
    await vi.advanceTimersByTimeAsync(6000);
    expect(typingEl().hidden).toBe(true);

    w.destroy();
  });

  it('clears the moment a reply lands, without waiting for the TTL', async () => {
    const { init } = await import('../src/index');
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.advanceTimersByTimeAsync(50);

    emitSse!('event: agent.typing\ndata: {"ttlMs":30000}\n\n');
    await vi.advanceTimersByTimeAsync(20);
    expect(typingEl().hidden).toBe(false);

    history = [
      {
        id: 'srv_1',
        createdAt: '2026-07-01T00:00:00.000Z',
        content: 'sí, disponible',
        direction: 'outbound',
        type: 'text',
      },
    ];
    emitSse!('event: message.created\nid: 2026-07-01T00:00:00.000Z\ndata: {}\n\n');
    await vi.advanceTimersByTimeAsync(50);

    // The reply is on screen and the indicator is gone — 30s of TTL unspent.
    expect(typingEl().hidden).toBe(true);

    w.destroy();
  });

  it('names nobody: the indicator carries no author anywhere in the DOM', async () => {
    const { init } = await import('../src/index');
    const w = init({ publicKey: PK, apiBaseUrl: BASE, locale: 'es' });
    w.open();
    await vi.advanceTimersByTimeAsync(50);

    emitSse!('event: agent.typing\ndata: {"ttlMs":6000}\n\n');
    await vi.advanceTimersByTimeAsync(20);

    const el = typingEl();
    // Three dots. No text content, no name, no bot-vs-human tell.
    expect(el.textContent).toBe('');
    expect(el.querySelectorAll('.vtr-typing-dot')).toHaveLength(3);
    expect(el.getAttribute('aria-label')).toBe('Escribiendo una respuesta…');

    w.destroy();
  });

  it('a later event extends the indicator rather than stacking timers', async () => {
    const { init } = await import('../src/index');
    const w = init({ publicKey: PK, apiBaseUrl: BASE });
    w.open();
    await vi.advanceTimersByTimeAsync(50);

    emitSse!('event: agent.typing\ndata: {"ttlMs":6000}\n\n');
    await vi.advanceTimersByTimeAsync(5000);
    expect(typingEl().hidden).toBe(false);

    // A second keystroke ping, 5s in. The clock restarts.
    emitSse!('event: agent.typing\ndata: {"ttlMs":6000}\n\n');
    await vi.advanceTimersByTimeAsync(2000);
    // The FIRST event's TTL has now elapsed (7s); the indicator is still up.
    expect(typingEl().hidden).toBe(false);

    await vi.advanceTimersByTimeAsync(4100);
    expect(typingEl().hidden).toBe(true);

    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// X4 — the visitor is told once when a person joins.
// ---------------------------------------------------------------------------
describe('openStream surfaces conversation.handoff', () => {
  it('reports the direction, and nothing else', async () => {
    const t = openWith([
      'event: conversation.handoff\ndata: {"type":"conversation.handoff","at":"2026-07-09T12:00:00.000Z","to":"human"}\n\n',
    ]);
    const onHandoff = vi.fn();
    const close = t.openStream({ onInvalidation: () => {}, onHandoff });

    await vi.advanceTimersByTimeAsync(50);
    expect(onHandoff).toHaveBeenCalledTimes(1);
    expect(onHandoff).toHaveBeenCalledWith('human');

    close();
  });

  it('ignores a handoff with a missing or nonsense direction', async () => {
    const t = openWith([
      'event: conversation.handoff\ndata: {}\n\n',
      'event: conversation.handoff\ndata: {"to":"martian"}\n\n',
      'event: conversation.handoff\ndata: not-json\n\n',
    ]);
    const onHandoff = vi.fn();
    const close = t.openStream({ onInvalidation: () => {}, onHandoff });

    await vi.advanceTimersByTimeAsync(50);
    expect(onHandoff).not.toHaveBeenCalled();

    close();
  });

  it('a handoff never triggers a refetch and never moves the cursor', async () => {
    const t = openWith([
      'event: conversation.handoff\nid: 2030-01-01T00:00:00.000Z\ndata: {"to":"human"}\n\n',
    ]);
    const onInvalidation = vi.fn();
    const close = t.openStream({ onInvalidation, onHandoff: () => {} });

    await vi.advanceTimersByTimeAsync(50);
    expect(onInvalidation).not.toHaveBeenCalled();

    close();
  });
});
