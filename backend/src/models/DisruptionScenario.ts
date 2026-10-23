import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const DisruptionScenarioSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['supplier_stop', 'supplier_delay', 'component_stop'], required: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    startDay: { type: Number, min: 0, default: 0 },
    durationDays: { type: Number, min: 1, required: true },
    horizonDays: { type: Number, min: 1, max: 365, default: 30 },
    backorders: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);

export type IDisruptionScenario = InferSchemaType<typeof DisruptionScenarioSchema>;
export const DisruptionScenario = model('DisruptionScenario', DisruptionScenarioSchema);
