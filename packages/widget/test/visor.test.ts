import { describe, expect, it } from 'vitest';

import { centroid, parseStatus, parseVisor, priceText, refreshMs, statusChanges, unitTitle, type Point } from '../src/visor';

describe('visor pure rules', () => {
  it('never polls faster than 10 s and defaults to 30 s', () => {
    expect(refreshMs(undefined)).toBe(30_000);
    expect(refreshMs(2)).toBe(10_000);
    expect(refreshMs(45)).toBe(45_000);
  });

  it('reports only the unidades whose status changed', () => {
    const cur = new Map<string, 'disponible' | 'reservada'>([['a', 'disponible'], ['b', 'reservada']]);
    const next = [{ id: 'a', status: 'reservada' as const }, { id: 'b', status: 'reservada' as const }, { id: 'zz', status: 'vendida' as const }];
    expect([...statusChanges(cur, next)]).toEqual([['a', 'reservada']]);
  });

  it('puts the label of an L-shaped unidad inside it', () => {
    const l: Point[] = [[0, 0], [1, 0], [1, 0.25], [0.25, 0.25], [0.25, 1], [0, 1]];
    const [x, y] = centroid(l);
    expect(x < 0.5 && y < 0.5).toBe(true);
  });

  it('treats a malformed body as no visor and drops unknown statuses', () => {
    expect(parseVisor({ data: {} })).toBeNull();
    expect(parseStatus(null)).toBeNull();
    const v = parseVisor({ data: { floor_plans: [], units: [{ id: 'a', status: 'disponible' }, { id: 'b', status: 'weird' }] } });
    expect(v?.units.map((u) => u.id)).toEqual(['a']);
  });

  it('shows a price only when the server sent one, and names the unidad', () => {
    expect(priceText(null)).toBeNull();
    expect(priceText({ amount: 2890.5, currency: 'UF' })).toContain('UF');
    expect(unitTitle({ kind: 'departamento', unit_number: '501' })).toBe('Departamento 501');
  });
});
