// Sidebar-mode chrome (embed#25, D7/D15/D20/D23): the named-assistant header,
// the side tab, the greeting chips, the WhatsApp link, the pinned CTA, the
// mobile peek card, the bottom-bar launcher slot and the demo-mode framing.
//
// It decorates the panel ui.ts already builds — the transcript, composer,
// booking and tabs are the same code for every layout. Constructed ONLY when
// the resolved layout is `sidebar` or `inline`; a bubble widget never reaches
// a line of this file.
//
// Same XSS discipline as ui.ts: DOM construction only, no innerHTML; every URL
// came through validateHttpUrl (agent avatar) or is built by handoff.ts.

import type { ResolvedAgent, ResolvedChip } from './sidebar-config';
import type { StringKey, Translate } from './i18n';
import type { WidgetLayout, WidgetPreset } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SidebarUiOptions {
  layout: Exclude<WidgetLayout, 'bubble'>;
  preset: WidgetPreset;
  anchor: 'auto' | 'bottom-bar';
  /** Resolved host element for the bottom-bar launcher, or null. */
  launcherSlot: HTMLElement | null;
  agent: ResolvedAgent | null;
  chips: ResolvedChip[];
  hasWhatsApp: boolean;
  ctaLabel: string | null;
  demoWorld: string | null;
}

export interface SidebarUiCallbacks {
  onChip(index: number, from: 'panel' | 'teaser'): void;
  /** Current wa.me URL (with the conversation ref when there is one). */
  whatsappUrl(): string | null;
  onWhatsApp(): void;
  onCta(): void;
  onTeaserOpen(): void;
  onTeaserDismiss(): void;
  onDemoExit(): void;
  onRequestOpen(): void;
}

/** A mobile viewport, where the panel goes full screen and the peek card lives. */
export const MOBILE_QUERY = '(max-width: 768px)';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function svg(viewBox: string, paths: Array<[string, Record<string, string>?]>, cls?: string): SVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  for (const [d, attrs] of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    for (const [k, v] of Object.entries(attrs ?? {})) p.setAttribute(k, v);
    s.appendChild(p);
  }
  return s;
}

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const WA_PATH =
  'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3z';

export const waIcon = (): SVGElement => svg('0 0 24 24', [[WA_PATH, { fill: 'currentColor' }]]);
const minusIcon = (): SVGElement => svg('0 0 24 24', [['M6 12h12', STROKE]], 'vtr-ic-min');
const chevronIcon = (): SVGElement => svg('0 0 24 24', [['M6 9l6 6 6-6', STROKE]], 'vtr-ic-chev');
const xIcon = (): SVGElement => svg('0 0 24 24', [['M6 6l12 12M18 6L6 18', STROKE]]);
export const sendIcon = (): SVGElement => svg('0 0 24 24', [['M12 19V5M5 12l7-7 7 7', STROKE]]);
const calendarIcon = (): SVGElement =>
  svg('0 0 24 24', [['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM16 3v4M8 3v4M3 10h18', STROKE]]);

/**
 * The round portrait. With no avatar URL it draws a neutral silhouette — the
 * placeholder until the tenant uploads a portrait (embed#26 for Tomás). Below
 * 40 px it ALWAYS carries the «IA» badge (spec v3 §5.1): at that size there is
 * no room for the written label next to it, and the face must never appear
 * without its disclosure.
 */
export function portrait(
  agent: ResolvedAgent | null,
  size: number,
  opts: { online?: boolean; aiTag: string },
): HTMLElement {
  const wrap = el('span', 'vtr-pt');
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  if (agent?.avatarUrl) {
    const img = el('img', 'vtr-pt-face');
    img.src = agent.avatarUrl;
    img.alt = '';
    img.decoding = 'async';
    wrap.appendChild(img);
  } else {
    const s = svg(
      '0 0 40 40',
      [
        ['M0 0h40v40H0z', { fill: '#EADBCB' }],
        ['M20 8.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4z', { fill: '#B89B82' }],
        ['M6 40c1.5-8.5 7.4-13 14-13s12.5 4.5 14 13z', { fill: '#8E6F57' }],
      ],
      'vtr-pt-face',
    );
    wrap.appendChild(s);
  }
  if (opts.online) wrap.appendChild(el('span', 'vtr-pt-on'));
  if (size < 40) wrap.appendChild(el('span', 'vtr-pt-ia', opts.aiTag));
  return wrap;
}

