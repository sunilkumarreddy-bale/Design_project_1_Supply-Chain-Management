import { Schema, model, InferSchemaType } from 'mongoose';
import { TimelineSchema, jsonOptions } from './common';

export const RECOVERY_STATUSES = [
  'proposed',
  'approved',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
  'failed',
] as const;

const StepSchema = new Schema(
  {
    type: { type: String, enum: ['transfer', 'purchase'], required: true },
    fromWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    fromWarehouseName: { type: String, default: '' },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplierName: { type: String, default: '' },
    quantity: { type: Number, min: 0, required: true },
    unitCost: { type: Number, min: 0, default: 0 },
    leadTimeDays: { type: Number, min: 0, default: 0 },
    cost: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const OptionSchema = new Schema(
  {
    optionId: { type: String, required: true },
    label: { type: String, required: true },
    steps: { type: [StepSchema], default: [] },
    coveredUnits: Number,
    shortageLeft: Number,
    totalCost: Number,
    etaDays: Number,
    feasible: Boolean,
    constraintChecks: [{ _id: false, name: String, passed: Boolean, detail: String }],
    explanation: [String],
    rank: Number,
  },
  { _id: false },
);

const RecoveryPlanSchema = new Schema(
  {
    planNo: { type: String, required: true, unique: true },
    status: { type: String, enum: RECOVERY_STATUSES, default: 'proposed' },
    trigger: {
      kind: { type: String, enum: ['supplier_delay', 'shortage_alert', 'manual'], default: 'manual' },
      supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
      delayDays: { type: Number, default: null },
    },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    targetWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    context: {
      onHand: Number,
      inboundWithinHorizon: Number,
      dailyDemand: Number,
      minStock: Number,
      horizonDays: Number,
      requiredUnits: Number,
      asOf: Date,
    },
    options: { type: [OptionSchema], default: [] },
    selectedOptionId: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: '' },
    execution: {
      transfers: [{ type: Schema.Types.ObjectId, ref: 'Transfer' }],
      purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
      /** All POs created by the plan (one per supplier); purchaseOrder holds the first for convenience. */
      purchaseOrders: [{ type: Schema.Types.ObjectId, ref: 'PurchaseOrder' }],
      completedAt: { type: Date, default: null },
    },
    timeline: { type: [TimelineSchema], default: [] },
  },
  { timestamps: true, toJSON: jsonOptions },
);
RecoveryPlanSchema.index({ status: 1, createdAt: -1 });

export type IRecoveryPlan = InferSchemaType<typeof RecoveryPlanSchema>;
export const RecoveryPlan = model('RecoveryPlan', RecoveryPlanSchema);
