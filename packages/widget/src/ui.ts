// The shadow-DOM UI: a floating launcher + a conversation panel, both isolated
// from host-page CSS. This module is presentation-only — it owns NO transport
// state; index.ts wires it to VitrinaTransport via the callbacks below.
//
// XSS SAFETY (AC#6): message content reaches the DOM only as text nodes or as
// elements built by ./markdown, which constructs nodes and never produces an
// HTML string; ids and metadata go through dataset/setAttribute. There is NO
// innerHTML anywhere, no eval, no remote script/style/asset (the only remote
// assets are a validated logo <img> and validated http(s) link targets).

import type { WidgetMessage } from './config';
import type { StringKey, Translate } from './i18n';
import { renderMarkdown } from './markdown';
import { STYLES } from './styles';
import { resolveAccent, resolvePosition, validateLogoUrl } from './theme';
import type { WidgetTheme } from './types';

export type BannerState = 'none' | 'offline' | 'reconnecting' | 'error' | 'sending';

export interface WidgetUiCallbacks {
  /** Composer submit: raw text + the honeypot field value (empty for humans). */
  onSend(text: string, honeypot: string): void;
  /** Launcher clicked — host decides to open (and kick off the session). */
  onRequestOpen(): void;
  /** Close button clicked. */
  onRequestClose(): void;
  /** Retry a failed send, re-using its ORIGINAL client message id (idempotent). */
  onRetry(clientMessageId: string): void;
}

export interface WidgetUiOptions {
  t: Translate;
  theme: WidgetTheme;
  welcomeMessage: string | null;
  callbacks: WidgetUiCallbacks;
}

export interface WidgetUi {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  mount(): void;
  destroy(): void;
  openPanel(): void;
  closePanel(): void;
  isOpen(): boolean;
  /**
   * Repaint the panel from the caller's message list. The list is the single
   * source of truth for what is on screen — including the visitor's own not-yet
   * -persisted messages, which are ENTRIES in it, not DOM artifacts. A repaint
   * can therefore never lose one.
   */
  renderMessages(messages: WidgetMessage[]): void;
  setBanner(state: BannerState): void;
}

interface TrackedListener {
  target: EventTarget;
  type: string;
  handler: EventListener;
}

/** Banner state -> the i18n key whose string it shows. */
const BANNER_STRING: Record<Exclude<BannerState, 'none'>, StringKey> = {
  offline: 'offline',
  reconnecting: 'reconnecting',
  error: 'error',
  sending: 'sending',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHAT_ICON_PATH =
  'M12 2C6.48 2 2 5.94 2 10.8c0 2.5 1.2 4.74 3.13 6.32-.1 1.2-.53 2.4-1.36 3.42-.2.24-.02.6.29.56 1.9-.26 3.3-.86 4.28-1.5.83.2 1.72.3 2.66.3 5.52 0 10-3.94 10-8.8S17.52 2 12 2z';

/** Build the launcher's chat glyph via the DOM — no innerHTML anywhere (AC#6). */
function chatIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', CHAT_ICON_PATH);
  svg.appendChild(path);
  return svg;
}

/**
 * Build the widget UI. Nothing is attached to the page until mount() is called;
 * destroy() removes the host node and every tracked listener.
 */
