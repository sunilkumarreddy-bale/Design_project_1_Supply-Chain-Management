import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../../config/env';
import { mockOutbox } from '../outbox';
import { safeFilename, StorageDriver } from './index';

export const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');

export const localStorageDriver: StorageDriver = {
  name: 'local',
  async upload(input) {
    const folder = safeFilename(input.folder);
    const key = `${folder}/${randomUUID()}-${safeFilename(input.filename)}`;
    const target = path.join(UPLOAD_DIR, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.buffer);
    const url = `${env.publicBaseUrl.replace(/\/$/, '')}/uploads/${key}`;
    mockOutbox.push({ channel: 'storage', driver: 'local', payload: { key, url, size: input.buffer.length } });
    return { url, key, driver: 'local' };
  },
};
