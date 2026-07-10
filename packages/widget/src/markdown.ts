// A deliberately small markdown renderer that builds DOM NODES.
//
// WHY THIS EXISTS. The platform tells the AI, in the `web` channel guide, that
// "markdown renders in the web widget" and "inline links are encouraged (the
// widget renders them as clickable)". Both statements were false: every reply
// was painted with `textContent`. The moment a dealer enables the webchat AI,
// the first reply a visitor reads contains literal asterisks and bracket
// syntax. This module makes the guide true.
//
// WHY NOT A MARKDOWN LIBRARY. The widget's central safety property is that it
// contains no `innerHTML`, anywhere — a property its tests assert and its
// Shadow-DOM isolation depends on. Every markdown library produces an HTML
// STRING, which you then have to sanitize and assign to `innerHTML`. That
// trades a structural guarantee ("HTML is never parsed") for a behavioural one
// ("our sanitizer is correct"), and it costs roughly four times the widget's
// entire current bundle to do it.
//
// So: no HTML string is ever produced. Text becomes text nodes; emphasis
// becomes `<strong>`/`<em>` elements; a link becomes an `<a>` whose href passed
// `validateHttpUrl`. An injected `<img src=x onerror=...>` is a text node, in
// every path, because there is no path that parses HTML.
//
// THE SUBSET, and nothing else:
//
//   **bold**            *italic*            `inline code`
//   [label](https://…)  - bullet lists      1. numbered lists
//   newlines
//
// Not supported, on purpose: headings, tables, images, blockquotes, fenced code
// blocks, `_underscore_` emphasis (it mangles snake_case and model output rarely
// needs it), and nested lists (they flatten to one level). `src/agents/channels/
// web.md` documents exactly this set for the model. If you widen the subset,
// widen the guide in the same commit.

import { validateHttpUrl } from './theme';

/** Guard against a pathological `**a *b `c` d* e**` nesting chain. */
const MAX_DEPTH = 4;

// Alternatives are ordered so the longer delimiter wins: `**bold**` is tried
// before `*italic*`, and inline code is tried before everything (its content is
// never re-parsed).
//
//   1 = code content
//   2 = link label, 3 = link href
//   4 = bold content
//   5 = italic content
//
// Every content class excludes newlines, so an unterminated `*` cannot swallow
// the rest of the message — it simply fails to match and stays a literal
// asterisk, which is the correct rendering of unbalanced emphasis.
//
// Bold content is lazy (`[^\n]+?`) rather than `[^*\n]+` so that `**a *b* c**`
// nests: the inner `*b*` is found when the bold content is re-parsed. Italic
// content excludes `*` and so does not nest bold, which is fine — the model
// writes `**bold**` inside prose, not `*italic **bold** italic*`.
const INLINE = new RegExp(
  [
    '`([^`\\n]+)`',
    '\\[([^\\]\\n]*)\\]\\(([^()\\s]+)\\)',
    '\\*\\*([^\\n]+?)\\*\\*',
    '\\*([^*\\n]+)\\*',
  ]
    .map((s) => `(?:${s})`)
    .join('|'),
  'g',
);

const BULLET_ITEM = /^\s{0,3}[-*+]\s+(.+)$/;
const ORDERED_ITEM = /^\s{0,3}\d{1,9}[.)]\s+(.+)$/;

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] };

const text = (value: string): Text => document.createTextNode(value);

/**
 * Build an anchor, or fall back to inert text. A label is rendered through the
 * inline parser (so `[**Corolla**](…)` bolds), but never as HTML — an
 * `<b>` in a label is a text node like anything else.
 */
function link(label: string, href: string, raw: string, depth: number): Node {
  const safe = validateHttpUrl(href);
  if (!safe) {
    // `javascript:`, `data:`, a relative path, anything unparseable. Emit the
    // ORIGINAL markdown source as text: the visitor sees something odd rather
    // than a link-looking thing that silently does nothing.
    return text(raw);
  }
  const a = document.createElement('a');
  a.className = 'vtr-link';
  a.href = safe;
  a.target = '_blank';
  // noopener: the opened page cannot reach back through window.opener.
  // noreferrer: the dealer's page URL does not leak to the link target.
  a.rel = 'noopener noreferrer';
  const inner = label.trim() === '' ? [text(safe)] : renderInline(label, depth + 1);
  for (const node of inner) a.appendChild(node);
  return a;
}

