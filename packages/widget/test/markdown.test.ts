// X2 — the AI's markdown actually renders.
//
// Two properties are under test, and the second matters more than the first:
//
//   1. The promised subset renders (bold, italic, code, links, lists, newlines).
//   2. NOTHING escapes into HTML. The renderer builds nodes; it never produces
//      an HTML string, so there is no sanitizer to be wrong. The adversarial
//      block below is the real specification.

import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../src/markdown';

/** Render into a detached host so we can query it like a bubble. */
function render(source: string): HTMLElement {
  const host = document.createElement('div');
  host.appendChild(renderMarkdown(source));
  return host;
}

describe('renderMarkdown: the promised subset', () => {
  it('renders **bold** as <strong>', () => {
    const el = render('el **Corolla** es 2020');
    expect(el.querySelector('strong')?.textContent).toBe('Corolla');
    expect(el.textContent).toBe('el Corolla es 2020');
  });

  it('renders *italic* as <em>', () => {
    const el = render('es *casi* nuevo');
    expect(el.querySelector('em')?.textContent).toBe('casi');
  });

  it('renders `inline code` as <code>, and never re-parses its content', () => {
    const el = render('escribe `**no bold**` aquí');
    const code = el.querySelector('code');
    expect(code?.textContent).toBe('**no bold**');
    // The stars inside code did NOT become a <strong>.
    expect(el.querySelector('strong')).toBeNull();
  });

  it('renders a link with target=_blank and rel=noopener noreferrer', () => {
    const el = render('mira el [Corolla 2020](https://dealer.cl/stock/42)');
    const a = el.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://dealer.cl/stock/42');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.textContent).toBe('Corolla 2020');
  });

  it('renders bullet lists', () => {
    const el = render('tenemos:\n- Corolla\n- Yaris\n- Hilux');
    const items = [...el.querySelectorAll('ul li')].map((li) => li.textContent);
    expect(items).toEqual(['Corolla', 'Yaris', 'Hilux']);
  });

  it('renders numbered lists', () => {
    const el = render('pasos:\n1. Agenda\n2. Visita\n3. Prueba');
    const items = [...el.querySelectorAll('ol li')].map((li) => li.textContent);
    expect(items).toEqual(['Agenda', 'Visita', 'Prueba']);
  });

  it('keeps newlines in prose (the bubble is pre-wrap)', () => {
    const el = render('linea uno\nlinea dos');
    expect(el.textContent).toBe('linea uno\nlinea dos');
  });

  it('renders inline markup INSIDE list items and link labels', () => {
    const el = render('- el **Corolla**\n- el [Yaris](https://d.cl/y)');
    expect(el.querySelector('li strong')?.textContent).toBe('Corolla');
    expect(el.querySelector('li a')?.textContent).toBe('Yaris');
  });

  it('switches list kind without merging them', () => {
    const el = render('- a\n1. b');
    expect(el.querySelectorAll('ul li')).toHaveLength(1);
    expect(el.querySelectorAll('ol li')).toHaveLength(1);
  });
});

describe('renderMarkdown: nothing ever becomes HTML', () => {
  it('an injected <img onerror> is a TEXT node, not an element', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const el = render(payload);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe(payload);
  });

  it('an HTML tag inside a LINK LABEL stays text', () => {
    const el = render('[<b>click</b>](https://ok.cl)');
    const a = el.querySelector('a') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.querySelector('b')).toBeNull();
    expect(a.textContent).toBe('<b>click</b>');
  });

  it('an HTML tag inside BOLD stays text', () => {
    const el = render('**<script>x</script>**');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('strong')?.textContent).toBe('<script>x</script>');
  });

  it('a javascript: href renders as INERT TEXT — no anchor at all', () => {
    const el = render('[click](javascript:alert%281%29)');
    expect(el.querySelector('a')).toBeNull();
    // The original source is shown, so the visitor sees something odd rather
    // than a link-looking thing that silently does nothing.
    expect(el.textContent).toBe('[click](javascript:alert%281%29)');
  });

  it('a javascript: href with parentheses never even parses as a link', () => {
    const el = render('[click](javascript:alert(1))');
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('[click](javascript:alert(1))');
  });

  it('rejects data:, vbscript: and relative hrefs', () => {
    for (const href of ['data:text/html,<script>1</script>', 'vbscript:msgbox', '/stock/42']) {
      const el = render(`[x](${href})`);
      expect(el.querySelector('a')).toBeNull();
    }
  });

  it('never sets an href the URL validator did not approve', () => {
    const el = render('[a](https://ok.cl) [b](javascript:1) [c](http://ok.cl)');
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://ok.cl/', 'http://ok.cl/']);
  });
});

describe('renderMarkdown: adversarial and degenerate input', () => {
  it('unbalanced emphasis stays a literal asterisk and does not swallow the message', () => {
    const el = render('precio: 5*000*000 y **sin cerrar');
    // `*000*` IS balanced, so it italicises — that is correct markdown.
    expect(el.querySelector('em')?.textContent).toBe('000');
    // The unterminated `**` stays literal; nothing after it is eaten.
    expect(el.textContent).toContain('**sin cerrar');
    expect(el.querySelector('strong')).toBeNull();
  });

  it('an unterminated delimiter cannot span lines', () => {
    const el = render('**abre\ncierra**');
    expect(el.querySelector('strong')).toBeNull();
    expect(el.textContent).toBe('**abre\ncierra**');
  });

  it('a nested list flattens to one level rather than breaking', () => {
    const el = render('- a\n  - b\n- c');
    const items = [...el.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('deeply nested emphasis terminates (no runaway recursion)', () => {
    const el = render('**a *b `c` d* e**');
    expect(el.querySelector('strong')).toBeTruthy();
    expect(el.textContent).toBe('a b c d e');
  });

  it('an empty link label falls back to the href as its text', () => {
    const el = render('[](https://dealer.cl/x)');
    expect(el.querySelector('a')?.textContent).toBe('https://dealer.cl/x');
  });

  it('handles empty and whitespace-only input', () => {
    expect(render('').textContent).toBe('');
    expect(render('   \n  ').textContent).toBe('');
  });

  it('a lone asterisk at line start is not a bullet', () => {
    const el = render('*enfatizado*');
    expect(el.querySelector('ul')).toBeNull();
    expect(el.querySelector('em')?.textContent).toBe('enfatizado');
  });

  it('does not mangle snake_case (underscore emphasis is unsupported on purpose)', () => {
    const el = render('el campo client_message_id viaja');
    expect(el.textContent).toBe('el campo client_message_id viaja');
    expect(el.querySelector('em')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The structural guarantee, asserted structurally.
//
// Every markdown library hands you an HTML string, which you then sanitize and
// assign to innerHTML. That swaps "HTML is never parsed" for "our sanitizer is
// correct". This test fails the moment someone reaches for the easy path.
// ---------------------------------------------------------------------------
describe('the widget source contains no innerHTML, anywhere', () => {
  it('no src/*.ts assigns innerHTML / outerHTML / insertAdjacentHTML / document.write', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    const dir = join(process.cwd(), 'src');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const body = readFileSync(join(dir, file), 'utf8');
      // Strip comments: this very rule is discussed in prose in markdown.ts.
      const code = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(code)) offenders.push(file);
      if (/document\s*\.\s*write\b/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
