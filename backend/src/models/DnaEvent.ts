import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';
import { GENE_TYPES } from '../engines/dnaEngine';

/** One gene of a lot's DNA: append-only, hash-chained per lot and anchored in the audit log (C.3, C.6). */
const DnaEventSchema = new Schema(
  {
    lot: { type: Schema.Types.ObjectId, ref: 'StockLot', required: true },
    seq: { type: Number, required: true, min: 1 },
    type: { type: String, enum: GENE_TYPES, required: true },
    at: { type: Date, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: 'system' },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    fromWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    toWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    bin: { type: String, default: null },
    qtyDelta: { type: Number, default: 0 },
    qtyMoved: { type: Number, default: 0 },
    qtyAfter: {
      onHand: { type: Number, default: 0 },
      inTransit: { type: Number, default: 0 },
    },
    cause: { type: String, default: null },
    refType: { type: String, default: null },
    refId: { type: Schema.Types.ObjectId, default: null },
    explanation: { type: String, default: '' },
    evidence: { type: [String], default: [] },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: false, versionKey: false, toJSON: jsonOptions, minimize: false },
);
DnaEventSchema.index({ lot: 1, seq: 1 }, { unique: true });
DnaEventSchema.index({ type: 1, at: -1 });
DnaEventSchema.index({ refType: 1, refId: 1 });
DnaEventSchema.index({ warehouse: 1, at: -1 });

export type IDnaEvent = InferSchemaType<typeof DnaEventSchema>;
export const DnaEvent = model('DnaEvent', DnaEventSchema);
