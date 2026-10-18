import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CenterMembershipRole, HandoffStatus, Prisma, UserRole } from "@prisma/client";
import { userCreateSchema } from "@/lib/validate";

const migration = readFileSync("prisma/migrations/20261009120000_patient_handoffs/migration.sql", "utf8");
const notificationMigration = readFileSync("prisma/migrations/20261013111500_link_notifications_to_handoffs/migration.sql", "utf8");
const notificationBackfillMigration = readFileSync("prisma/migrations/20261013113000_enrich_existing_handoff_notifications/migration.sql", "utf8");

describe("patient handoff additive migration", () => {
  it("generates the handoff model and enum values in Prisma Client", () => {
    expect(Prisma.dmmf.datamodel.models.some((model) => model.name === "PatientHandoff")).toBe(true);
    expect(HandoffStatus.SENT).toBe("SENT");
    expect(UserRole.SECRETARY).toBe("SECRETARY");
    expect([CenterMembershipRole.SECRETARY, CenterMembershipRole.RESIDENT, CenterMembershipRole.SPECIALIST]).toEqual([
      "SECRETARY", "RESIDENT", "SPECIALIST",
    ]);
    expect(userCreateSchema.safeParse({ username: "test.secretary", fullName: "نور الهدى عباس", role: "SECRETARY" }).success).toBe(true);
  });
  it("creates the handoff table and secretary enum value", () => {
    expect(migration).toContain('CREATE TABLE "patient_handoffs"');
    expect(migration).toContain("ADD VALUE 'SECRETARY'");
    expect(migration).toContain('CREATE TYPE "HandoffStatus"');
  });

  it("never drops, renames, or changes existing columns", () => {
    const statements = migration.replace(/--[^\n]*/g, "");
    expect(statements).not.toMatch(/\b(?:DROP|RENAME|ALTER\s+COLUMN|SET\s+DATA\s+TYPE)\b/i);
  });

  it("indexes receiving queues and cascades only with patient deletion", () => {
    expect(migration).toContain('"toCenterId", "status"');
    expect(migration).toContain('"toUserId", "status"');
    expect(migration).toContain('"patientId", "sentAt"');
    expect(migration).toMatch(/FOREIGN KEY \("patientId"\).*ON DELETE CASCADE/);
    expect(migration).toMatch(/FOREIGN KEY \("fromCenterId"\).*ON DELETE SET NULL/);
    expect(migration).toMatch(/FOREIGN KEY \("toCenterId"\).*ON DELETE SET NULL/);
  });

  it("links handoff notifications without deleting notification history", () => {
    const notification = Prisma.dmmf.datamodel.models.find((model) => model.name === "Notification");
    expect(notification?.fields.some((field) => field.name === "handoffId")).toBe(true);
    expect(notificationMigration).toContain('ADD COLUMN "handoffId" TEXT');
    expect(notificationMigration).toContain('"Notification_handoffId_read_idx"');
    expect(notificationMigration).toMatch(/FOREIGN KEY \("handoffId"\).*ON DELETE SET NULL/);
    expect(notificationMigration).not.toMatch(/\bDROP\b/i);
  });

  it("upgrades legacy handoff notice text with safe operational context", () => {
    expect(notificationBackfillMigration).toContain("المراجع:");
    expect(notificationBackfillMigration).toContain("الوجهة:");
    expect(notificationBackfillMigration).toContain("رقم التحويلة:");
    expect(notificationBackfillMigration).toContain('JOIN "patients"');
    expect(notificationBackfillMigration).not.toMatch(/\bDROP\b/i);
  });
});
