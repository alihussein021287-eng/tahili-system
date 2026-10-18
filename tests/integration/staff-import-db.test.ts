// @vitest-environment node
// Mission 09.5 — ONE unified staff file (personnel + accounts + memberships): coordinated preview and atomic apply.
// Synthetic data on a DISPOSABLE database only (never QA, never tahili_preview).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

vi.mock("@/lib/collaboration-scan", () => ({ scanBufferWithClamAv: async () => ({ status: "SAFE", engine: "test", detail: "stream: OK" }) }));

import { confirmImport, errorReportRows, importAllowed, previewImport, type Actor } from "@/lib/data-center/operations";
import { parseUpload } from "@/lib/data-center/spreadsheet";
import { buildTemplate } from "@/lib/data-center/templates";
import { loadReferences } from "@/lib/data-center/reference";
import { IMPORT_DOMAIN_BY_ID, decodeStaffRow } from "@/lib/data-center/registry";
import { ROLE_LABELS } from "@/lib/permissions";
import { environmentFingerprint } from "@/lib/data-center/environment";

const lib = createRequire(import.meta.url)("../../scripts/import-preflight/lib.cjs");
const base = process.env.DATABASE_URL ?? "";
const dbName = `tahili_stf_${randomUUID().slice(0, 8)}`;
const urlFor = (n: string) => base.replace(/\/[^/?]+(\?|$)/, `/${n}$1`);
let db: PrismaClient;
let A = 0, B = 0, CENTER = 0;
let opA: Actor, opB: Actor, onlyPersonnel: Actor, admin: Actor;
const actor = (userId: string, role: string, branchId: number | null, perms: string[]): Actor => ({ userId, role, branchId, permissions: new Set(perms) });
const IMPORT = ["datacenter.view", "datacenter.import.personnel", "datacenter.import.accounts", "datacenter.import.memberships", "datacenter.import.apply"];

const PH = ["personKey", "fullName", "category", "job", "specialty", "department", "capacity", "phone"];
const AH = ["personKey", "username", "role", "roleVerified", "email"];
const MH = ["personKey", "centerName", "specialty", "startDate"];
const RES = "طبيب مقيم (تدرج)", SPEC = "طبيب اختصاص", EMP = "موظف";
const stamp = (name = dbName) => ({ name: "تعليمات", rows: [[`بصمة البيئة: ${environmentFingerprint(name)}`, `البيئة: ${name}`]] });
const staffFile = (p: string[][], a: string[][] = [], m: string[][] = [], extra: { name: string; rows: string[][] }[] = [stamp()]) =>
  lib.writeXlsx([{ name: "الأشخاص", rows: [PH, ...p] }, { name: "الحسابات", rows: [AH, ...a] }, { name: "العضويات", rows: [MH, ...m] }, ...extra]) as Buffer;
const prev = (who: Actor, bytes: Buffer, branch = A) => previewImport(db, who, { domain: "staff", branchId: branch, fileName: "staff.xlsx", bytes });
const disp = (plan: { rows: { rowNumber: number; disposition: string; reasons: string[] }[] }, sheet: "personnel" | "accounts" | "memberships", line: number) =>
  plan.rows.find((r) => { const x = decodeStaffRow(r.rowNumber); return x.sheet === sheet && x.row === line; })!;
const reasons = (r: { reasons: string[]; fieldErrors?: { code: string }[] }) => [...r.reasons, ...(r.fieldErrors ?? []).map((e) => e.code)];

