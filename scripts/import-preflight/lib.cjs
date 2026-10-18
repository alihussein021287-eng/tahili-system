// Read-only spreadsheet readers and normalizers for the future Excel import preflight (Mission 08.8).
// Detects the REAL file format from content, not the extension: OOXML (.xlsx = ZIP), SpreadsheetML 2003 XML (what the Tahili
// export writes as ".xls"), or an HTML table. Legacy binary BIFF (.xls, OLE2) is detected but NOT parsed (convert to .xlsx).
const fs = require("node:fs");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

class DataFileError extends Error { constructor(code, message) { super(message); this.code = code; } }
const DEFAULT_LIMITS = { maxZipEntries: 300, maxInflatedBytes: 40 * 1024 * 1024, maxEntryBytes: 30 * 1024 * 1024, maxRatio: 250 };
const UNSAFE_ENTRY = /(vbaProject\.bin|\.bin$|macrosheets\/|xl\/externalLinks\/|xl\/embeddings\/|xl\/activeX\/|xl\/ctrlProps\/|\.dll$|\.exe$)/i;

function detectFormat(buf) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return "OOXML_ZIP";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "BIFF_OLE2";
  const head = buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.includes("urn:schemas-microsoft-com:office:spreadsheet") || (head.startsWith("<?xml") && head.includes("<workbook"))) return "SPREADSHEETML_2003";
  if (head.includes("<table") || head.startsWith("<html") || head.includes("<!doctype html")) return "HTML_TABLE";
  return "UNKNOWN";
}

function readZip(buf, limits = DEFAULT_LIMITS) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new DataFileError("NOT_ZIP", "not a ZIP archive");
  const count = buf.readUInt16LE(i + 10);
  if (count > limits.maxZipEntries) throw new DataFileError("TOO_MANY_ENTRIES", "archive has too many parts");
  let p = buf.readUInt32LE(i + 16);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new DataFileError("CORRUPT_ZIP", "corrupt ZIP directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20), rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (UNSAFE_ENTRY.test(name)) throw new DataFileError("UNSAFE_CONTENT", "macros, external links or embedded objects are not allowed");
    if (/(^|\/)\.\.(\/|$)|^\//.test(name)) throw new DataFileError("UNSAFE_PATH", "unsafe archive path");
    if (rawSize > limits.maxEntryBytes || (compSize > 0 && rawSize / compSize > limits.maxRatio && rawSize > 1_000_000)) throw new DataFileError("ZIP_BOMB", "archive part expands too much");
    total += rawSize;
    if (total > limits.maxInflatedBytes) throw new DataFileError("TOO_LARGE_UNCOMPRESSED", "archive expands beyond the allowed size");
    if (localOff + 30 > buf.length) throw new DataFileError("CORRUPT_ZIP", "corrupt ZIP entry");
    const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(start, start + compSize);
    let data;
    try { data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: limits.maxEntryBytes }) : null; } catch { throw new DataFileError("CORRUPT_ZIP", "cannot decompress archive part"); }
    if (data === null) throw new DataFileError("UNSUPPORTED_COMPRESSION", "unsupported compression method");
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xml = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, parseAttributeValue: false, trimValues: false,
  isArray: (name) => ["Worksheet", "Row", "Cell", "sheet", "row", "c", "si", "r", "Relationship"].includes(name),
});
function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new DataFileError("UNSAFE_XML", "DOCTYPE/ENTITY declarations are not allowed");
  return xml.parse(text);
}
const txt = (node) => {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(txt).join("");
  if (typeof node === "object") return txt(node["#text"] ?? node.t ?? node.Data ?? "") + (node.r ? txt(node.r) : "");
  return String(node);
};
function colIndex(ref) { let n = 0; for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

function readOoxml(buf) {
  const zip = readZip(buf);
  const get = (name) => { const f = zip.get(name); if (!f) throw new Error(`missing ${name}`); return parseXml(f.toString("utf8")); };
  const wb = get("xl/workbook.xml").workbook;
  const rels = Object.fromEntries((get("xl/_rels/workbook.xml.rels").Relationships.Relationship ?? []).map((r) => [r["@_Id"], r["@_Target"]]));
  const shared = zip.has("xl/sharedStrings.xml") ? (get("xl/sharedStrings.xml").sst.si ?? []).map((si) => txt(si.t ?? si.r ?? si)) : [];
  const sheets = [];
  for (const s of wb.sheets.sheet ?? []) {
    const target = rels[s["@_r:id"]];
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const ws = get(path).worksheet;
    const rows = [];
    const formulas = [];
    for (const r of ws.sheetData?.row ?? []) {
      const cells = [];
      for (const c of r.c ?? []) {
        const idx = c["@_r"] ? colIndex(c["@_r"]) : cells.length;
        let v = "";
        if (c.f !== undefined) formulas.push([Number(r["@_r"] ?? rows.length + 1) - 1, idx]);
        if (c["@_t"] === "s") v = shared[Number(c.v)] ?? "";
        else if (c["@_t"] === "inlineStr") v = txt(c.is);
        else v = c.v == null ? "" : String(c.v);
        cells[idx] = v;
      }
      rows[Number(r["@_r"] ?? rows.length + 1) - 1] = Array.from(cells, (x) => x ?? "");
    }
    sheets.push({ name: s["@_name"], rows: Array.from(rows, (r) => r ?? []), formulaCells: formulas });
  }
  return sheets;
}

function readSpreadsheetMl(buf) {
  const doc = parseXml(buf.toString("utf8").replace(/^﻿/, ""));
  const wb = doc.Workbook;
  return (wb.Worksheet ?? []).map((ws) => {
    const rows = [];
    for (const r of ws.Table?.Row ?? []) {
      const cells = [];
      let col = 0;
      for (const c of r.Cell ?? []) {
        if (c["@_ss:Index"]) col = Number(c["@_ss:Index"]) - 1;
        cells[col++] = txt(c.Data);
      }
      rows.push(Array.from(cells, (x) => x ?? ""));
    }
    return { name: ws["@_ss:Name"] ?? "Sheet", rows };
  });
}

function readHtmlTable(buf) {
  const html = buf.toString("utf8").replace(/^﻿/, "");
  const decode = (s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decode(c[1])));
  return [{ name: "Sheet1", rows }];
}

