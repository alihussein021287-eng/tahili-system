import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

// يحفظ ملف مرفوع ويرجّع المفتاح (key) لاستخدامه في الرابط
export async function saveFile(file: File): Promise<{ key: string; name: string }> {
  if (!existsSync(UPLOAD_DIR)) await mkdir(UPLOAD_DIR, { recursive: true });
  const originalName = path.basename(file.name || "file");
  const ext = path.extname(originalName).slice(0, 16) || "";
  const key = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, key), buf);
  return { key, name: originalName };
}

export async function readStoredFile(key: string): Promise<Buffer | null> {
  const safe = path.basename(key); // منع اختراق المسار
  if (!safe || safe !== key || safe.includes("..")) return null;
  const full = path.join(UPLOAD_DIR, safe);
  if (!existsSync(full)) return null;
  return readFile(full);
}
