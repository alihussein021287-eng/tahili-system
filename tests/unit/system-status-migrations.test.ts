import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("@/lib/backup", () => ({ getBackupOverview: () => ({ latestDb: null }) }));
import { prisma } from "@/lib/db";
import { getSystemStatus, migrationStatus } from "@/lib/system-status";

const date = new Date("2026-01-01T00:00:00Z");
const files = [{ name: "001_first", checksum: "first" }, { name: "002_second", checksum: "second" }];
const row = (name: string, checksum: string, finished_at: Date | null = date, rolled_back_at: Date | null = null) => ({ migration_name: name, checksum, finished_at, rolled_back_at });
const successful = [row("002_second", "second"), row("001_first", "first")];

afterEach(() => vi.restoreAllMocks());

describe("migration readiness reconciliation", () => {
  it("reports all successful migrations", () => {
    expect(migrationStatus(successful, files)).toMatchObject({ count: 2, latest: "002_second", pendingOrFailed: 0, unavailable: false });
  });
  it("does not flag historical rollback or its old checksum after successful application", () => {
    const history = [row("001_first", "old-content", null, date), ...successful];
    expect(migrationStatus(history, files)).toMatchObject({ count: 2, latest: "002_second", pendingOrFailed: 0, rolledBackCount: 1 });
  });
  it("detects an unresolved failure even when another attempt succeeded", () => {
    expect(migrationStatus([row("001_first", "first", null), ...successful], files)).toMatchObject({ pendingOrFailed: 1, unresolved: ["001_first"] });
  });
  it("detects a missing/pending migration", () => {
    expect(migrationStatus([successful[1]], files)).toMatchObject({ pendingOrFailed: 1, pending: ["002_second"] });
  });
  it("detects a successful checksum mismatch", () => {
    expect(migrationStatus([row("002_second", "modified"), successful[1]], files)).toMatchObject({ pendingOrFailed: 1, mismatched: ["002_second"] });
  });
  it("keeps rollback-only migrations pending and deduplicates unresolved issues", () => {
    const history = [row("002_second", "second", null, date), successful[1]];
    expect(migrationStatus(history, files)).toMatchObject({ count: 1, pendingOrFailed: 1, pending: ["002_second"] });
    expect(migrationStatus([row("002_second", "second", null), successful[1]], files).pendingOrFailed).toBe(1);
  });
  it("detects applied migrations absent from the release files", () => {
    expect(migrationStatus([...successful, row("003_unknown", "extra")], files)).toMatchObject({ pendingOrFailed: 1, unexpected: ["003_unknown"] });
  });
  it.each([[null, files], [successful, null], [successful, []]] as const)("fails closed when history or file inventory is unavailable", (records, inventory) => {
    expect(migrationStatus(records ? [...records] : null, inventory ? [...inventory] : null)).toMatchObject({ unavailable: true });
    expect(migrationStatus(records ? [...records] : null, inventory ? [...inventory] : null).pendingOrFailed).toBeGreaterThan(0);
  });
  it("loads real migration files/checksums into the system-status result", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tahili-migration-status-"));
    const migration = path.join(directory, "prisma", "migrations", "001_first");
    fs.mkdirSync(migration, { recursive: true });
    const sql = "-- synthetic migration fixture\nSELECT 1;\n";
    fs.writeFileSync(path.join(migration, "migration.sql"), sql);
    const checksum = createHash("sha256").update(sql).digest("hex");
    const query = vi.mocked(prisma.$queryRaw);
    query.mockResolvedValueOnce([row("001_first", checksum)]).mockResolvedValueOnce([{ size: 1n }]);
    vi.spyOn(process, "cwd").mockReturnValue(directory);
    try {
      expect((await getSystemStatus()).migrations).toMatchObject({ count: 1, pendingOrFailed: 0 });
      expect(String(query.mock.calls.at(-2)?.[0])).toContain("rolled_back_at");
    } finally {
      // Only this test's freshly created temporary fixture; no database is connected.
      expect(path.dirname(fs.realpathSync(directory))).toBe(fs.realpathSync(os.tmpdir()));
      expect(fs.lstatSync(directory).isSymbolicLink()).toBe(false);
      fs.rmSync(directory, { recursive: true });
    }
  });
});
