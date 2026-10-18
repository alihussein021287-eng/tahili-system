// @vitest-environment node
// Mission 09.3 — personnel records, counts, scope, account linking/staging. Synthetic data on a DISPOSABLE database only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { attendanceRequired, confirmLink, EmployeeDenied, getEmployee, listEmployees, proposeLink, roleMappingGroups, stageAccount, staffCounts, suggestRole, updateEmployee, type EmployeeActor } from "@/lib/employees/service";

const base = process.env.DATABASE_URL ?? "";
const dbName = `tahili_emp_${randomUUID().slice(0, 8)}`;
const urlFor = (n: string) => base.replace(/\/[^/?]+(\?|$)/, `/${n}$1`);
let db: PrismaClient;
let A = 0, B = 0, centerId = 0, inactiveCenterId = 0;
let admin: EmployeeActor, viewerA: EmployeeActor, editorA: EmployeeActor, viewerB: EmployeeActor, nonAdminWithManage: EmployeeActor;
const actor = (userId: string, role: string, branchId: number | null, perms: string[]): EmployeeActor => ({ userId, role, branchId, permissions: new Set(perms) });
const mkUser = async (username: string, role: string, branchId: number | null, fullName = username) => (await db.user.create({ data: { username, fullName, role: role as never, branchId, passwordHash: "!" } })).id;
const emp = (name: string, extra: Record<string, unknown> = {}) => db.employee.create({ data: { name, ...extra } as never });
const rejects = async (p: Promise<unknown>, code: string) => { await expect(p).rejects.toMatchObject({ code }); };

beforeAll(async () => {
  expect(base).toMatch(/127\.0\.0\.1:55432/);
  const root = new PrismaClient();
  await root.$executeRawUnsafe(`CREATE DATABASE ${dbName}`);
  await root.$disconnect();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: urlFor(dbName) }, stdio: "pipe" });
  db = new PrismaClient({ datasources: { db: { url: urlFor(dbName) } } });
  A = (await db.branch.create({ data: { name: "فرع تجريبي أ" } })).id;
  B = (await db.branch.create({ data: { name: "فرع تجريبي ب" } })).id;
  centerId = (await db.center.create({ data: { name: "مركز تجريبي" } })).id;
  inactiveCenterId = (await db.center.create({ data: { name: "مركز معطل", active: false } })).id;
  const adminId = await mkUser("emp-admin", "ADMIN", null);
  admin = actor(adminId, "ADMIN", null, ["employees.view", "employees.edit", "users.manage", "users.view"]);
  viewerA = actor(await mkUser("emp-viewer-a", "SECRETARY", A), "SECRETARY", A, ["employees.view"]);
  editorA = actor(await mkUser("emp-editor-a", "MANAGER", A), "MANAGER", A, ["employees.view", "employees.edit", "users.manage"]);
  viewerB = actor(await mkUser("emp-viewer-b", "SECRETARY", B), "SECRETARY", B, ["employees.view", "employees.edit"]);
  nonAdminWithManage = editorA;
  // Six imported-style residents in branch A, two specialists, three other employees (one legacy row without a category).
  for (let i = 1; i <= 6; i++) await emp(`طبيب مقيم تجريبي ${i}`, { category: "RESIDENT", job: i === 1 ? "طبيب مقيم اقدم" : "طبيب تدرج", sourceKey: `abcd1234:r${i}`, branchId: A });
  for (let i = 1; i <= 2; i++) await emp(`طبيب اختصاص تجريبي ${i}`, { category: "SPECIALIST", specialty: "عظام", branchId: A, sourceKey: `abcd1234:s${i}` });
  await emp("موظف كافتيريا تجريبي", { category: "EMPLOYEE", job: "كافتيريا", department: "الخدمات", branchId: A });
  await emp("موظف قديم بلا فئة", { branchId: A });
  await emp("موظف فرع ب", { category: "EMPLOYEE", job: "إداري", branchId: B });
}, 180_000);
afterAll(async () => { await db?.$disconnect(); });

