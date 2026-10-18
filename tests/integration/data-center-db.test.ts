// @vitest-environment node
// Data Management Center — synthetic-only tests on a DISPOSABLE database (created here; never QA, never tahili_preview).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/collaboration-scan", () => ({ scanBufferWithClamAv: async () => ({ status: "SAFE", engine: "test", detail: "stream: OK" }) }));

import { previewImport, confirmImport, errorReportRows, applyLockReason, DataCenterDenied, type Actor } from "@/lib/data-center/operations";
import { runExport, exportAllowed } from "@/lib/data-center/export";
import { parseUpload } from "@/lib/data-center/spreadsheet";
import { buildTemplate } from "@/lib/data-center/templates";
import { loadReferences } from "@/lib/data-center/reference";
import { IMPORT_DOMAINS, IMPORT_DOMAIN_BY_ID, DISABLED_EXPORTS } from "@/lib/data-center/registry";
import { CASE_TYPE, GENDER } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/permissions";
import { ROLES } from "@/lib/validate";

const lib = createRequire(import.meta.url)("../../scripts/import-preflight/lib.cjs");
const base = process.env.DATABASE_URL ?? "";
const stamp = randomUUID().slice(0, 8);
const dbName = `tahili_dc_${stamp}`;
let db: PrismaClient;
let A = 0, B = 0;
let admin: Actor, opA: Actor, opB: Actor, noPerm: Actor, finA: Actor;

const urlFor = (n: string) => base.replace(/\/[^/?]+(\?|$)/, `/${n}$1`);
const actor = (userId: string, role: string, branchId: number | null, perms: string[]): Actor => ({ userId, role, branchId, permissions: new Set(perms) });
const xlsx = (header: string[], rows: string[][], sheet = "البيانات") => lib.writeXlsx([{ name: sheet, rows: [header, ...rows] }]) as Buffer;
const csv = (header: string[], rows: string[][]) => lib.writeCsv([header, ...rows]) as Buffer;
const P_HEAD_ALL = ["legacyFileNumber", "fullName", "gender", "birthYear", "phone", "governorate", "injuryType", "caseType", "birthDate", "motherName", "maritalStatus", "childrenCount", "wivesCount", "kinshipDegree", "housing", "education", "inMobilization", "receivesSalary", "disabilityPct", "injuryCause", "injuryDate", "mobility", "status", "notes"];
const P_HEAD = P_HEAD_ALL;
const mkUserIn = async (username: string, role: string) => (await db.user.create({ data: { username, fullName: username, role: role as never, branchId: A, passwordHash: "!" } })).id;

beforeAll(async () => {
  expect(base).toMatch(/127\.0\.0\.1:55432/);
  const root = new PrismaClient();
  await root.$executeRawUnsafe(`CREATE DATABASE ${dbName}`);
  await root.$disconnect();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: urlFor(dbName) }, stdio: "pipe" });
  db = new PrismaClient({ datasources: { db: { url: urlFor(dbName) } } });
  A = (await db.branch.create({ data: { name: "فرع تجريبي أ" } })).id;
  B = (await db.branch.create({ data: { name: "فرع تجريبي ب" } })).id;
  await db.governorate.create({ data: { name: "بغداد" } });
  await db.injuryType.create({ data: { name: "كسر" } });
  await db.center.create({ data: { name: "مركز تجريبي" } });
  const mk = async (username: string, role: string, branchId: number | null) => (await db.user.create({ data: { username, fullName: username, role: role as never, branchId, passwordHash: "!" } })).id;
  const importPerms = ["datacenter.view", "datacenter.import.patients", "datacenter.import.personnel", "datacenter.import.accounts", "datacenter.import.memberships", "datacenter.import.apply"];
  admin = actor(await mk("dc-admin", "ADMIN", null), "ADMIN", null, [...importPerms, "datacenter.export.patients", "datacenter.export.users", "datacenter.export.personnel", "datacenter.export.pharmacy", "datacenter.export.finance", "patients.view", "users.view", "finance.report", "pharmacy.view"]);
  opA = actor(await mk("dc-op-a", "DATA_ENTRY", A), "DATA_ENTRY", A, [...importPerms, "datacenter.export.patients", "datacenter.export.users", "patients.view", "users.view"]);
  opB = actor(await mk("dc-op-b", "DATA_ENTRY", B), "DATA_ENTRY", B, [...importPerms, "datacenter.export.patients", "patients.view"]);
  noPerm = actor(await mk("dc-none", "DATA_ENTRY", A), "DATA_ENTRY", A, ["datacenter.view", "patients.view"]);
  finA = actor(await mk("dc-fin", "ACCOUNTANT", A), "ACCOUNTANT", A, ["datacenter.view", "datacenter.export.finance"]); // lacks finance.report
}, 180_000);
afterAll(async () => { process.env.DATA_CENTER_APPLY_ENABLED = ""; await db?.$disconnect(); });

