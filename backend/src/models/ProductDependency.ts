import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const ProductDependencySchema = new Schema(
  {
    componentProduct: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    finishedProduct: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantityPer: { type: Number, required: true, min: [0.0001, 'quantityPer must be positive'] },
  },
  { timestamps: true, toJSON: jsonOptions },
);
ProductDependencySchema.index({ componentProduct: 1, finishedProduct: 1 }, { unique: true });
ProductDependencySchema.index({ finishedProduct: 1 });

export type IProductDependency = InferSchemaType<typeof ProductDependencySchema>;
export const ProductDependency = model('ProductDependency', ProductDependencySchema);
