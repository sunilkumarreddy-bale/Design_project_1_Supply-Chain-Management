import { Schema, model, ClientSession } from 'mongoose';

const CounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false, versionKey: false },
);

export const Counter = model('Counter', CounterSchema);

/** Atomically increments and returns the named sequence; safe across several server instances. */
export async function nextSequence(name: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session },
  );
  return doc!.seq;
}