function readWorkbook(file) {
  const buf = fs.readFileSync(file);
  const format = detectFormat(buf);
  let sheets;
  if (format === "OOXML_ZIP") sheets = readOoxml(buf);
  else if (format === "SPREADSHEETML_2003") sheets = readSpreadsheetMl(buf);
  else if (format === "HTML_TABLE") sheets = readHtmlTable(buf);
  else return { file, format, sha256: sha256(buf), bytes: buf.length, sheets: [], unreadable: format === "BIFF_OLE2" ? "legacy binary .xls: re-save as .xlsx" : "unknown content" };
  return { file, format, sha256: sha256(buf), bytes: buf.length, sheets };
}

// ---------- normalizers (matching only; original values are what gets imported) ----------
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩", FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function latinDigits(s) { return String(s ?? "").replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d)); }
function normName(s) {
  return latinDigits(s).normalize("NFKC").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
}
function cleanName(s) { return String(s ?? "").replace(/\s+/g, " ").trim(); }
function normPhone(s) {
  let d = latinDigits(s).replace(/[^0-9]/g, "");
  if (!d) return { value: null, valid: true, empty: true };
  if (d.startsWith("00964")) d = "0" + d.slice(5); else if (d.startsWith("964")) d = "0" + d.slice(3);
  if (d.length === 10 && d.startsWith("7")) d = "0" + d;
  return { value: d, valid: /^07[0-9]{9}$/.test(d), empty: false };
}
function normYear(s) {
  const t = latinDigits(s).trim();
  if (!t) return { value: null, valid: true, empty: true };
  let y = null;
  if (/^[0-9]{4}$/.test(t)) y = Number(t);
  else if (/^[0-9]{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2}/.test(t)) y = Number(t.slice(0, 4));
  else if (/^[0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{4}$/.test(t)) y = Number(t.slice(-4));
  else if (/^[0-9]{5}(\.[0-9]+)?$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000); y = d.getUTCFullYear(); } // Excel serial
  if (y == null) return { value: null, valid: false, empty: false };
  return { value: y, valid: y >= 1900 && y <= new Date().getFullYear(), empty: false };
}


