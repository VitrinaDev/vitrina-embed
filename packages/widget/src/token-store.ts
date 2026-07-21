// localStorage-backed visitor-token persistence. The `vt_` token is a
// NON-SECRET visitor id (server-signed, origin+tenant-scoped) — safe to persist
// so a visitor resumes across reloads.
//
// Namespaced by publicKey so two widgets/keys on one origin never collide.
// Every storage access is wrapped: private-mode / disabled / quota-exceeded
// storage must degrade to an in-memory value, NEVER throw (AC#4).

import { safeLocalStorage, storageKey } from './storage';

const KEY_SUFFIX = ':visitorToken';

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

/**
 * Create a namespaced token store. Falls back to an in-memory slot if
 * localStorage is unavailable, so callers never branch on storage support.
 */
export function createTokenStore(publicKey: string): TokenStore {
  const key = storageKey(publicKey, KEY_SUFFIX);
  const ls = safeLocalStorage();
  let memory: string | null = null;

  return {
    get(): string | null {
      if (ls) {
        try {
          return ls.getItem(key);
        } catch {
          return memory;
        }
      }
      return memory;
    },
    set(token: string): void {
      memory = token;
      if (!ls) return;
      try {
        ls.setItem(key, token);
      } catch {
        /* keep the in-memory copy; storage full/blocked */
      }
    },
    clear(): void {
      memory = null;
      if (!ls) return;
      try {
        ls.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
