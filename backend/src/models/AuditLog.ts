import { Schema, model, InferSchemaType } from 'mongoose';

/** Append-only, hash-chained audit trail (F6). Every field below except _id is covered by the hash. */
const AuditLogSchema = new Schema(
  {
    seq: { type: Number, required: true, unique: true },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    actor: { type: String, default: null },
    warehouse: { type: String, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, required: true },
  },
  { timestamps: false, minimize: false, versionKey: false },
);
AuditLogSchema.index({ entityType: 1, entityId: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ actor: 1 });

export type IAuditLog = InferSchemaType<typeof AuditLogSchema>;
export const AuditLog = model('AuditLog', AuditLogSchema);
