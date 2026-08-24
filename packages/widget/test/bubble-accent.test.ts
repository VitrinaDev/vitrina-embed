import { describe, expect, it } from 'vitest';

import { STYLES } from '../src/styles';

// happy-dom does not run the CSS cascade, so the trap this suite pins is only
// observable in a real browser: var() substitutes into a custom property at
// computed-value time ON THE DECLARING ELEMENT. Declared on :host,
// --vtr-bubble-in froze to the default accent (#111827) before .vtr-root's
// setProperty('--vtr-accent', …) could matter — visitor bubbles never picked
// up the dealer accent. The invariant is asserted at the stylesheet-source
// level instead: the declaration must live on .vtr-root, the same element
// that carries the resolved --vtr-accent (see the --vtr-font precedent).
describe('inbound bubble accent', () => {
  it('declares --vtr-bubble-in exactly once, on .vtr-root, never on :host', () => {
    const declarations = STYLES.match(/--vtr-bubble-in:/g) ?? [];
    expect(declarations).toHaveLength(1);

    const hostBlock = STYLES.match(/:host \{[^}]*\}/)?.[0] ?? '';
    expect(hostBlock).not.toBe('');
    expect(hostBlock).not.toContain('--vtr-bubble-in');

    const rootRule = STYLES.match(/\.vtr-root \{[^}]*\}/)?.[0] ?? '';
    expect(rootRule).toContain('--vtr-bubble-in: var(--vtr-accent)');
  });

  it('inbound bubbles still read the layered variable', () => {
    expect(STYLES).toContain('background: var(--vtr-bubble-in)');
  });
});