export interface SidebarChrome {
  /** Rebuild the header in place for the named assistant. */
  decorateHeader(header: HTMLElement, closeBtn: HTMLButtonElement): void;
  /** The launcher becomes the side tab (desktop) / round portrait (mobile). */
  decorateLauncher(launcher: HTMLButtonElement): void;
  /** Elements appended under the greeting while the transcript is empty. */
  welcomeExtras(): HTMLElement[];
  /** The pinned CTA, inserted above the composer. null when none is configured. */
  ctaButton(): HTMLButtonElement | null;
  /** The demo-mode exit button, inserted above the CTA. */
  demoExitButton(): HTMLButtonElement;
  /** The peek card (mounted in the shadow root by ui.ts). */
  readonly teaser: HTMLElement;
  showTeaser(greeting: string): void;
  hideTeaser(): void;
  isTeaserShown(): boolean;
  setDemo(on: boolean): void;
  /** Mount the bottom-bar slot launcher. Returns whether a slot was used. */
  mountSlot(): boolean;
  setT(t: Translate): void;
  launcherAria(): string;
  destroy(): void;
}

export function createSidebarChrome(
  opts: SidebarUiOptions,
  cb: SidebarUiCallbacks,
  getT: () => Translate,
  on: (target: EventTarget, type: string, handler: EventListener) => void,
): SidebarChrome {
  const t = (key: StringKey): string =>
    getT()(key)
      .replace('{name}', opts.agent?.name ?? '')
      .replace('{world}', opts.demoWorld ?? '');
  const agent = opts.agent;

  // --- Header ---------------------------------------------------------------
  let headerWho: HTMLElement | null = null;
  let headerPt: HTMLElement | null = null;
  let demoMark: HTMLElement | null = null;
  let nameRow: HTMLElement | null = null;
  let labelRow: HTMLElement | null = null;
  let statusRow: HTMLElement | null = null;
  let waBtn: HTMLAnchorElement | null = null;
  const live = el('span', 'vtr-sr');
  live.setAttribute('aria-live', 'polite');

  function waLink(a: HTMLAnchorElement): void {
    // A real anchor the visitor taps — in-app browsers block window.open, never
    // a plain navigation (spec v3 §6.3). On a phone it stays in the same tab;
    // on a desktop wa.me opens WhatsApp Web, so a new tab keeps the page.
    const refresh = (): void => {
      const href = cb.whatsappUrl();
      if (href) a.href = href;
      const mobile = typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches;
      if (mobile) {
        a.removeAttribute('target');
        a.removeAttribute('rel');
      } else {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    };
    refresh();
    on(a, 'pointerdown', refresh);
    on(a, 'focus', refresh);
    on(a, 'click', () => {
      refresh();
      cb.onWhatsApp();
    });
  }

  function paintHeaderText(demo: boolean): void {
    if (!agent || !nameRow || !labelRow || !statusRow) return;
    nameRow.replaceChildren();
    if (demo) {
      nameRow.appendChild(el('span', 'vtr-pill', t('sbDemoPill')));
      labelRow.textContent = opts.demoWorld ? t('sbDemoLabelNamed') : t('sbDemoLabel');
      statusRow.hidden = !opts.demoWorld;
      statusRow.replaceChildren(document.createTextNode(t('sbDemoFictional')));
    } else {
      nameRow.append(el('span', 'vtr-sb-name', agent.name), el('span', 'vtr-pill vtr-pill-soft', t('sbAiTag')));
      labelRow.textContent = agent.label;
      statusRow.hidden = !agent.status;
      statusRow.replaceChildren(el('span', 'vtr-dot'), document.createTextNode(agent.status ?? ''));
    }
  }

  // --- Chips + WhatsApp under the greeting ------------------------------------
  function chipButton(chip: ResolvedChip, index: number, from: 'panel' | 'teaser'): HTMLButtonElement {
    const b = el('button', 'vtr-sb-chip');
    b.type = 'button';
    if (chip.action === 'demo') b.appendChild(el('span', 'vtr-sb-k', t('sbDemoTag')));
    b.appendChild(document.createTextNode(chip.label));
    on(b, 'click', (e) => {
      e.stopPropagation();
      cb.onChip(index, from);
    });
    return b;
  }

  // --- Teaser (peek card) -----------------------------------------------------
  const teaser = el('section', 'vtr-peek');
  teaser.setAttribute('role', 'region');
  teaser.hidden = true;
  let teaserShown = false;
  let teaserGreeting: HTMLElement | null = null;
  let greetingText = '';
  function buildTeaser(): void {
    teaser.replaceChildren();
    teaser.setAttribute('aria-label', agent ? `${agent.name}, ${agent.label}` : t('sbAskPlaceholder'));
    const top = el('div', 'vtr-peek-top');
    const txt = el('div', 'vtr-peek-txt');
    const who = el('div', 'vtr-peek-who');
    if (agent) who.append(el('b', undefined, agent.name), document.createTextNode(agent.label));
    teaserGreeting = el('div', 'vtr-peek-g', greetingText);
    txt.append(who, teaserGreeting);
    const x = el('button', 'vtr-peek-x');
    x.type = 'button';
    x.setAttribute('aria-label', t('sbDismissTeaser'));
    x.appendChild(xIcon());
    on(x, 'click', (e) => {
      e.stopPropagation();
      cb.onTeaserDismiss();
    });
    top.append(portrait(agent, 36, { aiTag: t('sbAiTag') }), txt, x);
    teaser.appendChild(top);
    if (opts.chips.length > 0) {
      const row = el('div', 'vtr-peek-row');
      opts.chips.forEach((c, i) => row.appendChild(chipButton(c, i, 'teaser')));
      teaser.appendChild(row);
    }
  }
  buildTeaser();
  on(teaser, 'click', () => cb.onTeaserOpen());
  on(teaser, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Escape') cb.onTeaserDismiss();
  }) as EventListener);

  /**
   * The peek card hides while the visitor is typing into the PAGE — a focused
   * field or an open on-screen keyboard — and comes back on blur. It never
   * covers the form they are filling in.
   */
  const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  let suppressed = false;
  function pageTyping(): boolean {
    const a = document.activeElement as HTMLElement | null;
    if (a && !a.hasAttribute('data-vitrina-widget') && (TYPING.has(a.tagName) || a.isContentEditable)) {
      return true;
    }
    const vv = (globalThis as { visualViewport?: VisualViewport }).visualViewport;
    return !!vv && typeof innerHeight === 'number' && innerHeight - vv.height > 150;
  }
  function placeTeaser(): void {
    // Above the host's sticky bar when the launcher lives in it, else above
    // our own launcher.
    let bottom = 88;
    if (slotHost && opts.launcherSlot) {
      const r = opts.launcherSlot.getBoundingClientRect();
      if (r.height > 0 && typeof innerHeight === 'number') {
        const bar = opts.launcherSlot.closest('[data-vtr-bar]') as HTMLElement | null;
        const top = bar ? bar.getBoundingClientRect().top : r.top - 10;
        bottom = Math.max(16, Math.round(innerHeight - top + 8));
      }
    }
    teaser.style.bottom = `${bottom}px`;
  }
  function syncTeaser(): void {
    suppressed = pageTyping();
    teaser.hidden = !teaserShown || suppressed;
    if (!teaser.hidden) placeTeaser();
  }
  const onFocusChange = (): void => {
    // focusout fires before the next element has focus; read it a tick later.
    setTimeout(syncTeaser, 0);
  };
  on(document, 'focusin', onFocusChange);
  on(document, 'focusout', onFocusChange);
  const vv = (globalThis as { visualViewport?: VisualViewport }).visualViewport;
  if (vv) on(vv, 'resize', syncTeaser);
  if (typeof window !== 'undefined') on(window, 'resize', syncTeaser);

  // --- Bottom-bar slot launcher ------------------------------------------------
  let slotHost: HTMLElement | null = null;

  // --- Demo exit + CTA ----------------------------------------------------------
  const exitBtn = el('button', 'vtr-sb-exit', t('sbDemoExit'));
  exitBtn.type = 'button';
  exitBtn.hidden = true;
  on(exitBtn, 'click', () => cb.onDemoExit());

  let cta: HTMLButtonElement | null = null;
  let ctaText: HTMLElement | null = null;
  if (opts.ctaLabel) {
    cta = el('button', 'vtr-sb-cta');
    cta.type = 'button';
    ctaText = el('span', undefined, opts.ctaLabel);
    cta.append(calendarIcon(), ctaText);
    on(cta, 'click', () => cb.onCta());
  }

  let launcherLabel: HTMLElement | null = null;
  let launcherRef: HTMLButtonElement | null = null;

  function launcherAria(): string {
    return agent ? `${t('sbChatWith')}, ${agent.label}` : t('sbAskPlaceholder');
  }

  return {
    teaser,
    decorateHeader(header, closeBtn) {
      header.classList.add('vtr-sb-head');
      if (agent) {
        headerPt = portrait(agent, 40, { online: true, aiTag: t('sbAiTag') });
        const initials = (opts.demoWorld ?? 'Demo')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w.charAt(0).toUpperCase())
          .join('');
        demoMark = el('span', 'vtr-demo-mark', initials);
        demoMark.hidden = true;
        headerWho = el('div', 'vtr-sb-who');
        nameRow = el('div', 'vtr-sb-namerow');
        labelRow = el('div', 'vtr-sb-role');
        statusRow = el('div', 'vtr-sb-role');
        headerWho.append(nameRow, labelRow, statusRow);
        paintHeaderText(false);
      }
      const tools: HTMLElement[] = [];
      if (opts.hasWhatsApp) {
        waBtn = el('a', 'vtr-ib vtr-ib-wa');
        waBtn.setAttribute('aria-label', t('sbWaAria'));
        waBtn.appendChild(waIcon());
        waLink(waBtn);
        tools.push(waBtn);
      }
      closeBtn.classList.add('vtr-ib');
      closeBtn.textContent = '';
      closeBtn.append(minusIcon(), chevronIcon());
      closeBtn.setAttribute('aria-label', t('sbMinimize'));
      if (opts.layout === 'inline') closeBtn.hidden = true;
      // The logo and the plain title give way to the named assistant (CSS).
      if (agent) header.setAttribute('data-agent', '');
      if (agent && headerPt && demoMark && headerWho) {
        header.prepend(headerPt, demoMark, headerWho);
      }
      header.append(...tools, closeBtn, live);
    },
    decorateLauncher(launcher) {
      launcherRef = launcher;
      launcher.classList.add('vtr-sb-tab');
      launcher.replaceChildren(
        ...Array.from(launcher.children).filter((c) => c.classList.contains('vtr-badge')),
      );
      launcher.prepend(portrait(agent, 36, { online: true, aiTag: t('sbAiTag') }));
      if (agent) {
        launcherLabel = el('span', 'vtr-sbtab-label', t('sbAskAgent'));
        launcher.appendChild(launcherLabel);
        const tip = el('span', 'vtr-sbtab-tip');
        tip.append(document.createTextNode(`${agent.name} · ${agent.label}`));
        if (agent.status) tip.appendChild(el('small', undefined, agent.status));
        launcher.appendChild(tip);
      }
      launcher.setAttribute('aria-label', launcherAria());
    },
    welcomeExtras() {
      const out: HTMLElement[] = [];
      if (agent) out.push(el('div', 'vtr-sb-meta', `${agent.name} · ${t('sbAiTag')}`));
      if (opts.chips.length > 0) {
        const col = el('div', 'vtr-sb-chips');
        opts.chips.forEach((c, i) => col.appendChild(chipButton(c, i, 'panel')));
        out.push(col);
      }
      if (opts.hasWhatsApp) {
        const row = el('div', 'vtr-sb-walink');
        const a = el('a', undefined, t('sbContinueWa'));
        waLink(a);
        row.append(waIcon(), document.createTextNode(`${t('sbPreferWa')} `), a);
        out.push(row);
      }
      return out;
    },
    ctaButton: () => cta,
    demoExitButton: () => exitBtn,
    showTeaser(greeting) {
      greetingText = greeting;
      if (teaserGreeting) teaserGreeting.textContent = greeting;
      teaserShown = true;
      syncTeaser();
    },
    hideTeaser() {
      teaserShown = false;
      teaser.hidden = true;
    },
    isTeaserShown: () => teaserShown && !suppressed,
    setDemo(on) {
      paintHeaderText(on);
      if (headerPt) headerPt.hidden = on;
      if (demoMark) demoMark.hidden = !on;
      exitBtn.hidden = !on;
      live.textContent = on ? t('sbDemoOn') : t('sbDemoOff');
    },
    mountSlot() {
      if (opts.anchor !== 'bottom-bar' || !opts.launcherSlot || slotHost) return !!slotHost;
      slotHost = document.createElement('span');
      slotHost.setAttribute('data-vitrina-widget-slot', '');
      const sr = slotHost.attachShadow({ mode: 'open' });
      const style = el('style');
      style.textContent = SLOT_STYLES;
      const btn = el('button', 'slot');
      btn.type = 'button';
      btn.setAttribute('aria-label', launcherAria());
      btn.appendChild(portrait(agent, 34, { online: true, aiTag: t('sbAiTag') }));
      on(btn, 'click', () => cb.onRequestOpen());
      sr.append(style, btn);
      opts.launcherSlot.appendChild(slotHost);
      return true;
    },
    launcherAria,
    setT() {
      exitBtn.textContent = t('sbDemoExit');
      if (launcherLabel) launcherLabel.textContent = t('sbAskAgent');
      if (launcherRef) launcherRef.setAttribute('aria-label', launcherAria());
      buildTeaser();
    },
    destroy() {
      slotHost?.remove();
      slotHost = null;
    },
  };
}

/** The bottom-bar slot's own (tiny) shadow stylesheet. */
const SLOT_STYLES = `
:host { all: initial; display: inline-block; }
.slot { width: 46px; height: 46px; border-radius: 12px; border: 1px solid #E0D9D2; background: #FEF9F3;
  display: grid; place-items: center; padding: 0; cursor: pointer; }
.slot:focus-visible { outline: 2px solid #AD4E00; outline-offset: 2px; }
.vtr-pt { position: relative; display: inline-block; flex: none; border-radius: 50%; }
.vtr-pt-face { width: 100%; height: 100%; border-radius: 50%; display: block; object-fit: cover; }
.vtr-pt-on { position: absolute; right: -1px; top: -1px; width: 10px; height: 10px; border-radius: 50%;
  background: #34893C; box-shadow: 0 0 0 2px #FEF9F3; }
.vtr-pt-ia { position: absolute; right: -4px; bottom: -3px; font: 500 9.5px/1 'IBM Plex Mono', ui-monospace, monospace;
  color: #FEF9F3; background: #201712; padding: 2px 3px; border-radius: 4px; box-shadow: 0 0 0 1.5px #FEF9F3; }
`;
