// localStorage-backed visitor-token persistence. The `vt_` token is a
// NON-SECRET visitor id (server-signed, origin+tenant-scoped) — safe to persist
// so a visitor resumes across reloads.
//
// Namespaced by publicKey so two widgets/keys on one origin never collide.
// Every storage access is wrapped: private-mode / disabled / quota-exceeded
// storage must degrade to an in-memory value, NEVER throw (AC#4).

const KEY_PREFIX = 'vtr:widget:';
const KEY_SUFFIX = ':visitorToken';

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

function storageKey(publicKey: string): string {
  return `${KEY_PREFIX}${publicKey}${KEY_SUFFIX}`;
}

/**
 * Probe for a usable localStorage. Some browsers expose the object but throw on
 * access (Safari private mode, disabled storage) — we only trust it if a
 * round-trip write+remove succeeds.
 */
function safeLocalStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__vtr_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Create a namespaced token store. Falls back to an in-memory slot if
 * localStorage is unavailable, so callers never branch on storage support.
 */
export function createTokenStore(publicKey: string): TokenStore {
  const key = storageKey(publicKey);
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