describe("counts and visibility", () => {
  it("shows the six resident records and keeps personnel, accounts and unlinked separate", async () => {
    const c = await staffCounts(db, admin);
    expect(c).toMatchObject({ personnel: 11, residents: 6, specialists: 2, others: 3, unlinked: 11 });
    expect(c.accounts).toBe(4); // user accounts are counted on their own
    // completion / account needs are distinct from account counts; a person is counted once
    expect(c).toMatchObject({ linked: 0, needsAccount: 8, needsMembership: 0 });
    expect(c.needsCompletion).toBe(11); // none of the fixtures has every optional detail
    expect(c.accountsByRole.reduce((n, r) => n + r.count, 0)).toBe(c.accounts);
    expect(c.othersByJob.reduce((n, r) => n + r.count, 0)).toBe(c.others);
    const list = await listEmployees(db, admin, { category: "RESIDENT" });
    expect(list.total).toBe(6);
    expect(list.rows.every((r) => r.userId === null)).toBe(true);
  });
  it("paginates, searches and filters by link status, department and branch", async () => {
    const p1 = await listEmployees(db, admin, { page: 1 });
    expect(p1.rows.length).toBe(11);
    expect((await listEmployees(db, admin, { q: "تجريبي 3" })).total).toBe(1);
    expect((await listEmployees(db, admin, { link: "linked" })).total).toBe(0);
    expect((await listEmployees(db, admin, { department: "الخدمات" })).total).toBe(1);
    expect((await listEmployees(db, admin, { branchId: B })).total).toBe(1);
    expect((await listEmployees(db, admin, { category: "NONE" })).total).toBe(1);
  });
  it("scopes non-admin actors to their own branch and requires the view permission", async () => {
    expect((await listEmployees(db, viewerA, {})).total).toBe(10);
    expect((await listEmployees(db, viewerB, {})).total).toBe(1);
    expect((await listEmployees(db, viewerA, { branchId: B })).total).toBe(10); // a forged branch filter does not widen or switch scope
    expect(await staffCounts(db, viewerB)).toMatchObject({ personnel: 1, residents: 0 });
    await rejects(listEmployees(db, actor("x", "SECRETARY", A, []), {}), "NO_PERMISSION");
    const other = await db.employee.findFirstOrThrow({ where: { branchId: B } });
    expect(await getEmployee(db, viewerA, other.id)).toBeNull();
    expect((await getEmployee(db, admin, other.id))?.name).toContain("فرع ب");
  });
});

describe("attendance obligation", () => {
  it("does not treat imported categories as automatically absent, but preserves the legacy roster rule", () => {
    expect(attendanceRequired({ attendanceRequired: null, category: "RESIDENT" })).toBe(false);
    expect(attendanceRequired({ attendanceRequired: null, category: "EMPLOYEE" })).toBe(false);
    expect(attendanceRequired({ attendanceRequired: null, category: null })).toBe(true);
    expect(attendanceRequired({ attendanceRequired: true, category: "RESIDENT" })).toBe(true);
    expect(attendanceRequired({ attendanceRequired: false, category: null })).toBe(false);
  });
});

