import { Response } from 'express';

export function sendPage<T>(res: Response, items: T[], total: number, page: number, limit: number) {
  res.json({ items, total, page, limit });
}

export function sendFile(res: Response, body: string | Buffer, filename: string, type: string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Escapes user input for use inside a RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
