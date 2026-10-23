import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';
import { jsonOptions } from './common';

export const ROLES = ['admin', 'warehouse_manager', 'supplier', 'staff'] as const;
export type Role = (typeof ROLES)[number];

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'staff' },
    supplier: {
      type: Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null,
      required: [
        function (this: { role: string }) {
          return this.role === 'supplier';
        },
        'A supplier user must be linked to a supplier',
      ],
    },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    phone: { type: String, trim: true, match: [/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format'], default: undefined },
    notify: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      ...jsonOptions,
      transform: (_d: unknown, ret: Record<string, unknown>) => {
        delete ret.id;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);
UserSchema.index({ role: 1 });
UserSchema.index({ warehouse: 1 });

export type IUser = InferSchemaType<typeof UserSchema>;
export type UserDoc = HydratedDocument<IUser>;
export const User = model('User', UserSchema);
