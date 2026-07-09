import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ACCENT,
  resolveAccent,
  resolvePosition,
  sanitizeColor,
  validateLogoUrl,
} from '../src/theme';

describe('sanitizeColor', () => {
  it('accepts valid hex, rgb, hsl and named colors', () => {
    expect(sanitizeColor('#fff')).toBe('#fff');
    expect(sanitizeColor('#1a2b3c')).toBe('#1a2b3c');
    expect(sanitizeColor('#1a2b3cff')).toBe('#1a2b3cff');
    expect(sanitizeColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
    expect(sanitizeColor('rgba(10,20,30,0.5)')).toBe('rgba(10,20,30,0.5)');
    expect(sanitizeColor('hsl(200, 50%, 40%)')).toBe('hsl(200, 50%, 40%)');
    expect(sanitizeColor('crimson')).toBe('crimson');
    expect(sanitizeColor('  BLUE ')).toBe('blue');
  });

  it('rejects CSS-injection attempts', () => {
    expect(sanitizeColor('red; background: url(evil)')).toBeNull();
    expect(sanitizeColor('red}body{display:none')).toBeNull();
    expect(sanitizeColor('url(javascript:alert(1))')).toBeNull();
    expect(sanitizeColor('expression(alert(1))')).toBeNull();
    expect(sanitizeColor('#fff/*comment*/')).toBeNull();
    expect(sanitizeColor('notacolor')).toBeNull();
    expect(sanitizeColor('')).toBeNull();
    expect(sanitizeColor(undefined)).toBeNull();
  });
});

describe('resolveAccent', () => {
  it('returns the sanitized color or the default fallback', () => {
    expect(resolveAccent('#abc')).toBe('#abc');
    expect(resolveAccent('red; evil')).toBe(DEFAULT_ACCENT);
    expect(resolveAccent(undefined)).toBe(DEFAULT_ACCENT);
  });
});

describe('validateLogoUrl', () => {
  it('accepts http and https URLs', () => {
    expect(validateLogoUrl('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png');
    expect(validateLogoUrl('http://example.com/a.png')).toBe('http://example.com/a.png');
  });

  it('rejects javascript: and non-URL garbage', () => {
    expect(validateLogoUrl('javascript:alert(1)')).toBeNull();
    expect(validateLogoUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(validateLogoUrl('not a url')).toBeNull();
    expect(validateLogoUrl('')).toBeNull();
    expect(validateLogoUrl(undefined)).toBeNull();
  });
});

describe('resolvePosition', () => {
  it('defaults to br and honors bl', () => {
    expect(resolvePosition('bl')).toBe('bl');
    expect(resolvePosition('br')).toBe('br');
    expect(resolvePosition(undefined)).toBe('br');
  });
});
