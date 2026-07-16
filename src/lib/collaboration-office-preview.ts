import "server-only";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isOfficePreviewSupported,
  officePreviewLimitBytes,
  officePreviewType,
  type OfficePreviewType,
} from "@/lib/collaboration-preview";

const OFFICE_PREVIEW_CACHE_DIR = path.join(os.tmpdir(), "tahili-office-preview-cache");
const MAX_PROCESS_OUTPUT_BYTES = 8_000;

const OFFICE_MARKERS: Record<OfficePreviewType, string> = {
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml",
  pptx: "ppt/presentation.xml",
};

type OfficePreviewInput = {
  fileId: string;
  version: number;
  originalName: string;
  mimeType: string;
  scanStatus: string;
  size: number;
  sha256: string;
  buffer: Buffer;
};

type ConversionInput = {
  type: OfficePreviewType;
  buffer: Buffer;
};

export type OfficePreviewRuntimeConfig = {
  officePreviewEnabled?: boolean;
  officePreviewMaxMb?: number;
  officePreviewTimeoutSeconds?: number;
  officePreviewCacheRetentionHours?: number;
};

export class OfficePreviewError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OfficePreviewError";
    this.code = code;
  }
}

function appendCapped(current: string, chunk: Buffer) {
  const next = current + chunk.toString("utf8");
  return next.length > MAX_PROCESS_OUTPUT_BYTES ? next.slice(-MAX_PROCESS_OUTPUT_BYTES) : next;
}

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function officePreviewTimeoutMs(config?: OfficePreviewRuntimeConfig | null) {
  return intInRange(config?.officePreviewTimeoutSeconds, 30, 5, 120) * 1000;
}

function officePreviewCacheRetentionMs(config?: OfficePreviewRuntimeConfig | null) {
  return intInRange(config?.officePreviewCacheRetentionHours, 48, 1, 24 * 30) * 3600_000;
}

async function executableExists(candidate: string) {
  try {
    await fs.access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve(false);
    }, 2_000);
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(false);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

export async function detectLibreOfficeBinary() {
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  const absoluteCandidates = [
    configured && path.isAbsolute(configured) ? configured : null,
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/usr/local/bin/soffice",
  ].filter(Boolean) as string[];

  for (const candidate of absoluteCandidates) {
    if (await executableExists(candidate)) return candidate;
  }

  const pathCandidates = [
    configured && !path.isAbsolute(configured) ? configured : null,
    "libreoffice",
    "soffice",
  ].filter(Boolean) as string[];

  for (const candidate of pathCandidates) {
    if (await commandExists(candidate)) return candidate;
  }

  return null;
}

function commandOutput(command: string, args: string[], timeoutMs = 2_000) {
  return new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ ok: false, output });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      output = appendCapped(output, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output = appendCapped(output, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, output: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: code === 0, output });
    });
  });
}

export async function getLibreOfficeStatus() {
  const binary = await detectLibreOfficeBinary();
  if (!binary) return { available: false, version: null as string | null };
  const result = await commandOutput(binary, ["--version"]);
  return {
    available: true,
    version: result.output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 120) || "موجود",
  };
}

function hasOfficeZipContent(buffer: Buffer, type: OfficePreviewType) {
  const hasZipHeader = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!hasZipHeader) return false;
  const sample = buffer.toString("latin1");
  return sample.includes("[Content_Types].xml") && sample.includes(OFFICE_MARKERS[type]);
}

function cachePathFor(input: OfficePreviewInput, type: OfficePreviewType) {
  const key = createHash("sha256")
    .update(`${input.fileId}:${input.version}:${input.sha256}:${input.size}:${type}`)
    .digest("hex");
  return path.join(OFFICE_PREVIEW_CACHE_DIR, `${key}.pdf`);
}

async function readCachedPreview(cachePath: string, retentionMs: number) {
  try {
    const stat = await fs.stat(cachePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    if (Date.now() - stat.mtime.getTime() > retentionMs) {
      await fs.rm(cachePath, { force: true }).catch(() => {});
      return null;
    }
    return await fs.readFile(cachePath);
  } catch {
    return null;
  }
}

async function cleanupPreviewCache(retentionMs: number) {
  try {
    const entries = await fs.readdir(OFFICE_PREVIEW_CACHE_DIR, { withFileTypes: true });
    const cutoff = Date.now() - retentionMs;
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".pdf")) return;
      const filePath = path.join(OFFICE_PREVIEW_CACHE_DIR, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.mtime.getTime() < cutoff) await fs.rm(filePath, { force: true }).catch(() => {});
    }));
  } catch {}
}

