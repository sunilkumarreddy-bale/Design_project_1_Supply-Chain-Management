import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const ProductSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, trim: true, default: 'General' },
    unit: { type: String, trim: true, default: 'pcs' },
    unitCost: { type: Number, min: 0, default: 0 },
    unitPrice: { type: Number, min: 0, default: 0 },
    imageUrl: { type: String, default: '' },
    primarySupplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    avgDailyDemand: { type: Number, min: 0, default: 1 },
    demandStdDev: { type: Number, min: 0, default: 0 },
    leadTimeDaysOverride: { type: Number, min: 0, default: null },
    serviceLevelZ: { type: Number, min: 0, max: 5, default: 1.65 },
    orderCost: { type: Number, min: 0, default: 20 },
    holdingCostPerUnitYear: {
      type: Number,
      default: 2,
      validate: { validator: (v: number) => v > 0, message: 'Holding cost must be greater than 0' },
    },
    annualDemandOverride: { type: Number, min: 0, default: null },
    isPerishable: { type: Boolean, default: false },
    shelfLifeDays: { type: Number, min: 0, default: null },
    minShelfLifeDays: { type: Number, min: 0, default: 1 },
    qrPayload: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);
ProductSchema.index({ name: 'text', sku: 'text' });
ProductSchema.index({ primarySupplier: 1 });
ProductSchema.pre('save', function (next) {
  const doc = this as unknown as { qrPayload: string; sku: string };
  if (!doc.qrPayload) doc.qrPayload = doc.sku;
  next();
});

export type IProduct = InferSchemaType<typeof ProductSchema>;
export const Product = model('Product', ProductSchema);
