import {
  ALIVE_STATUSES,
  analyseLocations,
  applyGene,
  canTransition,
  DEAD_STATUSES,
  depletionPct,
  emptyOut,
  geneHash,
  GeneInput,
  GeneType,
  hashFieldsOf,
  initialLotState,
  invariantHolds,
  LOT_STATUSES,
  LotState,
  LotStatus,
  lotMetrics,
  lifeUsedPct,
  pickFefoLots,
  reconcileLots,
  remainingShelfDays,
  sealLot,
  shouldDie,
  traceBackward,
  traceForward,
  TRANSITIONS,
  verifyLotChain,
  StoredGene,
  TraceLot,
} from '../../src/engines/dnaEngine';
import { GENESIS_HASH } from '../../src/engines/hashChain';

const D = (iso: string) => new Date(iso);
const born = (qty = 100, hold = false) => applyGene(initialLotState(), { type: 'born', qty, hold }).state;
const run = (s: LotState, ...genes: GeneInput[]) => genes.reduce((st, g) => applyGene(st, g).state, s);

describe('gene catalogue: counter effects (C.5)', () => {
  it('born sets qtyBorn and on hand; active, or quarantine when held', () => {
    const s = born(500);
    expect(s).toMatchObject({ status: 'active', qtyBorn: 500, qtyOnHand: 500, eventCount: 1 });
    expect(born(10, true)).toMatchObject({
      status: 'quarantine',
      flags: expect.objectContaining({ onHold: true }),
    });
  });

  it('receive_more adds to qtyAdded and on hand', () => {
    expect(run(born(100), { type: 'receive_more', qty: 40 })).toMatchObject({ qtyAdded: 40, qtyOnHand: 140 });
  });

  it('qc_hold, qc_release and qc_reject change status and flags only', () => {
    const held = run(born(100), { type: 'qc_hold' });
    expect(held).toMatchObject({
      status: 'quarantine',
      qtyOnHand: 100,
      flags: expect.objectContaining({ onHold: true }),
    });
    expect(run(held, { type: 'qc_release' })).toMatchObject({
      status: 'active',
      flags: expect.objectContaining({ onHold: false }),
    });
    const rejected = run(held, { type: 'qc_reject' });
    expect(rejected.flags.qcRejected).toBe(true);
    expect(() => run(rejected, { type: 'qc_release' })).toThrow(/rejected at QC/);
    expect(() => run(born(5), { type: 'qc_reject' })).toThrow(/quarantine/);
  });

  it('put_away, pick_fefo, decision_note and expiry_warning change no quantity', () => {
    for (const t of ['put_away', 'decision_note', 'expiry_warning'] as GeneType[]) {
      const e = applyGene(born(100), { type: t });
      expect(e).toMatchObject({
        qtyDelta: 0,
        state: expect.objectContaining({ qtyOnHand: 100, qtyInTransit: 0 }),
      });
    }
    const p = applyGene(born(100), { type: 'pick_fefo', qty: 30 });
    expect(p).toMatchObject({
      qtyDelta: 0,
      qtyMoved: 30,
      state: expect.objectContaining({ qtyOnHand: 100 }),
    });
    expect(() => run(born(5), { type: 'expiry_warning' }, { type: 'expiry_warning' })).toThrow(/already/);
  });

  it('transfer_out moves on hand to in transit; transfer_in moves it back', () => {
    const out = run(born(500), { type: 'transfer_out', qty: 380 });
    expect(out).toMatchObject({ qtyOnHand: 120, qtyInTransit: 380 });
    expect(run(out, { type: 'transfer_in', qty: 380 })).toMatchObject({ qtyOnHand: 500, qtyInTransit: 0 });
    expect(() => run(out, { type: 'transfer_in', qty: 400 })).toThrow(/in transit/);
  });

  it('reserve and release_reserve track a reservation without moving stock', () => {
    const r = run(born(100), { type: 'reserve', qty: 60 });
    expect(r).toMatchObject({ qtyReserved: 60, qtyOnHand: 100 });
    expect(() => run(r, { type: 'reserve', qty: 50 })).toThrow(/unreserved/);
    expect(run(r, { type: 'release_reserve', qty: 60 })).toMatchObject({ qtyReserved: 0 });
  });

  it('dispatch_sale, consume, damage and return_to_supplier take from on hand into their cause', () => {
    const s = run(
      born(100),
      { type: 'dispatch_sale', qty: 10 },
      { type: 'consume', qty: 5 },
      { type: 'damage', qty: 3 },
      { type: 'return_to_supplier', qty: 2 },
    );
    expect(s.qtyOnHand).toBe(80);
    expect(s.qtyOutByCause).toMatchObject({ sold: 10, consumed: 5, damaged: 3, returnedToSupplier: 2 });
    expect(() => run(born(5), { type: 'dispatch_sale', qty: 6 })).toThrow(/has 5 on hand/);
  });

  it('count_adjust: negative is shrinkage, positive is qtyAdded', () => {
    expect(run(born(100), { type: 'count_adjust', qty: -7 })).toMatchObject({
      qtyOnHand: 93,
      qtyOutByCause: expect.objectContaining({ shrinkage: 7 }),
    });
    expect(run(born(100), { type: 'count_adjust', qty: 4 })).toMatchObject({ qtyOnHand: 104, qtyAdded: 4 });
    expect(() => run(born(100), { type: 'count_adjust', qty: 0 })).toThrow(/non-zero/);
  });

  it('expire sets status expired; expired stock cannot be sold but can be disposed as expired', () => {
    const e = run(born(120), { type: 'expire' });
    expect(e.status).toBe('expired');
    expect(() => run(e, { type: 'dispatch_sale', qty: 1 })).toThrow(/expired/);
    expect(() => run(born(120), { type: 'write_off', qty: 10, cause: 'expired' })).toThrow(
      /Only an expired lot/,
    );
    expect(run(e, { type: 'write_off', qty: 120, cause: 'expired' })).toMatchObject({
      qtyOnHand: 0,
      qtyOutByCause: expect.objectContaining({ expired: 120 }),
    });
  });

  it('recall_flag blocks sale and transfer; recall_clear restores them', () => {
    const r = run(born(50), { type: 'recall_flag' });
    expect(r.flags.recalled).toBe(true);
    expect(() => run(r, { type: 'dispatch_sale', qty: 1 })).toThrow(/recalled/);
    expect(() => run(r, { type: 'transfer_out', qty: 1 })).toThrow(/recalled/);
    expect(run(r, { type: 'recall_clear' }, { type: 'dispatch_sale', qty: 1 }).qtyOnHand).toBe(49);
    expect(run(r, { type: 'write_off', qty: 50, cause: 'recalled' }).qtyOutByCause.recalled).toBe(50);
  });

  it('write_off maps each cause to its counter and rejects missing or unknown causes', () => {
    expect(run(born(10), { type: 'write_off', qty: 2, cause: 'damaged' }).qtyOutByCause.damaged).toBe(2);
    expect(run(born(10), { type: 'write_off', qty: 2, cause: 'written_off' }).qtyOutByCause.writtenOff).toBe(
      2,
    );
    const rej = run(
      born(10, true),
      { type: 'qc_reject' },
      { type: 'write_off', qty: 10, cause: 'rejected_at_qc' },
    );
    expect(rej.qtyOutByCause.writtenOff).toBe(10);
    expect(() => run(born(10), { type: 'write_off', qty: 2 })).toThrow(/needs a cause/);
  });

  it('the first gene must be born, a lot is born once, and the death gene cannot be applied directly', () => {
    expect(() => applyGene(initialLotState(), { type: 'put_away' })).toThrow(/must be born/);
    expect(() => run(born(5), { type: 'born', qty: 5 })).toThrow(/born only once/);
    expect(() => run(born(5), { type: 'death' })).toThrow(/sealLot/);
  });
});

