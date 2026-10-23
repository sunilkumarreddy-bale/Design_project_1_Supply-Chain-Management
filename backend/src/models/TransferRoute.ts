import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const TransferRouteSchema = new Schema(
  {
    fromWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    toWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    leadTimeDays: { type: Number, min: 0, required: true },
    costPerUnit: { type: Number, min: 0, default: 0 },
    distanceKm: { type: Number, min: 0, default: null },
    estimated: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: jsonOptions },
);
TransferRouteSchema.index({ fromWarehouse: 1, toWarehouse: 1 }, { unique: true });

export type ITransferRoute = InferSchemaType<typeof TransferRouteSchema>;
export const TransferRoute = model('TransferRoute', TransferRouteSchema);