// ---- the main synthetic file (row n of a sheet = data index + 3 because the helper writes ids on row 1 and data from row 2) ----
const personnel = [
  ["P001", "طبيب مقيم تجريبي أول", RES, "طبيب تدرج", "", "", "", ""],                 // line 2
  ["P002", "طبيب مقيم تجريبي ثان", RES, "طبيب مقيم اقدم", "", "", "", "07700000002"], // 3
  ["P003", "طبيب اختصاص تجريبي", SPEC, "", "جراحة عظام", "", "", ""],                  // 4
  ["P004", "موظف استقبال تجريبي", EMP, "استقبال", "", "", "", ""],                      // 5
  ["P005", "موظف كافتيريا تجريبي", EMP, "كافتيريا", "", "", "", ""],                    // 6 (record only, no account)
  ["P006", "صيدلي تجريبي", EMP, "صيدلي", "", "", "", ""],                               // 7 (account role not verified)
  ["P007", "معالج تجريبي", EMP, "معالج", "", "", "", ""],                               // 8
  ["P008", "مدير تجريبي أول", EMP, "مدير", "", "", "", ""],                             // 9 (ADMIN requested)
  ["P009", "مدير تجريبي ثان", EMP, "مدير", "", "", "", ""],                             // 10 (MANAGER requested)
  ["P010", "طبيب اختصاص تجريبي ثان", SPEC, "", "باطنية", "", "", ""],                   // 11 (role conflicts with category)
  ["P011", "موظف بلا دور تجريبي", EMP, "إداري", "", "", "", ""],                        // 12 (employee account without role)
];
const accounts = [
  ["P001", "res.one", "", "", ""],                       // 2 derived RESIDENT
  ["P002", "res.two", ROLE_LABELS.RESIDENT, "", "res2@example.test"], // 3
  ["P003", "spec.one", "", "", ""],                      // 4 derived DOCTOR
  ["P004", "rcp.one", ROLE_LABELS.RECEPTION, "نعم", ""], // 5 verified
  ["P006", "pharm.one", ROLE_LABELS.PHARMACIST, "", ""], // 6 not verified -> held
  ["P007", "thr.one", ROLE_LABELS.THERAPIST, "نعم", ""], // 7
  ["P008", "root.try", ROLE_LABELS.ADMIN, "نعم", ""],    // 8 privileged
  ["P009", "mgr.try", "MANAGER", "نعم", ""],             // 9 privileged
  ["P010", "spec.bad", ROLE_LABELS.RESIDENT, "", ""],    // 10 conflicts with SPECIALIST
  ["P011", "emp.norole", "", "نعم", ""],                 // 11 employee without role
  ["P999", "ghost.user", ROLE_LABELS.RECEPTION, "نعم", ""], // 12 unknown person key
];
const memberships = [
  ["P001", "مركز تجريبي", "", "2026-01-01"], // 2 ready (RESIDENT)
  ["P003", "مركز تجريبي", "باطنية", ""],      // 3 ready (SPECIALIST)
  ["P007", "مركز تجريبي", "", ""],            // 4 ready (THERAPIST)
  ["P004", "مركز تجريبي", "", ""],            // 5 reception has no center role
  ["P006", "مركز تجريبي", "", ""],            // 6 no account for the person
  ["P999", "مركز تجريبي", "", ""],            // 7 unknown key
  ["P001", "مركز غير موجود", "", ""],         // 8 unknown center
  ["P001", "مركز تجريبي", "", ""],            // 9 duplicate of row 2
];
let opId = "", planSha = "";

beforeAll(async () => {
  expect(base).toMatch(/127\.0\.0\.1:55432/);
  const root = new PrismaClient();
  await root.$executeRawUnsafe(`CREATE DATABASE ${dbName}`);
  await root.$disconnect();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: urlFor(dbName) }, stdio: "pipe" });
  db = new PrismaClient({ datasources: { db: { url: urlFor(dbName) } } });
  A = (await db.branch.create({ data: { name: "فرع تجريبي أ" } })).id;
  B = (await db.branch.create({ data: { name: "فرع تجريبي ب" } })).id;
  CENTER = (await db.center.create({ data: { name: "مركز تجريبي" } })).id;
  const mk = async (username: string, role: string, branchId: number | null) => (await db.user.create({ data: { username, fullName: username, role: role as never, branchId, passwordHash: "!" } })).id;
  admin = actor(await mk("stf-admin", "ADMIN", null), "ADMIN", null, IMPORT);
  opA = actor(await mk("stf-op-a", "DATA_ENTRY", A), "DATA_ENTRY", A, IMPORT);
  opB = actor(await mk("stf-op-b", "DATA_ENTRY", B), "DATA_ENTRY", B, IMPORT);
  onlyPersonnel = actor(await mk("stf-only", "DATA_ENTRY", A), "DATA_ENTRY", A, ["datacenter.view", "datacenter.import.personnel", "datacenter.import.apply"]);
}, 180_000);
afterAll(async () => { process.env.DATA_CENTER_APPLY_ENABLED = ""; await db?.$disconnect(); });

