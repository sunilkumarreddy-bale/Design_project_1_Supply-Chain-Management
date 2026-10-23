import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

export const ALERT_TYPES = [
  'low_stock',
  'overstock',
  'expiry',
  'po_pending_approval',
  'po_overdue',
  'supplier_disruption',
  'recovery_proposed',
  'redistribution_proposed',
  'count_variance',
  'discrepancy',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

const AlertSchema = new Schema(
  {
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, default: 'info' },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    plan: { type: Schema.Types.ObjectId, default: null },
    /** Distinguishes several open alerts of one type for the same product and warehouse (e.g. one per batch or PO). */
    key: { type: String, default: '' },
    message: { type: String, required: true },
    isResolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);
AlertSchema.index({ type: 1, product: 1, warehouse: 1, key: 1, isResolved: 1 });
AlertSchema.index({ isResolved: 1, createdAt: -1 });

export type IAlert = InferSchemaType<typeof AlertSchema>;
export const Alert = model('Alert', AlertSchema);
