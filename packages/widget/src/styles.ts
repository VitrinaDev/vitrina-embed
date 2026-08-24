// The widget's stylesheet — a single CONSTANT template string injected once into
// the shadow root. It is NEVER built from user input: the only dynamic bits are
// the `--vtr-accent` / `--vtr-font` custom properties (set via style.setProperty
// from sanitized, closed-set values) and the `data-pos` attribute (a fixed
// 'br'|'bl'). Living inside the shadow root, none of these rules leak to — or
// are overridden by — host CSS.
//
// The one interpolation below is SYSTEM_FONT_STACK, a module constant that has
// to be shared with fonts.ts (which builds the same stack as the fallback under
// a web font). It is not user input and never has been.
//
// DEFAULT_ACCENT must match theme.ts (kept in the var() fallback below).

import { SYSTEM_FONT_STACK } from './fonts';

export const STYLES = `
:host {
  all: initial;
  --vtr-accent: #111827;
  --vtr-font: ${SYSTEM_FONT_STACK};
  --vtr-surface: #ffffff;
  --vtr-text: #111827;
  --vtr-muted: #6b7280;
  --vtr-border: #e5e7eb;
  --vtr-bubble-in: var(--vtr-accent);
  --vtr-bubble-out: #f3f4f6;
  --vtr-danger: #b91c1c;
  --vtr-ok: #15803d;
  font-family: var(--vtr-font);
  line-height: 1.4;
}
@media (prefers-color-scheme: dark) {
  :host {
    --vtr-surface: #1f2937;
    --vtr-text: #f9fafb;
    --vtr-muted: #9ca3af;
    --vtr-border: #374151;
    --vtr-bubble-out: #374151;
    --vtr-danger: #f87171;
    --vtr-ok: #4ade80;
  }
}
* { box-sizing: border-box; }

/* The font is re-declared HERE, not only on :host, because .vtr-root is where
   the resolved stack is set (alongside --vtr-accent). A custom property set on
   the root cannot reach a font-family declared on its parent — children inherit
   the already-computed value — so the rule that reads it has to live on the
   same element that carries it. With nothing set, this resolves to the :host
   value: byte-identical to the stack the widget has always used. */
.vtr-root { position: fixed; bottom: 20px; z-index: 2147483000; font-family: var(--vtr-font); }
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

/* 400x704 rather than 360x520. The old card was sized for a transcript and
   nothing else; a Home screen with a hero and three cards, or an FAQ with a tab
   bar under it, needs the room — and 400 is still narrow enough to sit beside a
   dealer's own content on a laptop. min() keeps it off the viewport edges on a
   short window; 100dvh, never vh (see the mobile block). */
.vtr-panel {
  position: absolute; bottom: 0;
  width: 400px; max-width: calc(100vw - 40px);
  height: min(704px, calc(100dvh - 40px));
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
/* Sized by HEIGHT, never cropped: a dealer's logo is usually a wide wordmark,
   and a square object-fit:cover box turned every one of them into a cropped
   middle. contain + auto width lets a wordmark read and still bounds how much
   of a 360px header it can take. */
.vtr-logo { height: 22px; width: auto; max-width: 108px; border-radius: 4px; object-fit: contain; }
/* The logo element is always in the DOM so a server-resolved one (ADR 0046) can
   land without re-ordering the header. Explicit rather than relying on the UA
   [hidden] rule, which any future display declaration here would silently beat. */
.vtr-logo[hidden] { display: none; }
.vtr-title { font-weight: 600; font-size: 15px; flex: 1; margin: 0; }
.vtr-close {
  background: transparent; border: none; color: #fff; cursor: pointer;
  width: 32px; height: 32px; border-radius: 8px; font-size: 20px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.vtr-close:hover { background: rgba(255,255,255,0.18); }
/* On the compact (tabs-mode) header there is no accent band behind it, so the
   glyph has to come back to the text colour or it is white on white. */
.vtr-panel[data-tabs] .vtr-header .vtr-close, .vtr-vhead .vtr-close { color: var(--vtr-text); }
.vtr-panel[data-tabs] .vtr-header .vtr-close:hover, .vtr-vhead .vtr-close:hover {
  background: var(--vtr-bubble-out);
}

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

/* Attachment photos, rendered INSIDE a bubble above the caption. */
.vtr-media { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.vtr-media:last-child { margin-bottom: 0; }
.vtr-media-img {
  display: block; max-width: 100%; border-radius: 10px;
  background: var(--vtr-bubble-out);
}

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

/* Booking (S15-21). Every colour is an existing --vtr-* custom property, so
   dark mode came free and the dealer's accent reaches the calendar with no
   dynamic rule. Nothing below is ever built from user input.

   NOTE: this string ships verbatim to every dealer page — comments here cost
   real bytes on a real page load, so they stay short. */

/* Entry chips over the composer. Hidden with the composer while the overlay is
   up: one screen, one thing to do, nothing tabbable behind it. */
.vtr-actions {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 8px 12px 0;
}
.vtr-actions[hidden] { display: none; }
.vtr-chip {
  display: inline-flex; align-items: center; height: 30px; padding: 0 12px;
  border-radius: 999px; font: inherit; font-size: 12.5px; font-weight: 500;
  cursor: pointer;
  background: transparent; color: var(--vtr-accent);
  border: 1px solid var(--vtr-accent);
}
.vtr-chip:hover { background: var(--vtr-bubble-out); }
.vtr-chip:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 2px; }
.vtr-chip-visits { color: var(--vtr-muted); border-color: var(--vtr-border); }
.vtr-chip[hidden] { display: none; }
.vtr-panel[data-booking] .vtr-composer,
.vtr-panel[data-booking] .vtr-actions,
.vtr-panel[data-booking] .vtr-tabs { display: none; }

/* The overlay itself. Covers the panel, does NOT replace it — the transcript is
   still in the DOM underneath, untouched, and closing is a hidden flip. */
.vtr-booking {
  position: absolute; inset: 0; z-index: 1;
  background: var(--vtr-surface); color: var(--vtr-text);
  display: flex; flex-direction: column; overflow: hidden;
}
.vtr-booking[hidden] { display: none; }

.vtr-bk-head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; background: var(--vtr-accent); color: #fff;
}
.vtr-bk-title { font-weight: 600; font-size: 15px; flex: 1; }
.vtr-bk-back, .vtr-bk-close {
  background: transparent; border: none; color: #fff; cursor: pointer;
  width: 30px; height: 30px; border-radius: 8px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; line-height: 1;
}
.vtr-bk-back svg { width: 20px; height: 20px; }
.vtr-bk-back:hover, .vtr-bk-close:hover { background: rgba(255,255,255,0.18); }
.vtr-bk-back[hidden] { display: none; }

.vtr-bk-step {
  padding: 8px 16px 0; font-size: 11px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--vtr-muted);
}
.vtr-bk-step[hidden] { display: none; }

.vtr-bk-body {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 10px;
}

.vtr-bk-foot {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 16px 14px; border-top: 1px solid var(--vtr-border);
}
.vtr-bk-foot[hidden] { display: none; }
.vtr-bk-error { font-size: 12px; color: var(--vtr-danger); text-align: center; }
.vtr-bk-error[hidden] { display: none; }
.vtr-bk-primary {
  background: var(--vtr-accent); color: #fff; border: none; cursor: pointer;
  border-radius: 10px; height: 42px; font: inherit; font-weight: 600; font-size: 14px;
}
.vtr-bk-primary:disabled { opacity: 0.45; cursor: default; }
.vtr-bk-primary[hidden] { display: none; }
.vtr-bk-secondary {
  background: transparent; color: var(--vtr-danger); cursor: pointer;
  border: 1px solid var(--vtr-border); border-radius: 10px; height: 38px;
  font: inherit; font-weight: 500; font-size: 13px;
}
.vtr-bk-secondary:disabled { opacity: 0.5; cursor: default; }
.vtr-bk-secondary[hidden] { display: none; }

/* Month navigation + the hand-rolled grid (no date library, zero deps). */
.vtr-bk-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vtr-bk-month { font-size: 14px; font-weight: 600; text-transform: capitalize; }
.vtr-bk-navbtn {
  background: transparent; border: 1px solid var(--vtr-border); border-radius: 8px;
  color: var(--vtr-text); cursor: pointer; width: 32px; height: 32px; padding: 0;
  display: flex; align-items: center; justify-content: center;
}
.vtr-bk-navbtn svg { width: 18px; height: 18px; }
.vtr-bk-navnext svg { transform: rotate(180deg); }
.vtr-bk-navbtn:disabled { opacity: 0.35; cursor: default; }
.vtr-bk-week, .vtr-bk-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
}
.vtr-bk-wd {
  font-size: 10.5px; text-align: center; color: var(--vtr-muted);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.vtr-bk-pad { display: block; }
.vtr-bk-day {
  position: relative; aspect-ratio: 1 / 1; min-height: 34px;
  background: transparent; border: 1px solid transparent; border-radius: 9px;
  color: var(--vtr-text); font: inherit; font-size: 13px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
}
.vtr-bk-day:disabled { color: var(--vtr-muted); opacity: 0.4; cursor: default; }
.vtr-bk-day:not(:disabled):hover { background: var(--vtr-bubble-out); }
.vtr-bk-day[aria-current] { border-color: var(--vtr-accent); background: var(--vtr-bubble-out); }
.vtr-bk-day:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 1px; }
/* The ember dot: the whole trust device on a thin agenda. */
.vtr-bk-dot { width: 4px; height: 4px; border-radius: 999px; background: var(--vtr-accent); }
.vtr-bk-count { font-size: 12px; color: var(--vtr-muted); }
.vtr-bk-note { font-size: 12px; line-height: 1.5; color: var(--vtr-muted); }
.vtr-bk-empty { display: flex; flex-direction: column; gap: 6px; }
.vtr-bk-empty-title { font-size: 13.5px; font-weight: 600; }
.vtr-bk-warn { font-size: 13px; line-height: 1.5; color: var(--vtr-danger); }

/* Low-tone exit to a human, present at every dead end. */
.vtr-bk-fallback, .vtr-bk-linkbtn {
  background: transparent; border: none; padding: 0; cursor: pointer;
  font: inherit; font-size: 12px; text-align: left;
  color: var(--vtr-muted); text-decoration: underline;
}
.vtr-bk-linkbtn { color: var(--vtr-accent); font-weight: 600; }
.vtr-bk-fallback:focus-visible, .vtr-bk-linkbtn:focus-visible {
  outline: 2px solid var(--vtr-accent); outline-offset: 2px;
}

/* Slot grid. A taken hour is DIMMED, never removed. */
.vtr-bk-daylabel { font-size: 13.5px; font-weight: 600; text-transform: capitalize; }
.vtr-bk-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.vtr-bk-slot {
  height: 36px; border-radius: 9px; cursor: pointer;
  background: transparent; color: var(--vtr-text);
  border: 1px solid var(--vtr-border); font: inherit; font-size: 13px;
}
.vtr-bk-slot:not(:disabled):hover { border-color: var(--vtr-accent); }
.vtr-bk-slot[aria-current] { border-color: var(--vtr-accent); background: var(--vtr-bubble-out); }
.vtr-bk-slot[data-taken] { opacity: 0.38; cursor: default; text-decoration: line-through; }
.vtr-bk-slot:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 1px; }

/* Form */
.vtr-bk-form { display: flex; flex-direction: column; gap: 10px; }
.vtr-bk-label { display: flex; flex-direction: column; gap: 4px; }
.vtr-bk-label-text { font-size: 12px; color: var(--vtr-muted); }
.vtr-bk-input {
  border: 1px solid var(--vtr-border); border-radius: 10px; padding: 9px 11px;
  font: inherit; font-size: 14px;
  background: var(--vtr-surface); color: var(--vtr-text);
}
.vtr-bk-input:focus { outline: 2px solid var(--vtr-accent); outline-offset: -1px; }
.vtr-bk-consent {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12.5px; line-height: 1.45; cursor: pointer;
}
.vtr-bk-check { width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--vtr-accent); flex: none; }

/* Summary + confirmation */
.vtr-bk-card {
  border: 1px solid var(--vtr-border); border-radius: 12px; padding: 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.vtr-bk-when { font-size: 15px; font-weight: 600; text-transform: capitalize; }
.vtr-bk-when[data-struck] { text-decoration: line-through; color: var(--vtr-muted); }
.vtr-bk-time { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
.vtr-bk-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; }
.vtr-bk-rowkey { color: var(--vtr-muted); flex: none; }
.vtr-bk-rowval { text-align: right; }
.vtr-bk-done svg { width: 44px; height: 44px; color: var(--vtr-ok); }
.vtr-bk-codelabel {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vtr-muted);
}
/* The dealer's own A-<n>. Mono, because it gets read back over the phone. */
.vtr-bk-code, .vtr-bk-code-inline {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 20px; font-weight: 600; letter-spacing: 0.02em;
}
.vtr-bk-code-inline { font-size: 12px; font-weight: 500; color: var(--vtr-muted); }

/* Mis visitas */
.vtr-bk-section {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--vtr-muted); margin-top: 4px;
}
.vtr-bk-visit {
  border: 1px solid var(--vtr-border); border-radius: 12px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px;
}
.vtr-bk-visit-when { font-size: 13.5px; font-weight: 600; text-transform: capitalize; }
.vtr-bk-visit-when[data-struck] { text-decoration: line-through; color: var(--vtr-muted); }
.vtr-bk-visit-meta { display: flex; gap: 8px; align-items: baseline; }
.vtr-bk-visit-status { font-size: 11.5px; color: var(--vtr-muted); }

/* Tabs: Home / Messages / Help (0.8.0). Every rule below is inert for a tenant
   who turned neither tab on — the nodes they select do not exist, and the panel
   is the single-view card it has always been. */

.vtr-views { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.vtr-view { flex: 1; min-height: 0; display: none; flex-direction: column; }
.vtr-panel[data-active-view="home"] .vtr-view[data-view="home"],
.vtr-panel[data-active-view="messages"] .vtr-view[data-view="messages"],
.vtr-panel[data-active-view="help"] .vtr-view[data-view="help"] { display: flex; }

/* In tabs mode the accent band moves to the Home hero and the conversation
   header goes quiet: one surface with a tab bar, not three lidded screens. */
.vtr-panel[data-tabs] .vtr-header {
  background: var(--vtr-surface); color: var(--vtr-text); padding: 13px 16px;
}

.vtr-tabs {
  display: flex; flex: none; height: 56px;
  border-top: 1px solid var(--vtr-border); background: var(--vtr-surface);
}
.vtr-tabs[hidden] { display: none; }
.vtr-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; padding: 0; cursor: pointer;
  background: transparent; border: none; color: var(--vtr-muted);
  font: inherit; font-size: 11px; font-weight: 500; letter-spacing: 0.01em;
}
.vtr-tab[hidden] { display: none; }
.vtr-tab-icon { position: relative; display: flex; }
.vtr-tab svg {
  width: 20px; height: 20px; fill: none; stroke: currentColor;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}
.vtr-tab[aria-selected="true"] { color: var(--vtr-accent); font-weight: 600; }
.vtr-tab:hover { color: var(--vtr-text); }
.vtr-tab[aria-selected="true"]:hover { color: var(--vtr-accent); }
.vtr-tab:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: -3px; border-radius: 8px; }
.vtr-tab-dot {
  position: absolute; top: -1px; right: -3px;
  width: 7px; height: 7px; border-radius: 999px; background: #dc2626;
  box-shadow: 0 0 0 2px var(--vtr-surface);
}
.vtr-tab-dot[hidden] { display: none; }

/* Home */
.vtr-home-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.vtr-home-hero {
  padding: 20px 20px 48px; color: #fff;
  background: linear-gradient(180deg, var(--vtr-accent) 0%, var(--vtr-accent) 55%, transparent 100%);
}
.vtr-home-top { display: flex; align-items: center; gap: 10px; }
.vtr-home-spacer { flex: 1; }
.vtr-home-title { margin: 20px 0 0; font-size: 22px; font-weight: 700; line-height: 1.25; }
.vtr-home-sub { margin: 6px 0 0; font-size: 15px; line-height: 1.4; opacity: 0.92; }

/* The avatar stack: the "there are humans here" signal, in 28px. */
.vtr-avatars { display: flex; align-items: center; }
.vtr-avatars[hidden] { display: none; }
.vtr-avatar {
  width: 28px; height: 28px; border-radius: 50%; flex: none;
  border: 2px solid var(--vtr-surface); object-fit: cover;
  background: var(--vtr-bubble-out);
}
.vtr-avatar-initials {
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; color: #fff; letter-spacing: 0.01em;
}
.vtr-avatar + .vtr-avatar { margin-left: -8px; }

/* The cards float over the bottom of the hero fade. */
.vtr-home-cards { padding: 0 16px 16px; margin-top: -32px; display: grid; gap: 12px; }
.vtr-home-card {
  display: flex; align-items: center; gap: 12px; text-align: left; width: 100%;
  padding: 14px 16px; cursor: pointer; font: inherit; color: var(--vtr-text);
  background: var(--vtr-surface); border: 1px solid var(--vtr-border); border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.06);
}
.vtr-home-card:hover { border-color: var(--vtr-accent); }
.vtr-home-card:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 2px; }
.vtr-home-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.vtr-home-card-title { font-size: 14px; font-weight: 600; line-height: 1.3; }
.vtr-home-card-sub { font-size: 12.5px; line-height: 1.35; color: var(--vtr-muted); }
.vtr-home-card-preview {
  font-size: 12.5px; color: var(--vtr-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vtr-home-card-icon { flex: none; display: flex; color: var(--vtr-accent); }
.vtr-home-card-chev { color: var(--vtr-muted); }
.vtr-home-card-icon svg {
  width: 20px; height: 20px; fill: none; stroke: currentColor;
  stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
}

/* Help. Compact header, scrolling accordion, one sticky way out. */
.vtr-vhead {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 16px; background: var(--vtr-surface); color: var(--vtr-text);
}
.vtr-help-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 16px 8px; }
.vtr-help-foot { flex: none; padding: 8px 16px 14px; }
.vtr-help-cta {
  width: 100%; height: 40px; cursor: pointer; font: inherit;
  font-size: 13px; font-weight: 600;
  background: transparent; color: var(--vtr-accent);
  border: 1px solid var(--vtr-accent); border-radius: 999px;
}
.vtr-help-cta:hover { background: var(--vtr-bubble-out); }
.vtr-help-cta:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 2px; }

.vtr-faq { display: flex; flex-direction: column; }
.vtr-faq-item { border-bottom: 1px solid var(--vtr-border); }
.vtr-faq-q {
  width: 100%; display: flex; align-items: flex-start; gap: 10px; text-align: left;
  padding: 13px 0; cursor: pointer; font: inherit;
  font-size: 15px; font-weight: 500; line-height: 1.4;
  background: transparent; border: none; color: var(--vtr-text);
}
.vtr-faq-qtext { flex: 1; }
.vtr-faq-chev { flex: none; display: flex; margin-top: 2px; transition: transform 0.18s ease; }
.vtr-faq-chev svg {
  width: 16px; height: 16px; fill: none; stroke: currentColor;
  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--vtr-muted);
}
.vtr-faq-q[aria-expanded="true"] .vtr-faq-chev { transform: rotate(180deg); }
.vtr-faq-q:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: -2px; border-radius: 8px; }
.vtr-faq-a {
  padding: 0 26px 14px 0; font-size: 14px; line-height: 1.55;
  color: var(--vtr-muted); white-space: pre-wrap; word-break: break-word;
  animation: vtr-faq-in 0.18s ease;
}
.vtr-faq-a[hidden] { display: none; }
/* Markdown inside an answer. Same subset as a bubble, scoped again because the
   bubble rules are scoped to .vtr-msg. */
.vtr-faq-a .vtr-list { margin: 4px 0; padding-left: 20px; }
.vtr-faq-a .vtr-list li { margin: 2px 0; }
.vtr-faq-a .vtr-link { color: var(--vtr-accent); text-decoration: underline; }
.vtr-faq-a .vtr-link:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 2px; }
.vtr-faq-a .vtr-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em; padding: 1px 4px; border-radius: 4px; background: rgba(0,0,0,0.07);
}
.vtr-faq-a strong { font-weight: 650; color: var(--vtr-text); }
@media (prefers-color-scheme: dark) {
  .vtr-faq-a .vtr-code { background: rgba(255,255,255,0.12); }
}
@keyframes vtr-faq-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .vtr-faq-chev { transition: none; }
  .vtr-faq-a { animation: none; }
}

/* Mobile. Ships regardless of booking: a 360x520 card floating over a phone is
   a desktop widget on a screen that has no desktop. 100dvh, never vh — vh
   measures a viewport the browser chrome is standing in front of. */
@media (max-width: 480px) {
  .vtr-panel {
    /* fixed, not absolute: the panel's offset parent is the 0x0 .vtr-root
       pinned 20px off the corner, so inset:0 against IT would fill nothing. */
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100dvh;
    max-width: 100%;
    max-height: 100dvh;
    border-radius: 0;
    border: none;
  }
}
`;