describe("file validation (content based, bounded)", () => {
  it("rejects garbage, a renamed non-spreadsheet, legacy BIFF, macros, oversized and bad-encoding CSV", () => {
    expect(() => parseUpload(Buffer.from("not a spreadsheet at all"), "data.xlsx")).toThrow(/غير مدعوم/);
    expect(() => parseUpload(Buffer.from("MZ\u0090\u0000executable"), "data.xlsx")).toThrow();
    expect(() => parseUpload(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), "old.xls")).toThrow(/XLSX/);
    expect(() => parseUpload(Buffer.alloc(6 * 1024 * 1024, 65), "big.csv")).toThrow(/حجم الملف/);
    expect(() => parseUpload(Buffer.from([0xff, 0xfe, 0x41, 0x00]), "x.csv")).toThrow(/UTF-8/);
    const withMacro = lib.zipStore({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>", "xl/vbaProject.bin": "MACRO" }) as Buffer;
    expect(() => parseUpload(withMacro, "m.xlsx")).toThrow(/ماكرو/);
    const external = lib.zipStore({ "xl/workbook.xml": "<workbook/>", "xl/externalLinks/externalLink1.xml": "<x/>" }) as Buffer;
    expect(() => parseUpload(external, "e.xlsx")).toThrow(/ماكرو|روابط/);
    const bomb = lib.zipStore({ "xl/workbook.xml": Buffer.alloc(35 * 1024 * 1024, 0) }, { deflate: true }) as Buffer;
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    expect(() => parseUpload(bomb, "bomb.xlsx")).toThrow(/مضغوط|يتضخم/);
    const doctype = lib.zipStore({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": '<!DOCTYPE x [<!ENTITY a "b">]><workbook/>', "xl/_rels/workbook.xml.rels": "<Relationships/>" }) as Buffer;
    expect(() => parseUpload(doctype, "d.xlsx")).toThrow();
  });
  it("neutralizes formulas in templates/exports and flags formula cells on import", () => {
    const x = xlsx(["fullName"], [["=HYPERLINK(\"http://x\")"]]);
    const wb = parseUpload(x, "a.xlsx");
    expect(wb.sheets[0].rows[1][0]).toBe("'=HYPERLINK(\"http://x\")");
    const c = (lib.writeCsv([["a"], ["+SUM(1)"], ["@x"], ["-1+1"]]) as Buffer).toString("utf8");
    expect(c).toContain("'+SUM(1)"); expect(c).toContain("'@x"); expect(c).toContain("'-1+1");
  });
  it("official templates: ids, labels and instructions come from the shared contract; lists are generated from the live system", async () => {
    const refs = await loadReferences(db);
    for (const d of IMPORT_DOMAINS.filter((x) => !x.sheets)) { // single-sheet importers (the unified file has its own tests)
      const t = buildTemplate(d.id, "xlsx", refs)!;
      const wb = parseUpload(t.bytes, t.filename);
      const data = wb.sheets.find((s) => s.name === "البيانات")!;
      expect(data.rows[0]).toEqual(d.fields.map((f) => f.id));
      expect(data.rows[1]).toEqual(d.fields.map((f) => f.label));
      expect(data.rows.length).toBe(2); // no sample data mixed into import rows
      expect(wb.sheets.map((s) => s.name)).toContain("تعليمات");
      expect(buildTemplate(d.id, "csv", refs)!.bytes.toString("utf8").replace(/^﻿/, "").split(/\r?\n/)[0]).toBe(d.fields.map((f) => f.id).join(","));
      expect(d.fields.map((f) => f.id).length).toBe(new Set(d.fields.map((f) => f.id)).size); // no duplicate columns
    }
    const pat = buildTemplate("patients", "xlsx", refs)!;
    expect(pat.bytes.toString("latin1")).toContain("dataValidation");
    const lists = parseUpload(pat.bytes, "t.xlsx").sheets.find((s) => s.name === "القوائم")!;
    const flat = JSON.stringify(lists.rows);
    for (const v of [...Object.values(GENDER), ...Object.values(CASE_TYPE), ...refs.governorates, ...refs.injuryTypes]) expect(flat).toContain(v);
    expect(flat).not.toContain("ADMIN");
  });
  it("contract drift guard: patient required fields equal the application's own validation; account roles come from the application", () => {
    const patients = IMPORT_DOMAIN_BY_ID.patients;
    expect(patients.fields.filter((f) => f.required).map((f) => f.id).sort()).toEqual(["birthYear", "caseType", "fullName", "gender", "governorate", "injuryType", "phone"]);
    const accounts = IMPORT_DOMAIN_BY_ID.accounts.fields.find((f) => f.id === "role")!;
    const labels = Object.keys(accounts.enumMap!).filter((k) => /[\u0600-\u06FF]/.test(k));
    expect(labels.sort()).toEqual(ROLES.filter((r) => r !== "ADMIN" && r !== "MANAGER").map((r) => ROLE_LABELS[r]).sort());
    expect(IMPORT_DOMAINS.every((d) => d.notImported.length > 0)).toBe(true);
    expect(IMPORT_DOMAIN_BY_ID.accounts.fields.some((f) => /password|كلمة/i.test(f.id + f.label))).toBe(false);
  });
});

describe("patients: preview, duplicate protection, apply lock and synthetic apply", () => {
  const base1 = ["1001", "مراجع تجريبي أول ثاني ثالث", "ذكر", "1985", "07700000001", "بغداد", "كسر", "جريح"];
  const rows: string[][] = [
    [...base1, "1985-03-15", "اسم أم تجريبي", "متزوج", "2", "1", "نفسه", "ملك", "إعدادية", "نعم", "لا", "40", "سبب تجريبي", "2024-06-01", "حركة تجريبية", "نشط", "ملاحظة تجريبية"],
    ["1002", "مراجعة تجريبية رابع خامس سادس", "أنثى", "1990", "07700000002", "بغداد", "كسر", "مريض"],
    ["1003", "شخص آخر مختلف تماماً", "ذكر", "1990", "07700000002", "بغداد", "كسر", "جريح"],            // shared phone, different person -> warning only
    ["1004", ...base1.slice(1)],                                                                                    // exact duplicate in file
    ["1005", "مراجع بلا سنة تولد تجريبي", "ذكر", "", "07700000003", "بغداد", "كسر", "جريح"],         // required birth year missing -> invalid (never fabricated)
    ["1006", "مراجع هاتف خاطئ تجريبي", "ذكر", "1980", "123", "بغداد", "كسر", "جريح"],                // invalid phone
    ["1007", "م", "ذكر", "1980", "07700000004", "بغداد", "كسر", "جريح"],                              // invalid name
    ["", "", "", "", "", "", "", ""],                                                                  // blank
    ["1009", "مراجع محافظة خارج القائمة", "ذكر", "1975", "07700000005", "محافظة غير موجودة", "كسر", "جريح"],
    ["1010", "مراجع بلا نوع حالة تجريبي", "ذكر", "1975", "07700000006", "بغداد", "كسر", ""],           // required case type missing
    ["1011", "مراجع جنس غير صالح تجريبي", "غير ذلك", "1975", "07700000007", "بغداد", "كسر", "جريح"],
    ["1012", "مراجع تاريخ لا يطابق السنة", "ذكر", "1975", "07700000008", "بغداد", "كسر", "جريح", "1980-01-01"],
    ["1013", "مراجع نسبة عجز كبيرة", "ذكر", "1975", "07700000010", "بغداد", "كسر", "جريح", "", "", "", "", "", "", "", "", "", "", "150"],
    ["1014", "مراجع تاريخ إكسل تجريبي", "ذكر", "1975", "07700000012", "بغداد", "كسر", "جريح", "", "", "", "", "", "", "", "", "", "", "", "", "45000"], // Excel serial date
  ];
  let opId = "", planSha = "";

  it("previews with a documented disposition for every row and never fabricates a date", async () => {
    const file = xlsx(P_HEAD, rows);
    const { operationId, plan } = await previewImport(db, opA, { domain: "patients", branchId: A, fileName: "p.xlsx", bytes: file });
    opId = operationId; planSha = plan.planSha256;
    const c = plan.counts;
    expect(c.total).toBe(rows.length);
    expect(c.ready + c.matched + c.duplicate + c.held + c.invalid + c.excluded + c.updateCandidates).toBe(c.total);
    expect(c).toMatchObject({ ready: 4, duplicate: 1, invalid: 8, excluded: 1 });
    const code = (n: number) => plan.rows.find((r) => r.rowNumber === n)!.fieldErrors.map((e) => e.code);
    expect(code(6)).toContain("REQUIRED"); // birth year is required by the system and never invented
    expect(code(7)).toContain("INVALID_PHONE");
    expect(code(10)).toContain("NOT_IN_REFERENCE_LIST");
    expect(code(11)).toContain("REQUIRED");
    expect(code(12)).toContain("INVALID_VALUE");
    expect(code(13)).toContain("BIRTH_DATE_YEAR_MISMATCH");
    expect(code(14)).toContain("INVALID_PERCENT");
    expect(plan.rows.find((r) => r.rowNumber === 4)!.reasons).toContain("SHARED_PHONE_NOT_AN_IDENTITY_PROOF");
    expect(plan.rows.find((r) => r.rowNumber === 15)!.data!.injuryDate).toBe("2023-03-15");
    expect(await db.patient.count()).toBe(0); // preview writes no patient
  });

  it("APPLY is locked by default and on the protected database list", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "";
    await expect(confirmImport(db, opA, opId, planSha)).rejects.toThrow(/مقفل/);
    expect(applyLockReason("tahili_rehearsal", { DATA_CENTER_APPLY_ENABLED: "true" })).toMatch(/محظور/);
    expect(applyLockReason("tahili_dc_x", { DATA_CENTER_APPLY_ENABLED: "true" })).toBeNull();
    process.env.DATA_CENTER_FORBIDDEN_DATABASES = dbName;
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    await expect(confirmImport(db, opA, opId, planSha)).rejects.toThrow(/محظور/);
    delete process.env.DATA_CENTER_FORBIDDEN_DATABASES;
    process.env.DATA_CENTER_APPLY_ENABLED = "";
    expect(await db.patient.count()).toBe(0);
  });

  it("denies unauthorized branch, missing permission, and a forged operation id; audits the denials", async () => {
    const file = xlsx(P_HEAD, rows.slice(0, 1));
    await expect(previewImport(db, opA, { domain: "patients", branchId: B, fileName: "p.xlsx", bytes: file })).rejects.toThrow(/غير فرعك/);
    await expect(previewImport(db, noPerm, { domain: "patients", branchId: A, fileName: "p.xlsx", bytes: file })).rejects.toThrow(/صلاحية/);
    await expect(previewImport(db, opA, { domain: "tables; DROP", branchId: A, fileName: "p.xlsx", bytes: file })).rejects.toThrow(/غير مدعوم/);
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    await expect(confirmImport(db, opB, opId, planSha)).rejects.toThrow(/غير موجودة/); // another branch's operator cannot confirm it
    process.env.DATA_CENTER_APPLY_ENABLED = "";
    expect(await db.auditLog.count({ where: { action: "DENIED", userId: { in: [opA.userId, noPerm.userId, opB.userId] } } })).toBeGreaterThanOrEqual(3);
  });

  it("applies on the disposable database and the persisted record matches the source field by field; a wrong plan hash is refused", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    await expect(confirmImport(db, opA, opId, "0".repeat(64))).rejects.toThrow(/تغيّرت/);
    const res = await confirmImport(db, opA, opId, planSha);
    expect(res).toMatchObject({ status: "APPLIED", applied: 4, failed: 0 });
    const list = await db.patient.findMany({ orderBy: { legacyFileNumber: "asc" }, include: { governorate: true, injuryType: true } });
    expect(list).toHaveLength(4);
    expect(list.every((p) => p.branchId === A && p.importSourceKey && p.legacyFileNumber && p.status === "ACTIVE" && p.dataEntryBy?.startsWith("import:"))).toBe(true);
    const full = list.find((p) => p.legacyFileNumber === "1001")!;
    expect(full).toMatchObject({
      fullName: "مراجع تجريبي أول ثاني ثالث", gender: "MALE", birthYear: 1985, phone: "07700000001", caseType: "WOUNDED", motherName: "اسم أم تجريبي", maritalStatus: "MARRIED", childrenCount: 2, wivesCount: 1,
      kinshipDegree: "نفسه", housing: "ملك", education: "إعدادية", inMobilization: true, receivesSalary: false, disabilityPct: 40, injuryCause: "سبب تجريبي", mobility: "حركة تجريبية", status: "ACTIVE", notes: "ملاحظة تجريبية",
    });
    expect(full.governorate?.name).toBe("بغداد"); expect(full.injuryType?.name).toBe("كسر");
    expect(full.birthDate?.toISOString().slice(0, 10)).toBe("1985-03-15"); expect(full.injuryDate?.toISOString().slice(0, 10)).toBe("2024-06-01");
    const minimal = list.find((p) => p.legacyFileNumber === "1002")!;
    expect(minimal).toMatchObject({ gender: "FEMALE", caseType: "SICK", birthDate: null, motherName: null, notes: null });
    expect(list.find((p) => p.legacyFileNumber === "1014")!.injuryDate?.toISOString().slice(0, 10)).toBe("2023-03-15");
    const op = await db.dataOperation.findUniqueOrThrow({ where: { id: opId }, include: { rows: true } });
    expect(op.status).toBe("APPLIED"); expect(op.fileBytes).toBeNull(); // no plaintext copy retained
    expect(op.rows.filter((r) => r.disposition === "APPLIED").every((r) => r.resultRecordId)).toBe(true);
    expect(await db.auditLog.count({ where: { tableName: "data_operations", recordId: opId, action: { in: ["PREVIEW", "APPLY", "APPLY_DONE"] } } })).toBeGreaterThanOrEqual(3);
    expect(op.rows.filter((r) => r.resultRecordId).map((r) => r.resultRecordId).sort()).toEqual(list.map((p) => p.id).sort());
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("the same file again is refused; a different file with the same people matches instead of duplicating", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    await expect(previewImport(db, opA, { domain: "patients", branchId: A, fileName: "p.xlsx", bytes: xlsx(P_HEAD, rows) })).rejects.toThrow(/نُفِّذ سابقاً/);
    const other = xlsx(P_HEAD, [rows[1], ["2001", "مراجع جديد تماماً تجريبي", "ذكر", "1999", "07700000009", "بغداد", "كسر", "مريض"]], "المراجعون");
    const { plan, operationId } = await previewImport(db, opA, { domain: "patients", branchId: A, fileName: "p2.xlsx", bytes: other });
    expect(plan.counts.matched).toBe(1); expect(plan.counts.ready).toBe(1);
    const res = await confirmImport(db, opA, operationId, plan.planSha256);
    expect(res.applied).toBe(1);
    expect(await db.patient.count()).toBe(5);
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("official template round trip (CSV): the blank template filled with synthetic data previews READY; legacy headers work as a documented adapter; missing required columns and unsupported columns are surfaced", async () => {
    const refs = await loadReferences(db);
    const tpl = buildTemplate("patients", "csv", refs)!.bytes.toString("utf8").replace(/^﻿/, "").split(/\r?\n/);
    const header = tpl[0].split(",");
    const filled = header.map((h) => ({ fullName: "مراجع من القالب تجريبي", gender: "أنثى", birthYear: "1992", phone: "07700000031", governorate: "بغداد", injuryType: "كسر", caseType: "جريح" } as Record<string, string>)[h] ?? "");
    const rt = await previewImport(db, opA, { domain: "patients", branchId: A, fileName: "t.csv", bytes: csv(header, [filled]) });
    expect(rt.plan.counts).toMatchObject({ ready: 1, invalid: 0 }); expect(rt.plan.unmappedHeaders).toEqual([]);
    const legacy = csv(["الاسم", "الجنس", "التولد", "الهاتف", "المحافظة", "نوع الإصابة", "نوع الحالة", "عمود غير مدعوم"], [["مراجع بعنوان قديم تجريبي", "ذكر", "1988", "07700000032", "بغداد", "كسر", "مريض", "x"]]);
    const lg = await previewImport(db, opA, { domain: "patients", branchId: A, fileName: "l.csv", bytes: legacy });
    expect(lg.plan.counts.ready).toBe(1); expect(lg.plan.unmappedHeaders).toContain("عمود غير مدعوم"); // never silently discarded
    await expect(previewImport(db, opA, { domain: "patients", branchId: A, fileName: "bad.csv", bytes: csv(["الاسم", "الهاتف"], [["مراجع ناقص تجريبي", "07700000012"]]) })).rejects.toThrow(/أعمدة مطلوبة/);
    const fm = await previewImport(db, opA, { domain: "patients", branchId: A, fileName: "f.xlsx", bytes: xlsx(P_HEAD, [["", "=1+1", "ذكر", "1980", "07700000033", "بغداد", "كسر", "جريح"]]) });
    expect(fm.plan.rows[0].disposition).toBe("READY"); // sanitized text, not an executed formula
    const report = await errorReportRows(db, opA, opId);
    expect(report!.head[0]).toBe("رقم الصف في الملف");
    expect(JSON.stringify(report!.body)).not.toMatch(/07700000/); // protected report holds no cell values
  });
});

describe("personnel, accounts and memberships", () => {
  it("imports employees, residents and specialists as personnel records without logins; ambiguous same-name rows are held", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    const emp = xlsx(["fullName", "job", "department", "capacity", "phone"], [["موظف تجريبي أول", "إداري", "الاستعلامات", "تعيين", "07700000041"], ["موظف تجريبي أول", "إداري", "الاستعلامات", "تعيين", "07700000041"], ["اسم مكرر تجريبي", "محاسب", "", "", ""], ["اسم مكرر تجريبي", "إداري", "", "", ""]]);
    const e = await previewImport(db, opA, { domain: "employees", branchId: A, fileName: "e.xlsx", bytes: emp });
    expect(e.plan.counts).toMatchObject({ ready: 1, duplicate: 1, held: 2 });
    expect((await confirmImport(db, opA, e.operationId, e.plan.planSha256)).applied).toBe(1);
    const res = await previewImport(db, opA, { domain: "residents", branchId: A, fileName: "r.xlsx", bytes: xlsx(["اسم الطبيب", "العنوان الوظيفي", "رقم الهاتف"], [["طبيب مقيم تجريبي", "طبيب مقيم", "07700000042"]]) });
    const spec = await previewImport(db, opA, { domain: "specialists", branchId: A, fileName: "s.xlsx", bytes: xlsx(["اسم الطبيب", "الاختصاص"], [["طبيب اختصاص تجريبي", "جراحة عظام"]]) });
    await confirmImport(db, opA, res.operationId, res.plan.planSha256); await confirmImport(db, opA, spec.operationId, spec.plan.planSha256);
    const all = await db.employee.findMany();
    expect(all.map((x) => x.category).sort()).toEqual(["EMPLOYEE", "RESIDENT", "SPECIALIST"]);
    expect(all.every((x) => x.userId === null && x.sourceKey && x.branchId === A)).toBe(true);
    expect(all.find((x) => x.category === "EMPLOYEE")).toMatchObject({ name: "موظف تجريبي أول", job: "إداري", department: "الاستعلامات", capacity: "تعيين", phone: "07700000041" });
    expect(all.find((x) => x.category === "RESIDENT")).toMatchObject({ job: "طبيب مقيم", phone: "07700000042" });
    expect(all.find((x) => x.category === "SPECIALIST")).toMatchObject({ specialty: "جراحة عظام" });
    expect(await db.user.count({ where: { username: { not: { startsWith: "dc-" } } } })).toBe(0); // no accounts from personnel files
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("stages accounts INACTIVE with an unusable password; roles come from the system; privileged roles and duplicates are held; role escalation by upload is impossible", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    const f = xlsx(["username", "fullName", "role", "jobTitle", "department", "phone", "email"], [
      ["Staged.One", "مستخدم مجهز تجريبي", ROLE_LABELS.RECEPTION, "موظف استقبال", "الاستعلامات", "07700000051", "staged@example.test"],
      ["root.try", "محاولة مدير النظام", ROLE_LABELS.ADMIN, "", "", "", ""],
      ["mgr.try", "محاولة مدير", "MANAGER", "", "", "", ""],
      ["bad role", "دور غير صالح", "SUPERUSER", "", "", "", ""],
      ["Staged.One", "تكرار اسم المستخدم", ROLE_LABELS.RECEPTION, "", "", "", ""],
    ]);
    const a = await previewImport(db, opA, { domain: "accounts", branchId: A, fileName: "a.xlsx", bytes: f });
    expect(a.plan.counts).toMatchObject({ ready: 1, held: 2, invalid: 1, duplicate: 1 });
    const res = await confirmImport(db, opA, a.operationId, a.plan.planSha256);
    expect(res.applied).toBe(1);
    const u = await db.user.findUniqueOrThrow({ where: { username: "Staged.One" } });
    expect(u).toMatchObject({ isActive: false, needsActivation: true, branchId: A, role: "RECEPTION", jobTitle: "موظف استقبال", department: "الاستعلامات", phone: "07700000051", email: "staged@example.test" });
    expect(u.passwordHash.length).toBeGreaterThan(40);
    expect(await db.user.count({ where: { username: { in: ["root.try", "mgr.try"] } } })).toBe(0);
    expect(await db.employee.count({ where: { userId: { not: null } } })).toBe(0); // accounts are never linked to personnel by upload
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("memberships need an existing same-branch account, an existing center, and a role that has a center role (derived, not typed)", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    await db.user.update({ where: { username: "Staged.One" }, data: { role: "THERAPIST" } });
    await mkUserIn("rcp.user", "RECEPTION");
    const f = xlsx(["username", "centerName", "specialty", "startDate"], [
      ["Staged.One", "مركز تجريبي", "علاج طبيعي", "2026-01-01"],
      ["Staged.One", "مركز غير موجود", "", ""],
      ["ghost.user", "مركز تجريبي", "", ""],
      ["rcp.user", "مركز تجريبي", "", ""],
    ]);
    const m = await previewImport(db, opA, { domain: "memberships", branchId: A, fileName: "m.xlsx", bytes: f });
    expect(m.plan.counts).toMatchObject({ ready: 1, invalid: 3 });
    expect((await confirmImport(db, opA, m.operationId, m.plan.planSha256)).applied).toBe(1);
    const mem = await db.centerMembership.findMany();
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ role: "THERAPIST", specialty: "علاج طبيعي", status: "ACTIVE" });
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });
});

describe("export engine: scope, dedicated permissions, no secrets, injection-safe", () => {
  it("patient export is pinned to the actor's branch, refuses a forged branch, and ADMIN may choose", async () => {
    const mine = await runExport(db, opA, { domain: "patients" });
    expect(mine.count).toBe(5); expect(mine.headers).not.toContain("ملاحظات");
    await expect(runExport(db, opA, { domain: "patients", branchId: B })).rejects.toThrow(/غير فرعك/);
    const none = await runExport(db, opB, { domain: "patients" });
    expect(none.count).toBe(0);
    const all = await runExport(db, admin, { domain: "patients" });
    expect(all.count).toBe(5);
    expect((await runExport(db, admin, { domain: "patients", branchId: B })).count).toBe(0);
  });
  it("read access does not imply export; finance and pharmacy need their dedicated permissions", async () => {
    await expect(runExport(db, noPerm, { domain: "patients" })).rejects.toThrow(/صلاحية/);
    expect(exportAllowed(finA, "finance_invoices")).toBe(false); // lacks finance.report
    await expect(runExport(db, finA, { domain: "finance_invoices", from: "2026-01-01", to: "2026-12-31" })).rejects.toThrow(/صلاحية/);
    await expect(runExport(db, opA, { domain: "pharmacy_stock" })).rejects.toThrow(/صلاحية/);
    await expect(runExport(db, admin, { domain: "finance_invoices" })).rejects.toThrow(/نطاقاً زمنياً/);
    await expect(runExport(db, admin, { domain: "finance_invoices", from: "2020-01-01", to: "2026-12-31" })).rejects.toThrow(/366/);
    const fin = await runExport(db, admin, { domain: "finance_invoices", from: "2026-01-01", to: "2026-12-31" });
    expect(fin.headers).not.toContain("الاسم");
    expect((await runExport(db, admin, { domain: "pharmacy_stock" })).headers).toContain("الكمية");
  });
  it("sensitive medical domains have no export at all; user roster carries no secrets; personnel roster has no credentials", async () => {
    for (const bad of ["medical_reports", "diagnoses", "audit", "passwords", "../patients"]) await expect(runExport(db, admin, { domain: bad })).rejects.toThrow(/غير مدعوم/);
    expect(DISABLED_EXPORTS.length).toBeGreaterThanOrEqual(4);
    const users = await runExport(db, opA, { domain: "users" });
    expect(users.headers.join("|")).not.toMatch(/كلمة|سر|رمز|hash|token/i);
    expect(JSON.stringify(users.rows)).not.toMatch(/\$2[aby]\$/);
    const personnel = await runExport(db, admin, { domain: "personnel" });
    expect(personnel.headers.join("|")).not.toMatch(/كلمة|سر|رمز/);
  });
  it("exported cells that start with a formula character are neutralized", async () => {
    await db.patient.create({ data: { fullName: "=cmd|calc تجريبي طويل", branchId: A, phone: "07700000099" } });
    const r = await runExport(db, opA, { domain: "patients" });
    const csvText = (lib.writeCsv([r.headers, ...r.rows]) as Buffer).toString("utf8");
    expect(csvText).toContain("'=cmd|calc");
    expect(csvText).not.toMatch(/(^|,|\n)=cmd/);
    const x = parseUpload(lib.writeXlsx([{ name: "s", rows: [r.headers, ...r.rows] }]), "e.xlsx");
    expect(JSON.stringify(x.sheets[0].rows)).toContain("'=cmd|calc");
  });
});