// ---------- Data Management Center additions: buffer reading with limits, CSV, writers, cell sanitizing ----------
function parseCsv(buf) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { throw new DataFileError("BAD_ENCODING", "CSV must be UTF-8"); }
  text = text.replace(/^﻿/, "");
  if (text.includes("\u0000")) throw new DataFileError("BINARY_CONTENT", "binary content in CSV");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const delim = first.includes("\t") ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
  const rows = [];
  let row = [], cur = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; }
    else cur += ch;
  }
  if (quoted) throw new DataFileError("BAD_CSV", "unterminated quoted field");
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return [{ name: "CSV", rows, formulaCells: [] }];
}

/** Reads a spreadsheet from memory. Never executes formulas; formula cells are reported in sheet.formulaCells. */
function readWorkbookBuffer(buf, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const format = opts.csv ? "CSV" : detectFormat(buf);
  let sheets;
  if (format === "CSV") sheets = parseCsv(buf);
  else if (format === "OOXML_ZIP") sheets = readOoxmlLimited(buf, limits);
  else if (format === "SPREADSHEETML_2003") sheets = readSpreadsheetMl(buf);
  else if (format === "HTML_TABLE") sheets = readHtmlTable(buf);
  else if (format === "BIFF_OLE2") throw new DataFileError("LEGACY_BINARY_XLS", "legacy binary .xls is not supported: save as .xlsx or .csv");
  else throw new DataFileError("UNSUPPORTED_FORMAT", "unsupported or unrecognized file content");
  return { format, sha256: sha256(buf), bytes: buf.length, sheets };
}
function readOoxmlLimited(buf, limits) {
  const prev = readZip;
  // readOoxml calls readZip(buf) with default limits; re-run the guard with the caller's limits first (throws on unsafe content)
  prev(buf, limits);
  return readOoxml(buf);
}

function sanitizeCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function writeCsv(rows) {
  const q = (v) => { const s = String(sanitizeCell(v)); return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return Buffer.from("﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n", "utf8");
}

function crc32(buf) { let crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { crc ^= buf[n]; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
function zipStore(entries, opts = {}) {
  const local = [], central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"), nm = Buffer.from(name), crc = crc32(raw);
    const data = opts.deflate ? zlib.deflateRawSync(raw) : raw, method = opts.deflate ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    local.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm); offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22), n = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const xesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i) => { let n = i + 1, s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
/** Writes an XLSX with RTL sheets; every string is an inline string (never a formula) and risky leading characters are neutralized. */
// Optional per-sheet validations: { sqref, kind: "list"|"whole"|"decimal", list: "'Sheet'!$A$2:$A$9", min, max, strict }. Reading ignores them.
function dataValidations(v) {
  if (!v || !v.length) return "";
  const items = v.map((d) => {
    const err = d.strict === false ? "warning" : "stop";
    const head = `<dataValidation type="${d.kind}" errorStyle="${err}" allowBlank="1" showErrorMessage="1" sqref="${xesc(d.sqref)}"${d.kind === "list" ? "" : ` operator="between"`}>`;
    return head + (d.kind === "list" ? `<formula1>${xesc(d.list)}</formula1>` : `<formula1>${Number(d.min)}</formula1><formula2>${Number(d.max)}</formula2>`) + "</dataValidation>";
  });
  return `<dataValidations count="${items.length}">${items.join("")}</dataValidations>`;
}
function writeXlsx(sheets) {
  const entries = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(String(s.name).slice(0, 31).replace(/[\\/?*\[\]:]/g, " "))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  };
  sheets.forEach((s, i) => {
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const c = sanitizeCell(v), ref = colName(ci) + (ri + 1);
      if (c === "") return "";
      return typeof c === "number" && Number.isFinite(c) ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(c)}</t></is></c>`;
    }).join("")}</row>`).join("");
    entries[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><cols>${(s.widths || []).map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData>${dataValidations(s.validations)}</worksheet>`;
  });
  return zipStore(entries);
}

module.exports = { detectFormat, readWorkbook, readWorkbookBuffer, parseCsv, writeXlsx, writeCsv, zipStore, sanitizeCell, DataFileError, DEFAULT_LIMITS, sha256, normName, cleanName, normPhone, normYear, latinDigits };
