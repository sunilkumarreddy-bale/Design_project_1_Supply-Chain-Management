import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const CountLineSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    bin: { type: String, default: '' },
    batchNo: { type: String, default: '' },
    expiryDate: { type: Date, default: null },
    systemQty: { type: Number, min: 0, default: 0 },
    countedQty: { type: Number, min: 0, default: null },
    variance: { type: Number, default: null },
    reason: { type: String, default: '' },
  },
  { _id: true },
);

const StockCountSchema = new Schema(
  {
    countNo: { type: String, required: true, unique: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    status: { type: String, enum: ['open', 'submitted', 'reconciled', 'cancelled'], default: 'open' },
    lines: { type: [CountLineSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    submittedAt: { type: Date, default: null },
    reconciledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reconciledAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);
StockCountSchema.index({ warehouse: 1, status: 1 });

export type IStockCount = InferSchemaType<typeof StockCountSchema>;
export const StockCount = model('StockCount', StockCountSchema);
