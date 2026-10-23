import { Schema, model, InferSchemaType } from 'mongoose';
import { jsonOptions } from './common';

const NotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String, enum: ['in_app', 'email', 'sms'], required: true },
    type: { type: String, required: true },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    link: { type: String, default: '' },
    status: { type: String, enum: ['queued', 'sent', 'failed', 'read'], default: 'queued' },
    providerMessageId: { type: String, default: '' },
    error: { type: String, default: '' },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);
NotificationSchema.index({ user: 1, channel: 1, createdAt: -1 });

export type INotification = InferSchemaType<typeof NotificationSchema>;
export const Notification = model('Notification', NotificationSchema);
