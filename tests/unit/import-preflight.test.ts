// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// Synthetic data only: no real patient or staff records are used by automated tests.
const require_ = createRequire(import.meta.url);
const { run } = require_("../../scripts/import-preflight/preflight.cjs");
const { readWorkbook, normPhone, normYear } = require_("../../scripts/import-preflight/lib.cjs");

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sheetXml = (name: string, rows: string[][]) => `<Worksheet ss:Name="${name}"><Table>${rows.map((r) => `<Row>${r.map((c) => `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet>`;
const workbookXml = (sheets: string[]) => `﻿<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.join("")}</Workbook>`;

function crc32(buf: Buffer) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function zip(entries: Record<string, string>) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text, "utf8"), nm = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    local.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm); offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
function xlsx(sheetName: string, rows: string[][]) {
  const cell = (v: string, c: number, r: number) => `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i + 1)).join("")}</row>`).join("")}</sheetData></worksheet>`,
  });
}

const PHEAD = ["رقم الملف", "الاسم", "الجنس", "التولد", "الهاتف", "المحافظة", "نوع الإصابة", "الحالة"];
const patients = [
  ["1", "علي حسن محمد كاظم", "ذكر", "1985", "07701234567", "بغداد", "بتر", "نشط"],            // ready
  ["2", "زينب أحمد علي حسين", "أنثى", "1990", "07701234568", "بغداد", "", "نشط"],             // ready (shares phone below)
  ["3", "حيدر كريم جاسم عباس", "ذكر", "1990", "07701234568", "بغداد", "", "نشط"],             // shared phone, different person -> both ready w/ warning
  ["4", "علي حسن محمد كاظم", "ذكر", "1985", "07701234567", "بغداد", "بتر", "نشط"],            // exact duplicate in source
  ["5", "سجاد فاضل نعمة ياسر", "ذكر", "", "07709999999", "", "", "نشط"],                      // missing year -> ready with warning
  ["6", "سجاد فاضل نعمة ياسر", "ذكر", "1979", "07709999999", "", "", "نشط"],                  // same name+phone, other has year -> ambiguous both
  ["7", "م", "ذكر", "1980", "07701111111", "", "", "نشط"],                                    // invalid name
  ["8", "كرار عبد الله هادي سعد", "ذكر", "1980", "123", "", "", "نشط"],                       // invalid phone
  ["9", "مرتضى جواد كاظم علوان", "ذكر", "3050", "07702222222", "", "", "نشط"],                // invalid year
  ["10", "", "", "", "", "", "", ""],                                                          // empty
  ["11", "نور الهدى سلمان رشيد عدي", "أنثى", "٢٠٠١", "٠٧٧٠٣٣٣٣٣٣٣", "", "", "نشط"],         // arabic digits ready
  ["3", "رياض ثامر ناجي فرحان", "ذكر", "1975", "07704444444", "", "", "نشط"],                 // same source file number as row 3 -> conflict
];
let dir: string, out: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "m088-in-")); out = mkdtempSync(join(tmpdir(), "m088-out-"));
  const main = workbookXml([
    sheetXml("المراجعون", [PHEAD, ...patients]),
    sheetXml("المواعيد", [["المريض", "التاريخ"], ["x", "y"], ["x2", "y2"]]),
    sheetXml("المخزون", [["المادة", "الكمية"], ["دواء", "5"]]),
    sheetXml("المستخدمون", [["الاسم", "اسم المستخدم", "الدور", "فعّال"], ["طبيب تجريبي أول", "doc.one", "DOCTOR", "نعم"], ["مدير النظام تجريبي", "root1", "ADMIN", "نعم"], ["طبيب ثان تجريبي", "doc.one", "DOCTOR", "نعم"], ["بلا دور تجريبي", "norole", "FOO", "نعم"]]),
  ]);
  writeFileSync(join(dir, "tahili-export-2026-10-14.xls"), main);
  writeFileSync(join(dir, "tahili-export-2026-10-14(1).xls"), main); // byte-identical copy
  writeFileSync(join(dir, "موظفين المراكز.xlsx"), xlsx("Sheet1", [["الاسم", "الوظيفة", "المركز", "الهاتف"], ["ممرض تجريبي أول", "ممرض", "مركز النقاء", "07705550001"], ["ممرض تجريبي أول", "ممرض", "مركز النقاء", "07705550001"], ["فني تجريبي", "فني", "مركز غير معروف", ""], ["اسم متكرر تجريبي", "إداري", "", ""], ["اسم متكرر تجريبي", "محاسب", "", ""]]));
  writeFileSync(join(dir, "اطباء التدرج.xlsx"), xlsx("Sheet1", [["الاسم", "الاختصاص"], ["طبيب مقيم تجريبي", "باطنية"]]));
  writeFileSync(join(dir, "الاطباء الاختصاص.xlsx"), xlsx("Sheet1", [["الاسم", "الاختصاص"], ["طبيب اختصاص تجريبي", "عظام"]]));
  mkdirSync(out, { recursive: true });
});

describe("Excel import preflight (synthetic)", () => {
  it("detects the real format from content (SpreadsheetML named .xls, OOXML) and normalizes Arabic digits", () => {
    expect(readWorkbook(join(dir, "tahili-export-2026-10-14.xls")).format).toBe("SPREADSHEETML_2003");
    expect(readWorkbook(join(dir, "موظفين المراكز.xlsx")).format).toBe("OOXML_ZIP");
    expect(normPhone("٠٧٧٠٣٣٣٣٣٣٣").value).toBe("07703333333");
    expect(normYear("٢٠٠١").value).toBe(2001);
  });

  it("accounts for every source row and separates exact duplicate snapshots from distinct people", () => {
    const s = run_();
    expect(s.totals.accountingBalanced).toBe(true);
    expect(s.dispositions.EXACT_DUPLICATE_FILE).toBe(patients.length + 2 + 1 + 4); // every row of the byte-identical copy, all sheets
    const c = s.counts;
    expect(c.patientSourceRowsAllFiles).toBe(patients.length * 2);
    expect(c.patientRowsInCanonicalSnapshot).toBe(patients.length); // the copy adds no distinct patient
    expect(s.dispositions.DUPLICATE_IN_SOURCE).toBeGreaterThanOrEqual(1);
    expect(c.exactDuplicateSnapshotRows).toBe(0);
  });

  it("holds ambiguous, invalid and privileged rows; never fabricates a birth year; excludes operational sheets", () => {
    const s = run_();
    expect(s.dispositions.HELD_AMBIGUOUS_IDENTITY).toBeGreaterThanOrEqual(2);
    expect(s.dispositions.HELD_INVALID_NAME).toBeGreaterThanOrEqual(1);
    expect(s.dispositions.HELD_INVALID_PHONE).toBe(1);
    expect(s.dispositions.HELD_INVALID_YEAR).toBe(1);
    expect(s.dispositions.EXCLUDED_BY_POLICY).toBe(2 + 1); // appointments + stock rows (canonical file only)
    const plan = JSON.parse(readFileSync(join(out, "import-plan.json"), "utf8"));
    const noYear = plan.patients.filter((p: any) => p.birthYear == null);
    expect(noYear.length).toBe(0); // the only missing-year row is ambiguous with a row that has a year -> held, not imported
    expect(plan.patients.some((p: any) => p.birthYear === 2001)).toBe(true);
    expect(s.dispositions.HELD_PRIVILEGED_ROLE).toBe(1);
    expect(s.dispositions.HELD_UNRESOLVED_ROLE).toBe(1);
    expect(s.dispositions.HELD_DUPLICATE_USERNAME).toBe(1);
    expect(plan.accounts.map((a: any) => a.username)).toEqual(["doc.one"]);
  });

  it("shared phone numbers do not merge people; staff with the same name but different details are held, identical rows deduplicated", () => {
    run_();
    const ledger = readFileSync(join(out, "disposition-ledger.csv"), "utf8");
    expect(ledger).toContain("SHARED_PHONE_NOT_AN_IDENTITY_PROOF");
    const plan = JSON.parse(readFileSync(join(out, "import-plan.json"), "utf8"));
    expect(plan.employees.filter((e: any) => e.fullName.startsWith("ممرض")).length).toBe(1);
    expect(plan.employees.some((e: any) => e.fullName.startsWith("اسم متكرر"))).toBe(false);
    expect(ledger).toContain("SAME_NAME_DIFFERENT_DETAILS_NOT_PROVEN_SAME_PERSON");
    const summary = JSON.parse(readFileSync(join(out, "preflight-summary.json"), "utf8"));
    expect(summary.unresolved.centers.length).toBeGreaterThan(0);
    expect(summary.unresolved.roles.length).toBeGreaterThan(0);
  });

  it("holds rows that share a source file number; identical inputs give an identical plan hash", () => {
    const a = run_(); const b = run_();
    expect(a.dispositions.HELD_FILE_NUMBER_CONFLICT).toBe(2);
    expect(a.planSha256).toBe(b.planSha256);
    expect(a.analysis.patients.sourceFileNumbers.unique).toBeLessThan(a.analysis.patients.sourceFileNumbers.present);
    expect(a.analysis.accounts.proposed).toBe(1);
  });

  it("the sanitized outputs contain no personal data", () => {
    run_();
    for (const f of ["preflight-summary.json", "preflight-summary.md", "disposition-ledger.csv", "exceptions.csv"]) {
      const text = readFileSync(join(out, f), "utf8");
      expect(text).not.toMatch(/07[0-9]{9}/);
      expect(text).not.toContain("علي حسن");
      expect(text).not.toContain("زينب");
    }
  });
});

function run_() {
  return run(["--input-dir", dir, "--out-dir", out, "--branch-name", "فرع تجريبي"]);
}