describe('invariant under random valid sequences (property test, seeded)', () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('qtyBorn + qtyAdded = onHand + inTransit + sum(out) after each of 200 events, for 25 seeds', () => {
    const types: GeneType[] = [
      'receive_more',
      'transfer_out',
      'transfer_in',
      'reserve',
      'release_reserve',
      'pick_fefo',
      'dispatch_sale',
      'consume',
      'count_adjust',
      'damage',
      'return_to_supplier',
      'write_off',
      'put_away',
      'decision_note',
      'recall_flag',
      'recall_clear',
      'qc_hold',
      'qc_release',
    ];
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed);
      let s = born(5000 + Math.floor(r() * 500));
      let applied = 0;
      let attempts = 0;
      while (applied < 200 && attempts < 5000) {
        attempts++;
        if (shouldDie(s)) break;
        const type = types[Math.floor(r() * types.length)];
        const qty = 1 + Math.floor(r() * 40);
        const gene: GeneInput = {
          type,
          qty: type === 'count_adjust' ? (r() < 0.5 ? -qty : qty) : qty,
          cause: type === 'write_off' ? (r() < 0.5 ? 'damaged' : 'written_off') : undefined,
        };
        try {
          s = applyGene(s, gene).state;
        } catch {
          continue;
        }
        applied++;
        expect(invariantHolds(s)).toBe(true);
        expect(s.qtyOnHand).toBeGreaterThanOrEqual(0);
        expect(s.qtyInTransit).toBeGreaterThanOrEqual(0);
        expect(s.qtyReserved).toBeLessThanOrEqual(s.qtyOnHand);
      }
      expect(applied).toBe(200);
    }
  });
});

