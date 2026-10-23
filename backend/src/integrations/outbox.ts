/** In-memory record of messages handled by the console/mock drivers (inspected by tests and the dev log). */
export interface OutboxEntry {
  channel: 'email' | 'sms' | 'storage' | 'maps' | 'payments';
  driver: string;
  at: Date;
  payload: Record<string, unknown>;
}

const entries: OutboxEntry[] = [];
const MAX = 500;

export const mockOutbox = {
  push(e: Omit<OutboxEntry, 'at'>) {
    entries.push({ ...e, at: new Date() });
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  },
  list(channel?: OutboxEntry['channel']) {
    return channel ? entries.filter((e) => e.channel === channel) : [...entries];
  },
  clear() {
    entries.length = 0;
  },
};
