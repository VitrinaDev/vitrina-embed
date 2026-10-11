import { describe, expect, it } from 'vitest';

import { REF_PATTERN, conversationRef, fnv1a32, handoffText, whatsappHandoffUrl } from '../src/handoff';

describe('conversation reference code (contract with vitrina-app)', () => {
  it('FNV-1a 32 matches the reference vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('is 6 Crockford characters, stable, and differs between conversations', () => {
    const a = conversationRef('web:6f1c2b9e-0000-4000-8000-000000000001');
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(conversationRef('web:6f1c2b9e-0000-4000-8000-000000000001')).toBe(a);
    expect(conversationRef('web:6f1c2b9e-0000-4000-8000-000000000002')).not.toBe(a);
  });

  it('pins a known vector so the server implementation can be checked against it', () => {
    // fnv1a32('foobar') = 0xbf9cf968; >>> 2 -> 30 bits -> 'QYEFJT' (verified with an independent Python implementation).
    expect(conversationRef('foobar')).toBe('QYEFJT');
  });
});

describe('handoff text and URL', () => {
  it('fills {ref} or appends it in the parseable shape', () => {
    expect(handoffText('Hola Tomás, sigo la conversación de la web (ref {ref})', 'K7Q2XM')).toBe(
      'Hola Tomás, sigo la conversación de la web (ref K7Q2XM)',
    );
    const appended = handoffText('Hola, vengo de la web', 'K7Q2XM');
    expect(appended).toBe('Hola, vengo de la web (ref K7Q2XM)');
    expect(appended.match(REF_PATTERN)?.[1]).toBe('K7Q2XM');
  });

  it('drops the ref line when there is no conversation yet', () => {
    expect(handoffText('Hola Tomás, sigo la conversación de la web (ref {ref})', null)).toBe(
      'Hola Tomás, sigo la conversación de la web',
    );
  });

  it('builds a plain wa.me link with the text encoded', () => {
    expect(whatsappHandoffUrl('56912345678', 'Hola (ref {ref})', 'K7Q2XM')).toBe(
      'https://wa.me/56912345678?text=Hola%20(ref%20K7Q2XM)',
    );
  });
});
