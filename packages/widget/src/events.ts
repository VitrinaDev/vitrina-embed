// A tiny typed emitter for the public `on()` API. A throwing host handler is
// isolated: it never breaks the widget nor the other listeners.

import type { WidgetEventMap, WidgetEventName } from './types';

type Handler<E extends WidgetEventName> = (payload: WidgetEventMap[E]) => void;

export interface Emitter {
  on<E extends WidgetEventName>(event: E, handler: Handler<E>): () => void;
  emit<E extends WidgetEventName>(event: E, payload: WidgetEventMap[E]): void;
  clear(): void;
}

export function createEmitter(): Emitter {
  const handlers = new Map<WidgetEventName, Set<Handler<WidgetEventName>>>();
  return {
    on(event, handler) {
      if (typeof handler !== 'function') return () => {};
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as Handler<WidgetEventName>);
      return () => {
        set!.delete(handler as Handler<WidgetEventName>);
      };
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of [...set]) {
        try {
          (h as Handler<typeof event>)(payload);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[vitrina-widget] "${event}" handler threw:`, err);
        }
      }
    },
    clear() {
      handlers.clear();
    },
  };
}