export function createWidgetUI(opts: WidgetUiOptions): WidgetUi {
  const { t, theme, welcomeMessage, callbacks } = opts;

  const host = document.createElement('div');
  // Defensive light-DOM styles: the shadow root protects everything INSIDE it,
  // but not the host element itself — pin it so host CSS cannot hide/mis-stack
  // the launcher (review requirement).
  host.setAttribute('data-vitrina-widget', '');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('z-index', '2147483000', 'important');
  host.style.setProperty('bottom', '0', 'important');
  host.style.setProperty(resolvePosition(theme.position) === 'bl' ? 'left' : 'right', '0', 'important');
  host.style.setProperty('width', '0', 'important');
  host.style.setProperty('height', '0', 'important');
  host.style.setProperty('visibility', 'visible', 'important');
  host.style.setProperty('display', 'block', 'important');

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'vtr-root';
  root.setAttribute('data-pos', resolvePosition(theme.position));
  root.style.setProperty('--vtr-accent', resolveAccent(theme.accent));

  // --- Launcher ---
  const launcher = document.createElement('button');
  launcher.className = 'vtr-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', t('launcherLabel'));
  launcher.appendChild(chatIcon());

  // --- Panel ---
  const panel = document.createElement('div');
  panel.className = 'vtr-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('title'));
  panel.hidden = true;

  const header = document.createElement('div');
  header.className = 'vtr-header';
  const logoHref = validateLogoUrl(theme.logoUrl);
  if (logoHref) {
    const logo = document.createElement('img');
    logo.className = 'vtr-logo';
    logo.src = logoHref;
    logo.alt = '';
    header.appendChild(logo);
  }
  const title = document.createElement('span');
  title.className = 'vtr-title';
  title.textContent = t('title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'vtr-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', t('close'));
  closeBtn.textContent = '×';
  header.append(title, closeBtn);

  const messagesEl = document.createElement('div');
  messagesEl.className = 'vtr-messages';

  const banner = document.createElement('div');
  banner.className = 'vtr-banner';
  banner.hidden = true;

  const form = document.createElement('form');
  form.className = 'vtr-composer';
  const input = document.createElement('textarea');
  input.className = 'vtr-input';
  input.rows = 1;
  input.placeholder = t('placeholder');
  input.setAttribute('aria-label', t('placeholder'));
  const honeypot = document.createElement('input');
  honeypot.className = 'vtr-hp';
  honeypot.type = 'text';
  honeypot.name = 'hp_website';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');
  const sendBtn = document.createElement('button');
  sendBtn.className = 'vtr-sendbtn';
  sendBtn.type = 'submit';
  sendBtn.textContent = t('send');
  form.append(honeypot, input, sendBtn);

  const footer = document.createElement('div');
  footer.className = 'vtr-footer';
  footer.textContent = t('poweredBy');

  panel.append(header, messagesEl, banner, form, footer);
  root.append(launcher, panel);
  shadow.appendChild(root);

  // --- state + listeners ---
  const listeners: TrackedListener[] = [];
  let open = false;

  function on(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    listeners.push({ target, type, handler });
  }

  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function bubble(dir: 'inbound' | 'outbound', content: string, id?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vtr-msg';
    el.setAttribute('data-dir', dir);
    if (id !== undefined) el.dataset.id = id;
    if (dir === 'outbound') {
      // Server-authored: the dealer's reply, the AI's reply, or the dealer's
      // configured greeting. Rendered through the safe-subset markdown parser,
      // which builds DOM nodes — an injected tag becomes a text node, because
      // no code path anywhere parses HTML.
      el.appendChild(renderMarkdown(content));
    } else {
      // The visitor's own text. They typed it; render it verbatim.
      el.textContent = content;
    }
    return el;
  }

  /**
   * A failed message gets an inline retry control rather than a toast: the
   * affordance belongs next to the thing that failed, and the visitor should
   * never have to wonder WHICH message did not go out.
   *
   * No listener is attached here. Every repaint rebuilds these nodes, so a
   * per-button listener would accumulate in the tracked-listener array without
   * bound. The click is handled by ONE delegated listener on the message list,
   * which reads `data-retry`.
   */
  function retryControl(clientMessageId: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vtr-msg-status';
    wrap.setAttribute('data-status', 'failed');
    const label = document.createElement('span');
    label.textContent = t('notSent');
    const btn = document.createElement('button');
    btn.className = 'vtr-retry';
    btn.type = 'button';
    btn.textContent = t('retry');
    btn.dataset.retry = clientMessageId;
    wrap.append(label, btn);
    return wrap;
  }

  function renderWelcome(): void {
    const greeting = welcomeMessage ?? t('welcome');
    messagesEl.appendChild(bubble('outbound', greeting));
  }

  const ui: WidgetUi = {
    host,
    shadow,
    mount(): void {
      if (!host.isConnected) document.body.appendChild(host);
    },
    destroy(): void {
      for (const { target, type, handler } of listeners) {
        target.removeEventListener(type, handler);
      }
      listeners.length = 0;
      if (host.isConnected) host.remove();
    },
    openPanel(): void {
      open = true;
      panel.hidden = false;
      launcher.hidden = true;
      // Paint the ephemeral greeting on first open if the list is still empty.
      if (messagesEl.childElementCount === 0) renderWelcome();
      input.focus();
      scrollToBottom();
    },
    closePanel(): void {
      open = false;
      panel.hidden = true;
      launcher.hidden = false;
    },
    isOpen(): boolean {
      return open;
    },
    renderMessages(messages: WidgetMessage[]): void {
      // Repaint from the caller's list, which INCLUDES the visitor's own
      // not-yet-persisted messages. This used to clear the panel and render
      // server rows only, so any local echo was destroyed on every repaint —
      // and a repaint fires after every send. The echo now survives by
      // construction, because it is in `messages`.
      messagesEl.replaceChildren();
      if (messages.length === 0) {
        if (open) renderWelcome();
        return;
      }
      for (const m of messages) {
        const el = bubble(m.direction, m.content, String(m.id));
        if (m.status) el.setAttribute('data-status', m.status);
        messagesEl.appendChild(el);
        if (m.status === 'failed' && m.clientMessageId) {
          messagesEl.appendChild(retryControl(m.clientMessageId));
        }
      }
      scrollToBottom();
    },
    setBanner(state: BannerState): void {
      if (state === 'none') {
        banner.hidden = true;
        banner.removeAttribute('data-state');
        return;
      }
      banner.hidden = false;
      banner.setAttribute('data-state', state);
      banner.textContent = BANNER_STRING[state] ? t(BANNER_STRING[state]) : '';
    },
  };

  // Wire interactions.
  on(launcher, 'click', () => callbacks.onRequestOpen());
  on(closeBtn, 'click', () => callbacks.onRequestClose());

  // ONE delegated listener for every retry button, present and future. Retry
  // buttons are rebuilt on each repaint, so binding per-button would grow the
  // tracked-listener array without bound.
  on(messagesEl, 'click', (e) => {
    const target = e.target as HTMLElement | null;
    const clientMessageId = target?.dataset?.retry;
    if (clientMessageId) callbacks.onRetry(clientMessageId);
  });

  function submit(): void {
    const text = input.value.trim();
    if (text === '') return;
    const hp = honeypot.value;
    input.value = '';
    callbacks.onSend(text, hp);
  }

  on(form, 'submit', (e) => {
    e.preventDefault();
    submit();
  });
  // Enter to send, Shift+Enter for a newline.
  on(input, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }) as EventListener);

  return ui;
}
