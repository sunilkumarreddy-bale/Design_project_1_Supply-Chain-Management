import { Schema, model, InferSchemaType } from 'mongoose';
import { LocationSchema, jsonOptions } from './common';

const SupplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    location: { type: LocationSchema, default: null },
    leadTimeDays: { type: Number, min: 0, default: 7 },
    performanceScore: { type: Number, min: 0, max: 100, default: 100 },
    onTimeDeliveries: { type: Number, min: 0, default: 0 },
    lateDeliveries: { type: Number, min: 0, default: 0 },
    totalOrders: { type: Number, min: 0, default: 0 },
    leadTimeSamples: { type: Number, min: 0, default: 0 },
    leadTimeSum: { type: Number, min: 0, default: 0 },
    leadTimeSumSq: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ['active', 'disrupted', 'inactive'], default: 'active' },
    disruption: {
      type: new Schema(
        {
          from: { type: Date, required: true },
          expectedDays: { type: Number, min: 0, required: true },
          reason: { type: String, default: '' },
        },
        { _id: false },
      ),
      default: null,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);
SupplierSchema.index({ name: 1 });

export type ISupplier = InferSchemaType<typeof SupplierSchema>;
export const Supplier = model('Supplier', SupplierSchema);
