// IIFE <script>-tag entry (tsup → dist/visor.global.js), served by the API at
// `/visor.js` like `/widget.js` and `/project-form.js`: one Vitrina host in the
// site's CSP.
//
//   <script src="https://api.vitrinadev.com/visor.js"
//           data-key="pk_…" data-project="<proyecto id>"
//           data-container="#visor" async></script>
//
// `data-container` is a selector; without it the visor draws where the tag sits.
// `data-api-base` overrides the API (default: this script's own origin + /api/v1).
//
// THE CHAT. A tapped unidad is handed to the Vitrina chat (`setUnit`, `prefill`,
// `open`). When the page already runs the widget, that instance is used. When it
// does not, the visor loads `widget.js` from the same host with the same key, so
// «Consultar por esta unidad» always has a chat to open; the widget is inert
// until then. Never throws into the host page; a second copy is a no-op.

import { mountVisor, type VisorChat } from './visor';

declare global {
  interface Window {
    vitrinaChat?: Record<string, unknown>;
    vitrinaChatInstance?: unknown;
    __vitrinaVisorBooted?: Set<Element>;
  }
}

function ownScript(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript;
  const all = Array.from(document.getElementsByTagName('script'));
  for (let i = all.length - 1; i >= 0; i -= 1) if (/\/visor(?:\.[\w.-]+)?\.js(?:[?#]|$)/.test(all[i]!.getAttribute('src') ?? '')) return all[i]!;
  return null;
}

export function resolveContainer(script: HTMLScriptElement): HTMLElement {
  const sel = script.getAttribute('data-container')?.trim();
  if (sel) {
    try {
      const found = document.querySelector<HTMLElement>(sel);
      if (found) return found;
    } catch {
      /* a bad selector falls through to the tag's own position */
    }
  }
  const div = document.createElement('div');
  script.parentNode?.insertBefore(div, script);
  return div;
}

const live = (): VisorChat | null => {
  const inst = window.vitrinaChatInstance as VisorChat | undefined;
  return inst && typeof inst.setUnit === 'function' ? inst : null;
};

function chatFor(apiBaseUrl: string, publicKey: string, origin: string): () => Promise<VisorChat | null> {
  let loading: Promise<VisorChat | null> | null = null;
  return () => {
    const now = live();
    if (now) return Promise.resolve(now);
    // Not on the page yet: load widget.js once, with this key, and wait (up to 8 s) for the instance.
    loading ??= new Promise<VisorChat | null>((resolve) => {
      if (!window.vitrinaChat) window.vitrinaChat = { publicKey, apiBaseUrl };
      const s = document.createElement('script');
      s.src = `${origin}/widget.js`;
      s.async = true;
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
      const started = Date.now();
      const poll = setInterval(() => {
        const inst = live();
        if (inst || Date.now() - started > 8000) {
          clearInterval(poll);
          resolve(inst);
        }
      }, 100);
    });
    return loading;
  };
}

(function autoInit(): void {
  if (typeof window === 'undefined') return;
  try {
    const script = ownScript();
    if (!script) return;
    const key = script.getAttribute('data-key')?.trim();
    const project = script.getAttribute('data-project')?.trim();
    if (!key || !project) {
      console.warn('[vitrina-visor] data-key and data-project are required; skipping.');
      return;
    }
    const src = script.getAttribute('src') ?? '';
    const origin = new URL(src, location.href).origin;
    const apiBaseUrl = (script.getAttribute('data-api-base')?.trim() || `${origin}/api/v1`).replace(/\/+$/, '');
    const container = resolveContainer(script);
    window.__vitrinaVisorBooted ??= new Set();
    if (window.__vitrinaVisorBooted.has(container)) return;
    window.__vitrinaVisorBooted.add(container);
    void mountVisor({ apiBaseUrl, publicKey: key, projectId: project, container, chat: chatFor(apiBaseUrl, key, origin) });
  } catch (err) {
    console.warn('[vitrina-visor] failed to start:', err);
  }
})();