function runLibreOffice(binary: string, inputPath: string, outDir: string, profileDir: string, timeoutMs: number) {
  return new Promise<{ exitCode: number | null; timedOut: boolean; stdout: string; stderr: string }>((resolve, reject) => {
    const args = [
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      "--nolockcheck",
      "--nodefault",
      "--norestore",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      inputPath,
    ];
    const child = spawn(binary, args, {
      cwd: outDir,
      env: {
        ...process.env,
        HOME: profileDir,
        XDG_CACHE_HOME: path.join(profileDir, "cache"),
        XDG_CONFIG_HOME: path.join(profileDir, "config"),
        XDG_RUNTIME_DIR: path.join(profileDir, "runtime"),
        SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN || "svp",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new OfficePreviewError("CONVERSION_FAILED", error.message ? "تعذر تشغيل محول Office المحلي." : "تعذر تجهيز معاينة PDF لهذا الملف."));
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, timedOut, stdout, stderr });
    });
  });
}

export async function convertOfficeToPdfPreview(input: ConversionInput, config?: OfficePreviewRuntimeConfig | null) {
  const binary = await detectLibreOfficeBinary();
  if (!binary) throw new OfficePreviewError("MISSING_CONVERTER", "المعاينة غير متاحة لأن LibreOffice غير متوفر في بيئة التطبيق.");
  const timeoutMs = officePreviewTimeoutMs(config);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tahili-office-preview-"));
  try {
    const outDir = path.join(tempRoot, "out");
    const profileDir = path.join(tempRoot, "profile");
    const cacheDir = path.join(profileDir, "cache");
    const configDir = path.join(profileDir, "config");
    const runtimeDir = path.join(profileDir, "runtime");
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });

    const inputPath = path.join(tempRoot, `input.${input.type}`);
    const pdfPath = path.join(outDir, "input.pdf");
    await fs.writeFile(inputPath, input.buffer);

    const result = await runLibreOffice(binary, inputPath, outDir, profileDir, timeoutMs);
    let pdf: Buffer | null = null;
    try {
      pdf = await fs.readFile(pdfPath);
    } catch {
      pdf = null;
    }

    if (result.timedOut) {
      throw new OfficePreviewError("TIMEOUT", "انتهت مهلة تحويل معاينة Office.");
    }
    if (!pdf || pdf.length === 0 || !pdf.subarray(0, 4).equals(Buffer.from("%PDF"))) {
      throw new OfficePreviewError("CONVERSION_FAILED", "تعذر تجهيز معاينة PDF لهذا الملف.");
    }

    return pdf;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function getOrCreatePreviewPdf(input: OfficePreviewInput) {
  return getOrCreatePreviewPdfWithConfig(input);
}

export async function getOrCreatePreviewPdfWithConfig(input: OfficePreviewInput, config?: OfficePreviewRuntimeConfig | null) {
  const type = officePreviewType({ mimeType: input.mimeType, name: input.originalName });
  if (!type || !isOfficePreviewSupported({
    mimeType: input.mimeType,
    name: input.originalName,
    scanStatus: input.scanStatus,
    size: input.size,
  }, config)) {
    throw new OfficePreviewError("UNSUPPORTED", "المعاينة غير متاحة لهذا النوع من الملفات.");
  }
  const maxBytes = officePreviewLimitBytes(config);
  const maxMb = Math.round(maxBytes / 1024 / 1024);
  if (input.size > maxBytes || input.buffer.length > maxBytes) {
    throw new OfficePreviewError("TOO_LARGE", `حجم ملف Office يتجاوز حد المعاينة الداخلية ${maxMb}MB.`);
  }
  if (!hasOfficeZipContent(input.buffer, type)) {
    throw new OfficePreviewError("INVALID_CONTENT", "المعاينة غير متاحة لأن محتوى ملف Office غير متطابق.");
  }

  await fs.mkdir(OFFICE_PREVIEW_CACHE_DIR, { recursive: true });
  const retentionMs = officePreviewCacheRetentionMs(config);
  await cleanupPreviewCache(retentionMs);
  const cachePath = cachePathFor(input, type);
  const cached = await readCachedPreview(cachePath, retentionMs);
  if (cached) return { buffer: cached, cached: true };

  const pdf = await convertOfficeToPdfPreview({ type, buffer: input.buffer }, config);
  const tempCachePath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempCachePath, pdf);
  await fs.rename(tempCachePath, cachePath).catch(async () => {
    await fs.rm(tempCachePath, { force: true }).catch(() => {});
  });
  return { buffer: pdf, cached: false };
}
