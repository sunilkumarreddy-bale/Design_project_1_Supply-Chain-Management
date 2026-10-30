import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';
import { BIRTH_TYPES, DEATH_CAUSES, DISPOSAL_CAUSES, LOT_STATUSES } from '../engines/dnaEngine';

/** Stock DNA header: one per lot, from birth to death (docs/Stock_DNA_Spec.md C.3). */
const BirthSchema = new Schema(
  {
    type: { type: String, enum: BIRTH_TYPES, required: true },
    at: { type: Date, required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    bin: { type: String, default: '' },
    qty: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, min: 0, default: 0 },
    refType: { type: String, default: null },
    refId: { type: Schema.Types.ObjectId, default: null },
    grnNo: { type: String, default: null },
    backfilled: { type: Boolean, default: false },
  },
  { _id: false },
);

const OutSchema = new Schema(
  {
    sold: { type: Number, default: 0 },
    consumed: { type: Number, default: 0 },
    expired: { type: Number, default: 0 },
    damaged: { type: Number, default: 0 },
    shrinkage: { type: Number, default: 0 },
    recalled: { type: Number, default: 0 },
    returnedToSupplier: { type: Number, default: 0 },
    writtenOff: { type: Number, default: 0 },
  },
  { _id: false },
);

const DeathSchema = new Schema(
  {
    at: { type: Date, required: true },
    cause: { type: String, enum: DEATH_CAUSES, required: true },
    lifespanDays: { type: Number, required: true },
    lifeUsedPct: { type: Number, default: null },
    valueLost: { type: Number, default: 0 },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: '' },
  },
  { _id: false },
);

/** Disposal and return-to-supplier requests raised by a manager and decided by an admin. */
const RequestSchema = new Schema(
  {
    kind: { type: String, enum: ['dispose', 'return_to_supplier'], required: true },
    cause: { type: String, enum: [...DISPOSAL_CAUSES, null], default: null },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    qty: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true },
    evidence: { type: [String], default: [] },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: () => new Date() },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' },
  },
  { _id: true },
);

const StockLotSchema = new Schema(
  {
    dnaCode: { type: String, required: true, unique: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    batchNo: { type: String, default: '' },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    birth: { type: BirthSchema, required: true },
    manufactureDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    shelfLifeDays: { type: Number, default: null },
    parentLots: { type: [{ type: Schema.Types.ObjectId, ref: 'StockLot' }], default: [] },
    status: { type: String, enum: LOT_STATUSES, required: true },
    qtyBorn: { type: Number, default: 0 },
    qtyAdded: { type: Number, default: 0 },
    qtyOnHand: { type: Number, default: 0 },
    qtyInTransit: { type: Number, default: 0 },
    qtyReserved: { type: Number, default: 0 },
    qtyOutByCause: { type: OutSchema, default: () => ({}) },
    flags: {
      onHold: { type: Boolean, default: false },
      recalled: { type: Boolean, default: false },
      backfilled: { type: Boolean, default: false },
      qcRejected: { type: Boolean, default: false },
      expiryWarned: { type: Boolean, default: false },
    },
    /** Every warehouse the lot has been in (for scoping and filters). */
    warehouses: { type: [{ type: Schema.Types.ObjectId, ref: 'Warehouse' }], default: [] },
    death: { type: DeathSchema, default: null },
    requests: { type: [RequestSchema], default: [] },
    eventCount: { type: Number, default: 0 },
    headHash: { type: String, default: null },
    lastEventAt: { type: Date, default: null },
    lastEventType: { type: String, default: null },
    lastVerify: {
      at: { type: Date, default: null },
      ok: { type: Boolean, default: null },
      firstBrokenSeq: { type: Number, default: null },
    },
  },
  { timestamps: true, toJSON: jsonOptions, minimize: false },
);
StockLotSchema.index({ product: 1, status: 1 });
StockLotSchema.index({ product: 1, batchNo: 1, status: 1 });
StockLotSchema.index({ supplier: 1, batchNo: 1 });
StockLotSchema.index({ expiryDate: 1 });
StockLotSchema.index({ 'flags.recalled': 1 });
StockLotSchema.index({ status: 1, 'death.at': -1 });
StockLotSchema.index({ warehouses: 1 });

export type IStockLot = InferSchemaType<typeof StockLotSchema>;
export const StockLot = model('StockLot', StockLotSchema);
