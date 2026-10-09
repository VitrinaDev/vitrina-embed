// Spanish dates are lowercase except where they open a line (vitrina-app#3957).
//
// The prod widget E2E showed «Domingo, 11 De Octubre» and «Octubre De 2026»:
// CSS `text-transform: capitalize` title-cased every word Intl had already got
// right. The fix lives in the shared formatters — sentence case at the start
// of a line, Intl's own lowercase mid-sentence — and the CSS no longer
// touches the text at all.

import { describe, expect, it } from 'vitest';

import { dateCase, formatDayLong, formatMonth } from '../src/booking-ui';
import { STYLES } from '../src/styles';

describe('Spanish date casing', () => {
  it('opens a line with only the first letter up', () => {
    expect(formatDayLong('2026-10-11', 'es')).toBe('Domingo, 11 de octubre');
    expect(formatMonth(new Date(2026, 9, 1), 'es')).toBe('Octubre de 2026');
  });

  it('keeps Intl lowercase mid-sentence (the deposit deadline)', () => {
    expect(formatDayLong('2026-10-09', 'es', 'inline')).toBe('viernes, 9 de octubre');
  });

  it('leaves English as Intl writes it', () => {
    expect(formatDayLong('2026-10-11', 'en')).toBe('Sunday, October 11');
    expect(formatDayLong('2026-10-11', 'en', 'inline')).toBe('Sunday, October 11');
    expect(formatMonth(new Date(2026, 9, 1), 'en')).toBe('October 2026');
  });

  it('upper-cases one letter, never a word per word', () => {
    expect(dateCase('miércoles, 12 de agosto', 'es')).toBe('Miércoles, 12 de agosto');
    expect(dateCase('', 'es')).toBe('');
  });

  it('no stylesheet rule re-capitalises the text', () => {
    expect(STYLES).not.toMatch(/text-transform:\s*capitalize/);
  });
});
