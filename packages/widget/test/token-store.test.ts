import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTokenStore } from '../src/token-store';

afterEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createTokenStore', () => {
  it('round-trips a token through localStorage', () => {
    const store = createTokenStore('pk_abc');
    expect(store.get()).toBeNull();
    store.set('vt_1');
    expect(store.get()).toBe('vt_1');
    // Verify it actually landed under a namespaced key.
    expect(globalThis.localStorage.getItem('vtr:widget:pk_abc:visitorToken')).toBe('vt_1');
    store.clear();
    expect(store.get()).toBeNull();
  });

  it('isolates tokens by publicKey namespace', () => {
    const a = createTokenStore('pk_a');
    const b = createTokenStore('pk_b');
    a.set('vt_a');
    b.set('vt_b');
    expect(a.get()).toBe('vt_a');
    expect(b.get()).toBe('vt_b');
    a.clear();
    expect(a.get()).toBeNull();
    expect(b.get()).toBe('vt_b');
  });

  it('degrades to in-memory (never throws) when localStorage is unavailable', () => {
    // A localStorage whose probe write throws — the store must fall back.
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      clear: () => {},
      key: () => null,
      length: 0,
    };
    vi.stubGlobal('localStorage', throwing);
    const store = createTokenStore('pk_x');
    expect(() => store.set('vt_mem')).not.toThrow();
    expect(store.get()).toBe('vt_mem');
    expect(() => store.clear()).not.toThrow();
    expect(store.get()).toBeNull();
  });
});
