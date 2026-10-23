import { Schema } from 'mongoose';

export const LocationSchema = new Schema(
  {
    lat: { type: Number, min: -90, max: 90 },
    lng: { type: Number, min: -180, max: 180 },
  },
  { _id: false },
);

export const TimelineSchema = new Schema(
  {
    at: { type: Date, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    event: { type: String, required: true },
    detail: { type: String, default: '' },
  },
  { _id: false },
);

/** Shared JSON transform: ids as strings, no __v. */
export const jsonOptions = {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret.id;
    return ret;
  },
};