describe('life-state transitions (C.4)', () => {
  it('accepts every allowed move and rejects every other one', () => {
    for (const from of LOT_STATUSES) {
      for (const to of LOT_STATUSES) {
        expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
      }
    }
    expect(canTransition(null, 'active')).toBe(true);
    expect(canTransition(null, 'quarantine')).toBe(true);
    expect(canTransition(null, 'expired')).toBe(false);
    expect(TRANSITIONS.quarantine).toEqual(expect.arrayContaining(['active', 'written_off']));
    expect(TRANSITIONS.active).toEqual(expect.arrayContaining(['expired', 'depleted', 'written_off']));
    expect(TRANSITIONS.expired).toEqual(['expired_disposed', 'recalled_destroyed', 'returned_to_supplier']);
    for (const d of DEAD_STATUSES) expect(TRANSITIONS[d]).toEqual([]);
  });

  it('a dead lot rejects every gene', () => {
    const s = run(born(10), { type: 'dispatch_sale', qty: 10 });
    expect(shouldDie(s)).toBe(true);
    const dead = sealLot(s, 'sold_out', { at: D('2026-01-05'), bornAt: D('2026-01-01'), unitCost: 25 }).state;
    expect(dead.status).toBe('depleted');
    expect(() => applyGene(dead, { type: 'decision_note' })).toThrow(/sealed/);
    expect(() =>
      sealLot(dead, 'sold_out', { at: D('2026-01-06'), bornAt: D('2026-01-01'), unitCost: 25 }),
    ).toThrow(/Cannot seal/);
    expect(ALIVE_STATUSES).not.toContain(dead.status as LotStatus);
  });

  it('sealLot picks the terminal status and the value lost per cause', () => {
    const exp = run(
      born(500),
      { type: 'transfer_out', qty: 380 },
      { type: 'transfer_in', qty: 380 },
      { type: 'dispatch_sale', qty: 380 },
      { type: 'expire' },
      { type: 'write_off', qty: 120, cause: 'expired' },
    );
    const { state, death } = sealLot(exp, 'expired', {
      at: D('2026-01-07T00:00:00Z'),
      bornAt: D('2026-01-01T00:00:00Z'),
      unitCost: 25,
      manufactureDate: D('2026-01-01T00:00:00Z'),
      expiryDate: D('2026-01-07T00:00:00Z'),
    });
    expect(state.status).toBe('expired_disposed');
    expect(death).toEqual({
      at: D('2026-01-07T00:00:00Z'),
      cause: 'expired',
      lifespanDays: 6,
      lifeUsedPct: 1,
      valueLost: 3000,
    });
    const sold = sealLot(run(born(10), { type: 'dispatch_sale', qty: 10 }), 'sold_out', {
      at: D('2026-01-03'),
      bornAt: D('2026-01-01'),
      unitCost: 25,
    });
    expect(sold.death.valueLost).toBe(0);
    const ret = sealLot(run(born(10), { type: 'return_to_supplier', qty: 10 }), 'returned_to_supplier', {
      at: D('2026-01-03'),
      bornAt: D('2026-01-01'),
      unitCost: 25,
    });
    expect(ret.state.status).toBe('returned_to_supplier');
  });
});

