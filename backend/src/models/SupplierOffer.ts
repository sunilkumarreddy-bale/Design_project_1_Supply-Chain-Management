import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const SupplierOfferSchema = new Schema(
  {
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    capacityUnits: { type: Number, min: 0, required: true },
    minOrderQty: { type: Number, min: 0, default: 1 },
    leadTimeDays: { type: Number, min: 0, required: true },
    unitCost: { type: Number, min: 0, required: true },
    validUntil: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);
SupplierOfferSchema.index({ supplier: 1, product: 1 }, { unique: true });
SupplierOfferSchema.index({ product: 1 });

export type ISupplierOffer = InferSchemaType<typeof SupplierOfferSchema>;
export const SupplierOffer = model('SupplierOffer', SupplierOfferSchema);