describe("official unified template", () => {
  it("downloads as XLSX with linked sheets, ids + Arabic labels, separate help and lists; CSV is not offered; a filled template previews READY", async () => {
    const refs = await loadReferences(db);
    expect(buildTemplate("staff", "csv", refs, { databaseName: dbName })).toBeNull();
    expect(() => buildTemplate("staff", "xlsx", refs)).toThrow(); // a template always belongs to one environment
    const t = buildTemplate("staff", "xlsx", refs, { databaseName: dbName })!;
    const wb = parseUpload(t.bytes, t.filename);
    expect(wb.sheets.map((s) => s.name)).toEqual(["الأشخاص", "الحسابات", "العضويات", "تعليمات", "القوائم"]);
    const d = IMPORT_DOMAIN_BY_ID.staff;
    for (const sh of d.sheets!) {
      const ws = wb.sheets.find((s) => s.name === sh.name)!;
      expect(ws.rows[0]).toEqual(sh.fields.map((f) => f.id));
      expect(ws.rows[1]).toEqual(sh.fields.map((f) => f.label));
      expect(ws.rows.length).toBe(2); // no sample data inside the import sheets
    }
    expect(t.bytes.toString("latin1")).toContain("dataValidation");
    const lists = JSON.stringify(wb.sheets.find((s) => s.name === "القوائم")!.rows);
    for (const v of ["طبيب مقيم (تدرج)", "طبيب اختصاص", "موظف", ROLE_LABELS.RESIDENT, ROLE_LABELS.DOCTOR, "مركز تجريبي"]) expect(lists).toContain(v);
    expect(lists).not.toContain(ROLE_LABELS.ADMIN); // privileged roles are not offered
    expect(JSON.stringify(wb.sheets)).not.toMatch(/password|كلمة السر|hash/i.test("") ? "" : /كلمة (السر|المرور)\s*[:：]\s*\S/);
    // fill the downloaded template (keeping its label row) with synthetic data and upload it
    const fill = (name: string, rows: string[][]) => { const ws = wb.sheets.find((s) => s.name === name)!; return { name, rows: [...ws.rows, ...rows] }; };
    const bytes = lib.writeXlsx([fill("الأشخاص", [["R1", "طبيب مقيم من القالب", RES, "طبيب تدرج", "", "", "", ""]]), fill("الحسابات", [["R1", "tpl.res", "", "", ""]]), fill("العضويات", [["R1", "مركز تجريبي", "", ""]]), { name: "تعليمات", rows: wb.sheets.find((x) => x.name === "تعليمات")!.rows }]) as Buffer;
    const { plan } = await prev(opA, bytes);
    expect(plan.counts).toMatchObject({ ready: 3, invalid: 0, held: 0 });
    expect(plan.unmappedHeaders).toEqual([]);
  });
  it("is limited to holders of every import permission it exercises", () => {
    expect(importAllowed(opA, "staff")).toBe(true);
    expect(importAllowed(onlyPersonnel, "staff")).toBe(false); // lacks accounts + memberships
    expect(importAllowed(onlyPersonnel, "employees")).toBe(true); // the old single-domain importers keep working
  });
});

