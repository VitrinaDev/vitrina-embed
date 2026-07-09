// Widget-chrome i18n. A flat es/en dictionary covering ONLY the widget's own
// copy (launcher label, panel title, composer, status banners) — NEVER message
// content, which is server data rendered verbatim. `es` is the default and the
// fallback (Chilean market), mirroring the app's custom t() convention: no
// external i18n lib, zero deps (MEMORY: es/en parity).

import type { WidgetLocale } from './types';

/** The set of chrome strings the UI needs. Keep in sync across locales. */
export interface WidgetStrings {
  launcherLabel: string;
  title: string;
  placeholder: string;
  send: string;
  close: string;
  welcome: string;
  offline: string;
  /** The realtime stream dropped and a backoff is running. */
  reconnecting: string;
  error: string;
  sending: string;
  poweredBy: string;
  /** Inline label on a message whose send failed. */
  notSent: string;
  /** Button that re-sends a failed message with its original client id. */
  retry: string;
}

export type StringKey = keyof WidgetStrings;

const STRINGS: Record<WidgetLocale, WidgetStrings> = {
  es: {
    launcherLabel: 'Abrir chat',
    title: 'Conversemos',
    placeholder: 'Escribe tu mensaje…',
    send: 'Enviar',
    close: 'Cerrar',
    welcome: 'Hola, ¿en qué te puedo ayudar?',
    offline: 'Sin conexión, reintentando…',
    reconnecting: 'Reconectando…',
    error: 'No se pudo enviar. Reintenta.',
    sending: 'Enviando…',
    poweredBy: 'con tecnología de Vitrina',
    notSent: 'No se envió',
    retry: 'Reintentar',
  },
  en: {
    launcherLabel: 'Open chat',
    title: "Let's chat",
    placeholder: 'Type your message…',
    send: 'Send',
    close: 'Close',
    welcome: 'Hi, how can I help?',
    offline: 'Offline, reconnecting…',
    reconnecting: 'Reconnecting…',
    error: 'Could not send. Retry.',
    sending: 'Sending…',
    poweredBy: 'powered by Vitrina',
    notSent: 'Not sent',
    retry: 'Retry',
  },
};

/** Translator: table lookup with an es fallback, then the key itself. */
export type Translate = (key: StringKey) => string;

/**
 * Build a translator for `locale`. Unknown locales fall back to `es`; a missing
 * key falls back to the `es` value, then the raw key — never returns undefined.
 */
export function makeT(locale: WidgetLocale): Translate {
  const table = STRINGS[locale] ?? STRINGS.es;
  return (key: StringKey): string => table[key] ?? STRINGS.es[key] ?? key;
}