/** Parse one line's inline markup into DOM nodes. Never returns an HTML string. */
export function renderInline(source: string, depth = 0): Node[] {
  if (depth >= MAX_DEPTH) return [text(source)];

  const out: Node[] = [];
  let lastIndex = 0;
  // A fresh regex per call: `INLINE` is /g and therefore stateful, and this
  // function recurses.
  const re = new RegExp(INLINE.source, 'g');
  let m: RegExpExecArray | null = re.exec(source);

  while (m !== null) {
    if (m.index > lastIndex) out.push(text(source.slice(lastIndex, m.index)));

    const [raw, code, label, href, bold, italic] = m;
    if (code !== undefined) {
      const el = document.createElement('code');
      el.className = 'vtr-code';
      // Code content is LITERAL: never re-parsed, so `` `**x**` `` shows stars.
      el.textContent = code;
      out.push(el);
    } else if (href !== undefined) {
      out.push(link(label ?? '', href, raw, depth));
    } else if (bold !== undefined) {
      const el = document.createElement('strong');
      for (const node of renderInline(bold, depth + 1)) el.appendChild(node);
      out.push(el);
    } else if (italic !== undefined) {
      const el = document.createElement('em');
      for (const node of renderInline(italic, depth + 1)) el.appendChild(node);
      out.push(el);
    }

    lastIndex = m.index + raw.length;
    // Zero-length matches are impossible (every alternative has a + quantifier),
    // but guard the loop anyway.
    if (re.lastIndex === m.index) re.lastIndex += 1;
    m = re.exec(source);
  }

  if (lastIndex < source.length) out.push(text(source.slice(lastIndex)));
  return out;
}

/**
 * Group lines into blocks. Consecutive list items of the same kind form one
 * list; everything else accumulates into a paragraph block whose lines are
 * rejoined with newlines (the bubble is `white-space: pre-wrap`, so they break).
 *
 * An indented item joins the list it is inside rather than nesting — see the
 * module header. Flattening is the honest degradation: the visitor reads all
 * the items, just without the indent.
 */
function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] | null = null;
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = (): void => {
    if (para) blocks.push({ kind: 'p', lines: para });
    para = null;
  };
  const flushList = (): void => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const line of source.split('\n')) {
    const bullet = BULLET_ITEM.exec(line);
    const ordered = bullet ? null : ORDERED_ITEM.exec(line);
    const kind = bullet ? 'ul' : ordered ? 'ol' : null;

    if (kind) {
      flushPara();
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }

    flushList();
    if (!para) para = [];
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/**
 * Render markdown into a DocumentFragment of real nodes.
 *
 * Only ever called on SERVER-authored content (the dealer's or the AI's reply,
 * and the dealer-configured welcome greeting). The visitor's own messages are
 * still painted with `textContent`: they typed plain text, and parsing it would
 * both mangle it and needlessly widen what gets parsed.
 */
export function renderMarkdown(source: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (typeof source !== 'string' || source === '') return frag;

  // Trailing blank lines would render as trailing gaps under pre-wrap.
  for (const block of parseBlocks(source.replace(/\s+$/, ''))) {
    if (block.kind === 'p') {
      // Blocks alternate paragraph/list, and a list is block-level, so no
      // separator node is needed between them.
      block.lines.forEach((line, i) => {
        if (i > 0) frag.appendChild(text('\n'));
        for (const node of renderInline(line)) frag.appendChild(node);
      });
      continue;
    }
    const listEl = document.createElement(block.kind);
    listEl.className = 'vtr-list';
    for (const item of block.items) {
      const li = document.createElement('li');
      for (const node of renderInline(item)) li.appendChild(node);
      listEl.appendChild(li);
    }
    frag.appendChild(listEl);
  }
  return frag;
}
