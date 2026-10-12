// Sidebar / inline layout stylesheet (embed#25). Appended to the shadow root
// ONLY for those layouts, so a bubble widget's stylesheet is byte-identical to
// before. Constant string, never built from input; the dynamic values are the
// same sanitized --vtr-* custom properties as styles.ts.
//
// NOTE: one big template literal — no backticks in these comments.

export const SIDEBAR_STYLES = `
/* Cream preset: the Vitrina landing tokens (research 12, ember per D61). It
   pins its own surfaces in both colour schemes: the page around it is cream. */
.vtr-root[data-preset="cream"] {
  --vtr-surface: #FEF9F3; --vtr-page: #FAF5ED; --vtr-text: #201712; --vtr-muted: #665D56;
  --vtr-border: #E0D9D2; --vtr-input: #E8E0D8; --vtr-bubble-out: #EFE8DF; --vtr-tint: #F3E3D6;
  --vtr-chip-border: #D9C3B0; --vtr-ok: #34893C; --vtr-danger: #B42318;
  color-scheme: light;
}
.vtr-root[data-layout] { --vtr-tint: color-mix(in srgb, var(--vtr-accent) 12%, var(--vtr-surface));
  --vtr-chip-border: color-mix(in srgb, var(--vtr-accent) 35%, var(--vtr-border)); --vtr-input: var(--vtr-border); }
.vtr-root[data-preset="cream"] { --vtr-tint: #F3E3D6; --vtr-chip-border: #D9C3B0; --vtr-input: #E8E0D8; }

/* --- Layout: sidebar. The root no longer floats in a corner; the panel docks. */
.vtr-root[data-layout="sidebar"] { position: fixed; bottom: 0; right: 0; left: auto; }
.vtr-root[data-layout="sidebar"] .vtr-panel {
  position: fixed; top: 0; right: 0; bottom: 0; left: auto;
  width: 400px; max-width: 100vw; height: 100dvh; max-height: none;
  border: none; border-left: 1px solid var(--vtr-border); border-radius: 0;
  box-shadow: -12px 0 40px rgba(32,23,18,0.10);
  animation: vtr-slide-in 0.2s ease-out;
}
@keyframes vtr-slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }

/* Side tab (collapsed). */
.vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-tab {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  width: 56px; height: auto; padding: 12px 0 12px; border-radius: 14px 0 0 14px; font-family: inherit;
  flex-direction: column; gap: 10px;
  background: var(--vtr-surface); color: var(--vtr-text);
  border: 1px solid var(--vtr-border); border-right: 0;
  box-shadow: 0 6px 24px rgba(32,23,18,0.10);
}
.vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-tab:hover { transform: translateY(-50%) translateX(-2px); }
.vtr-sbtab-label { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 12.5px; font-weight: 500; white-space: nowrap; }
.vtr-sbtab-tip {
  position: absolute; right: 66px; top: 50%; transform: translateY(-50%);
  background: var(--vtr-text); color: var(--vtr-surface); font-size: 13px; line-height: 1.35;
  padding: 9px 12px; border-radius: 10px; white-space: nowrap; text-align: left;
  opacity: 0; pointer-events: none; transition: opacity 0.12s ease;
}
.vtr-sbtab-tip small { display: block; opacity: 0.75; font-size: 12px; margin-top: 2px; }
.vtr-sb-tab:hover .vtr-sbtab-tip, .vtr-sb-tab:focus-visible .vtr-sbtab-tip { opacity: 1; }
.vtr-sb-tab .vtr-badge { top: 4px; right: 6px; }

/* Bubble launcher (launcherStyle: 'bubble'): a round portrait bottom-right, tooltip on hover/focus. */
.vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-bubble {
  top: auto; bottom: 24px; right: 24px; transform: none; width: 60px; height: 60px; padding: 0;
  border-radius: 50%; border: 1px solid var(--vtr-border); flex-direction: row; gap: 0;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-bubble:hover { transform: scale(1.05); box-shadow: 0 8px 28px rgba(32,23,18,0.16); }
.vtr-sb-bubble:focus-visible { outline: 3px solid var(--vtr-accent); outline-offset: 3px; }
.vtr-sb-bubble .vtr-pt-on { width: 13px; height: 13px; right: 1px; top: 1px; box-shadow: 0 0 0 2.5px var(--vtr-surface); }
.vtr-sb-bubble .vtr-pt-ia { right: -5px; bottom: -4px; }
.vtr-sb-bubble .vtr-sbtab-tip { right: 72px; font-size: 13.5px; font-weight: 500; }
.vtr-sb-bubble .vtr-badge { top: -4px; right: -4px; }
.vtr-root[data-launcher="bubble"] .vtr-peek { right: 24px; bottom: 100px; }

/* Portrait + IA badge (shared with the slot launcher's own stylesheet). */
.vtr-pt { position: relative; display: inline-block; flex: none; border-radius: 50%; }
.vtr-pt[hidden] { display: none; }
.vtr-pt-face { width: 100%; height: 100%; border-radius: 50%; display: block; object-fit: cover; }
.vtr-pt-on { position: absolute; right: -1px; top: -1px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--vtr-ok); box-shadow: 0 0 0 2px var(--vtr-surface); }
.vtr-pt-ia { position: absolute; right: -4px; bottom: -3px;
  font: 500 9.5px/1 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.02em;
  color: var(--vtr-surface); background: var(--vtr-text); padding: 2px 3px; border-radius: 4px;
  box-shadow: 0 0 0 1.5px var(--vtr-surface); }

/* Header: the named assistant on the surface, not on an accent band. */
.vtr-root[data-layout] .vtr-header.vtr-sb-head {
  background: var(--vtr-surface); color: var(--vtr-text); gap: 12px;
  padding: 16px 14px 14px 18px; border-bottom: 1px solid var(--vtr-border);
}
.vtr-sb-head[data-agent] .vtr-logo, .vtr-sb-head[data-agent] .vtr-title { display: none; }
.vtr-sb-head .vtr-title { color: var(--vtr-text); }
.vtr-sb-who { flex: 1; min-width: 0; }
.vtr-sb-namerow { display: flex; align-items: center; gap: 8px; font-size: 15.5px; font-weight: 600; letter-spacing: -0.01em; }
.vtr-sb-role { font-size: 12.5px; color: var(--vtr-muted); margin-top: 1px; display: flex; align-items: center; gap: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vtr-sb-role[hidden] { display: none; }
.vtr-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vtr-ok); flex: none; }
.vtr-pill { font: 500 11px/1 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.04em;
  text-transform: uppercase; background: var(--vtr-text); color: var(--vtr-surface); padding: 4px 6px; border-radius: 5px; }
.vtr-pill-soft { background: var(--vtr-tint); color: var(--vtr-text); }
.vtr-demo-mark { width: 40px; height: 40px; border-radius: 12px; background: var(--vtr-text); color: var(--vtr-surface);
  display: grid; place-items: center; font-weight: 700; font-size: 13px; flex: none; }
.vtr-demo-mark[hidden] { display: none; }
.vtr-ib { width: 36px; height: 36px; border-radius: 10px; border: none; background: transparent; color: var(--vtr-muted);
  display: grid; place-items: center; cursor: pointer; padding: 0; margin: 0; flex: none; }
.vtr-root[data-layout] .vtr-header .vtr-close.vtr-ib { color: var(--vtr-muted); margin-left: 0; }
.vtr-ib:hover, .vtr-root[data-layout] .vtr-header .vtr-close.vtr-ib:hover { background: var(--vtr-bubble-out); }
.vtr-ib:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 1px; }
.vtr-ib svg { width: 19px; height: 19px; }
.vtr-ib-wa { color: #1F8F4E; }
.vtr-ib .vtr-ic-chev { display: none; }
.vtr-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Transcript. */
.vtr-root[data-layout] .vtr-messages { padding: 22px 18px 8px; gap: 10px; }
.vtr-root[data-layout] .vtr-msg { max-width: 86%; font-size: 14.5px; line-height: 1.5; padding: 11px 14px; border-radius: 16px; }
.vtr-root[data-layout] .vtr-msg[data-dir="outbound"] { border-bottom-left-radius: 5px; }
.vtr-root[data-layout] .vtr-msg[data-dir="inbound"] { border-bottom-right-radius: 5px; color: #fff; }
/* Per message, not per panel: Tomás's own earlier bubbles never take the tint. */
.vtr-msg[data-mode="demo"][data-dir="outbound"] { background: var(--vtr-tint); }
.vtr-msg[data-mode="demo"][data-dir="inbound"] { box-shadow: inset 0 0 0 1.5px var(--vtr-tint); }
.vtr-msg-tag { display: block; margin-bottom: 4px; font: 500 10px/1 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--vtr-muted); }
.vtr-sb-meta { font-size: 11.5px; color: var(--vtr-muted); margin: -4px 0 4px 4px; }
.vtr-sb-chips { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 6px; }
.vtr-sb-chip {
  font: inherit; font-size: 14px; font-weight: 500; color: var(--vtr-accent); background: var(--vtr-surface);
  border: 1px solid var(--vtr-chip-border); border-radius: 999px; padding: 9px 15px; min-height: 40px;
  text-align: left; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
}
.vtr-sb-chip:hover { background: var(--vtr-tint); border-color: var(--vtr-accent); }
.vtr-sb-chip:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 2px; }
.vtr-sb-k { font: 500 10.5px/1 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--vtr-text); background: var(--vtr-tint); border-radius: 5px; padding: 4px 5px; }
.vtr-sb-walink { margin-top: 10px; font-size: 13.5px; color: var(--vtr-muted); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.vtr-sb-walink svg { width: 16px; height: 16px; color: #1F8F4E; }
.vtr-sb-walink a { color: var(--vtr-text); font-weight: 500; text-decoration: underline; text-underline-offset: 3px;
  text-decoration-color: var(--vtr-chip-border); }

/* Dock: demo exit, pinned CTA, composer, disclaimer. */
.vtr-sb-exit, .vtr-sb-cta { margin: 10px 14px 0; font: inherit; cursor: pointer; border-radius: 12px; }
.vtr-sb-exit { height: 40px; background: var(--vtr-surface); border: 1px solid var(--vtr-border); font-size: 14px; font-weight: 500; color: var(--vtr-text); }
.vtr-sb-exit[hidden] { display: none; }
.vtr-sb-cta { height: 46px; border: none; background: var(--vtr-accent); color: #fff; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; gap: 9px; }
.vtr-sb-cta svg { width: 18px; height: 18px; }
.vtr-sb-cta:focus-visible, .vtr-sb-exit:focus-visible { outline: 2px solid var(--vtr-accent); outline-offset: 2px; }
.vtr-panel[data-cta] .vtr-chip-book { display: none; }
.vtr-panel[data-booking] .vtr-sb-cta, .vtr-panel[data-booking] .vtr-sb-exit,
.vtr-panel[data-home-action] .vtr-sb-cta, .vtr-panel[data-home-action] .vtr-sb-exit { display: none; }
.vtr-root[data-layout] .vtr-composer { border-top: none; padding: 10px 14px 6px; }
.vtr-root[data-layout] .vtr-input { border: 1px solid var(--vtr-input); background: #fff; border-radius: 14px; padding: 11px 14px; font-size: 14.5px; }
.vtr-root[data-layout] .vtr-sendbtn { width: 40px; padding: 0; border-radius: 10px; display: grid; place-items: center; }
.vtr-root[data-layout] .vtr-sendbtn svg { width: 18px; height: 18px; }
.vtr-root[data-layout] .vtr-footer { padding: 0 14px 12px; font-size: 11.5px; }
.vtr-root[data-layout] .vtr-actions { padding: 8px 14px 0; }
.vtr-panel[data-cta] .vtr-actions { padding: 0 14px; }
.vtr-panel[data-cta] .vtr-chip-visits { margin-top: 8px; }
.vtr-root[data-layout] .vtr-banner + .vtr-actions, .vtr-root[data-layout] .vtr-sb-exit { border-top: none; }

/* Peek card. */
.vtr-peek {
  position: fixed; left: 12px; right: 12px; bottom: 88px; max-width: 420px; margin-left: auto;
  background: var(--vtr-surface); color: var(--vtr-text); border: 1px solid var(--vtr-border); border-radius: 18px;
  box-shadow: 0 10px 30px rgba(32,23,18,0.14); padding: 12px 12px 12px 14px; cursor: pointer;
  font-family: var(--vtr-font); animation: vtr-peek-in 0.22s ease-out;
}
.vtr-peek[hidden] { display: none; }
@keyframes vtr-peek-in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
.vtr-peek-top { display: flex; gap: 10px; align-items: flex-start; }
.vtr-peek-txt { flex: 1; min-width: 0; }
.vtr-peek-who { font-size: 12px; color: var(--vtr-muted); display: flex; gap: 6px; align-items: baseline; white-space: nowrap; overflow: hidden; }
.vtr-peek-who b { color: var(--vtr-text); font-weight: 600; font-size: 13px; }
.vtr-peek-g { font-size: 14px; line-height: 1.4; margin-top: 3px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.vtr-peek-x { width: 44px; height: 44px; margin: -10px -8px 0 0; border: none; background: transparent; color: var(--vtr-muted);
  display: grid; place-items: center; cursor: pointer; flex: none; border-radius: 10px; }
.vtr-peek-x svg { width: 18px; height: 18px; }
.vtr-peek-x:focus-visible { outline: 2px solid var(--vtr-accent); }
.vtr-peek-row { display: flex; gap: 8px; overflow-x: auto; margin: 10px -12px 0 0; padding-right: 12px; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); mask-image: linear-gradient(90deg, #000 85%, transparent); }
.vtr-peek-row::-webkit-scrollbar { display: none; }
.vtr-peek-row .vtr-sb-chip { white-space: nowrap; flex: none; font-size: 13.5px; min-height: 38px; padding: 8px 13px; }

/* Inline: the same chat inside a host section. */
.vtr-root[data-layout="inline"] { position: relative; bottom: auto; right: auto; left: auto; height: 100%; }
.vtr-root[data-layout="inline"] .vtr-launcher { display: none; }
.vtr-root[data-layout="inline"] .vtr-panel { position: relative; width: 100%; max-width: none; height: 100%; min-height: 480px;
  border: 1px solid var(--vtr-border); border-radius: 18px; box-shadow: none; }

/* Phones: full screen only when tapped open; the tab becomes a round portrait,
   or disappears into the host's sticky bar. */
@media (max-width: 768px) {
  .vtr-root[data-layout="sidebar"] .vtr-panel { left: 0; width: 100%; border-left: none; box-shadow: none; animation: none; }
  .vtr-root[data-layout="sidebar"] .vtr-panel .vtr-header { padding-top: calc(14px + env(safe-area-inset-top)); }
  .vtr-root[data-layout="sidebar"] .vtr-footer { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-tab {
    top: auto; bottom: 16px; right: 16px; transform: none; width: 56px; height: 56px; padding: 0;
    border-radius: 50%; border: 1px solid var(--vtr-border);
  }
  .vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-tab:hover { transform: none; }
  .vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-bubble { bottom: 16px; right: 16px; width: 56px; height: 56px; }
  .vtr-root[data-launcher="bubble"] .vtr-peek { right: 12px; bottom: 88px; }
  .vtr-root[data-layout="sidebar"][data-slotted] .vtr-launcher { display: none; }
  .vtr-sb-tab .vtr-sbtab-label, .vtr-sb-tab .vtr-sbtab-tip { display: none; }
  .vtr-ib .vtr-ic-min { display: none; }
  .vtr-ib .vtr-ic-chev { display: block; }
}
@media (min-width: 769px) {
  .vtr-peek { left: auto; right: 72px; bottom: 24px; width: 360px; }
  .vtr-root[data-launcher="bubble"] .vtr-peek { right: 24px; bottom: 100px; }
}
@media (prefers-reduced-motion: reduce) {
  .vtr-root[data-layout="sidebar"] .vtr-panel, .vtr-peek { animation: none; }
  .vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-bubble, .vtr-sbtab-tip { transition: none; }
  .vtr-root[data-layout="sidebar"] .vtr-launcher.vtr-sb-bubble:hover { transform: none; }
}
`;
