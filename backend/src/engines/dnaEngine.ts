/**
 * Stock DNA engine (pure, no database). A lot's life is a list of genes (DNA events); this module holds the
 * gene catalogue with each gene's effect on the lot counters, the life-state transition table, the per-lot
 * hash chain, the computed life values, forward/backward tracing, reconciliation and FEFO lot picking.
 */
import { GENESIS_HASH, scopedHash } from './hashChain';
import { allocateFEFO, Allocation } from './inventoryLogic';

const DAY_MS = 86_400_000;

export const DNA_SCOPE = 'dna';

export const LOT_STATUSES = [
  'quarantine',
  'active',
  'expired',
  'depleted',
  'expired_disposed',
  'written_off',
  'recalled_destroyed',
  'returned_to_supplier',
] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const ALIVE_STATUSES: LotStatus[] = ['quarantine', 'active', 'expired'];
export const DEAD_STATUSES: LotStatus[] = [
  'depleted',
  'expired_disposed',
  'written_off',
  'recalled_destroyed',
  'returned_to_supplier',
];

export const GENE_TYPES = [
  'born',
  'receive_more',
  'qc_hold',
  'qc_release',
  'qc_reject',
  'put_away',
  'transfer_out',
  'transfer_in',
  'reserve',
  'release_reserve',
  'pick_fefo',
  'dispatch_sale',
  'consume',
  'count_adjust',
  'damage',
  'expiry_warning',
  'expire',
  'recall_flag',
  'recall_clear',
  'return_to_supplier',
  'write_off',
  'decision_note',
  'death',
] as const;
export type GeneType = (typeof GENE_TYPES)[number];

export const BIRTH_TYPES = ['purchase_receipt', 'opening_balance', 'return_in'] as const;
export type BirthType = (typeof BIRTH_TYPES)[number];

export const DEATH_CAUSES = [
  'sold_out',
  'consumed',
  'expired',
  'damaged',
  'recalled',
  'returned_to_supplier',
  'rejected_at_qc',
  'written_off',
] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

/** Causes accepted by a write_off (disposal) gene. */
export const DISPOSAL_CAUSES = ['expired', 'damaged', 'recalled', 'rejected_at_qc', 'written_off'] as const;
export type DisposalCause = (typeof DISPOSAL_CAUSES)[number];

export const OUT_KEYS = [
  'sold',
  'consumed',
  'expired',
  'damaged',
  'shrinkage',
  'recalled',
  'returnedToSupplier',
  'writtenOff',
] as const;
export type OutKey = (typeof OUT_KEYS)[number];
export type OutByCause = Record<OutKey, number>;

/** Quantity lost to waste (counts toward value lost at death). */
const WASTE_KEYS: OutKey[] = ['expired', 'damaged', 'shrinkage', 'recalled', 'writtenOff'];

const DISPOSAL_OUT_KEY: Record<DisposalCause, OutKey> = {
  expired: 'expired',
  damaged: 'damaged',
  recalled: 'recalled',
  rejected_at_qc: 'writtenOff',
  written_off: 'writtenOff',
};

export class DnaRuleError extends Error {
  code = 'DNA_RULE';
}

export interface LotFlags {
  onHold: boolean;
  recalled: boolean;
  backfilled: boolean;
  qcRejected: boolean;
  expiryWarned: boolean;
}

export interface LotState {
  status: LotStatus | null;
  qtyBorn: number;
  qtyAdded: number;
  qtyOnHand: number;
  qtyInTransit: number;
  qtyReserved: number;
  qtyOutByCause: OutByCause;
  flags: LotFlags;
  eventCount: number;
}

export function emptyOut(): OutByCause {
  return {
    sold: 0,
    consumed: 0,
    expired: 0,
    damaged: 0,
    shrinkage: 0,
    recalled: 0,
    returnedToSupplier: 0,
    writtenOff: 0,
  };
}

/** State of a lot before its birth gene. */
export function initialLotState(): LotState {
  return {
    status: null,
    qtyBorn: 0,
    qtyAdded: 0,
    qtyOnHand: 0,
    qtyInTransit: 0,
    qtyReserved: 0,
    qtyOutByCause: emptyOut(),
    flags: { onHold: false, recalled: false, backfilled: false, qcRejected: false, expiryWarned: false },
    eventCount: 0,
  };
}

export function isDead(status: LotStatus | null | undefined): boolean {
  return !!status && DEAD_STATUSES.includes(status);
}

export function isAlive(status: LotStatus | null | undefined): boolean {
  return !!status && ALIVE_STATUSES.includes(status);
}

export function sumOut(out: OutByCause): number {
  return OUT_KEYS.reduce((s, k) => s + (out[k] ?? 0), 0);
}

/** qtyBorn + qtyAdded = qtyOnHand + qtyInTransit + sum(qtyOutByCause). */
export function invariantHolds(
  s: Pick<LotState, 'qtyBorn' | 'qtyAdded' | 'qtyOnHand' | 'qtyInTransit' | 'qtyOutByCause'>,
): boolean {
  return s.qtyBorn + s.qtyAdded === s.qtyOnHand + s.qtyInTransit + sumOut(s.qtyOutByCause);
}