describe("editing", () => {
  it("edits authorized fields, audits field names only, and never duplicates records", async () => {
    const target = await db.employee.findFirstOrThrow({ where: { name: "طبيب مقيم تجريبي 2" } });
    const before = await db.employee.count();
    expect((await updateEmployee(db, editorA, target.id, { department: "الباطنية", phone: "07700000099", attendanceRequired: "yes" })).changed.sort()).toEqual(["attendanceRequired", "department", "phone"]);
    expect((await updateEmployee(db, editorA, target.id, { department: "الباطنية" })).changed).toEqual([]); // repeat is a no-op
    expect(await db.employee.count()).toBe(before);
    const row = await db.employee.findUniqueOrThrow({ where: { id: target.id } });
    expect(row).toMatchObject({ department: "الباطنية", phone: "07700000099", attendanceRequired: true, sourceKey: "abcd1234:r2" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { tableName: "Employee", recordId: String(target.id), action: "UPDATE" } });
    expect(JSON.stringify(audit.newValue)).not.toContain("07700000099");
  });
  it("rejects bad input, cross-branch edits and edits without the permission", async () => {
    const a = await db.employee.findFirstOrThrow({ where: { name: "طبيب مقيم تجريبي 3" } });
    const b = await db.employee.findFirstOrThrow({ where: { branchId: B } });
    await rejects(updateEmployee(db, editorA, a.id, { phone: "123" }), "PHONE_INVALID");
    await rejects(updateEmployee(db, editorA, a.id, { name: "ab" }), "NAME_REQUIRED");
    await rejects(updateEmployee(db, viewerA, a.id, { job: "x" }), "NO_PERMISSION");
    await rejects(updateEmployee(db, editorA, b.id, { job: "x" }), "NOT_FOUND");
    await rejects(updateEmployee(db, viewerB, a.id, { job: "x" }), "NOT_FOUND");
    await rejects(updateEmployee(db, editorA, a.id, { branchId: B }), "BRANCH_FORBIDDEN");
    expect((await updateEmployee(db, admin, a.id, { notes: "ملاحظة" })).changed).toEqual(["notes"]);
  });
});

describe("role suggestions", () => {
  it("maps categories as decided, uses exact titles only, and leaves ambiguity unmapped", async () => {
    expect(suggestRole({ category: "RESIDENT", job: "x", department: null }).role).toBe("RESIDENT");
    expect(suggestRole({ category: "SPECIALIST", job: null, department: null }).role).toBe("DOCTOR");
    expect(suggestRole({ category: "EMPLOYEE", job: "صيدلي", department: null }).role).toBe("PHARMACIST");
    expect(suggestRole({ category: "EMPLOYEE", job: "كافتيريا", department: null }).role).toBeNull();
    expect(suggestRole({ category: "EMPLOYEE", job: "مدير المستشفى والمشرف الطبي", department: null })).toMatchObject({ role: null, basis: "review" });
    expect(suggestRole({ category: "EMPLOYEE", job: "صيدلي ومشرف", department: null }).role).toBeNull(); // free text never grants
    expect((await roleMappingGroups(db, admin)).length).toBeGreaterThan(3);
  });
});

