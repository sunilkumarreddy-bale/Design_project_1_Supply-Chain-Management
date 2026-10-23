import {
  classifyABC,
  classifyXYZ,
  coefficientOfVariation,
  daysOfCover,
  estimateDemand,
  policyHint,
  POLICY_HINTS,
  recommendedZ,
} from '../../src/engines/analytics';

describe('ABC classification', () => {
  it('assigns A while the item starts before 80%, B before 95%, else C', () => {
    const r = classifyABC([
      { id: 'a', annualValue: 700 },
      { id: 'b', annualValue: 150 },
      { id: 'c', annualValue: 100 },
      { id: 'd', annualValue: 50 },
    ]);
    const cls = Object.fromEntries(r.map((x) => [x.id, x.abc]));
    // starts: a 0%, b 70%, c 85%, d 95%
    expect(cls).toEqual({ a: 'A', b: 'A', c: 'B', d: 'C' });
    expect(r.find((x) => x.id === 'a')!.share).toBeCloseTo(0.7);
  });
  it('puts zero-value items and an all-zero list in C', () => {
    expect(classifyABC([{ id: 'x', annualValue: 0 }]).map((r) => r.abc)).toEqual(['C']);
    expect(classifyABC([{ id: 'x', annualValue: 10 }, { id: 'y', annualValue: 0 }]).map((r) => r.abc)).toEqual(['A', 'C']);
  });
});

describe('XYZ classification', () => {
  it('uses CV thresholds 0.25 and 0.5', () => {
    expect(classifyXYZ(0.25)).toBe('X');
    expect(classifyXYZ(0.26)).toBe('Y');
    expect(classifyXYZ(0.5)).toBe('Y');
    expect(classifyXYZ(0.51)).toBe('Z');
  });
  it('treats zero demand as Z', () => {
    expect(coefficientOfVariation(0, 1)).toBeNull();
    expect(classifyXYZ(coefficientOfVariation(0, 0))).toBe('Z');
  });
});

describe('recommendations and cover', () => {
  it('recommends z by ABC class', () => {
    expect([recommendedZ('A'), recommendedZ('B'), recommendedZ('C')]).toEqual([2.05, 1.65, 1.28]);
  });
  it('has a hint for all nine classes', () => {
    expect(Object.keys(POLICY_HINTS).sort()).toEqual(['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ']);
    expect(policyHint('C', 'Z')).toMatch(/expiry/);
  });
  it('computes days of cover and null for zero demand', () => {
    expect(daysOfCover(100, 8)).toBe(12.5);
    expect(daysOfCover(100, 0)).toBeNull();
  });
});

describe('estimateDemand', () => {
  const now = new Date('2026-03-31T10:00:00Z');
  const day = (n: number) => new Date(Date.UTC(2026, 2, 31 - n));
  it('falls back when fewer than 7 days of history exist', () => {
    const h = [1, 2, 3].map((n) => ({ date: day(n), quantity: 10 }));
    expect(estimateDemand(h, 4, 30, now)).toEqual({ mean: 4, std: 0, samples: 3, source: 'fallback' });
  });
  it('averages the last 30 full days, counting missing days as zero and excluding today', () => {
    const h = Array.from({ length: 15 }, (_, i) => ({ date: day(i + 1), quantity: 20 }));
    h.push({ date: day(0), quantity: 1000 });
    const e = estimateDemand(h, 4, 30, now);
    expect(e.source).toBe('history');
    expect(e.samples).toBe(15);
    expect(e.mean).toBe(10);
    expect(e.std).toBeCloseTo(Math.sqrt((30 * 100) / 29), 10);
  });
  it('returns constant history with zero std', () => {
    const h = Array.from({ length: 30 }, (_, i) => ({ date: day(i + 1), quantity: 120 }));
    expect(estimateDemand(h, 1, 30, now)).toMatchObject({ mean: 120, std: 0, source: 'history' });
  });
});
