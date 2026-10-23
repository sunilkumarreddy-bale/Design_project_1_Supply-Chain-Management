import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

export const TRANSFER_STATUSES = [
  'pending_approval',
  'approved',
  'in_transit',
  'completed',
  'rejected',
  'cancelled',
] as const;

const AllocationSchema = new Schema(
  {
    batchNo: { type: String, default: '' },
    bin: { type: String, default: '' },
    expiryDate: { type: Date, default: null },
    quantity: { type: Number, min: 0, required: true },
  },
  { _id: false },
);

const TransferSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    fromWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    toWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    quantity: { type: Number, required: true, min: [1, 'Quantity must be at least 1'] },
    batchNo: { type: String, default: '' },
    status: { type: String, enum: TRANSFER_STATUSES, default: 'pending_approval' },
    mode: { type: String, enum: ['instant', 'tracked'], default: 'instant' },
    allocations: { type: [AllocationSchema], default: [] },
    source: {
      type: String,
      enum: ['manual', 'rebalance', 'recovery_plan', 'redistribution_plan'],
      default: 'manual',
    },
    plan: { type: Schema.Types.ObjectId, default: null },
    planModel: { type: String, enum: ['RecoveryPlan', 'RedistributionPlan', null], default: null },
    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedReason: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true, toJSON: jsonOptions },
);
TransferSchema.index({ status: 1 });
TransferSchema.index({ fromWarehouse: 1, status: 1 });
TransferSchema.index({ toWarehouse: 1, status: 1 });
TransferSchema.index({ plan: 1 });

export type ITransfer = InferSchemaType<typeof TransferSchema>;
export const Transfer = model('Transfer', TransferSchema);
