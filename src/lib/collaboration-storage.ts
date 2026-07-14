import { Client } from "minio";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";

const BUCKET = process.env.COLLABORATION_MINIO_BUCKET || "tahili-collaboration";
const LOCAL_DIR = path.join(process.env.UPLOAD_DIR || "uploads", "collaboration");

let minioClient: Client | null | undefined;

function getMinioClient() {
  if (minioClient !== undefined) return minioClient;
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) {
    minioClient = null;
    return null;
  }
  minioClient = new Client({
    endPoint: endpoint,
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey,
    secretKey,
  });
  return minioClient;
}

async function ensureBucket(client: Client) {
  const exists = await client.bucketExists(BUCKET).catch(() => false);
  if (!exists) await client.makeBucket(BUCKET, process.env.MINIO_REGION || "us-east-1");
}

function objectKey(storageKey: string) {
  const safe = storageKey.replace(/[^a-zA-Z0-9/_\-.]/g, "");
  if (!safe || safe.includes("..") || safe.startsWith("/") || safe !== storageKey) throw new Error("مفتاح التخزين غير صالح");
  return safe;
}

export async function putCollaborationObject(storageKey: string, buffer: Buffer, meta: { mimeType: string; originalName: string }) {
  const key = objectKey(storageKey);
  const client = getMinioClient();
  if (client) {
    await ensureBucket(client);
    await client.putObject(BUCKET, key, buffer, buffer.length, {
      "Content-Type": meta.mimeType,
      "X-Amz-Meta-Original-Name": encodeURIComponent(meta.originalName),
    });
    return;
  }
  if (!existsSync(LOCAL_DIR)) await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, key.replace(/\//g, "__")), buffer);
}

export async function getCollaborationObject(storageKey: string): Promise<Buffer | null> {
  const key = objectKey(storageKey);
  const client = getMinioClient();
  if (client) {
    try {
      await ensureBucket(client);
      const stream = await client.getObject(BUCKET, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as Readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  const full = path.join(LOCAL_DIR, key.replace(/\//g, "__"));
  if (!existsSync(full)) return null;
  return readFile(full);
}

export function collaborationStorageKey(publicId: string, version: number, extension: string) {
  const ext = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${publicId}/v${version}.${ext}`;
}
