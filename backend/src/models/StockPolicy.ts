import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const StockPolicySchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    minStock: { type: Number, min: 0, default: null },
    maxStock: { type: Number, min: 0, default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);
StockPolicySchema.index({ product: 1, warehouse: 1 }, { unique: true });

export type IStockPolicy = InferSchemaType<typeof StockPolicySchema>;
export const StockPolicy = model('StockPolicy', StockPolicySchema);
