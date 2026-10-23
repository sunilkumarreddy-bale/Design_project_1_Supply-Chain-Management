import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const SimulationRunSchema = new Schema(
  {
    scenario: { type: Schema.Types.ObjectId, ref: 'DisruptionScenario', default: null },
    scenarioSnapshot: { type: Schema.Types.Mixed, default: null },
    ranAt: { type: Date, default: () => new Date() },
    ranBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    parameters: {
      horizonDays: Number,
      safetyStockMultiplier: Number,
      backorders: Boolean,
    },
    graph: { type: Schema.Types.Mixed, default: null },
    baseline: { type: Schema.Types.Mixed, default: null },
    strategies: { type: Schema.Types.Mixed, default: [] },
    sweep: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false, toJSON: jsonOptions },
);
SimulationRunSchema.index({ ranAt: -1 });

export type ISimulationRun = InferSchemaType<typeof SimulationRunSchema>;
export const SimulationRun = model('SimulationRun', SimulationRunSchema);
