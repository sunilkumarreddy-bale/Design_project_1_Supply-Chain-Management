import { randomUUID } from 'crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import { safeFilename, StorageDriver } from './index';

let client: S3Client | null = null;

/** Uses the default AWS credential chain (env keys locally, the EC2 instance role in production). */
export const s3StorageDriver: StorageDriver = {
  name: 's3',
  async upload(input) {
    client ??= new S3Client({ region: env.awsRegion });
    const key = `${safeFilename(input.folder)}/${randomUUID()}-${safeFilename(input.filename)}`;
    await client.send(
      new PutObjectCommand({ Bucket: env.awsS3Bucket, Key: key, Body: input.buffer, ContentType: input.mimeType }),
    );
    return { url: `https://${env.awsS3Bucket}.s3.${env.awsRegion}.amazonaws.com/${key}`, key, driver: 's3' };
  },
};
