// The lazy boot stub (embed#25): queues API calls, loads widget.js on the first
// trigger, and never loads for a mere subscription.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type W = Window & { vitrinaChatApi?: Record<string, (...a: unknown[]) => unknown>; vitrinaChatQueue?: unknown[][]; vitrinaChat?: unknown };

function withCurrentScript(src: string | null): void {
  const s = document.createElement('script');
  if (src) s.setAttribute('data-src', src);
  Object.defineProperty(document, 'currentScript', { value: s, configurable: true });
}

const injected = (): HTMLScriptElement[] =>
  Array.from(document.head.querySelectorAll('script')).filter((s) => s.src.includes('widget.js'));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  const w = window as W;
  delete w.vitrinaChatApi;
  delete w.vitrinaChatQueue;
  delete w.vitrinaChat;
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('boot stub', () => {
  it('queues calls and loads the widget on the first API call, once', async () => {
    withCurrentScript('https://api.example.com/widget.js');
    await import('../src/boot');
    const w = window as W;
    const handler = (): void => {};
    w.vitrinaChatApi!.on('cta', handler);
    expect(injected()).toHaveLength(0);
    w.vitrinaChatApi!.open();
    w.vitrinaChatApi!.send('hola');
    expect(injected()).toHaveLength(1);
    expect(w.vitrinaChatQueue).toEqual([['on', ['cta', handler]], ['open', []], ['send', ['hola']]]);
  });

  it('loads on the first interaction', async () => {
    withCurrentScript('https://api.example.com/widget.js');
    await import('../src/boot');
    window.dispatchEvent(new Event('pointerdown'));
    expect(injected()).toHaveLength(1);
  });

  it('loads after idle + 4 s without any interaction', async () => {
    withCurrentScript('https://api.example.com/widget.js');
    await import('../src/boot');
    vi.advanceTimersByTime(3_000);
    expect(injected()).toHaveLength(0);
    vi.advanceTimersByTime(10_000);
    expect(injected()).toHaveLength(1);
  });

  it('keeps calls a page queued before the stub arrived', async () => {
    const early: [string, unknown[]] = ['on', ['open', () => {}]];
    (window as W).vitrinaChatQueue = [early];
    withCurrentScript('https://api.example.com/widget.js');
    await import('../src/boot');
    expect((window as W).vitrinaChatQueue![0]).toBe(early);
  });

  it('warns and does nothing without data-src', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withCurrentScript(null);
    await import('../src/boot');
    expect(warn).toHaveBeenCalled();
    expect((window as W).vitrinaChatApi).toBeUndefined();
  });
});