describe("coordinated preview", () => {
  it("gives every row of every sheet an explicit disposition with the correct reasons", async () => {
    const { operationId, plan } = await prev(opA, staffFile(personnel, accounts, memberships));
    opId = operationId; planSha = plan.planSha256;
    const c = plan.counts;
    expect(c.ready + c.matched + c.duplicate + c.held + c.invalid + c.excluded + c.updateCandidates).toBe(c.total);
    expect(c.total).toBe(personnel.length + accounts.length + memberships.length);
    // personnel: all eleven are importable records, none touches an account by itself
    for (let l = 2; l <= 12; l++) expect(disp(plan, "personnel", l).disposition, `personnel ${l}`).toBe("READY");
    // accounts
    const a = (l: number) => disp(plan, "accounts", l);
    expect(a(2).disposition).toBe("READY"); expect(a(3).disposition).toBe("READY"); expect(a(4).disposition).toBe("READY");
    expect(a(5).disposition).toBe("READY"); expect(a(7).disposition).toBe("READY");
    expect(a(6).disposition).toBe("HELD"); expect(reasons(a(6))).toContain("ROLE_NOT_VERIFIED");
    expect(a(8).disposition).toBe("HELD"); expect(reasons(a(8))).toContain("PRIVILEGED_ROLE_NEEDS_SEPARATE_APPROVAL");
    expect(a(9).disposition).toBe("HELD"); expect(reasons(a(9))).toContain("PRIVILEGED_ROLE_NEEDS_SEPARATE_APPROVAL");
    expect(a(10).disposition).toBe("INVALID"); expect(reasons(a(10))).toContain("ROLE_CONFLICTS_WITH_CATEGORY");
    expect(a(11).disposition).toBe("INVALID"); expect(reasons(a(11))).toContain("REQUIRED");
    expect(a(12).disposition).toBe("INVALID"); expect(reasons(a(12))).toContain("PERSON_KEY_NOT_FOUND");
    // memberships
    const m = (l: number) => disp(plan, "memberships", l);
    expect([m(2), m(3), m(4)].map((x) => x.disposition)).toEqual(["READY", "READY", "READY"]);
    expect(m(5).disposition).toBe("INVALID"); expect(reasons(m(5))).toContain("ROLE_HAS_NO_CENTER_ROLE");
    expect(m(6).disposition).toBe("HELD"); expect(reasons(m(6))).toContain("NO_ACCOUNT_FOR_PERSON");
    expect(m(7).disposition).toBe("INVALID"); expect(reasons(m(7))).toContain("PERSON_KEY_NOT_FOUND");
    expect(m(8).disposition).toBe("INVALID"); expect(reasons(m(8))).toContain("NOT_IN_REFERENCE_LIST");
    expect(m(9).disposition).toBe("DUPLICATE");
    expect(c).toMatchObject({ readyPersonnel: 11, readyAccounts: 5, readyMemberships: 3 });
    expect(await db.employee.count()).toBe(0); expect(await db.user.count({ where: { username: { not: { startsWith: "stf-" } } } })).toBe(0); // a preview writes nothing
  });

  it("the protected error report names the sheet and row and contains no cell values", async () => {
    const r = await errorReportRows(db, opA, opId);
    expect(r!.head.slice(0, 2)).toEqual(["الورقة", "رقم الصف في الملف"]);
    const text = JSON.stringify(r!.body);
    expect(text).toContain("الحسابات"); expect(text).toContain("العضويات");
    expect(text).not.toMatch(/root\.try|mgr\.try|ghost\.user|spec\.bad/);
  });

  it("rejects invalid multi-sheet shapes: missing personnel sheet, missing required columns, formulas, repeated keys and look-alike people", async () => {
    await expect(prev(opA, lib.writeXlsx([{ name: "الحسابات", rows: [AH, ["P1", "x.user", "", "", ""]] }, stamp()]) as Buffer)).rejects.toThrow(/الأشخاص/);
    await expect(prev(opA, lib.writeXlsx([{ name: "الأشخاص", rows: [["fullName"], ["طبيب بلا رمز"]] }, stamp()]) as Buffer)).rejects.toThrow(/أعمدة مطلوبة/);
    const f = await prev(opA, staffFile([["F1", "=1+1", RES, "طبيب تدرج", "", "", "", ""]]));
    expect(disp(f.plan, "personnel", 2).disposition).toBe("READY"); // sanitised text, never an executed formula
    const rep = await prev(opA, staffFile([
      ["K1", "شخص مكرر الرمز أول", EMP, "إداري", "", "", "", ""], ["K1", "شخص آخر بالرمز نفسه", EMP, "إداري", "", "", "", ""],
      ["K2", "الاسم نفسه تحت رمزين", EMP, "إداري", "", "", "", ""], ["K3", "الاسم نفسه تحت رمزين", EMP, "إداري", "", "", "", ""],
      ["K4", "تكرار حرفي تجريبي", EMP, "إداري", "", "", "", ""], ["K4", "تكرار حرفي تجريبي", EMP, "إداري", "", "", "", ""],
    ], [["K1", "k1.user", ROLE_LABELS.RECEPTION, "نعم", ""], ["K4", "k4.user", ROLE_LABELS.RECEPTION, "نعم", ""], ["K4", "k4.other", ROLE_LABELS.RECEPTION, "نعم", ""]]));
    expect(disp(rep.plan, "personnel", 2).disposition).toBe("HELD"); expect(disp(rep.plan, "personnel", 3).disposition).toBe("HELD");
    expect(reasons(disp(rep.plan, "personnel", 4))).toContain("SAME_PERSON_UNDER_DIFFERENT_KEYS");
    expect(disp(rep.plan, "personnel", 6).disposition).toBe("READY"); expect(disp(rep.plan, "personnel", 7).disposition).toBe("DUPLICATE");
    expect(disp(rep.plan, "accounts", 2).disposition).toBe("HELD"); expect(reasons(disp(rep.plan, "accounts", 2))).toContain("PERSON_NOT_IMPORTABLE");
    expect(reasons(disp(rep.plan, "accounts", 3))).toContain("ACCOUNT_REQUESTED_TWICE_FOR_PERSON");
  });

  it("missing optional information stays incomplete and is never fabricated", async () => {
    const { plan } = await prev(opA, staffFile([["O1", "شخص بالحد الأدنى", EMP, "", "", "", "", ""]]));
    expect(disp(plan, "personnel", 2).disposition).toBe("READY");
  });
});