// ---------------------------------------------------------------------------------------------------------------
// Life states

/** Allowed status changes (C.4). "active -> quarantine" is the QC hold of a lot that was already put away. */
export const TRANSITIONS: Record<LotStatus, LotStatus[]> = {
  quarantine: ['active', 'written_off', 'recalled_destroyed', 'returned_to_supplier'],
  active: ['quarantine', 'expired', 'depleted', 'written_off', 'recalled_destroyed', 'returned_to_supplier'],
  expired: ['expired_disposed', 'recalled_destroyed', 'returned_to_supplier'],
  depleted: [],
  expired_disposed: [],
  written_off: [],
  recalled_destroyed: [],
  returned_to_supplier: [],
};

export function canTransition(from: LotStatus | null, to: LotStatus): boolean {
  if (from === null) return to === 'active' || to === 'quarantine';
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: LotStatus | null, to: LotStatus): void {
  if (!canTransition(from, to)) {
    throw new DnaRuleError(`A lot cannot go from ${from ?? '(birth)'} to ${to}`);
  }
}

/** The terminal status a lot takes when it dies of a cause, given the status it dies in. */
export function terminalStatusFor(cause: DeathCause, from: LotStatus): LotStatus {
  switch (cause) {
    case 'sold_out':
    case 'consumed':
      return 'depleted';
    case 'expired':
      return 'expired_disposed';
    case 'recalled':
      return 'recalled_destroyed';
    case 'returned_to_supplier':
      return 'returned_to_supplier';
    default:
      return from === 'expired' ? 'expired_disposed' : 'written_off';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Gene catalogue

export interface GeneInput {
  type: GeneType;
  /** Positive quantity for quantity genes; signed variance for count_adjust. */
  qty?: number;
  /** born: start in quarantine instead of active. */
  hold?: boolean;
  /** write_off: the disposal cause. */
  cause?: DisposalCause | DeathCause | null;
  /** receive_more: adopting stock found without a DNA record (allowed even into an expired or recalled lot). */
  adopt?: boolean;
}

export interface GeneEffect {
  state: LotState;
  /** Signed change of the lot's total quantity (on hand + in transit). */
  qtyDelta: number;
  /** Quantity that moved (moves, picks, reservations). */
  qtyMoved: number;
}

interface CatalogueRow {
  meaning: string;
  needsQty: boolean;
  /** Applies the gene to a copy of the state (already checked: lot alive unless born). */
  apply: (s: LotState, g: GeneInput) => { qtyDelta: number; qtyMoved: number };
}

function positive(g: GeneInput): number {
  const q = g.qty ?? 0;
  if (!(Number.isFinite(q) && q > 0)) throw new DnaRuleError(`${g.type} needs a quantity greater than 0`);
  return q;
}

function takeOnHand(s: LotState, q: number, what: string) {
  if (q > s.qtyOnHand) throw new DnaRuleError(`Cannot ${what} ${q}: the lot has ${s.qtyOnHand} on hand`);
  s.qtyOnHand -= q;
  s.qtyReserved = Math.min(s.qtyReserved, s.qtyOnHand);
}

function requireSellable(s: LotState, what: string) {
  if (s.status !== 'active') throw new DnaRuleError(`Cannot ${what}: the lot is ${s.status}`);
  if (s.flags.recalled) throw new DnaRuleError(`Cannot ${what}: the lot is recalled`);
}

function setStatus(s: LotState, to: LotStatus) {
  assertTransition(s.status, to);
  s.status = to;
}

export const GENE_CATALOGUE: Record<GeneType, CatalogueRow> = {
  born: {
    meaning: 'Birth: purchase receipt, opening balance or customer return',
    needsQty: true,
    apply: (s, g) => {
      if (s.eventCount !== 0) throw new DnaRuleError('A lot is born only once');
      const q = positive(g);
      setStatus(s, g.hold ? 'quarantine' : 'active');
      s.flags.onHold = !!g.hold;
      s.qtyBorn = q;
      s.qtyOnHand = q;
      return { qtyDelta: q, qtyMoved: 0 };
    },
  },
  receive_more: {
    meaning: 'More of the same batch received after birth (counted in qtyAdded)',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      if (!g.adopt && s.status === 'expired') throw new DnaRuleError('Cannot receive into an expired lot');
      if (!g.adopt && s.flags.recalled) throw new DnaRuleError('Cannot receive into a recalled lot');
      s.qtyAdded += q;
      s.qtyOnHand += q;
      return { qtyDelta: q, qtyMoved: 0 };
    },
  },
  qc_hold: {
    meaning: 'Quality hold',
    needsQty: false,
    apply: (s) => {
      setStatus(s, 'quarantine');
      s.flags.onHold = true;
      return { qtyDelta: 0, qtyMoved: 0 };
    },
  },
  qc_release: {
    meaning: 'Quality release',
    needsQty: false,
    apply: (s) => {
      if (s.flags.qcRejected) throw new DnaRuleError('The lot was rejected at QC and must be disposed');
      setStatus(s, 'active');
      s.flags.onHold = false;
      return { qtyDelta: 0, qtyMoved: 0 };
    },
  },
  qc_reject: {
    meaning: 'Quality rejection (disposal follows)',
    needsQty: false,
    apply: (s) => {
      if (s.status !== 'quarantine') throw new DnaRuleError('Only a lot in quarantine can be rejected at QC');
      s.flags.qcRejected = true;
      return { qtyDelta: 0, qtyMoved: 0 };
    },
  },
  put_away: {
    meaning: 'Assigned to a bin',
    needsQty: false,
    apply: () => ({ qtyDelta: 0, qtyMoved: 0 }),
  },
  transfer_out: {
    meaning: 'Left a warehouse on a transfer',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      requireSellable(s, 'transfer');
      takeOnHand(s, q, 'transfer');
      s.qtyInTransit += q;
      return { qtyDelta: 0, qtyMoved: q };
    },
  },
  transfer_in: {
    meaning: 'Arrived at a warehouse from a transfer',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      if (q > s.qtyInTransit)
        throw new DnaRuleError(`Cannot receive ${q}: only ${s.qtyInTransit} in transit`);
      s.qtyInTransit -= q;
      s.qtyOnHand += q;
      return { qtyDelta: 0, qtyMoved: q };
    },
  },
  reserve: {
    meaning: 'Allocated to a customer order',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      requireSellable(s, 'reserve');
      if (s.qtyReserved + q > s.qtyOnHand) {
        throw new DnaRuleError(`Cannot reserve ${q}: ${s.qtyOnHand - s.qtyReserved} unreserved on hand`);
      }
      s.qtyReserved += q;
      return { qtyDelta: 0, qtyMoved: q };
    },
  },
  release_reserve: {
    meaning: 'Reservation released',
    needsQty: true,
    apply: (s, g) => {
      const q = Math.min(positive(g), s.qtyReserved);
      s.qtyReserved -= q;
      return { qtyDelta: 0, qtyMoved: q };
    },
  },
  pick_fefo: {
    meaning: 'Picked first-expired-first-out',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      requireSellable(s, 'pick');
      if (q > s.qtyOnHand) throw new DnaRuleError(`Cannot pick ${q}: the lot has ${s.qtyOnHand} on hand`);
      return { qtyDelta: 0, qtyMoved: q };
    },
  },
  dispatch_sale: {
    meaning: 'Shipped to a customer',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      requireSellable(s, 'dispatch');
      takeOnHand(s, q, 'dispatch');
      s.qtyOutByCause.sold += q;
      return { qtyDelta: -q, qtyMoved: q };
    },
  },
  consume: {
    meaning: 'Used in production or internally',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      requireSellable(s, 'consume');
      takeOnHand(s, q, 'consume');
      s.qtyOutByCause.consumed += q;
      return { qtyDelta: -q, qtyMoved: q };
    },
  },
  count_adjust: {
    meaning: 'Cycle-count variance posted (negative: shrinkage, positive: added)',
    needsQty: true,
    apply: (s, g) => {
      const d = g.qty ?? 0;
      if (!Number.isFinite(d) || d === 0 || !Number.isInteger(d))
        throw new DnaRuleError('count_adjust needs a non-zero whole variance');
      if (d < 0) {
        takeOnHand(s, -d, 'count down');
        s.qtyOutByCause.shrinkage += -d;
      } else {
        s.qtyAdded += d;
        s.qtyOnHand += d;
      }
      return { qtyDelta: d, qtyMoved: Math.abs(d) };
    },
  },
  damage: {
    meaning: 'Damaged or lost',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      takeOnHand(s, q, 'record damage of');
      s.qtyOutByCause.damaged += q;
      return { qtyDelta: -q, qtyMoved: q };
    },
  },
  expiry_warning: {
    meaning: 'Expiry approaching',
    needsQty: false,
    apply: (s) => {
      if (s.flags.expiryWarned) throw new DnaRuleError('Expiry warning already recorded');
      s.flags.expiryWarned = true;
      return { qtyDelta: 0, qtyMoved: 0 };
    },
  },
  expire: {
    meaning: 'Passed its expiry date with stock left',
    needsQty: false,
    apply: (s) => {
      setStatus(s, 'expired');
      return { qtyDelta: 0, qtyMoved: 0 };
    },
  },
  recall_flag: {
    meaning: 'Recall raised',
    needsQty: false,
    apply: (s) => {
      if (s.flags.recalled) throw new DnaRuleError('The lot is already recalled');
      s.flags.recalled = true;
      return { qtyDelta: 0, qtyMoved: 0 };
    },
  },
  recall_clear: {
    meaning: 'Recall cleared',
    needsQty: false,
    apply: (s) => {
      if (!s.flags.recalled) throw new DnaRuleError('The lot is not recalled');
      s.flags.recalled = false;
      return { qtyDelta: 0, qtyMoved: 0 };
    },
  },
  return_to_supplier: {
    meaning: 'Sent back to the supplier',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      takeOnHand(s, q, 'return');
      s.qtyOutByCause.returnedToSupplier += q;
      return { qtyDelta: -q, qtyMoved: q };
    },
  },
  write_off: {
    meaning: 'Disposal approved',
    needsQty: true,
    apply: (s, g) => {
      const q = positive(g);
      const cause = g.cause as DisposalCause | undefined;
      if (!cause || !DISPOSAL_CAUSES.includes(cause)) {
        throw new DnaRuleError(`write_off needs a cause: ${DISPOSAL_CAUSES.join(', ')}`);
      }
      if (cause === 'expired' && s.status !== 'expired')
        throw new DnaRuleError('Only an expired lot can be disposed as expired');
      if (cause === 'recalled' && !s.flags.recalled)
        throw new DnaRuleError('Only a recalled lot can be disposed as recalled');
      if (cause === 'rejected_at_qc' && !s.flags.qcRejected)
        throw new DnaRuleError('Only a lot rejected at QC can be disposed as rejected');
      takeOnHand(s, q, 'write off');
      s.qtyOutByCause[DISPOSAL_OUT_KEY[cause]] += q;
      return { qtyDelta: -q, qtyMoved: q };
    },
  },
  decision_note: {
    meaning: 'An approved engine decision touched this lot',
    needsQty: false,
    apply: () => ({ qtyDelta: 0, qtyMoved: 0 }),
  },
  death: {
    meaning: 'Terminal seal',
    needsQty: false,
    apply: () => {
      throw new DnaRuleError('The death gene is written by sealLot, not applied directly');
    },
  },
};

