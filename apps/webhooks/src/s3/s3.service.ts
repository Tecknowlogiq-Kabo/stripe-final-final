import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly trustPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('aws.region') ?? 'us-east-1';
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');
    this.bucket = this.configService.get<string>('aws.s3Bucket') ?? 'stripe-trust-files';
    this.trustPrefix = this.configService.get<string>('aws.s3TrustPrefix') ?? 'trust-approved/';

    this.client = new S3Client({
      region,
      credentials: accessKeyId
        ? { accessKeyId, secretAccessKey: secretAccessKey ?? '' }
        : undefined,
    });

    this.logger.log({
      message: 'S3 client initialized',
      region,
      bucket: this.bucket,
      hasCredentials: !!accessKeyId,
    });
  }

  /**
   * Upload a body (Buffer or string) to S3.
   * Returns the S3 key.
   */
  async upload(
    key: string,
    body: Buffer | string,
    contentType?: string,
  ): Promise<{ key: string; etag?: string }> {
    const fullKey = `${this.trustPrefix}${key}`;
    this.logger.log({ message: 'Uploading to S3', bucket: this.bucket, key: fullKey });

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
      Body: body,
      ContentType: contentType ?? 'application/octet-stream',
    });

    const result = await this.client.send(command);
    return { key: fullKey, etag: result.ETag };
  }

  /**
   * Download an object from S3. Returns the body as Buffer.
   */
  async download(key: string): Promise<Buffer> {
    const fullKey = key.startsWith(this.trustPrefix) ? key : `${this.trustPrefix}${key}`;
    this.logger.log({ message: 'Downloading from S3', bucket: this.bucket, key: fullKey });

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
    });

    const result = await this.client.send(command);
    if (!result.Body) {
      throw new Error(`S3 object has no body: ${fullKey}`);
    }

    // Convert the stream/body to Buffer
    const chunks: Uint8Array[] = [];
    const stream = result.Body as any;
    if (typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    } else {
      // In Node.js AWS SDK, Body may already be a Buffer/string
      if (Buffer.isBuffer(stream)) return stream;
      if (typeof stream === 'string') return Buffer.from(stream);
      throw new Error(`Unsupported S3 response body type: ${typeof stream}`);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Generate a pre-signed URL for GET access (time-limited download).
   */
  async presignedGetUrl(key: string, expiresInSec: number = 3600): Promise<string> {
    const fullKey = key.startsWith(this.trustPrefix) ? key : `${this.trustPrefix}${key}`;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSec });
  }

  /**
   * Generate a pre-signed URL for PUT access (time-limited upload).
   */
  async presignedPutUrl(
    key: string,
    expiresInSec: number = 3600,
    contentType?: string,
  ): Promise<string> {
    const fullKey = `${this.trustPrefix}${key}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
      ContentType: contentType ?? 'application/octet-stream',
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSec });
  }

  /**
   * Delete an object from S3. Idempotent — succeeds even if the key doesn't exist.
   */
  async deleteObject(key: string): Promise<void> {
    const fullKey = key.startsWith(this.trustPrefix) ? key : `${this.trustPrefix}${key}`;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: fullKey }),
      );
      this.logger.log({ message: 'Deleted S3 object', bucket: this.bucket, key: fullKey });
    } catch (err) {
      this.logger.error({ message: 'Failed to delete S3 object', bucket: this.bucket, key: fullKey, err });
    }
  }

  /**
   * Fetch a file from a source URL and store it in S3.
   * Uses native Node.js fetch (Node 18+).
   */
  async pullAndStore(
    sourceUrl: string,
    destKey: string,
    contentType?: string,
  ): Promise<{ key: string; size: number }> {
    this.logger.log({ message: 'Pulling from source and storing in S3', sourceUrl, destKey });

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch source file: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const detectedContentType = contentType ?? response.headers.get('content-type') ?? undefined;

    const result = await this.upload(destKey, buffer, detectedContentType);
    return { key: result.key, size: buffer.length };
  }

  /**
   * Check if an object exists in S3.
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = key.startsWith(this.trustPrefix) ? key : `${this.trustPrefix}${key}`;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: fullKey }));
      return true;
    } catch {
      return false;
    }
  }
}
