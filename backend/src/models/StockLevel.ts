import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const StockLevelSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    bin: { type: String, trim: true, default: '' },
    batchNo: { type: String, trim: true, default: '' },
    expiryDate: { type: Date, default: null },
    quantity: { type: Number, min: [0, 'Stock quantity cannot be negative'], default: 0 },
    reorderPoint: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, toJSON: jsonOptions },
);
StockLevelSchema.index({ product: 1, warehouse: 1, batchNo: 1, bin: 1 }, { unique: true });
StockLevelSchema.index({ expiryDate: 1 });
StockLevelSchema.index({ warehouse: 1 });

export type IStockLevel = InferSchemaType<typeof StockLevelSchema>;
export const StockLevel = model('StockLevel', StockLevelSchema);
