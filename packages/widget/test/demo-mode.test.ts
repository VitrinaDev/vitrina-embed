// Demo mode (D60) rules without the DOM.
import { describe, expect, it } from 'vitest';

import { asksAboutProduct, asksToTryDemo, demoKindOf, newDemoSessionId } from '../src/demo-mode';

describe('demoKindOf', () => {
  it('uses the explicit kind, else reads the world name', () => {
    expect(demoKindOf('clinica', 'Automotora Demo')).toBe('clinica');
    expect(demoKindOf(undefined, 'Automotora Demo')).toBe('automotora');
    expect(demoKindOf(null, 'Clínica Demo')).toBe('clinica');
    expect(demoKindOf(null, 'Clinica Demo')).toBe('clinica');
    expect(demoKindOf(null, 'Negocio X')).toBeNull();
    expect(demoKindOf('bancos', null)).toBeNull();
  });
});

describe('asksAboutProduct: only wording about THIS tool leaves the demo', () => {
  it.each([
    '¿y esto cuánto cuesta?',
    'cuánto cuesta el sistema',
    '¿Cuánto cuesta Vitrina?',
    'quiero contratar',
    'quiero una demo con ustedes',
    'quisiera agendar una demo',
    'hablar con una persona',
    '¿tú eres Tomás?',
    'cuánto cobran por usar esto',
  ])('%j leaves the demo', (text) => {
    expect(asksAboutProduct(text)).toBe(true);
  });

  it.each([
    '¿cuánto cuesta la RAV4?',
    'cuánto cuesta el Hilux 2022',
    'quiero ver autos para la familia',
    'tienen horas para mañana',
    '¿cuánto sale un botox?',
    'me das el precio final',
    'puedo agendar una visita para el sábado',
    'quiero agendar una hora de kine',
  ])('%j stays in the demo', (text) => {
    expect(asksAboutProduct(text)).toBe(false);
  });
});

describe('asksToTryDemo', () => {
  it.each(['quiero probar', 'hazte pasar por un cliente', 'escríbeme como tu peor cliente', 'pruébalo', 'modo demo'])(
    '%j is an invitation',
    (text) => expect(asksToTryDemo(text)).toBe(true),
  );
  it.each(['¿cuánto cuesta?', 'quiero agendar', 'hola', 'quiero ver autos'])('%j is not', (text) =>
    expect(asksToTryDemo(text)).toBe(false),
  );
});

describe('newDemoSessionId', () => {
  it('is opaque, within the server pattern, and different each time', () => {
    const a = newDemoSessionId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{6,40}$/);
    expect(newDemoSessionId()).not.toBe(a);
  });
});