function cloneState(s: LotState): LotState {
  return { ...s, qtyOutByCause: { ...s.qtyOutByCause }, flags: { ...s.flags } };
}

/** Applies one gene to a lot state and returns the new state plus the quantity effect. Throws DnaRuleError. */
export function applyGene(state: LotState, gene: GeneInput): GeneEffect {
  const row = GENE_CATALOGUE[gene.type];
  if (!row) throw new DnaRuleError(`Unknown gene type ${gene.type}`);
  if (isDead(state.status)) throw new DnaRuleError(`The lot is dead (${state.status}); its DNA is sealed`);
  if (gene.type !== 'born' && state.eventCount === 0)
    throw new DnaRuleError('The first gene of a lot must be born');
  const next = cloneState(state);
  const { qtyDelta, qtyMoved } = row.apply(next, gene);
  next.eventCount = state.eventCount + 1;
  return { state: next, qtyDelta, qtyMoved };
}

/** True when the lot just ran out: nothing on hand or in transit, still alive. */
export function shouldDie(s: LotState): boolean {
  return isAlive(s.status) && s.qtyOnHand === 0 && s.qtyInTransit === 0 && s.eventCount > 0;
}

/** Cause of death implied by the gene that emptied the lot. */
export function deathCauseFor(gene: GeneInput): DeathCause {
  switch (gene.type) {
    case 'dispatch_sale':
      return 'sold_out';
    case 'consume':
      return 'consumed';
    case 'damage':
      return 'damaged';
    case 'return_to_supplier':
      return 'returned_to_supplier';
    case 'write_off':
      return (gene.cause as DeathCause) ?? 'written_off';
    default:
      return 'written_off';
  }
}

