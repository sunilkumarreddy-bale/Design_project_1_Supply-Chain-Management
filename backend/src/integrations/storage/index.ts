import { env } from '../../config/env';
import { cloudinaryStorageDriver, parseCloudinaryUrl } from './cloudinaryDriver';
import { localStorageDriver } from './localDriver';
import { s3StorageDriver } from './s3Driver';

export type UploadKind = 'image' | 'attachment' | 'document';

export interface UploadInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  folder: string;
  kind: UploadKind;
}

export interface UploadResult {
  url: string;
  key: string;
  driver: string;
}

export interface StorageDriver {
  name: string;
  upload(input: UploadInput): Promise<UploadResult>;
}

const cloudinaryReady = () => !!parseCloudinaryUrl(env.cloudinaryUrl);
const s3Ready = () => !!env.awsS3Bucket;

/**
 * Images and attachments go to Cloudinary, documents to S3, when configured; STORAGE_PROVIDER forces one.
 * With no keys the local driver stores files under ./uploads and serves them from /uploads.
 */
export function getStorageDriver(kind: UploadKind): StorageDriver {
  const forced = env.storageProvider;
  if (forced === 'cloudinary' && cloudinaryReady()) return cloudinaryStorageDriver;
  if (forced === 's3' && s3Ready()) return s3StorageDriver;
  if (forced === 'local') return localStorageDriver;
  if (kind === 'document') {
    if (s3Ready()) return s3StorageDriver;
    if (cloudinaryReady()) return cloudinaryStorageDriver;
  } else {
    if (cloudinaryReady()) return cloudinaryStorageDriver;
    if (s3Ready()) return s3StorageDriver;
  }
  return localStorageDriver;
}

export function uploadFile(input: UploadInput): Promise<UploadResult> {
  return getStorageDriver(input.kind).upload(input);
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '');
  return cleaned.slice(-80) || 'file';
}
