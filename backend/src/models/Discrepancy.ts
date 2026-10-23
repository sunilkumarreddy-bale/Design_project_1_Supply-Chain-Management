import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const DiscrepancySchema = new Schema(
  {
    type: { type: String, enum: ['receipt_mismatch', 'count_variance', 'damage', 'other'], required: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    expectedQty: { type: Number, min: 0, default: 0 },
    actualQty: { type: Number, min: 0, default: 0 },
    evidence: { type: [String], default: [] },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, default: '' },
  },
  { timestamps: true, toJSON: jsonOptions },
);
DiscrepancySchema.index({ status: 1, warehouse: 1 });

export type IDiscrepancy = InferSchemaType<typeof DiscrepancySchema>;
export const Discrepancy = model('Discrepancy', DiscrepancySchema);