describe('per-lot hash chain and anchors (C.6)', () => {
  const LOT = '65a000000000000000000001';
  function chain(n: number, endWithDeath = false): StoredGene[] {
    const out: StoredGene[] = [];
    let prev = GENESIS_HASH;
    for (let i = 1; i <= n; i++) {
      const type = i === 1 ? 'born' : endWithDeath && i === n ? 'death' : 'dispatch_sale';
      const g: Record<string, unknown> = {
        lot: LOT,
        seq: i,
        type,
        at: new Date(Date.UTC(2026, 0, i)),
        actor: null,
        warehouse: 'w1',
        qtyDelta: i === 1 ? 100 : -1,
        qtyMoved: i === 1 ? 0 : 1,
        qtyAfter: { onHand: 100 - (i - 1), inTransit: 0 },
        explanation: `event ${i}`,
      };
      const hash = geneHash(prev, hashFieldsOf(g));
      out.push({ ...g, prevHash: prev, hash } as StoredGene);
      prev = hash;
    }
    return out;
  }
  const header = (g: StoredGene[]) => ({
    eventCount: g.length,
    headHash: g.length ? g[g.length - 1].hash : null,
  });
  const anchorsOf = (g: StoredGene[]) => new Map(g.map((x) => [x.seq, x.hash]));

  it('an untouched chain verifies, including the anchors', () => {
    const g = chain(6);
    expect(verifyLotChain(g, header(g), anchorsOf(g))).toEqual({
      ok: true,
      eventsChecked: 6,
      firstBrokenSeq: null,
      reason: null,
      anchoredOk: true,
      anchorProblems: [],
    });
  });

  it('editing one field breaks the chain at that event', () => {
    const g = chain(6);
    const h = header(g);
    g[3] = { ...g[3], qtyMoved: 50 };
    const r = verifyLotChain(g, h, anchorsOf(g));
    expect(r).toMatchObject({ ok: false, firstBrokenSeq: 4, eventsChecked: 3 });
    expect(r.reason).toMatch(/modified/);
  });

  it('deleting an event is a sequence gap; deleting the last one is caught by the header', () => {
    const g = chain(6);
    const h = header(g);
    expect(verifyLotChain([...g.slice(0, 2), ...g.slice(3)], h, null)).toMatchObject({
      ok: false,
      firstBrokenSeq: 3,
    });
    const r = verifyLotChain(g.slice(0, 5), h, null);
    expect(r).toMatchObject({ ok: false, firstBrokenSeq: 6 });
    expect(r.reason).toMatch(/deleted/);
  });

  it('reordering two events is detected at the first moved one', () => {
    const g = chain(6);
    const swapped = [g[0], g[1], { ...g[3], seq: 3 }, { ...g[2], seq: 4 }, g[4], g[5]];
    expect(verifyLotChain(swapped, header(g), null)).toMatchObject({ ok: false, firstBrokenSeq: 3 });
  });

  it('an event appended after death fails verification at that event', () => {
    const g = chain(4, true);
    const extra = { ...g[1], seq: 5, prevHash: g[3].hash, type: 'decision_note' } as StoredGene;
    extra.hash = geneHash(g[3].hash, hashFieldsOf(extra));
    const all = [...g, extra];
    expect(verifyLotChain(all, header(all), null)).toMatchObject({
      ok: false,
      firstBrokenSeq: 5,
      reason: 'Event recorded after the lot died',
    });
  });

  it('a whole chain rewritten consistently still fails the anchor check', () => {
    const g = chain(4);
    const anchors = anchorsOf(g);
    const forged: StoredGene[] = [];
    let prev = GENESIS_HASH;
    for (const x of g) {
      const y = { ...x, explanation: 'forged', prevHash: prev } as StoredGene;
      y.hash = geneHash(prev, hashFieldsOf(y));
      forged.push(y);
      prev = y.hash;
    }
    const r = verifyLotChain(forged, header(forged), anchors);
    expect(r.firstBrokenSeq).toBeNull();
    expect(r).toMatchObject({ ok: false, anchoredOk: false });
    expect(r.anchorProblems).toHaveLength(4);
  });
});