describe("apply: atomic, inactive accounts, one-to-one links, receipts", () => {
  it("APPLY is locked by default; a wrong plan hash and another branch's operator are refused", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "";
    await expect(confirmImport(db, opA, opId, planSha)).rejects.toThrow(/مقفل/);
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    await expect(confirmImport(db, opA, opId, "0".repeat(64))).rejects.toThrow(/تغيّرت/);
    await expect(confirmImport(db, opB, opId, planSha)).rejects.toThrow(/غير موجودة/);
    await expect(confirmImport(db, onlyPersonnel, opId, planSha)).rejects.toThrow(/صلاحية|غير موجودة/);
    expect(await db.employee.count()).toBe(0);
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("a request into another branch is denied", async () => {
    await expect(prev(opA, staffFile(personnel.slice(0, 1)), B)).rejects.toThrow(/غير فرعك/);
  });

  it("applies everything in one operation and the persisted data matches the file", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    const res = await confirmImport(db, opA, opId, planSha);
    expect(res).toMatchObject({ status: "APPLIED", applied: 19, failed: 0 });
    const emps = await db.employee.findMany({ include: { user: { include: { centerMemberships: true } } } });
    expect(emps).toHaveLength(11);
    expect(emps.every((e) => e.branchId === A && e.sourceKey)).toBe(true);
    const by = (n: string) => emps.find((e) => e.name === n)!;
    expect(by("طبيب مقيم تجريبي أول")).toMatchObject({ category: "RESIDENT", job: "طبيب تدرج" });
    expect(by("طبيب مقيم تجريبي ثان")).toMatchObject({ category: "RESIDENT", phone: "07700000002" });
    expect(by("طبيب اختصاص تجريبي")).toMatchObject({ category: "SPECIALIST", specialty: "جراحة عظام" });
    expect(by("موظف كافتيريا تجريبي")).toMatchObject({ category: "EMPLOYEE", userId: null });
    // accounts: staged INACTIVE, unusable password, linked one-to-one to the SAME employee rows (no duplicate people)
    const linked = emps.filter((e) => e.user).map((e) => e.user!.username).sort();
    expect(linked).toEqual(["rcp.one", "res.one", "res.two", "spec.one", "thr.one"]);
    for (const e of emps.filter((x) => x.user)) {
      expect(e.user).toMatchObject({ isActive: false, needsActivation: true, branchId: A, fullName: e.name });
      expect(await bcrypt.compare("", e.user!.passwordHash)).toBe(false);
    }
    expect(by("طبيب مقيم تجريبي أول").user!.role).toBe("RESIDENT");
    expect(by("طبيب اختصاص تجريبي").user!.role).toBe("DOCTOR");
    expect(by("موظف استقبال تجريبي").user!.role).toBe("RECEPTION");
    expect(by("معالج تجريبي").user!.role).toBe("THERAPIST");
    expect(await db.user.count({ where: { username: { in: ["pharm.one", "root.try", "mgr.try", "spec.bad", "emp.norole", "ghost.user"] } } })).toBe(0);
    // memberships: only the three verified ones, role derived from the account role
    const mem = await db.centerMembership.findMany({ include: { user: true } });
    expect(mem.map((m) => `${m.user.username}:${m.role}`).sort()).toEqual(["res.one:RESIDENT", "spec.one:SPECIALIST", "thr.one:THERAPIST"]);
    expect(mem.every((m) => m.status === "ACTIVE" && m.centerId === CENTER)).toBe(true);
    expect(mem.find((m) => m.user.username === "spec.one")!.specialty).toBe("باطنية");
    // receipts + audit
    const op = await db.dataOperation.findUniqueOrThrow({ where: { id: opId }, include: { rows: true } });
    expect(op).toMatchObject({ status: "APPLIED", templateVersion: "1.1" }); expect(op.fileBytes).toBeNull();
    expect(op.rows.filter((r) => r.disposition === "APPLIED")).toHaveLength(19);
    expect(op.rows.filter((r) => r.disposition === "APPLIED").every((r) => r.resultRecordId)).toBe(true);
    expect(await db.auditLog.count({ where: { tableName: "data_operations", recordId: opId, action: { in: ["PREVIEW", "APPLY", "APPLY_DONE"] } } })).toBeGreaterThanOrEqual(3);
    expect(await db.auditLog.count({ where: { tableName: "users", action: "CREATE", userId: opA.userId } })).toBe(5);
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("the same file again is refused", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    await expect(prev(opA, staffFile(personnel, accounts, memberships))).rejects.toThrow(/نُفِّذ سابقاً/);
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });
});

describe("existing staff: trustworthy matching only, nothing overwritten, no duplicates", () => {
  it("matches identical existing people, holds look-alikes, links an unlinked existing record to a NEW inactive account without creating a second employee", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    const employeesBefore = await db.employee.count();
    const f = staffFile([
      ["P001", "طبيب مقيم تجريبي أول", RES, "طبيب تدرج", "", "", "", ""],         // identical to an existing linked resident -> MATCHED
      ["P002", "طبيب مقيم تجريبي ثان", RES, "وظيفة مختلفة", "", "", "", ""],      // same name, different details -> HELD
      ["P005", "موظف كافتيريا تجريبي", EMP, "كافتيريا", "", "", "", ""],          // identical, unlinked -> MATCHED, may receive an account
      ["N001", "شخص جديد تماماً", RES, "طبيب تدرج", "", "", "", ""],              // new
    ], [
      ["P001", "res.one", "", "", ""],                                  // the existing linked account -> MATCHED
      ["P001", "res.other", "", "", ""],                               // second account for a person who already has one -> HELD (duplicate-key rule fires first)
      ["P002", "res.two.b", "", "", ""],                               // person is held -> held
      ["P005", "cafe.one", ROLE_LABELS.DATA_ENTRY, "نعم", ""],        // unlinked existing employee gets a new inactive account
      ["N001", "new.res", "", "", ""],
    ], [
      ["P001", "مركز تجريبي", "", ""],                                  // existing membership -> MATCHED
      ["N001", "مركز تجريبي", "", ""],
    ]);
    const { operationId, plan } = await prev(opA, f);
    expect(disp(plan, "personnel", 2).disposition).toBe("MATCHED");
    expect(disp(plan, "personnel", 3).disposition).toBe("HELD"); expect(reasons(disp(plan, "personnel", 3))).toContain("SAME_NAME_EXISTS_WITH_DIFFERENT_DETAILS");
    expect(disp(plan, "personnel", 4).disposition).toBe("MATCHED");
    expect(disp(plan, "personnel", 5).disposition).toBe("READY");
    expect(disp(plan, "accounts", 2).disposition).toBe("HELD"); // two requests for the same person
    expect(disp(plan, "accounts", 3).disposition).toBe("HELD");
    expect(reasons(disp(plan, "accounts", 4))).toContain("PERSON_NOT_IMPORTABLE");
    expect(disp(plan, "accounts", 5).disposition).toBe("READY");
    expect(disp(plan, "accounts", 6).disposition).toBe("READY");
    expect(disp(plan, "memberships", 2).disposition).toBe("MATCHED");
    expect(disp(plan, "memberships", 3).disposition).toBe("READY");
    expect(await confirmImport(db, opA, operationId, plan.planSha256)).toMatchObject({ status: "APPLIED" });
    expect(await db.employee.count()).toBe(employeesBefore + 1); // only the genuinely new person
    const cafe = await db.employee.findFirstOrThrow({ where: { name: "موظف كافتيريا تجريبي" }, include: { user: true } });
    expect(cafe.user).toMatchObject({ username: "cafe.one", isActive: false, role: "DATA_ENTRY" });
    expect(await db.employee.count({ where: { name: "موظف كافتيريا تجريبي" } })).toBe(1);
    const p2 = await db.employee.findFirstOrThrow({ where: { name: "طبيب مقيم تجريبي ثان" } });
    expect(p2.job).toBe("طبيب مقيم اقدم"); // nothing overwritten
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("existing records of another branch are not matched; an unassigned record with the same name is held for a decision", async () => {
    await db.employee.create({ data: { name: "اسم موجود في فرع آخر", job: "إداري", category: "EMPLOYEE", branchId: B } });
    await db.employee.create({ data: { name: "اسم موجود بلا فرع", job: "إداري", category: "EMPLOYEE" } });
    const { plan } = await prev(opA, staffFile([["B1", "اسم موجود في فرع آخر", EMP, "إداري", "", "", "", ""], ["B2", "اسم موجود بلا فرع", EMP, "إداري", "", "", "", ""]]));
    expect(disp(plan, "personnel", 2).disposition).toBe("READY"); // a separate record in this branch, no cross-branch merge
    expect(disp(plan, "personnel", 3).disposition).toBe("HELD"); expect(reasons(disp(plan, "personnel", 3))).toContain("EXISTING_UNASSIGNED_RECORD_WITH_SAME_NAME");
  });

  it("confirmation revalidates against the actual database: a username taken after the preview blocks the whole operation", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    const f = staffFile([["Z1", "شخص للتحقق من الحالة", RES, "طبيب تدرج", "", "", "", ""]], [["Z1", "late.taken", "", "", ""]]);
    const { operationId, plan } = await prev(opA, f);
    expect(plan.counts.ready).toBe(2);
    await db.user.create({ data: { username: "late.taken", fullName: "حساب سبق", role: "VIEWER", branchId: A, passwordHash: "!" } });
    const before = await db.employee.count();
    await expect(confirmImport(db, opA, operationId, plan.planSha256)).rejects.toThrow(/تغيّرت/);
    expect(await db.employee.count()).toBe(before); // nothing partial
    expect((await db.dataOperation.findUniqueOrThrow({ where: { id: operationId } })).status).toBe("PREVIEWED");
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });
});

describe("template corrections: canonical categories, environment binding, authorized centers", () => {
  it("offers exactly three category choices; legacy labels are still accepted as input", async () => {
    const refs = await loadReferences(db);
    const wb = parseUpload(buildTemplate("staff", "xlsx", refs, { databaseName: dbName })!.bytes, "t.xlsx");
    const lists = wb.sheets.find((x) => x.name === "القوائم")!;
    const col = lists.rows[0].findIndex((h) => h === "الأشخاص — الفئة");
    expect(col).toBeGreaterThanOrEqual(0);
    expect(lists.rows.slice(1).map((r) => r[col]).filter(Boolean)).toEqual(["طبيب مقيم (تدرج)", "طبيب اختصاص", "موظف"]);
    const { plan } = await prev(opA, staffFile([
      ["L1", "اسم بتسمية قديمة أول", "اطباء التدرج", "طبيب تدرج", "", "", "", ""],
      ["L2", "اسم بتسمية قديمة ثان", "الاطباء الاختصاص", "", "باطنية", "", "", ""],
      ["L3", "اسم بتسمية قديمة ثالث", "موظفين المراكز", "إداري", "", "", "", ""],
      ["L4", "فئة غير معروفة", "مدير", "إداري", "", "", "", ""],
    ]));
    expect([2, 3, 4].map((l) => disp(plan, "personnel", l).disposition)).toEqual(["READY", "READY", "READY"]);
    const bad = disp(plan, "personnel", 5);
    expect(bad.disposition).toBe("INVALID"); expect(reasons(bad)).toContain("INVALID_VALUE");
  });

  it("the list of centers contains only ACTIVE centers of this database; a center that exists elsewhere (QA) is not accepted here", async () => {
    await db.center.create({ data: { name: "مركز معطل في هذه القاعدة", active: false } });
    const refs = await loadReferences(db);
    const wb = parseUpload(buildTemplate("staff", "xlsx", refs, { databaseName: dbName })!.bytes, "t.xlsx");
    const lists = wb.sheets.find((x) => x.name === "القوائم")!;
    const col = lists.rows[0].findIndex((h) => h === "العضويات — اسم المركز");
    const centers = lists.rows.slice(1).map((r) => r[col]).filter(Boolean);
    const active = (await db.center.findMany({ where: { active: true } })).map((c) => c.name).sort();
    expect([...centers].sort()).toEqual(active);
    expect(centers).not.toContain("مركز معطل في هذه القاعدة");
    const { plan } = await prev(opA, staffFile([["C1", "طبيب للمراكز الأجنبية", RES, "طبيب تدرج", "", "", "", ""]], [["C1", "c1.user", "", "", ""]], [["C1", "REHEARSAL_ONLY_CENTER", "", ""], ["C1", "مركز معطل في هذه القاعدة", "", ""]]));
    expect(disp(plan, "memberships", 2).disposition).toBe("INVALID"); expect(reasons(disp(plan, "memberships", 2))).toContain("NOT_IN_REFERENCE_LIST");
    expect(disp(plan, "memberships", 3).disposition).toBe("INVALID");
    expect(disp(plan, "accounts", 2).disposition).toBe("READY"); // the account is fine; it simply gets no membership
    expect(plan.rows.find((r) => decodeStaffRow(r.rowNumber).sheet === "accounts")!.reasons).toContain("NO_CENTER_MEMBERSHIP_REQUESTED");
  });

  it("a file generated for another environment, or without the official stamp, is rejected before any row is read", async () => {
    await expect(prev(opA, staffFile(personnel.slice(0, 1), [], [], []))).rejects.toThrow(/بصمة بيئة/);
    await expect(prev(opA, staffFile(personnel.slice(0, 1), [], [], [stamp("tahili_rehearsal")]))).rejects.toThrow(/بيئة أخرى/);
    await expect(prev(opA, staffFile(personnel.slice(0, 1), [], [], [stamp("tahili_preview")]))).rejects.toThrow(/بيئة أخرى/);
  });
});

describe("residents imported earlier by the single-domain importer", () => {
  it("are matched exactly, never duplicated or guessed; blank optional fields stay blank; accounts stay inactive and link to the SAME record", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    // as in the real preview: the old resident importer created personnel records (job set, no department, no account, branch set)
    const old = await previewImport(db, opA, { domain: "residents", branchId: A, fileName: "old-res.xlsx", bytes: lib.writeXlsx([{ name: "البيانات", rows: [["اسم الطبيب", "العنوان الوظيفي"], ["مقيم سابق أول", "طبيب مقيم اقدم"], ["مقيم سابق ثان", "طبيب تدرج"], ["مقيم سابق ثالث", "طبيب تدرج"]] }]) as Buffer });
    expect((await confirmImport(db, opA, old.operationId, old.plan.planSha256)).applied).toBe(3);
    const existing = await db.employee.findMany({ where: { name: { startsWith: "مقيم سابق" } } });
    expect(existing.every((e) => e.category === "RESIDENT" && e.userId === null && e.department === null && e.branchId === A)).toBe(true);
    const before = await db.employee.count();

    const f = staffFile([
      ["R1", "مقيم سابق أول", RES, "طبيب مقيم اقدم", "", "", "", "07700000066"],   // identical identity (phone is extra info, never written onto the existing record)
      ["R2", "مقيم سابق ثان", RES, "وظيفة أخرى", "", "", "", ""],                   // same name, different job -> held
      ["R3", "مقيم سابق ثالث", RES, "طبيب تدرج", "", "", "", ""],                   // identical
      ["R4", "مقيم سابق رابع جديد", RES, "طبيب تدرج", "", "", "", ""],              // a different person (no guessing from similar names)
    ], [
      ["R1", "prev.res.one", "", "", "x@example.test"],
      ["R3", "prev.res.three", "", "", ""],
      ["R4", "prev.res.four", "", "", ""],
    ], [["R1", "مركز تجريبي", "", ""], ["R4", "مركز تجريبي", "", ""]]);
    const { operationId, plan } = await prev(opA, f);
    expect([2, 4].map((l) => disp(plan, "personnel", l).disposition)).toEqual(["MATCHED", "MATCHED"]);
    expect(disp(plan, "personnel", 3).disposition).toBe("HELD");
    expect(disp(plan, "personnel", 5).disposition).toBe("READY");
    expect([2, 3, 4].map((l) => disp(plan, "accounts", l).disposition)).toEqual(["READY", "READY", "READY"]);
    expect(plan.counts).toMatchObject({ readyPersonnel: 1, readyAccounts: 3, readyMemberships: 2 });
    expect(await confirmImport(db, opA, operationId, plan.planSha256)).toMatchObject({ status: "APPLIED", applied: 6 });

    expect(await db.employee.count()).toBe(before + 1); // only the genuinely new person
    const r1 = await db.employee.findFirstOrThrow({ where: { name: "مقيم سابق أول" }, include: { user: { include: { centerMemberships: true } } } });
    expect(r1.phone).toBeNull(); // existing record untouched
    expect(r1.user).toMatchObject({ username: "prev.res.one", role: "RESIDENT", isActive: false, needsActivation: true, email: "x@example.test" });
    expect(r1.user!.centerMemberships.map((m) => m.role)).toEqual(["RESIDENT"]);
    const r2 = await db.employee.findFirstOrThrow({ where: { name: "مقيم سابق ثان" } });
    expect(r2.job).toBe("طبيب تدرج"); expect(r2.userId).toBeNull(); // held row changed nothing
    const r4 = await db.employee.findFirstOrThrow({ where: { name: "مقيم سابق رابع جديد" }, include: { user: true } });
    expect(r4).toMatchObject({ department: null, specialty: null, capacity: null, phone: null }); // blank optional fields are not fabricated
    expect(r4.user!.isActive).toBe(false);
    expect(await db.employee.count({ where: { name: { startsWith: "مقيم سابق" } } })).toBe(4);
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });

  it("the filled official template applies safely end to end on the disposable database", async () => {
    process.env.DATA_CENTER_APPLY_ENABLED = "true";
    const refs = await loadReferences(db);
    const wb = parseUpload(buildTemplate("staff", "xlsx", refs, { databaseName: dbName })!.bytes, "t.xlsx");
    const fill = (name: string, rows: string[][]) => ({ name, rows: [...wb.sheets.find((x) => x.name === name)!.rows, ...rows] });
    const bytes = lib.writeXlsx([
      fill("الأشخاص", [["T1", "طبيب اختصاص من القالب", SPEC, "", "جراحة", "", "", ""], ["T2", "موظف من القالب", EMP, "", "", "", "", ""]]),
      fill("الحسابات", [["T1", "tpl.spec", "", "", ""]]), fill("العضويات", [["T1", "مركز تجريبي", "", ""]]),
      { name: "تعليمات", rows: wb.sheets.find((x) => x.name === "تعليمات")!.rows },
    ]) as Buffer;
    const { operationId, plan } = await prev(opA, bytes);
    expect(plan.counts).toMatchObject({ ready: 4, invalid: 0, held: 0 });
    expect((await confirmImport(db, opA, operationId, plan.planSha256)).applied).toBe(4);
    const e = await db.employee.findFirstOrThrow({ where: { name: "طبيب اختصاص من القالب" }, include: { user: { include: { centerMemberships: true } } } });
    expect(e.user).toMatchObject({ role: "DOCTOR", isActive: false });
    expect(e.user!.centerMemberships.map((m) => m.role)).toEqual(["SPECIALIST"]);
    process.env.DATA_CENTER_APPLY_ENABLED = "";
  });
});
