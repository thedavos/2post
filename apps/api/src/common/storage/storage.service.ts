import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

/**
 * Storage abstraction ported from the legacy STORAGE_BACKEND switch:
 *   local → filesystem under MEDIA_ROOT (Docker volume)
 *   s3    → S3-compatible bucket (R2/AWS/MinIO/B2) via signed PUT
 * Media rows store only `storageKey`; bytes never move during migration.
 */

export interface MediaStorage {
  readonly backend: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** A URL from which the object can be read (signed for S3, served path local). */
  publicUrl(key: string): Promise<string>;
}

class LocalMediaStorage implements MediaStorage {
  readonly backend = "local" as const;

  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const absPath = path.join(this.root, key);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, data);
  }

  async publicUrl(key: string): Promise<string> {
    return `/media/${key}`;
  }
}

@Injectable()
export class StorageService implements MediaStorage, OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private delegate!: MediaStorage;
  readonly backend: "local" | "s3";

  constructor() {
    this.backend =
      process.env.STORAGE_BACKEND === "s3" ? "s3" : ("local" as const);
  }

  async onModuleInit() {
    if (this.backend === "s3") {
      const { S3Client } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: process.env.S3_REGION_NAME || "auto",
        endpoint: process.env.S3_ENDPOINT_URL,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        },
      });
      const bucket = process.env.S3_BUCKET_NAME ?? "";
      if (!bucket) throw new Error("S3_BUCKET_NAME required when STORAGE_BACKEND=s3");

      this.delegate = {
        backend: "s3",
        put: async (key, data, contentType) => {
          const { PutObjectCommand } = await import("@aws-sdk/client-s3");
          await client.send(
            new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }),
          );
        },
        publicUrl: async (key) => {
          // Public CDN domain when configured; presigned GET otherwise.
          const customDomain = process.env.S3_CUSTOM_DOMAIN;
          if (customDomain) return `${customDomain.replace(/\/+$/, "")}/${key}`;
          const { GetObjectCommand } = await import("@aws-sdk/client-s3");
          const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
          return getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 7 * 24 * 3600 },
          );
        },
      };
      this.logger.log("Using S3-compatible storage backend");
    } else {
      const root = process.env.MEDIA_ROOT ?? "./media-uploads";
      this.delegate = new LocalMediaStorage(root);
      this.logger.log(`Using local storage backend at ${root}`);
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    return this.delegate.put(key, data, contentType);
  }

  async publicUrl(key: string): Promise<string> {
    return this.delegate.publicUrl(key);
  }
}