export interface DeathRecord {
  at: Date;
  cause: DeathCause;
  lifespanDays: number;
  lifeUsedPct: number | null;
  valueLost: number;
}

/** Seals a lot: the terminal status and the death record (C.5). */
export function sealLot(
  s: LotState,
  cause: DeathCause,
  ctx: { at: Date; bornAt: Date; unitCost: number; manufactureDate?: Date | null; expiryDate?: Date | null },
): { state: LotState; death: DeathRecord } {
  if (!isAlive(s.status)) throw new DnaRuleError(`Cannot seal a lot that is ${s.status}`);
  const to = terminalStatusFor(cause, s.status!);
  assertTransition(s.status, to);
  const next = cloneState(s);
  next.status = to;
  next.qtyReserved = 0;
  next.eventCount = s.eventCount + 1;
  const wasted = WASTE_KEYS.reduce((sum, k) => sum + next.qtyOutByCause[k], 0);
  return {
    state: next,
    death: {
      at: ctx.at,
      cause,
      lifespanDays: round2((ctx.at.getTime() - ctx.bornAt.getTime()) / DAY_MS),
      lifeUsedPct: lifeUsedPct(ctx.manufactureDate ?? null, ctx.expiryDate ?? null, ctx.at),
      valueLost: round2(wasted * (ctx.unitCost || 0)),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hash chain

export interface GeneHashFields {
  lot: string;
  seq: number;
  type: GeneType;
  at: Date | string;
  actor: string | null;
  warehouse: string | null;
  fromWarehouse: string | null;
  toWarehouse: string | null;
  bin: string | null;
  qtyDelta: number;
  qtyMoved: number;
  qtyAfter: { onHand: number; inTransit: number };
  cause: string | null;
  refType: string | null;
  refId: string | null;
  explanation: string;
}

export const HASHED_FIELDS: (keyof GeneHashFields)[] = [
  'lot',
  'seq',
  'type',
  'at',
  'actor',
  'warehouse',
  'fromWarehouse',
  'toWarehouse',
  'bin',
  'qtyDelta',
  'qtyMoved',
  'qtyAfter',
  'cause',
  'refType',
  'refId',
  'explanation',
];

/** Picks the hashed fields from a stored gene, normalising ids and dates. */
export function hashFieldsOf(g: Record<string, unknown>): GeneHashFields {
  const id = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const qa = (g.qtyAfter ?? {}) as { onHand?: number; inTransit?: number };
  return {
    lot: String(g.lot),
    seq: Number(g.seq),
    type: g.type as GeneType,
    at: new Date(g.at as string).toISOString(),
    actor: id(g.actor),
    warehouse: id(g.warehouse),
    fromWarehouse: id(g.fromWarehouse),
    toWarehouse: id(g.toWarehouse),
    bin: (g.bin as string | null | undefined) ?? null,
    qtyDelta: Number(g.qtyDelta ?? 0),
    qtyMoved: Number(g.qtyMoved ?? 0),
    qtyAfter: { onHand: Number(qa.onHand ?? 0), inTransit: Number(qa.inTransit ?? 0) },
    cause: (g.cause as string | null | undefined) ?? null,
    refType: (g.refType as string | null | undefined) ?? null,
    refId: id(g.refId),
    explanation: String(g.explanation ?? ''),
  };
}

export function geneHash(prevHash: string, fields: GeneHashFields): string {
  return scopedHash(DNA_SCOPE, prevHash, fields);
}

export interface StoredGene extends Record<string, unknown> {
  seq: number;
  type: string;
  prevHash: string;
  hash: string;
}

export interface LotVerifyResult {
  ok: boolean;
  eventsChecked: number;
  firstBrokenSeq: number | null;
  reason: string | null;
  anchoredOk: boolean;
  anchorProblems: { seq: number; reason: string }[];
}

/**
 * Verifies a lot's gene chain (ordered by seq) against its header and the hashes anchored in the audit log.
 * anchors maps seq -> hash recorded in the matching audit entry; pass null to skip the anchor check.
 */
export function verifyLotChain(
  genes: StoredGene[],
  header: { eventCount: number; headHash: string | null },
  anchors: Map<number, string> | null,
): LotVerifyResult {
  let prevHash = GENESIS_HASH;
  let checked = 0;
  let broken: { seq: number; reason: string } | null = null;
  let deathSeen = false;
  for (let i = 0; i < genes.length; i++) {
    const g = genes[i];
    const expectedSeq = i + 1;
    if (g.seq !== expectedSeq) {
      broken = {
        seq: expectedSeq,
        reason: `Sequence gap: expected event #${expectedSeq} but found #${g.seq} (an event was deleted or reordered)`,
      };
      break;
    }
    if (deathSeen) {
      broken = { seq: g.seq, reason: 'Event recorded after the lot died' };
      break;
    }
    if (g.prevHash !== prevHash) {
      broken = {
        seq: g.seq,
        reason: `prevHash does not match the hash of event #${g.seq - 1} (the chain was altered)`,
      };
      break;
    }
    if (geneHash(prevHash, hashFieldsOf(g)) !== g.hash) {
      broken = { seq: g.seq, reason: 'Event contents do not match its stored hash (the event was modified)' };
      break;
    }
    if (g.type === 'death') deathSeen = true;
    prevHash = g.hash;
    checked++;
  }
  if (!broken && genes.length !== header.eventCount) {
    broken = {
      seq: genes.length + 1,
      reason: `The lot header records ${header.eventCount} events but ${genes.length} were found (events were deleted)`,
    };
  }
  if (!broken && genes.length && header.headHash !== prevHash) {
    broken = { seq: genes.length, reason: 'The lot header head hash does not match the last event' };
  }
  const anchorProblems: { seq: number; reason: string }[] = [];
  if (anchors) {
    for (const g of genes) {
      const a = anchors.get(g.seq);
      if (!a) anchorProblems.push({ seq: g.seq, reason: 'No audit anchor found' });
      else if (a !== g.hash)
        anchorProblems.push({ seq: g.seq, reason: 'Hash differs from the one anchored in the audit log' });
    }
  }
  return {
    ok: !broken && anchorProblems.length === 0,
    eventsChecked: checked,
    firstBrokenSeq: broken?.seq ?? null,
    reason:
      broken?.reason ??
      (anchorProblems.length
        ? `Anchor check failed at event #${anchorProblems[0].seq}: ${anchorProblems[0].reason}`
        : null),
    anchoredOk: anchors ? anchorProblems.length === 0 : false,
    anchorProblems,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Computed values (C.8)

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function ageDays(bornAt: Date, now: Date): number {
  return round2((now.getTime() - bornAt.getTime()) / DAY_MS);
}

/** Share of the shelf life used (0..1), or null when the manufacture or expiry date is unknown. */
export function lifeUsedPct(manufactureDate: Date | null, expiryDate: Date | null, now: Date): number | null {
  if (!manufactureDate || !expiryDate) return null;
  const span = expiryDate.getTime() - manufactureDate.getTime();
  if (span <= 0) return 1;
  return round2(clamp01((now.getTime() - manufactureDate.getTime()) / span) * 100) / 100;
}

export function remainingShelfDays(expiryDate: Date | null, now: Date): number | null {
  if (!expiryDate) return null;
  return round2((expiryDate.getTime() - now.getTime()) / DAY_MS);
}

export function depletionPct(s: Pick<LotState, 'qtyOnHand' | 'qtyBorn' | 'qtyAdded'>): number {
  const total = s.qtyBorn + s.qtyAdded;
  if (total <= 0) return 0;
  return round2((1 - s.qtyOnHand / total) * 100) / 100;
}

/** The location-relevant part of a gene. */
export interface MoveGene {
  seq: number;
  type: string;
  at: Date | string;
  warehouse?: string | null;
  fromWarehouse?: string | null;
  toWarehouse?: string | null;
  qtyDelta?: number;
  qtyMoved?: number;
  refId?: string | null;
}

export interface JourneyStop {
  warehouse: string;
  arrivedAt: Date;
  departedAt: Date | null;
  dwellDays: number;
  transitDaysBefore: number | null;
}

/** Per-warehouse quantity changes implied by a gene. */
function warehouseDeltas(g: MoveGene): [string, number][] {
  const wh = g.warehouse ? String(g.warehouse) : null;
  const q = Number(g.qtyMoved ?? 0);
  switch (g.type) {
    case 'born':
    case 'receive_more':
      return wh ? [[wh, Number(g.qtyDelta ?? 0)]] : [];
    case 'transfer_out':
      return g.fromWarehouse ? [[String(g.fromWarehouse), -q]] : [];
    case 'transfer_in':
      return g.toWarehouse ? [[String(g.toWarehouse), q]] : [];
    case 'dispatch_sale':
    case 'consume':
    case 'damage':
    case 'return_to_supplier':
    case 'write_off':
    case 'count_adjust':
      return wh ? [[wh, Number(g.qtyDelta ?? 0)]] : [];
    default:
      return [];
  }
}

export interface LocationAnalysis {
  journey: JourneyStop[];
  dwellByLocation: Record<string, number>;
  hops: number;
  /** Unit-days held in warehouses (quantity x days), the basis of the holding cost. */
  unitDays: number;
}

/**
 * Replays the genes to find where the lot was, when, and for how long. A stop opens when a warehouse's
 * quantity goes from 0 to positive and closes when it returns to 0 (or at "until" while still there).
 */
export function analyseLocations(genes: MoveGene[], until: Date): LocationAnalysis {
  const sorted = [...genes].sort((a, b) => a.seq - b.seq);
  const qty = new Map<string, number>();
  const open = new Map<string, JourneyStop>();
  const journey: JourneyStop[] = [];
  const outAt = new Map<string, Date>();
  let hops = 0;
  let unitDays = 0;
  let lastT: number | null = null;
  const total = () => [...qty.values()].reduce((s, v) => s + v, 0);
  for (const g of sorted) {
    const t = new Date(g.at);
    if (lastT !== null) unitDays += (total() * (t.getTime() - lastT)) / DAY_MS;
    lastT = t.getTime();
    if (g.type === 'transfer_out' && g.refId) outAt.set(String(g.refId), t);
    if (g.type === 'transfer_in') hops++;
    for (const [wh, d] of warehouseDeltas(g)) {
      const before = qty.get(wh) ?? 0;
      const after = before + d;
      qty.set(wh, after);
      if (before <= 0 && after > 0) {
        const sentAt = g.type === 'transfer_in' && g.refId ? outAt.get(String(g.refId)) : undefined;
        const stop: JourneyStop = {
          warehouse: wh,
          arrivedAt: t,
          departedAt: null,
          dwellDays: 0,
          transitDaysBefore: sentAt ? round2((t.getTime() - sentAt.getTime()) / DAY_MS) : null,
        };
        open.set(wh, stop);
        journey.push(stop);
      } else if (before > 0 && after <= 0) {
        const stop = open.get(wh);
        if (stop) {
          stop.departedAt = t;
          stop.dwellDays = round2((t.getTime() - stop.arrivedAt.getTime()) / DAY_MS);
          open.delete(wh);
        }
      }
    }
  }
  if (lastT !== null && until.getTime() > lastT) unitDays += (total() * (until.getTime() - lastT)) / DAY_MS;
  for (const stop of open.values())
    stop.dwellDays = round2((until.getTime() - stop.arrivedAt.getTime()) / DAY_MS);
  const dwellByLocation: Record<string, number> = {};
  for (const s of journey)
    dwellByLocation[s.warehouse] = round2((dwellByLocation[s.warehouse] ?? 0) + s.dwellDays);
  return { journey, dwellByLocation, hops, unitDays: round2(unitDays) };
}

export interface LotMetricsInput {
  state: Pick<LotState, 'qtyOnHand' | 'qtyBorn' | 'qtyAdded' | 'status'>;
  bornAt: Date;
  diedAt?: Date | null;
  manufactureDate?: Date | null;
  expiryDate?: Date | null;
  holdingCostPerUnitYear: number;
  genes: MoveGene[];
}

export interface LotMetrics {
  ageDays: number;
  lifeUsedPct: number | null;
  remainingShelfDays: number | null;
  depletionPct: number;
  dwellByLocation: Record<string, number>;
  journey: JourneyStop[];
  hops: number;
  holdingCostAccrued: number;
  holdingCostNote: string;
}

/** Every computed value for a lot at time "now" (a dead lot is measured at its death). */
export function lotMetrics(input: LotMetricsInput, now: Date): LotMetrics {
  const until = input.diedAt ?? now;
  const loc = analyseLocations(input.genes, until);
  return {
    ageDays: ageDays(input.bornAt, until),
    lifeUsedPct: lifeUsedPct(input.manufactureDate ?? null, input.expiryDate ?? null, until),
    remainingShelfDays: remainingShelfDays(input.expiryDate ?? null, now),
    depletionPct: depletionPct(input.state),
    dwellByLocation: loc.dwellByLocation,
    journey: loc.journey,
    hops: loc.hops,
    holdingCostAccrued: round2((loc.unitDays * (input.holdingCostPerUnitYear || 0)) / 365),
    holdingCostNote: 'estimated: unit-days held x holding cost per unit per year / 365',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Trace

export interface TraceLot {
  id: string;
  dnaCode: string;
  status: LotStatus;
  qtyBorn: number;
  qtyAdded: number;
  qtyOnHand: number;
  qtyInTransit: number;
  birthWarehouse: string | null;
}

export interface TraceGene {
  lot: string;
  type: string;
  warehouse?: string | null;
  toWarehouse?: string | null;
  qtyMoved?: number;
  qtyDelta?: number;
  refType?: string | null;
  refId?: string | null;
}

export interface TraceLink {
  parentLot: string;
  childLot: string;
  relation: string;
  qty: number;
}

export interface ForwardTraceLot {
  lot: string;
  dnaCode: string;
  status: LotStatus;
  depth: number;
  warehouses: { warehouse: string; qtyReceived: number }[];
  orders: { refId: string; qty: number }[];
  qtyDispatched: number;
  qtyAlive: number;
  children: string[];
}

export interface ForwardTrace {
  lots: ForwardTraceLot[];
  warehousesReached: { warehouse: string; qtyReceived: number }[];
  orders: { refId: string; qty: number }[];
  qtyDispatchedToOrders: number;
  qtyStillAlive: number;
}

/** Forward trace: every warehouse that received the lots, every order they shipped to, and every child lot. */
export function traceForward(
  rootIds: string[],
  lots: Map<string, TraceLot>,
  genes: TraceGene[],
  links: TraceLink[],
): ForwardTrace {
  const byLot = new Map<string, TraceGene[]>();
  for (const g of genes) byLot.set(String(g.lot), [...(byLot.get(String(g.lot)) ?? []), g]);
  const childrenOf = new Map<string, string[]>();
  for (const l of links)
    childrenOf.set(String(l.parentLot), [...(childrenOf.get(String(l.parentLot)) ?? []), String(l.childLot)]);

  const out: ForwardTraceLot[] = [];
  const seen = new Set<string>();
  const queue: { id: string; depth: number }[] = rootIds.map((id) => ({ id, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const lot = lots.get(id);
    if (!lot) continue;
    const wh = new Map<string, number>();
    const orders = new Map<string, number>();
    let dispatched = 0;
    for (const g of byLot.get(id) ?? []) {
      if ((g.type === 'born' || g.type === 'receive_more') && g.warehouse)
        wh.set(String(g.warehouse), (wh.get(String(g.warehouse)) ?? 0) + Number(g.qtyDelta ?? 0));
      if (g.type === 'transfer_in' && g.toWarehouse)
        wh.set(String(g.toWarehouse), (wh.get(String(g.toWarehouse)) ?? 0) + Number(g.qtyMoved ?? 0));
      if (g.type === 'dispatch_sale') {
        const q = Number(g.qtyMoved ?? 0);
        dispatched += q;
        if (g.refType === 'customer_order' && g.refId)
          orders.set(String(g.refId), (orders.get(String(g.refId)) ?? 0) + q);
      }
    }
    const children = childrenOf.get(id) ?? [];
    out.push({
      lot: id,
      dnaCode: lot.dnaCode,
      status: lot.status,
      depth,
      warehouses: [...wh].map(([warehouse, qtyReceived]) => ({ warehouse, qtyReceived })),
      orders: [...orders].map(([refId, qty]) => ({ refId, qty })),
      qtyDispatched: dispatched,
      qtyAlive: isAlive(lot.status) ? lot.qtyOnHand + lot.qtyInTransit : 0,
      children,
    });
    for (const c of children) queue.push({ id: c, depth: depth + 1 });
  }
  const whTotals = new Map<string, number>();
  const orderTotals = new Map<string, number>();
  for (const l of out) {
    for (const w of l.warehouses) whTotals.set(w.warehouse, (whTotals.get(w.warehouse) ?? 0) + w.qtyReceived);
    for (const o of l.orders) orderTotals.set(o.refId, (orderTotals.get(o.refId) ?? 0) + o.qty);
  }
  return {
    lots: out,
    warehousesReached: [...whTotals].map(([warehouse, qtyReceived]) => ({ warehouse, qtyReceived })),
    orders: [...orderTotals].map(([refId, qty]) => ({ refId, qty })),
    qtyDispatchedToOrders: [...orderTotals.values()].reduce((s, v) => s + v, 0),
    qtyStillAlive: out.reduce((s, l) => s + l.qtyAlive, 0),
  };
}

/** Backward trace: the chain of parent lots up to the original births (nearest first). */
export function traceBackward(
  lotId: string,
  links: TraceLink[],
): { lot: string; parent: string; relation: string; qty: number; depth: number }[] {
  const parentsOf = new Map<string, TraceLink[]>();
  for (const l of links) parentsOf.set(String(l.childLot), [...(parentsOf.get(String(l.childLot)) ?? []), l]);
  const out: { lot: string; parent: string; relation: string; qty: number; depth: number }[] = [];
  const seen = new Set<string>([lotId]);
  const queue: { id: string; depth: number }[] = [{ id: lotId, depth: 1 }];
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    for (const l of parentsOf.get(id) ?? []) {
      const parent = String(l.parentLot);
      out.push({ lot: id, parent, relation: l.relation, qty: l.qty, depth });
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push({ id: parent, depth: depth + 1 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Reconcile

export interface ReconcileInput {
  lot: string;
  dnaCode: string;
  header: Pick<LotState, 'qtyBorn' | 'qtyAdded' | 'qtyOnHand' | 'qtyInTransit' | 'qtyOutByCause'>;
  geneOnHand: number;
  geneInTransit: number;
  sliceOnHand: number;
}

export interface ReconcileDrift {
  lot: string;
  dnaCode: string;
  genesOnHand: number;
  headerOnHand: number;
  slicesOnHand: number;
  genesInTransit: number;
  headerInTransit: number;
  invariantOk: boolean;
}

/** Lots whose genes, header counters and stock slices disagree (or whose invariant fails). */
export function reconcileLots(rows: ReconcileInput[]): ReconcileDrift[] {
  const out: ReconcileDrift[] = [];
  for (const r of rows) {
    const inv = invariantHolds(r.header);
    const same =
      r.geneOnHand === r.header.qtyOnHand &&
      r.header.qtyOnHand === r.sliceOnHand &&
      r.geneInTransit === r.header.qtyInTransit;
    if (!same || !inv) {
      out.push({
        lot: r.lot,
        dnaCode: r.dnaCode,
        genesOnHand: r.geneOnHand,
        headerOnHand: r.header.qtyOnHand,
        slicesOnHand: r.sliceOnHand,
        genesInTransit: r.geneInTransit,
        headerInTransit: r.header.qtyInTransit,
        invariantOk: inv,
      });
    }
  }
  return out;
}

/** Replays qtyAfter from stored genes: the last gene's recorded totals. */
export function geneTotals(genes: { seq: number; qtyAfter?: { onHand?: number; inTransit?: number } }[]): {
  onHand: number;
  inTransit: number;
} {
  if (!genes.length) return { onHand: 0, inTransit: 0 };
  const last = genes.reduce((a, b) => (b.seq > a.seq ? b : a));
  return { onHand: Number(last.qtyAfter?.onHand ?? 0), inTransit: Number(last.qtyAfter?.inTransit ?? 0) };
}

// ---------------------------------------------------------------------------------------------------------------
// FEFO picking over lots

export interface PickableSlice {
  id: string;
  lot: string;
  lotStatus: LotStatus;
  recalled: boolean;
  batchNo: string;
  bin: string;
  expiryDate: Date | null;
  quantity: number;
  createdAt?: Date | null;
}

/** Why a slice cannot be picked, or null when it can. */
export function pickBlockReason(
  s: Pick<PickableSlice, 'lotStatus' | 'recalled' | 'expiryDate'>,
  now: Date,
): string | null {
  if (s.recalled) return 'recalled';
  if (s.lotStatus === 'expired') return 'expired';
  if (s.lotStatus === 'quarantine') return 'in quarantine';
  if (s.lotStatus !== 'active') return s.lotStatus;
  if (s.expiryDate && new Date(s.expiryDate).getTime() <= now.getTime()) return 'past its expiry date';
  return null;
}

export interface LotAllocation extends Allocation {
  lineId: string;
  lot: string;
}

/**
 * First-expired-first-out across lots, skipping expired, quarantined and recalled lots (AC-DNA-6).
 * Throws DnaRuleError naming the blocked quantity when the pickable stock is not enough.
 */
export function pickFefoLots(slices: PickableSlice[], qty: number, now: Date): LotAllocation[] {
  const blocked = new Map<string, number>();
  const pickable = slices.filter((s) => {
    const why = pickBlockReason(s, now);
    if (why && s.quantity > 0) blocked.set(why, (blocked.get(why) ?? 0) + s.quantity);
    return !why;
  });
  const lotOf = new Map(pickable.map((s) => [s.id, s.lot]));
  try {
    return allocateFEFO(
      pickable.map((s) => ({
        id: s.id,
        batchNo: s.batchNo,
        bin: s.bin,
        expiryDate: s.expiryDate,
        quantity: s.quantity,
        createdAt: s.createdAt ?? null,
      })),
      qty,
    ).map((a) => ({ ...a, lineId: a.lineId!, lot: lotOf.get(a.lineId!)! }));
  } catch (e) {
    const note = [...blocked].map(([why, q]) => `${q} ${why}`).join(', ');
    throw new DnaRuleError(`${(e as Error).message}${note ? ` (not pickable: ${note})` : ''}`);
  }
}
