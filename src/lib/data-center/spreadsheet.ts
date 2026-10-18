import path from "node:path";

// Reuses the preflight tooling's reader/writer (scripts/import-preflight/lib.cjs, shipped in the image next to node_modules) instead of
// duplicating a second parser. Loaded at runtime from the working directory so the bundler does not inline it.
export type Sheet = { name: string; rows: string[][]; formulaCells?: [number, number][] };
export type Workbook = { format: string; sha256: string; bytes: number; sheets: Sheet[] };
type Lib = {
  readWorkbookBuffer(buf: Buffer, opts?: { csv?: boolean }): Workbook;
  writeXlsx(sheets: { name: string; rows: (string | number | null)[][]; widths?: number[] }[]): Buffer;
  writeCsv(rows: (string | number | null)[][]): Buffer;
  sanitizeCell(v: unknown): string | number;
  sha256(buf: Buffer): string;
  DataFileError: new (code: string, message: string) => Error & { code: string };
  normName(s: unknown): string;
  cleanName(s: unknown): string;
  normPhone(s: unknown): { value: string | null; valid: boolean; empty: boolean };
  normYear(s: unknown): { value: number | null; valid: boolean; empty: boolean };
  latinDigits(s: unknown): string;
};

let cached: Lib | null = null;
export function sheetLib(): Lib {
  if (!cached) {
    // eval keeps the bundler from rewriting the runtime require (webpack would otherwise resolve or stub it)
    // eslint-disable-next-line no-eval
    const nodeRequire = eval("require") as NodeRequire;
    cached = nodeRequire(path.join(process.cwd(), "scripts", "import-preflight", "lib.cjs")) as Lib;
  }
  return cached;
}

export const FILE_LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 5000, maxColumns: 40, maxCellChars: 500 } as const;

export class UploadRejected extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const MESSAGES: Record<string, string> = {
  UNSUPPORTED_FORMAT: "نوع الملف غير مدعوم أو محتواه لا يطابق امتداده (المسموح: XLSX أو CSV بترميز UTF-8)",
  LEGACY_BINARY_XLS: "صيغة XLS الثنائية القديمة غير مدعومة؛ احفظ الملف بصيغة XLSX أو CSV",
  UNSAFE_CONTENT: "الملف يحتوي ماكرو أو روابط خارجية أو كائنات مضمّنة وهذا غير مسموح",
  UNSAFE_XML: "الملف يحتوي تعريفات XML غير مسموحة",
  ZIP_BOMB: "الملف مضغوط بصورة مفرطة ويُرفض حمايةً للنظام",
  TOO_LARGE_UNCOMPRESSED: "الملف يتضخم عند فكّه فوق الحد المسموح",
  TOO_MANY_ENTRIES: "الملف يحتوي أجزاء أكثر من المسموح",
  CORRUPT_ZIP: "الملف تالف أو غير مكتمل",
  BAD_ENCODING: "ملف CSV يجب أن يكون بترميز UTF-8",
  BAD_CSV: "ملف CSV غير صالح",
  BINARY_CONTENT: "الملف يحتوي بيانات ثنائية",
};

/** Content-based, bounded parse. Throws UploadRejected with an Arabic, actionable message. */
export function parseUpload(buf: Buffer, fileName: string): Workbook {
  if (buf.length === 0) throw new UploadRejected("EMPTY", "الملف فارغ");
  if (buf.length > FILE_LIMITS.maxBytes) throw new UploadRejected("TOO_LARGE", `حجم الملف يتجاوز ${FILE_LIMITS.maxBytes / 1024 / 1024} ميغابايت`);
  const lib = sheetLib();
  const isCsvName = /\.(csv|txt)$/i.test(fileName);
  try {
    // A ".csv" name is only honored when the bytes are NOT a zip/OLE container; everything else is decided by content.
    const head = buf.subarray(0, 8);
    const looksBinary = (head[0] === 0x50 && head[1] === 0x4b) || (head[0] === 0xd0 && head[1] === 0xcf);
    const wb = lib.readWorkbookBuffer(buf, { csv: isCsvName && !looksBinary });
    if (!isCsvName && wb.format === "CSV") throw new UploadRejected("UNSUPPORTED_FORMAT", MESSAGES.UNSUPPORTED_FORMAT);
    const rows = wb.sheets.reduce((n, s) => n + s.rows.length, 0);
    if (rows > FILE_LIMITS.maxRows + 20) throw new UploadRejected("TOO_MANY_ROWS", `عدد الصفوف يتجاوز الحد المسموح (${FILE_LIMITS.maxRows})`);
    for (const s of wb.sheets) for (const r of s.rows) if (r.length > FILE_LIMITS.maxColumns + 5) throw new UploadRejected("TOO_MANY_COLUMNS", "عدد الأعمدة يتجاوز الحد المسموح");
    return wb;
  } catch (e) {
    if (e instanceof UploadRejected) throw e;
    const code = (e as { code?: string }).code ?? "UNSUPPORTED_FORMAT";
    throw new UploadRejected(code, MESSAGES[code] ?? MESSAGES.UNSUPPORTED_FORMAT);
  }
}
