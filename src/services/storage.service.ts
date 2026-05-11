import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { logger } from '../utils/logger';

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

function getS3Client(): S3Client | null {
  if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    return null;
  }
  return new S3Client({
    region: config.S3_REGION ?? 'eu-west-1',
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT, forcePathStyle: true } : {}),
  });
}

export type StoredFile = {
  key: string;
  url: string;
};

class StorageService {
  private s3: S3Client | null;

  constructor() {
    this.s3 = getS3Client();
    if (!this.s3 && !fs.existsSync(LOCAL_UPLOAD_DIR)) {
      fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    }
    logger.info(this.s3 ? 'Stockage : S3' : 'Stockage : disque local');
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<StoredFile> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET!,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );

      const endpoint = config.S3_ENDPOINT
        ? `${config.S3_ENDPOINT}/${config.S3_BUCKET}/${key}`
        : `https://${config.S3_BUCKET}.s3.${config.S3_REGION ?? 'eu-west-1'}.amazonaws.com/${key}`;

      return { key, url: endpoint };
    }

    const filePath = path.join(LOCAL_UPLOAD_DIR, key);
    fs.writeFileSync(filePath, buffer);
    return { key, url: `${config.BASE_URL}/uploads/${key}` };
  }

  async getStream(key: string): Promise<{ stream: Readable; contentType?: string }> {
    if (this.s3) {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: config.S3_BUCKET!, Key: key })
      );
      return {
        stream: res.Body as Readable,
        contentType: res.ContentType,
      };
    }

    const filePath = path.join(LOCAL_UPLOAD_DIR, key);
    if (!fs.existsSync(filePath)) {
      throw new Error('Fichier introuvable');
    }
    return { stream: fs.createReadStream(filePath) };
  }

  async delete(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET!, Key: key }));
      return;
    }

    const filePath = path.join(LOCAL_UPLOAD_DIR, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  isS3(): boolean {
    return this.s3 !== null;
  }
}

export const storageService = new StorageService();
