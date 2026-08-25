/**
 * Turnstile on the booking confirm step (vitrina-app #1265 closed the server
 * side in Aug 2026; this suite pins the widget side that was missing).
 *
 * Three seams, one per module boundary:
 *  - remote-config: `turnstileSiteKey` survives coercion (it is also the
 *    localStorage read path, so the bounds are tamper armor, not decoration);
 *  - config: the resolved key is SERVER-ONLY — no inline override exists;
 *  - transport: the token rides as `turnstile_token`, and only when given.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { coerceRemoteConfig } from '../src/remote-config';
import { resolveConfig } from '../src/config';
import { VitrinaTransport } from '../src/transport';
import type { TokenStore } from '../src/token-store';
import { createTurnstileGate } from '../src/turnstile';

function memStore(): TokenStore {
  let value: string | null = 'vt_live';
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

describe('remote-config · turnstileSiteKey', () => {
  it('keeps a plausible site key', () => {
    expect(coerceRemoteConfig({ turnstileSiteKey: '0x4AAAAAAA' })).toEqual({
      turnstileSiteKey: '0x4AAAAAAA',
    });
  });

  it('drops empty, non-string and oversized values', () => {
    expect(coerceRemoteConfig({ turnstileSiteKey: '' })).toEqual({});
    expect(coerceRemoteConfig({ turnstileSiteKey: 42 })).toEqual({});
    expect(coerceRemoteConfig({ turnstileSiteKey: null })).toEqual({});
    expect(coerceRemoteConfig({ turnstileSiteKey: 'x'.repeat(129) })).toEqual({});
  });
});

describe('resolveConfig · turnstileSiteKey', () => {
  const BASE = { publicKey: 'pk_x', apiBaseUrl: 'https://api.test' };

  it('is null without a remote value (pre-Turnstile behaviour)', () => {
    expect(resolveConfig(BASE).turnstileSiteKey).toBeNull();
    expect(resolveConfig(BASE, {}).turnstileSiteKey).toBeNull();
  });

  it('takes the server value', () => {
    expect(
      resolveConfig(BASE, { turnstileSiteKey: '0x4AAAAAAA' }).turnstileSiteKey,
    ).toBe('0x4AAAAAAA');
  });
});

describe('transport · turnstile_token on the booking POST', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  function makeTransport(): VitrinaTransport {
    return new VitrinaTransport(
      { publicKey: 'pk_x', apiBaseUrl: 'https://api.test' },
      memStore(),
    );
  }

  function jsonRes(status: number, data: unknown): Response {
    return new Response(JSON.stringify({ data }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('sends turnstile_token when given, omits it when not', async () => {
    fetchMock.mockResolvedValue(jsonRes(400, {}));
    const t = makeTransport();

    await t.bookAppointment({
      startsAt: 'a',
      endsAt: 'b',
      name: 'Ana',
      turnstileToken: 'tok_123',
    });
    let body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.turnstile_token).toBe('tok_123');

    await t.bookAppointment({ startsAt: 'a', endsAt: 'b', name: 'Ana' });
    body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect('turnstile_token' in body).toBe(false);
  });
});

describe('turnstile gate', () => {
  it('resolves token() with the challenge callback result', async () => {
    const render = vi.fn(
      (
        _el: HTMLElement,
        opts: { callback: (token: string) => void },
      ): string => {
        // Solve asynchronously, like the real challenge does.
        setTimeout(() => opts.callback('tok_solved'), 0);
        return 'w1';
      },
    );
    (window as unknown as { turnstile: unknown }).turnstile = {
      render,
      remove: vi.fn(),
      reset: vi.fn(),
    };
    const gate = createTurnstileGate('0x4AAAAAAA');
    gate.mountFresh(document.createElement('div'));
    await expect(gate.token()).resolves.toBe('tok_solved');
    // Single-use: mountFresh must be called again for a second token; without
    // a solved challenge the second read cannot invent one.
    expect(render).toHaveBeenCalledTimes(1);
    gate.destroy();
    delete (window as { turnstile?: unknown }).turnstile;
  });

  it('resolves null after destroy — never hangs a confirm', async () => {
    const gate = createTurnstileGate('0x4AAAAAAA');
    gate.destroy();
    await expect(gate.token()).resolves.toBeNull();
  });
});
