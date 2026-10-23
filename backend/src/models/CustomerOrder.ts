import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const LineSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: [1, 'Quantity must be at least 1'] },
    quantityFulfilled: { type: Number, min: 0, default: 0 },
    unitPrice: { type: Number, min: 0, default: null },
  },
  { _id: true },
);

const CustomerOrderSchema = new Schema(
  {
    orderNo: { type: String, required: true, unique: true, trim: true },
    customerName: { type: String, required: true, trim: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    items: {
      type: [LineSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: 'An order needs at least one line' },
    },
    requiredBy: { type: Date, required: true },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    status: { type: String, enum: ['open', 'fulfilled', 'late', 'cancelled'], default: 'open' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);
CustomerOrderSchema.index({ warehouse: 1, status: 1 });
CustomerOrderSchema.index({ 'items.product': 1 });

export type ICustomerOrder = InferSchemaType<typeof CustomerOrderSchema>;
export const CustomerOrder = model('CustomerOrder', CustomerOrderSchema);
