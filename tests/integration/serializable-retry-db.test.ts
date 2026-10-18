import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { withSerializableRetry } from "@/lib/serializable-retry";

// Rehearsal database only. Proves a retried Serializable transaction leaves no duplicate rows, audits or notices.
const prisma = new PrismaClient();
const tag = `m085r-${randomUUID().slice(0, 8)}`;
let patientId = "";

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  patientId = (await prisma.patient.create({ data: { fullName: `${tag} patient` } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

const conflict = () => Object.assign(new Error("write conflict"), { code: "P2034" });

async function writeUnit(tx: any, label: string) {
  const task = await tx.task.create({ data: { title: `${tag} ${label}`, patientId } });
  await tx.notification.create({ data: { targetRole: "DOCTOR", title: `${tag} ${label}`, link: `/patients/${patientId}` } });
  await tx.auditLog.create({ data: { action: "CREATE", tableName: "tasks", recordId: task.id } });
  return task.id as string;
}
const counts = async (label: string) => ({
  tasks: await prisma.task.count({ where: { title: `${tag} ${label}` } }),
  notices: await prisma.notification.count({ where: { title: `${tag} ${label}` } }),
});

describe("bounded Serializable retry (database)", () => {
  it("a conflict after the writes rolls everything back; the retry commits exactly one set", async () => {
    let attempts = 0;
    await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      attempts += 1;
      await writeUnit(tx, "retry-once");
      if (attempts === 1) throw conflict();
    }, { isolationLevel: "Serializable" }));
    expect(attempts).toBe(2);
    expect(await counts("retry-once")).toEqual({ tasks: 1, notices: 1 });
  });

  it("exhausted retries surface the conflict and leave no partial rows", async () => {
    let attempts = 0;
    await expect(withSerializableRetry(() => prisma.$transaction(async (tx) => {
      attempts += 1;
      await writeUnit(tx, "exhausted");
      throw conflict();
    }, { isolationLevel: "Serializable" }), 2)).rejects.toMatchObject({ code: "P2034" });
    expect(attempts).toBe(3);
    expect(await counts("exhausted")).toEqual({ tasks: 0, notices: 0 });
  });

  it("a non-conflict error is never retried and writes nothing", async () => {
    let attempts = 0;
    await expect(withSerializableRetry(() => prisma.$transaction(async (tx) => {
      attempts += 1;
      await writeUnit(tx, "denied");
      throw new Error("غير مصرح");
    }, { isolationLevel: "Serializable" }))).rejects.toThrow("غير مصرح");
    expect(attempts).toBe(1);
    expect(await counts("denied")).toEqual({ tasks: 0, notices: 0 });
  });

  it("two truly concurrent writers of the same unique key end with one row and one winner", async () => {
    const key = `${tag}-race`;
    const run = () => withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const existing = await tx.task.findFirst({ where: { title: key } });
      if (existing) return "exists";
      await tx.task.create({ data: { title: key, patientId } });
      return "created";
    }, { isolationLevel: "Serializable" }), 5);
    const results = await Promise.all([run(), run(), run(), run()]);
    expect(results.filter((r) => r === "created").length).toBe(1);
    expect(await prisma.task.count({ where: { title: key } })).toBe(1);
  });
});