describe('computed values (C.8) on a fixed example', () => {
  // 500 milk packets: born at A on day 0, 380 shipped to B on day 1 and received day 2, B sells 380 by day 4,
  // A's 120 are written off on day 6.
  const genes = [
    { seq: 1, type: 'born', at: D('2026-01-01T00:00:00Z'), warehouse: 'A', qtyDelta: 500 },
    { seq: 2, type: 'put_away', at: D('2026-01-01T00:00:00Z'), warehouse: 'A' },
    {
      seq: 3,
      type: 'transfer_out',
      at: D('2026-01-02T00:00:00Z'),
      fromWarehouse: 'A',
      toWarehouse: 'B',
      qtyMoved: 380,
      refId: 't1',
    },
    {
      seq: 4,
      type: 'transfer_in',
      at: D('2026-01-03T00:00:00Z'),
      fromWarehouse: 'A',
      toWarehouse: 'B',
      qtyMoved: 380,
      refId: 't1',
    },
    {
      seq: 5,
      type: 'dispatch_sale',
      at: D('2026-01-05T00:00:00Z'),
      warehouse: 'B',
      qtyDelta: -380,
      qtyMoved: 380,
    },
    {
      seq: 6,
      type: 'write_off',
      at: D('2026-01-07T00:00:00Z'),
      warehouse: 'A',
      qtyDelta: -120,
      qtyMoved: 120,
    },
  ];

  it('journey, dwell, hops and transit time', () => {
    const loc = analyseLocations(genes, D('2026-01-10T00:00:00Z'));
    expect(loc.hops).toBe(1);
    expect(loc.journey).toEqual([
      {
        warehouse: 'A',
        arrivedAt: D('2026-01-01T00:00:00Z'),
        departedAt: D('2026-01-07T00:00:00Z'),
        dwellDays: 6,
        transitDaysBefore: null,
      },
      {
        warehouse: 'B',
        arrivedAt: D('2026-01-03T00:00:00Z'),
        departedAt: D('2026-01-05T00:00:00Z'),
        dwellDays: 2,
        transitDaysBefore: 1,
      },
    ]);
    expect(loc.dwellByLocation).toEqual({ A: 6, B: 2 });
    // unit-days: 500x1 + 120x1 (+380 in transit not counted) + 500x2 + 120x2 = 1860
    expect(loc.unitDays).toBe(1860);
  });

  it('life used, remaining shelf days, depletion and holding cost', () => {
    const m = lotMetrics(
      {
        state: { qtyOnHand: 0, qtyBorn: 500, qtyAdded: 0, status: 'expired_disposed' },
        bornAt: D('2026-01-01T00:00:00Z'),
        diedAt: D('2026-01-07T00:00:00Z'),
        manufactureDate: D('2026-01-01T00:00:00Z'),
        expiryDate: D('2026-01-07T00:00:00Z'),
        holdingCostPerUnitYear: 36.5,
        genes,
      },
      D('2026-01-10T00:00:00Z'),
    );
    expect(m.ageDays).toBe(6);
    expect(m.lifeUsedPct).toBe(1);
    expect(m.remainingShelfDays).toBe(-3);
    expect(m.depletionPct).toBe(1);
    expect(m.holdingCostAccrued).toBe(186); // 1860 unit-days x 36.5 / 365
    expect(lifeUsedPct(D('2026-01-01T00:00:00Z'), D('2026-01-07T00:00:00Z'), D('2026-01-04T00:00:00Z'))).toBe(
      0.5,
    );
    expect(lifeUsedPct(null, D('2026-01-07'), D('2026-01-04'))).toBeNull();
    expect(remainingShelfDays(D('2026-01-07T12:00:00Z'), D('2026-01-04T00:00:00Z'))).toBe(3.5);
    expect(depletionPct({ qtyOnHand: 25, qtyBorn: 80, qtyAdded: 20 })).toBe(0.75);
  });
});

