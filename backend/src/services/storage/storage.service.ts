/**
 * @fileoverview S3-Compatible Object Storage Service
 *
 * Provides methods to interact with any S3-compatible storage backend:
 * - SeaweedFS (local/Docker and Kubernetes)
 * - AWS S3 (production cloud)
 *
 * Uses AWS SDK v3 with forcePathStyle so it works with self-hosted endpoints.
 * Compatible with SeaweedFS, AWS S3, Ceph, and any other S3-compatible endpoint.
 *
 * @module services/storage/storage
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { logger } from '../../utils/logger';

export interface FileMetadata {
  size: number;
  metaData: Record<string, string>;
  lastModified: Date;
  etag: string;
}

export class StorageService {
  private client: S3Client;
  private createdBuckets: Set<string> = new Set();

  constructor() {
    // Accept both STORAGE_* (new) and MINIO_* (legacy) env vars
    const endpoint = process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT || 'localhost';
    const port = parseInt(process.env.STORAGE_PORT || process.env.MINIO_PORT || '8333');
    const useSSL =
      process.env.STORAGE_USE_SSL === 'true' || process.env.MINIO_USE_SSL === 'true';
    const accessKeyId =
      process.env.STORAGE_ACCESS_KEY ||
      process.env.MINIO_ACCESS_KEY ||
      process.env.MINIO_ROOT_USER ||
      'admin';
    const secretAccessKey =
      process.env.STORAGE_SECRET_KEY ||
      process.env.MINIO_SECRET_KEY ||
      process.env.MINIO_ROOT_PASSWORD ||
      'password';

    this.client = new S3Client({
      endpoint: `${useSSL ? 'https' : 'http'}://${endpoint}:${port}`,
      region: 'us-east-1', // required by SDK; SeaweedFS ignores it
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // required for self-hosted S3 endpoints
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getUserBucket(userId: string): string {
    const sanitizedUserId = userId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return `user-${sanitizedUserId}`;
  }

  private async ensureUserBucket(userId: string): Promise<string> {
    const bucket = this.getUserBucket(userId);

    if (this.createdBuckets.has(bucket)) {
      return bucket;
    }

    try {
      const exists = await this.bucketExists(bucket);
      if (!exists) {
        await this.makeBucket(bucket);
        logger.info(`[Storage] Created user bucket: ${bucket}`);
      }
      this.createdBuckets.add(bucket);
      return bucket;
    } catch (error) {
      logger.error(`[Storage] Error ensuring user bucket ${bucket}:`, error);
      throw new Error('Failed to initialize user storage bucket');
    }
  }

  // ---------------------------------------------------------------------------
  // Low-level S3 primitives
  // ---------------------------------------------------------------------------

  async bucketExists(bucket: string): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (error: any) {
      if (
        error.name === 'NotFound' ||
        error.name === 'NoSuchBucket' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  async makeBucket(bucket: string): Promise<void> {
    await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  async removeBucket(bucket: string): Promise<void> {
    await this.client.send(new DeleteBucketCommand({ Bucket: bucket }));
  }

  async putObject(
    bucket: string,
    key: string,
    buffer: Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
      })
    );
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async getObjectStream(bucket: string, key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    return response.Body as Readable;
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((k) => ({ Key: k })) },
      })
    );
  }

  async listObjects(
    bucket: string,
    prefix?: string
  ): Promise<Array<{ name: string; size: number; lastModified: Date }>> {
    const files: Array<{ name: string; size: number; lastModified: Date }> = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents ?? []) {
        if (obj.Key) {
          files.push({
            name: obj.Key,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified ?? new Date(),
          });
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  }

  async presignedGetUrl(
    bucket: string,
    key: string,
    expirySeconds: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expirySeconds });
  }

  async statObject(bucket: string, key: string): Promise<FileMetadata> {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    return {
      size: response.ContentLength ?? 0,
      metaData: response.Metadata ?? {},
      lastModified: response.LastModified ?? new Date(),
      etag: response.ETag ?? '',
    };
  }

  // ---------------------------------------------------------------------------
  // High-level methods — S3-compatible object storage API
  // ---------------------------------------------------------------------------

  /**
   * Upload a file.
   * Files are stored as: user-{userId}/{category}/{timestamp}-{filename}
   *
   * An optional subPath is inserted between the category and the filename —
   * user-{userId}/{category}/{subPath}/{timestamp}-{filename} — so callers that
   * store many files of one category can partition them by entity (e.g.
   * `clients/{clientId}`) instead of relying on the timestamp alone to keep
   * keys apart. The parameter is trailing and optional, so existing five-
   * argument callers are unaffected.
   */
  async uploadFile(
    userId: string,
    fileBuffer: Buffer,
    originalFilename: string,
    mimetype: string,
    category: 'receipts' | 'logos' | 'documents' | 'invoices' | 'exports' = 'receipts',
    subPath?: string
  ): Promise<{ url: string; filename: string; objectName: string }> {
    try {
      const bucket = await this.ensureUserBucket(userId);
      const timestamp = Date.now();
      const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
      // Sanitise each segment separately so the caller's '/' separators survive
      // but nothing can climb out of the category prefix.
      const sanitizedSubPath = (subPath || '')
        .split('/')
        .map((segment) => segment.replace(/[^a-zA-Z0-9.-]/g, '_'))
        .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
        .join('/');
      const prefix = sanitizedSubPath ? `${category}/${sanitizedSubPath}` : category;
      const objectName = `${prefix}/${timestamp}-${sanitizedFilename}`;

      await this.putObject(bucket, objectName, fileBuffer, mimetype);
      logger.info(`[Storage] Uploaded file: ${objectName} to bucket: ${bucket}`);

      return {
        url: `/${bucket}/${objectName}`,
        filename: sanitizedFilename,
        objectName,
      };
    } catch (error) {
      logger.error('[Storage] Upload error:', error);
      throw new Error('Failed to upload file to storage');
    }
  }

  /** Generate a presigned GET URL (bucket + key). */
  async getPresignedUrl(
    bucket: string,
    objectName: string,
    expirySeconds: number = 3600
  ): Promise<string> {
    try {
      return await this.presignedGetUrl(bucket, objectName, expirySeconds);
    } catch (error) {
      logger.error('[Storage] Presigned URL error:', error);
      throw new Error('Failed to generate download URL');
    }
  }

  /** Generate a presigned GET URL from a stored path like /bucket/category/file. */
  async getPresignedUrlFromPath(storedUrl: string, expirySeconds: number = 3600): Promise<string> {
    try {
      const parts = storedUrl.replace(/^\//, '').split('/');
      const bucket = parts[0];
      const objectName = parts.slice(1).join('/');
      return await this.getPresignedUrl(bucket, objectName, expirySeconds);
    } catch (error) {
      logger.error('[Storage] Presigned URL from path error:', error);
      throw new Error('Failed to generate download URL');
    }
  }

  /** Delete a file by bucket + object name. */
  async deleteFile(bucket: string, objectName: string): Promise<void> {
    try {
      await this.deleteObject(bucket, objectName);
      logger.info(`[Storage] Deleted file: ${objectName} from bucket: ${bucket}`);
    } catch (error) {
      logger.error('[Storage] Delete error:', error);
      throw new Error('Failed to delete file from storage');
    }
  }

  /** Delete a file using a stored path like /bucket/category/file. */
  async deleteFileFromPath(storedUrl: string): Promise<void> {
    try {
      const parts = storedUrl.replace(/^\//, '').split('/');
      const bucket = parts[0];
      const objectName = parts.slice(1).join('/');
      await this.deleteFile(bucket, objectName);
    } catch (error) {
      logger.error('[Storage] Delete from path error:', error);
      throw new Error('Failed to delete file');
    }
  }

  /** List files for a user, optionally filtered by category. */
  async listUserFiles(
    userId: string,
    category?: 'receipts' | 'logos' | 'documents' | 'invoices' | 'exports'
  ): Promise<Array<{ name: string; size: number; lastModified: Date }>> {
    try {
      const bucket = await this.ensureUserBucket(userId);
      const prefix = category ? `${category}/` : undefined;
      return await this.listObjects(bucket, prefix);
    } catch (error) {
      logger.error('[Storage] List files error:', error);
      throw new Error('Failed to list files');
    }
  }

  /** Return true if the given bucket belongs to the user. */
  validateUserAccess(userId: string, bucketName: string): boolean {
    return bucketName === this.getUserBucket(userId);
  }

  /** Delete a user bucket and all its contents. */
  async deleteUserBucket(userId: string): Promise<void> {
    try {
      const bucket = this.getUserBucket(userId);
      const exists = await this.bucketExists(bucket);

      if (!exists) {
        logger.info(`[Storage] Bucket ${bucket} does not exist, skipping deletion`);
        return;
      }

      const objects = await this.listObjects(bucket);
      if (objects.length > 0) {
        await this.deleteObjects(
          bucket,
          objects.map((o) => o.name)
        );
        logger.info(`[Storage] Deleted ${objects.length} objects from bucket ${bucket}`);
      }

      await this.removeBucket(bucket);
      this.createdBuckets.delete(bucket);
      logger.info(`[Storage] Deleted user bucket: ${bucket}`);
    } catch (error) {
      logger.error('[Storage] Error deleting user bucket:', error);
      throw new Error('Failed to delete user bucket');
    }
  }

  /** Get file metadata (size, content-type, last modified, etag). */
  async getFileMetadata(bucket: string, objectName: string): Promise<FileMetadata> {
    try {
      return await this.statObject(bucket, objectName);
    } catch (error) {
      logger.error('[Storage] Get metadata error:', error);
      throw new Error('Failed to get file metadata');
    }
  }

  /** Get a readable stream for a file. */
  async getFileStream(bucket: string, objectName: string): Promise<Readable> {
    try {
      return await this.getObjectStream(bucket, objectName);
    } catch (error) {
      logger.error('[Storage] Get file stream error:', error);
      throw new Error('Failed to get file stream');
    }
  }
}

export const storageService = new StorageService();
