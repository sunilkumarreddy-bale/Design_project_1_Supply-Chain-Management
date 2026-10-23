import { canonicalize, ChainEntry, computeHash, GENESIS_HASH, verifyChain } from '../../src/engines/hashChain';

function chain(n: number): ChainEntry[] {
  const out: ChainEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const base = {
      seq: i,
      action: 'stock.receive',
      entityType: 'StockLevel',
      entityId: `e${i}`,
      actor: 'u1',
      warehouse: 'w1',
      before: { quantity: i * 10 },
      after: { quantity: i * 10 + 5, nested: { b: 1, a: 2 } },
      metadata: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    };
    const hash = computeHash(prev, base);
    out.push({ ...base, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('canonicalize', () => {
  it('sorts keys, drops undefined and nulls non-finite numbers', () => {
    expect(canonicalize({ b: 1, a: { d: undefined, c: [1, NaN, Infinity] }, e: new Date('2026-01-01T00:00:00Z') })).toBe(
      '{"a":{"c":[1,null,null]},"b":1,"e":"2026-01-01T00:00:00.000Z"}',
    );
  });
  it('is independent of key order', () => {
    expect(canonicalize({ x: 1, y: { q: 2, p: 3 } })).toBe(canonicalize({ y: { p: 3, q: 2 }, x: 1 }));
  });
});

describe('verifyChain', () => {
  it('accepts a valid chain and reports the head', () => {
    const c = chain(5);
    expect(verifyChain(c)).toEqual({ valid: true, checked: 5, headSeq: 5, headHash: c[4].hash });
  });
  it('accepts an empty chain', () => {
    expect(verifyChain([])).toEqual({ valid: true, checked: 0, headSeq: null, headHash: null });
  });
  it('detects an edited entry', () => {
    const c = chain(5);
    c[2] = { ...c[2], after: { quantity: 9999 } };
    expect(verifyChain(c)).toEqual({
      valid: false,
      checked: 2,
      brokenAtSeq: 3,
      reason: 'Entry contents do not match its stored hash (the record was modified)',
    });
  });
  it('detects a deleted entry as a sequence gap', () => {
    const c = chain(5);
    c.splice(1, 1);
    const r = verifyChain(c);
    expect(r).toMatchObject({ valid: false, brokenAtSeq: 3 });
    expect((r as { reason: string }).reason).toMatch(/Sequence gap.*deleted or inserted/);
  });
  it('detects reordered entries', () => {
    const c = chain(4);
    [c[1], c[2]] = [c[2], c[1]];
    expect(verifyChain(c)).toMatchObject({ valid: false, brokenAtSeq: 3 });
  });
  it('detects a rehashed entry whose link to the previous entry is broken', () => {
    const c = chain(4);
    const edited = { ...c[2], after: { quantity: 1 } };
    edited.hash = computeHash(edited.prevHash, edited);
    c[2] = edited;
    const r = verifyChain(c);
    expect(r).toMatchObject({ valid: false, brokenAtSeq: 4 });
    expect((r as { reason: string }).reason).toMatch(/prevHash does not match/);
  });
  it('requires the genesis entry to link to 64 zeros and start at seq 1', () => {
    const c = chain(2);
    expect(verifyChain([{ ...c[0], prevHash: 'f'.repeat(64) }])).toMatchObject({ valid: false, brokenAtSeq: 1 });
    expect(verifyChain(c.slice(1))).toMatchObject({ valid: false, brokenAtSeq: 2 });
  });
});
