import { Schema, model, InferSchemaType } from 'mongoose';
import { LocationSchema, jsonOptions } from './common';

const ZoneSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, trim: true, default: '' },
    bins: { type: [String], default: [] },
  },
  { _id: false },
);

const WarehouseSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    location: { type: LocationSchema, default: null },
    zones: { type: [ZoneSchema], default: [] },
    manager: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

export type IWarehouse = InferSchemaType<typeof WarehouseSchema>;
export const Warehouse = model('Warehouse', WarehouseSchema);
