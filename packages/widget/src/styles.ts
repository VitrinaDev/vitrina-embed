// The widget's stylesheet — a single CONSTANT template string injected once into
// the shadow root. It is NEVER built from user input: the only dynamic bits are
// the `--vtr-accent` custom property (set via style.setProperty from a sanitized
// color) and the `data-pos` attribute (a fixed 'br'|'bl'). Living inside the
// shadow root, none of these rules leak to — or are overridden by — host CSS.
//
// DEFAULT_ACCENT must match theme.ts (kept in the var() fallback below).

export const STYLES = `
:host {
  all: initial;
  --vtr-accent: #111827;
  --vtr-surface: #ffffff;
  --vtr-text: #111827;
  --vtr-muted: #6b7280;
  --vtr-border: #e5e7eb;
  --vtr-bubble-in: var(--vtr-accent);
  --vtr-bubble-out: #f3f4f6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.4;
}
@media (prefers-color-scheme: dark) {
  :host {
    --vtr-surface: #1f2937;
    --vtr-text: #f9fafb;
    --vtr-muted: #9ca3af;
    --vtr-border: #374151;
    --vtr-bubble-out: #374151;
  }
}
* { box-sizing: border-box; }

.vtr-root { position: fixed; bottom: 20px; z-index: 2147483000; }
.vtr-root[data-pos="br"] { right: 20px; }
.vtr-root[data-pos="bl"] { left: 20px; }

.vtr-launcher {
  position: relative;
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--vtr-accent); color: #fff;
  border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.24);
  transition: transform 0.12s ease;
  padding: 0;
}
.vtr-launcher:hover { transform: scale(1.06); }
.vtr-launcher:focus-visible { outline: 3px solid rgba(0,0,0,0.35); outline-offset: 2px; }
.vtr-launcher svg { width: 26px; height: 26px; fill: currentColor; }
.vtr-launcher[hidden] { display: none; }

/* Unread badge on the launcher. No sound, no browser notification, no favicon
   dot, no title flashing — a count is a signal; the rest is an interruption. */
.vtr-badge {
  position: absolute; top: -2px; right: -2px;
  min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 10px; background: #dc2626; color: #fff;
  font-size: 11px; font-weight: 700; line-height: 20px; text-align: center;
  box-shadow: 0 0 0 2px var(--vtr-surface);
}
.vtr-badge[hidden] { display: none; }

.vtr-panel {
  position: absolute; bottom: 0;
  width: 360px; max-width: calc(100vw - 40px);
  height: 520px; max-height: calc(100vh - 40px);
  background: var(--vtr-surface); color: var(--vtr-text);
  border: 1px solid var(--vtr-border); border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.28);
  display: flex; flex-direction: column; overflow: hidden;
}
.vtr-root[data-pos="br"] .vtr-panel { right: 0; }
.vtr-root[data-pos="bl"] .vtr-panel { left: 0; }
.vtr-panel[hidden] { display: none; }

.vtr-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; background: var(--vtr-accent); color: #fff;
}
.vtr-logo { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; background: rgba(255,255,255,0.15); }
.vtr-title { font-weight: 600; font-size: 15px; flex: 1; margin: 0; }
.vtr-close {
  background: transparent; border: none; color: #fff; cursor: pointer;
  width: 32px; height: 32px; border-radius: 8px; font-size: 20px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.vtr-close:hover { background: rgba(255,255,255,0.18); }

.vtr-messages {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.vtr-msg {
  max-width: 78%; padding: 9px 12px; border-radius: 14px;
  font-size: 14px; white-space: pre-wrap; word-break: break-word;
}
.vtr-msg[data-dir="inbound"] {
  align-self: flex-end; background: var(--vtr-bubble-in); color: #fff;
  border-bottom-right-radius: 4px;
}
.vtr-msg[data-dir="outbound"] {
  align-self: flex-start; background: var(--vtr-bubble-out); color: var(--vtr-text);
  border-bottom-left-radius: 4px;
}
/* Rendered markdown inside an outbound bubble (see markdown.ts for the subset).
   Lists reset their default indent/margins so a bubble does not gain a gutter;
   pre-wrap on the bubble means block elements need no extra separators.
   NOTE: this file is one big template literal — no backticks in these comments. */
.vtr-msg .vtr-list { margin: 4px 0; padding-left: 20px; }
.vtr-msg .vtr-list li { margin: 2px 0; }
.vtr-msg .vtr-link { color: inherit; text-decoration: underline; }
.vtr-msg .vtr-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.vtr-msg .vtr-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em; padding: 1px 4px; border-radius: 4px;
  background: rgba(0,0,0,0.07);
}
@media (prefers-color-scheme: dark) {
  .vtr-msg .vtr-code { background: rgba(255,255,255,0.12); }
}
.vtr-msg strong { font-weight: 650; }

/* A message the visitor sent that the server has not yet accepted. Dimmed, not
   hidden — it is a real message, and it stays on screen whatever happens. */
.vtr-msg[data-status="pending"] { opacity: 0.6; }
.vtr-msg[data-status="failed"] { opacity: 0.6; border: 1px solid #b91c1c; }

/* Inline retry, rendered directly beneath the message that failed so the
   visitor never has to guess which one did not go out. */
.vtr-msg-status {
  align-self: flex-end; display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #b91c1c; margin-top: -4px;
}
.vtr-retry {
  background: transparent; border: none; padding: 0; cursor: pointer;
  font: inherit; font-size: 11px; font-weight: 600;
  color: #b91c1c; text-decoration: underline;
}
.vtr-retry:focus-visible { outline: 2px solid #b91c1c; outline-offset: 2px; }

/* Vehicle card, rendered INSIDE an outbound bubble beneath the AI's prose. */
.vtr-card {
  margin-top: 8px; border: 1px solid var(--vtr-border); border-radius: 10px;
  overflow: hidden; background: var(--vtr-surface);
}
.vtr-card-img { display: block; width: 100%; height: 132px; object-fit: cover; background: var(--vtr-bubble-out); }
.vtr-card-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.vtr-card-title { font-size: 13px; font-weight: 600; color: var(--vtr-text); }
.vtr-card-price { font-size: 13px; color: var(--vtr-text); }
.vtr-card-link { font-size: 12px; font-weight: 600; color: var(--vtr-accent); text-decoration: none; margin-top: 4px; }
.vtr-card-link:hover { text-decoration: underline; }
.vtr-card-link:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 2px; }

/* Centered system line ("an advisor joined"). Not a bubble: it has no author,
   no direction, and it names nobody. */
.vtr-system {
  align-self: center; max-width: 90%;
  padding: 2px 10px; margin: 2px 0;
  font-size: 11.5px; text-align: center;
  color: var(--vtr-muted);
}

/* Typing indicator: three pulsing dots, no name. The visitor is never told
   whether the AI or a person is composing. */
.vtr-typing {
  display: flex; align-items: center; gap: 4px;
  padding: 0 16px 8px;
}
.vtr-typing[hidden] { display: none; }
.vtr-typing-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--vtr-muted);
  animation: vtr-typing-pulse 1.2s infinite ease-in-out;
}
.vtr-typing-dot:nth-child(2) { animation-delay: 0.15s; }
.vtr-typing-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes vtr-typing-pulse {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}
@media (prefers-reduced-motion: reduce) {
  .vtr-typing-dot { animation: none; opacity: 0.6; }
}

.vtr-banner {
  padding: 8px 16px; font-size: 12px; text-align: center;
  color: var(--vtr-muted); border-top: 1px solid var(--vtr-border);
}
.vtr-banner[data-state="error"] { color: #b91c1c; }
.vtr-banner[hidden] { display: none; }

.vtr-composer {
  display: flex; gap: 8px; align-items: flex-end;
  padding: 12px; border-top: 1px solid var(--vtr-border);
}
.vtr-input {
  flex: 1; resize: none; border: 1px solid var(--vtr-border);
  border-radius: 10px; padding: 9px 11px; font: inherit; font-size: 14px;
  background: var(--vtr-surface); color: var(--vtr-text);
  max-height: 120px; min-height: 40px;
}
.vtr-input:focus { outline: 2px solid var(--vtr-accent); outline-offset: -1px; }
.vtr-sendbtn {
  background: var(--vtr-accent); color: #fff; border: none; cursor: pointer;
  border-radius: 10px; padding: 0 16px; height: 40px; font: inherit; font-weight: 600;
}
.vtr-sendbtn:disabled { opacity: 0.5; cursor: default; }

.vtr-footer { padding: 0 12px 10px; font-size: 11px; color: var(--vtr-muted); text-align: center; }

/* Honeypot: visually hidden but focusable-off-screen, NEVER display:none (bots
   skip display:none fields). Always submitted, empty for real humans. */
.vtr-hp {
  position: absolute !important; left: -9999px !important; top: auto !important;
  width: 1px !important; height: 1px !important; overflow: hidden !important;
  opacity: 0 !important; pointer-events: none !important;
}
`;
