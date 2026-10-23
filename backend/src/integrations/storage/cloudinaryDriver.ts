import { createHash } from 'crypto';
import { env } from '../../config/env';
import type { StorageDriver } from './index';

export function parseCloudinaryUrl(url: string): { apiKey: string; apiSecret: string; cloudName: string } | null {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url || '');
  return m ? { apiKey: m[1], apiSecret: m[2], cloudName: m[3] } : null;
}

export const cloudinaryStorageDriver: StorageDriver = {
  name: 'cloudinary',
  async upload(input) {
    const cfg = parseCloudinaryUrl(env.cloudinaryUrl);
    if (!cfg) throw new Error('CLOUDINARY_URL is not configured');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = `smart-inventory/${input.folder}`;
    const signature = createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${cfg.apiSecret}`).digest('hex');
    const form = new FormData();
    form.append('file', new Blob([input.buffer], { type: input.mimeType }), input.filename);
    form.append('api_key', cfg.apiKey);
    form.append('timestamp', timestamp);
    form.append('folder', folder);
    form.append('signature', signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/auto/upload`, { method: 'POST', body: form });
    const body = (await res.json()) as { secure_url?: string; public_id?: string; error?: { message: string } };
    if (!res.ok || !body.secure_url) throw new Error(`Cloudinary upload failed: ${body.error?.message ?? res.status}`);
    return { url: body.secure_url, key: body.public_id ?? '', driver: 'cloudinary' };
  },
};