describe('forward and backward trace (C.8)', () => {
  const lot = (id: string, status: LotStatus, onHand: number, born: number): TraceLot => ({
    id,
    dnaCode: `DNA-${id}`,
    status,
    qtyBorn: born,
    qtyAdded: 0,
    qtyOnHand: onHand,
    qtyInTransit: 0,
    birthWarehouse: 'A',
  });
  const lots = new Map([
    ['P', lot('P', 'depleted', 0, 100)],
    ['C', lot('C', 'quarantine', 8, 8)],
  ]);
  const genes = [
    { lot: 'P', type: 'born', warehouse: 'A', qtyDelta: 100 },
    { lot: 'P', type: 'transfer_in', toWarehouse: 'B', qtyMoved: 40 },
    { lot: 'P', type: 'dispatch_sale', warehouse: 'A', qtyMoved: 60, refType: 'customer_order', refId: 'o1' },
    { lot: 'P', type: 'dispatch_sale', warehouse: 'B', qtyMoved: 40, refType: 'customer_order', refId: 'o2' },
    { lot: 'C', type: 'born', warehouse: 'B', qtyDelta: 8 },
  ];
  const links = [{ parentLot: 'P', childLot: 'C', relation: 'return', qty: 8 }];

  it('forward: warehouses, orders, child lots and the quantity still alive', () => {
    const t = traceForward(['P'], lots, genes, links);
    expect(t.lots.map((l) => [l.lot, l.depth])).toEqual([
      ['P', 0],
      ['C', 1],
    ]);
    expect(t.lots[0]).toMatchObject({
      qtyDispatched: 100,
      qtyAlive: 0,
      children: ['C'],
      orders: [
        { refId: 'o1', qty: 60 },
        { refId: 'o2', qty: 40 },
      ],
    });
    expect(t.warehousesReached).toEqual([
      { warehouse: 'A', qtyReceived: 100 },
      { warehouse: 'B', qtyReceived: 48 },
    ]);
    expect(t.qtyDispatchedToOrders).toBe(100);
    expect(t.qtyStillAlive).toBe(8);
  });

  it('backward: the child lot leads to its parent', () => {
    expect(traceBackward('C', links)).toEqual([
      { lot: 'C', parent: 'P', relation: 'return', qty: 8, depth: 1 },
    ]);
    expect(traceBackward('P', links)).toEqual([]);
  });
});

describe('reconcile', () => {
  it('returns only lots whose genes, header and slices disagree', () => {
    const header = {
      qtyBorn: 100,
      qtyAdded: 0,
      qtyOnHand: 90,
      qtyInTransit: 0,
      qtyOutByCause: { ...emptyOut(), sold: 10 },
    };
    expect(
      reconcileLots([{ lot: 'a', dnaCode: 'A', header, geneOnHand: 90, geneInTransit: 0, sliceOnHand: 90 }]),
    ).toEqual([]);
    expect(
      reconcileLots([{ lot: 'b', dnaCode: 'B', header, geneOnHand: 90, geneInTransit: 0, sliceOnHand: 85 }]),
    ).toEqual([
      {
        lot: 'b',
        dnaCode: 'B',
        genesOnHand: 90,
        headerOnHand: 90,
        slicesOnHand: 85,
        genesInTransit: 0,
        headerInTransit: 0,
        invariantOk: true,
      },
    ]);
  });
});

describe('FEFO across lots (AC-DNA-6)', () => {
  const now = D('2026-03-10T00:00:00Z');
  const slice = (
    id: string,
    lot: string,
    expiry: string | null,
    quantity: number,
    extra: Partial<{ lotStatus: LotStatus; recalled: boolean }> = {},
  ) => ({
    id,
    lot,
    lotStatus: 'active' as LotStatus,
    recalled: false,
    batchNo: lot,
    bin: 'A1',
    expiryDate: expiry ? D(expiry) : null,
    quantity,
    ...extra,
  });

  it('skips expired, quarantined, recalled and past-date lots and draws across two lots in expiry order', () => {
    const slices = [
      slice('s1', 'L-expired', '2026-03-11', 50, { lotStatus: 'expired' }),
      slice('s2', 'L-quarantine', '2026-03-12', 50, { lotStatus: 'quarantine' }),
      slice('s3', 'L-recalled', '2026-03-12', 50, { recalled: true }),
      slice('s4', 'L-pastdate', '2026-03-09', 50),
      slice('s5', 'L-late', '2026-04-30', 100),
      slice('s6', 'L-early', '2026-03-20', 30),
    ];
    const a = pickFefoLots(slices, 50, now);
    expect(a.map((x) => [x.lot, x.quantity])).toEqual([
      ['L-early', 30],
      ['L-late', 20],
    ]);
  });

  it('names the blocked quantity when the pickable stock is not enough', () => {
    expect(() =>
      pickFefoLots(
        [slice('s1', 'L1', '2026-03-20', 10), slice('s2', 'L2', '2026-03-20', 40, { recalled: true })],
        20,
        now,
      ),
    ).toThrow(/Insufficient stock: have 10, requested 20 \(not pickable: 40 recalled\)/);
  });
});
