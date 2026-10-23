import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const DemandHistorySchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    date: { type: Date, required: true },
    quantity: { type: Number, min: 0, default: 0 },
    source: { type: String, enum: ['dispatch', 'import', 'seed'], default: 'dispatch' },
  },
  { timestamps: true, toJSON: jsonOptions },
);
DemandHistorySchema.index({ product: 1, warehouse: 1, date: 1 }, { unique: true });

export type IDemandHistory = InferSchemaType<typeof DemandHistorySchema>;
export const DemandHistory = model('DemandHistory', DemandHistorySchema, 'demandhistory');
