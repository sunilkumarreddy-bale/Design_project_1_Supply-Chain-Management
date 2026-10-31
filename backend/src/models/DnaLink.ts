import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

/** Genealogy edge between lots (return, repack, merge). A partial transfer never creates a child lot. */
const DnaLinkSchema = new Schema(
  {
    parentLot: { type: Schema.Types.ObjectId, ref: 'StockLot', required: true },
    childLot: { type: Schema.Types.ObjectId, ref: 'StockLot', required: true },
    relation: { type: String, enum: ['return', 'repack', 'merge'], required: true },
    qty: { type: Number, required: true, min: 0 },
    at: { type: Date, required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'DnaEvent', default: null },
  },
  { timestamps: false, versionKey: false, toJSON: jsonOptions },
);
DnaLinkSchema.index({ parentLot: 1 });
DnaLinkSchema.index({ childLot: 1 });

export type IDnaLink = InferSchemaType<typeof DnaLinkSchema>;
export const DnaLink = model('DnaLink', DnaLinkSchema);
