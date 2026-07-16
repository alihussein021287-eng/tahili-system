import "server-only";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAX_OFFICE_PREVIEW_BYTES,
  isOfficePreviewSupported,
  officePreviewType,
  type OfficePreviewType,
} from "@/lib/collaboration-preview";

const OFFICE_PREVIEW_TIMEOUT_MS = 30_000;
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

async function readCachedPreview(cachePath: string) {
  try {
    const stat = await fs.stat(cachePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    return await fs.readFile(cachePath);
  } catch {
    return null;
  }
}

function runLibreOffice(binary: string, inputPath: string, outDir: string, profileDir: string) {
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
    }, OFFICE_PREVIEW_TIMEOUT_MS);

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

export async function convertOfficeToPdfPreview(input: ConversionInput) {
  const binary = await detectLibreOfficeBinary();
  if (!binary) throw new OfficePreviewError("MISSING_CONVERTER", "المعاينة غير متاحة لأن LibreOffice غير متوفر في بيئة التطبيق.");

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

    const result = await runLibreOffice(binary, inputPath, outDir, profileDir);
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
  const type = officePreviewType({ mimeType: input.mimeType, name: input.originalName });
  if (!type || !isOfficePreviewSupported(input)) {
    throw new OfficePreviewError("UNSUPPORTED", "المعاينة غير متاحة لهذا النوع من الملفات.");
  }
  if (input.size > MAX_OFFICE_PREVIEW_BYTES || input.buffer.length > MAX_OFFICE_PREVIEW_BYTES) {
    throw new OfficePreviewError("TOO_LARGE", "حجم ملف Office يتجاوز حد المعاينة الداخلية 25MB.");
  }
  if (!hasOfficeZipContent(input.buffer, type)) {
    throw new OfficePreviewError("INVALID_CONTENT", "المعاينة غير متاحة لأن محتوى ملف Office غير متطابق.");
  }

  await fs.mkdir(OFFICE_PREVIEW_CACHE_DIR, { recursive: true });
  const cachePath = cachePathFor(input, type);
  const cached = await readCachedPreview(cachePath);
  if (cached) return { buffer: cached, cached: true };

  const pdf = await convertOfficeToPdfPreview({ type, buffer: input.buffer });
  const tempCachePath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempCachePath, pdf);
  await fs.rename(tempCachePath, cachePath).catch(async () => {
    await fs.rm(tempCachePath, { force: true }).catch(() => {});
  });
  return { buffer: pdf, cached: false };
}
