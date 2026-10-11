import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'https://api.example.com/api/v1';
const PK = 'pk_test_123';

function stubResponse(): Response {
  return { ok: true, status: 200, json: async () => ({ data: {} }) } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(stubResponse())));
  delete (window as { vitrinaChat?: unknown }).vitrinaChat;
  delete (window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance;
});

afterEach(() => {
  try {
    (window as { vitrinaChatInstance?: { destroy(): void } }).vitrinaChatInstance?.destroy();
  } catch {
    /* ignore */
  }
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loader (<script> entry)', () => {
  it('auto-inits from window.vitrinaChat and stashes the handle', async () => {
    (window as { vitrinaChat?: unknown }).vitrinaChat = { publicKey: PK, apiBaseUrl: BASE };
    await import('../src/loader');

    const instance = (window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance;
    expect(instance).toBeDefined();
    expect(typeof (instance as { open: unknown }).open).toBe('function');
    // The launcher actually mounted.
    expect(document.querySelector('[data-vitrina-widget]')).not.toBeNull();
  });

  it('warns and does not throw when window.vitrinaChat is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(import('../src/loader')).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
    expect((window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance).toBeUndefined();
    expect(document.querySelector('[data-vitrina-widget]')).toBeNull();
  });

  it('warns on an incomplete config (missing apiBaseUrl)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as { vitrinaChat?: unknown }).vitrinaChat = { publicKey: PK };
    await import('../src/loader');
    expect(warn).toHaveBeenCalled();
    expect((window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance).toBeUndefined();
  });
});

describe('loader drains the boot stub queue (embed#25)', () => {
  it('replays queued calls in order and swaps in the live instance', async () => {
    const seen: string[] = [];
    (window as { vitrinaChat?: unknown }).vitrinaChat = { publicKey: PK, apiBaseUrl: BASE, remoteConfig: false };
    (window as { vitrinaChatQueue?: unknown }).vitrinaChatQueue = [
      ['on', ['open', (p: { source: string }) => seen.push(`open:${p.source}`)]],
      ['nope', []],
      ['open', []],
    ];
    await import('../src/loader');
    const w = window as { vitrinaChatApi?: unknown; vitrinaChatInstance?: unknown; vitrinaChatQueue?: unknown[] };
    expect(w.vitrinaChatApi).toBe(w.vitrinaChatInstance);
    expect(w.vitrinaChatQueue).toEqual([]);
    expect(seen).toEqual(['open:api']);
  });
});