describe("linking an existing account", () => {
  it("rejects unverified evidence and links only with exact identity, same branch and compatible role", async () => {
    const r1 = await db.employee.findFirstOrThrow({ where: { name: "طبيب مقيم تجريبي 4" } });
    await mkUser("res.other.name", "RESIDENT", A, "اسم مختلف تماما");
    await mkUser("res.wrong.branch", "RESIDENT", B, "طبيب مقيم تجريبي 4");
    await mkUser("res.wrong.role", "THERAPIST", A, "طبيب مقيم تجريبي 4");
    await mkUser("res.priv", "MANAGER", A, "طبيب مقيم تجريبي 4");
    for (const u of ["res.other.name", "res.wrong.branch", "res.wrong.role", "res.priv", "does.not.exist"]) {
      expect((await proposeLink(db, admin, r1.id, u)).ok, u).toBe(false);
      await rejects(confirmLink(db, admin, r1.id, u, "تحقق من الوثيقة"), "LINK_REJECTED");
    }
    await db.user.update({ where: { username: "res.other.name" }, data: { phone: (await db.employee.findUniqueOrThrow({ where: { id: r1.id } })).phone ?? "07700000001" } }); // same phone is not evidence
    await rejects(confirmLink(db, admin, r1.id, "res.other.name", "تحقق من الهاتف فقط"), "LINK_REJECTED");
    await mkUser("res.ok", "RESIDENT", A, "طبيب مقيم تجريبي 4");
    expect((await proposeLink(db, admin, r1.id, "res.ok")).ok).toBe(true);
    await rejects(confirmLink(db, admin, r1.id, "res.ok", "x"), "NOTE_REQUIRED");
    await confirmLink(db, admin, r1.id, "res.ok", "تحقق من هوية الطبيب بالمستمسك");
    expect((await db.employee.findUniqueOrThrow({ where: { id: r1.id } })).userId).not.toBeNull();
    expect(await db.employee.count({ where: { name: "طبيب مقيم تجريبي 4" } })).toBe(1);
    expect((await proposeLink(db, admin, r1.id, "res.ok")).ok).toBe(false); // employee already linked
    expect(await db.auditLog.count({ where: { action: "LINK", tableName: "Employee", recordId: String(r1.id) } })).toBe(1);
  });
  it("allows only one winner when two records race for the same account, and never links a taken account", async () => {
    const e1 = await emp("اسم مكرر للسباق", { category: "EMPLOYEE", job: "إداري", branchId: A });
    const e2 = await emp("اسم مكرر للسباق", { category: "EMPLOYEE", job: "مساعد", branchId: A });
    await mkUser("race.user", "RECEPTION", A, "اسم مكرر للسباق");
    const results = await Promise.allSettled([confirmLink(db, admin, e1.id, "race.user", "تحقق سباق 1"), confirmLink(db, admin, e2.id, "race.user", "تحقق سباق 2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.employee.count({ where: { user: { username: "race.user" } } })).toBe(1);
    const loser = (await db.employee.findMany({ where: { id: { in: [e1.id, e2.id] }, userId: null } }))[0];
    expect((await proposeLink(db, admin, loser.id, "race.user")).ok).toBe(false);
  });
  it("denies non-admin actors even when they hold employees.edit/users.manage", async () => {
    const e = await emp("سجل للاختبار الأمني", { category: "EMPLOYEE", branchId: A });
    await rejects(proposeLink(db, nonAdminWithManage, e.id, "res.ok"), "NO_ACCOUNT_PERMISSION");
    await rejects(confirmLink(db, nonAdminWithManage, e.id, "res.ok", "تحقق كاف"), "NO_ACCOUNT_PERMISSION");
    await rejects(stageAccount(db, nonAdminWithManage, e.id, { username: "sec.test", role: "RECEPTION" }), "NO_ACCOUNT_PERMISSION");
    expect(await db.auditLog.count({ where: { action: "DENIED", tableName: "Employee", recordId: String(e.id) } })).toBe(3);
  });
});

describe("staging an inactive account", () => {
  it("creates an inactive, unusable-credential account linked to the same record with a verified center membership", async () => {
    const r = await db.employee.findFirstOrThrow({ where: { name: "طبيب مقيم تجريبي 5" } });
    const before = await db.employee.count();
    const out = await stageAccount(db, admin, r.id, { username: "res.five", role: "RESIDENT", centerId });
    expect(out.membership).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { username: "res.five" }, include: { centerMemberships: true } });
    expect(u).toMatchObject({ isActive: false, needsActivation: true, role: "RESIDENT", branchId: A, fullName: r.name });
    expect(await bcrypt.compare("", u.passwordHash)).toBe(false);
    expect(u.centerMemberships).toHaveLength(1);
    expect(u.centerMemberships[0]).toMatchObject({ role: "RESIDENT", centerId, status: "ACTIVE" });
    expect(await db.employee.count()).toBe(before); // linked, not duplicated
    expect((await db.employee.findUniqueOrThrow({ where: { id: r.id } })).userId).toBe(u.id);
    await rejects(stageAccount(db, admin, r.id, { username: "res.five.b", role: "RESIDENT" }), "ALREADY_LINKED");
  });
  it("never grants silent access: no center means no membership and a warning; bad centers and roles are refused", async () => {
    const r6 = await db.employee.findFirstOrThrow({ where: { name: "طبيب مقيم تجريبي 6" } });
    await rejects(stageAccount(db, admin, r6.id, { username: "res.six", role: "RESIDENT", centerId: inactiveCenterId }), "CENTER_INVALID");
    await rejects(stageAccount(db, admin, r6.id, { username: "res.six", role: "THERAPIST" }), "ROLE_MISMATCH");
    await rejects(stageAccount(db, admin, r6.id, { username: "res.six", role: "ADMIN" }), "ROLE_NOT_ALLOWED");
    await rejects(stageAccount(db, admin, r6.id, { username: "res.six", role: "MANAGER" }), "ROLE_NOT_ALLOWED");
    await rejects(stageAccount(db, admin, r6.id, { username: "BAD NAME", role: "RESIDENT" }), "USERNAME_INVALID");
    await rejects(stageAccount(db, admin, r6.id, { username: "res.five", role: "RESIDENT" }), "USERNAME_TAKEN");
    expect((await db.employee.findUniqueOrThrow({ where: { id: r6.id } })).userId).toBeNull(); // failed attempts leave nothing behind
    const out = await stageAccount(db, admin, r6.id, { username: "res.six", role: "RESIDENT" });
    expect(out.membership).toBe(false);
    expect(out.warnings.join(" ")).toContain("عضوية");
    expect(await db.centerMembership.count({ where: { user: { username: "res.six" } } })).toBe(0);
  });
  it("supports specialists, needs a branch, and blocks look-alike duplicate accounts", async () => {
    const s = await db.employee.findFirstOrThrow({ where: { name: "طبيب اختصاص تجريبي 1" } });
    await rejects(stageAccount(db, admin, s.id, { username: "spec.one", role: "RESIDENT" }), "ROLE_MISMATCH");
    await stageAccount(db, admin, s.id, { username: "spec.one", role: "DOCTOR", centerId });
    expect((await db.user.findUniqueOrThrow({ where: { username: "spec.one" } })).role).toBe("DOCTOR");
    expect(await db.centerMembership.count({ where: { user: { username: "spec.one" }, role: "SPECIALIST" } })).toBe(1);
    const nb = await emp("سجل بلا فرع", { category: "EMPLOYEE" });
    await rejects(stageAccount(db, admin, nb.id, { username: "no.branch", role: "RECEPTION" }), "BRANCH_REQUIRED");
    const dup = await emp("طبيب مقيم تجريبي 4", { category: "EMPLOYEE", branchId: A }); // same name as an already linked account in the branch
    await rejects(stageAccount(db, admin, dup.id, { username: "dup.try", role: "RECEPTION" }), "POSSIBLE_DUPLICATE");
  });
  it("lets only one of two concurrent staging attempts for the same record succeed", async () => {
    const e = await emp("سجل للتنافس على الحساب", { category: "EMPLOYEE", branchId: A });
    const res = await Promise.allSettled([stageAccount(db, admin, e.id, { username: "conc.one", role: "RECEPTION" }), stageAccount(db, admin, e.id, { username: "conc.two", role: "RECEPTION" })]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { username: { in: ["conc.one", "conc.two"] } } })).toBe(1);
    expect(res.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof EmployeeDenied)).toBe(true);
  });
  it("never activates anything", async () => {
    expect(await db.user.count({ where: { username: { in: ["res.five", "res.six", "spec.one", "conc.one", "conc.two"] }, isActive: true } })).toBe(0);
  });
});

describe("migration backfill", () => {
  it("assigns a branch only from the import operation named by the source key", async () => {
    const op = await db.dataOperation.create({ data: { kind: "IMPORT", domain: "residents", status: "APPLIED", branchId: B, actorId: admin.userId } });
    const key = op.id.slice(-8);
    const e = await emp("سجل للتعبئة", { sourceKey: `${key}:k1` });
    const orphan = await emp("سجل بمفتاح غريب", { sourceKey: "zzzzzzzz:k1" });
    const sql = readFileSync("prisma/migrations/20261023090000_employee_management/migration.sql", "utf8").split("-- Provenance backfill")[1].replace(/^[^\n]*\n/, "");
    await db.$executeRawUnsafe(sql);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).branchId).toBe(B);
    expect((await db.employee.findUniqueOrThrow({ where: { id: orphan.id } })).branchId).toBeNull();
  });
});
