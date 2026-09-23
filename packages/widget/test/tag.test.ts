import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ownScriptElement, resolveApiBase, resolveSiteId } from '../src/tag';

const PK = 'pk_test_123';

function appendScript(attrs: Record<string, string>): HTMLScriptElement {
  const el = document.createElement('script');
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.body.appendChild(el);
  return el;
}

function stubJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  document.querySelectorAll('script').forEach((n) => n.remove());
  delete (window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance;
  delete (window as { __vitrinaTagTrackerBooted?: unknown }).__vitrinaTagTrackerBooted;
  delete (window as { __vitrinaConsent?: unknown }).__vitrinaConsent;
  delete (window as { dataLayer?: unknown }).dataLayer;
});

afterEach(() => {
  try {
    (window as { vitrinaChatInstance?: { destroy(): void } }).vitrinaChatInstance?.destroy();
  } catch {
    /* ignore */
  }
  document.querySelectorAll('[data-vitrina-widget]').forEach((n) => n.remove());
  document.querySelectorAll('script').forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ownScriptElement / resolveSiteId / resolveApiBase (pure)', () => {
  it('prefers document.currentScript when it is a real HTMLScriptElement', () => {
    const el = appendScript({ src: 'https://cdn.example.com/tag.js', 'data-site': PK });
    const doc = { currentScript: el, getElementsByTagName: () => [] } as unknown as Document;
    expect(ownScriptElement(doc)).toBe(el);
  });

  it('falls back to scanning <script> tags whose src matches tag.js, taking the last one', () => {
    appendScript({ src: 'https://cdn.example.com/other.js' });
    const target = appendScript({ src: 'https://cdn.example.com/tag.js?site=pk_second' });
    const doc = { currentScript: null, getElementsByTagName: () => document.getElementsByTagName('script') } as unknown as Document;
    expect(ownScriptElement(doc)).toBe(target);
  });

  it('resolves the site id from data-site first', () => {
    const el = appendScript({ src: 'https://cdn.example.com/tag.js?site=pk_from_query', 'data-site': 'pk_from_attr' });
    expect(resolveSiteId(el)).toBe('pk_from_attr');
  });

  it('falls back to ?site= on the script src (the GTM path — no data-*)', () => {
    const el = appendScript({ src: 'https://cdn.example.com/tag.js?site=pk_from_query' });
    expect(resolveSiteId(el)).toBe('pk_from_query');
  });

  it('resolves null when neither is present', () => {
    const el = appendScript({ src: 'https://cdn.example.com/tag.js' });
    expect(resolveSiteId(el)).toBeNull();
    expect(resolveSiteId(null)).toBeNull();
  });

  it('resolves apiBase from data-api-base first', () => {
    const el = appendScript({
      src: 'https://cdn.example.com/tag.js?api=https://query.example.com/api/v1',
      'data-api-base': 'https://attr.example.com/api/v1/',
    });
    expect(resolveApiBase(el)).toBe('https://attr.example.com/api/v1');
  });

  it('falls back to ?api= on the script src', () => {
    const el = appendScript({ src: 'https://cdn.example.com/tag.js?api=https://query.example.com/api/v1/' });
    expect(resolveApiBase(el)).toBe('https://query.example.com/api/v1');
  });

  it('defaults apiBase to the script origin + /api/v1', () => {
    const el = appendScript({ src: 'https://api.vitrinadev.com/tag.js?site=pk_x' });
    expect(resolveApiBase(el)).toBe('https://api.vitrinadev.com/api/v1');
  });
});

describe('tag.ts (combined <script> entry)', () => {
  it('boots the assistant and defers the tracker until consent (no signal = never)', async () => {
    appendScript({ src: 'https://api.example.com/tag.js?site=' + PK });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          stubJsonResponse({
            data: {
              assistant: { publicKey: PK, apiBaseUrl: 'https://api.example.com/api/v1' },
              tracking: { key: 'trk_live_x', tracker_src: 'https://track.atribu.app/t.js?k=trk_live_x' },
            },
          }),
        ),
      ),
    );

    await import('../src/tag');
    // autoInit is async (awaits fetch) — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect((window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance).toBeDefined();
    expect(document.querySelector('[data-vitrina-widget]')).not.toBeNull();
    // No consent signal at all -> the tracker must NOT have been injected.
    expect(document.querySelector('script[data-vitrina-tracker-key]')).toBeNull();
  });

  it('injects the tracker immediately when consent is already granted', async () => {
    appendScript({ src: 'https://api.example.com/tag.js?site=' + PK });
    (window as { __vitrinaConsent?: unknown }).__vitrinaConsent = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          stubJsonResponse({
            data: {
              assistant: { publicKey: PK, apiBaseUrl: 'https://api.example.com/api/v1' },
              tracking: { key: 'trk_live_x', tracker_src: 'https://track.atribu.app/t.js?k=trk_live_x' },
            },
          }),
        ),
      ),
    );

    await import('../src/tag');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const trackerEl = document.querySelector('script[data-vitrina-tracker-key]');
    expect(trackerEl).not.toBeNull();
    expect(trackerEl?.getAttribute('src')).toBe('https://track.atribu.app/t.js?k=trk_live_x');
  });

  it('boots the assistant even when tracking is null (no Ads entitlement)', async () => {
    appendScript({ src: 'https://api.example.com/tag.js?site=' + PK });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          stubJsonResponse({
            data: {
              assistant: { publicKey: PK, apiBaseUrl: 'https://api.example.com/api/v1' },
              tracking: null,
            },
          }),
        ),
      ),
    );

    await import('../src/tag');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect((window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance).toBeDefined();
    expect(document.querySelector('script[data-vitrina-tracker-key]')).toBeNull();
  });

  it('warns and boots nothing when the site id cannot be resolved', async () => {
    appendScript({ src: 'https://api.example.com/tag.js' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await import('../src/tag');
    await Promise.resolve();

    expect(warn).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance).toBeUndefined();
  });

  it('warns and boots nothing when the fetch itself fails', async () => {
    appendScript({ src: 'https://api.example.com/tag.js?site=' + PK });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );

    await import('../src/tag');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalled();
    expect((window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance).toBeUndefined();
  });

  it('warns and boots nothing when tag-config answers a non-2xx', async () => {
    appendScript({ src: 'https://api.example.com/tag.js?site=' + PK });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(stubJsonResponse({}, false, 404))),
    );

    await import('../src/tag');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalled();
    expect((window as { vitrinaChatInstance?: unknown }).vitrinaChatInstance).toBeUndefined();
  });
});
