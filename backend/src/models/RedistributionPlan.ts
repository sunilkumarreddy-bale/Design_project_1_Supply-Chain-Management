import { Schema, model, InferSchemaType } from 'mongoose';
import { TimelineSchema, jsonOptions } from './common';

export const REDISTRIBUTION_STATUSES = [
  'proposed',
  'approved',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
] as const;

const LineSchema = new Schema(
  {
    toWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    toWarehouseName: { type: String, default: '' },
    quantity: { type: Number, min: 0, required: true },
    transferLeadDays: Number,
    transferCostPerUnit: Number,
    sellWindowDays: Number,
    destDailyDemand: Number,
    destExistingUnits: Number,
    capacityUnits: Number,
    expectedSoldBeforeExpiry: Number,
    transfer: { type: Schema.Types.ObjectId, ref: 'Transfer', default: null },
  },
  { _id: false },
);

const RedistributionPlanSchema = new Schema(
  {
    planNo: { type: String, required: true, unique: true },
    status: { type: String, enum: REDISTRIBUTION_STATUSES, default: 'proposed' },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    stockLevel: { type: Schema.Types.ObjectId, ref: 'StockLevel', default: null },
    batchNo: { type: String, default: '' },
    sourceWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    sourceQuantity: Number,
    expiryDate: Date,
    shelfLifeDaysLeft: Number,
    minShelfLifeDays: Number,
    sourceDailyDemand: Number,
    sourceOwnSalesUnits: Number,
    surplusUnits: Number,
    lines: { type: [LineSchema], default: [] },
    residualUnits: Number,
    residualAdvice: { type: String, enum: ['markdown', 'donate', 'dispose', 'none'], default: 'none' },
    explanation: [String],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: '' },
    timeline: { type: [TimelineSchema], default: [] },
  },
  { timestamps: true, toJSON: jsonOptions },
);
RedistributionPlanSchema.index({ status: 1, createdAt: -1 });

export type IRedistributionPlan = InferSchemaType<typeof RedistributionPlanSchema>;
export const RedistributionPlan = model('RedistributionPlan', RedistributionPlanSchema);
