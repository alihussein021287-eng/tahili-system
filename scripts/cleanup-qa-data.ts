import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const MARKER_PATTERN = "(^|[^[:alnum:]])(QA|ACCEPTANCE|prod-qa|e2e)([^[:alnum:]]|$)|test users created by acceptance";
const execute = process.argv.includes("--execute");

type CleanupSpec = {
  table: string;
  label: string;
  columns: string[];
  extraWhere?: string;
};

const SPECS: CleanupSpec[] = [
  { table: "users", label: "Users", columns: ["username", "fullName", "email", "phone", "jobTitle", "department", "note"], extraWhere: "\"role\" <> 'ADMIN'" },
  { table: "patients", label: "Patients", columns: ["fullName", "phone", "address", "notes", "barcode"] },
  { table: "appointments", label: "Appointments", columns: ["notes", "assignedTo"] },
  { table: "visits", label: "Visits", columns: ["notes"] },
  { table: "queue_entries", label: "Queue entries", columns: ["station", "notes"] },
  { table: "referral_requests", label: "Referral requests", columns: ["notes", "destinationName", "clinicalQuestion"] },
  { table: "prescriptions", label: "Prescriptions", columns: ["medicationName", "notes", "doctor"] },
  { table: "medical_reports", label: "Medical reports", columns: ["title", "summary", "recommendations"] },
  { table: "treatment_plans", label: "Treatment plans", columns: ["title", "goals", "notes"] },
  { table: "therapy_sessions", label: "Therapy sessions", columns: ["notes"] },
  { table: "therapy_session_logs", label: "Therapy logs", columns: ["notes", "progress"] },
  { table: "center_programs", label: "Center programs", columns: ["goals", "initialSummary", "finalSummary"] },
  { table: "center_sessions", label: "Center sessions", columns: ["notes"] },
  { table: "wounded_expenses", label: "Wounded expenses", columns: ["expenseType", "description", "beneficiaryEntity", "note"] },
  { table: "invoices", label: "Invoices", columns: ["description", "currency"] },
  { table: "payments", label: "Payments", columns: ["method", "note"] },
  { table: "tasks", label: "Tasks", columns: ["title", "description"] },
  { table: "conversations", label: "Conversations", columns: ["title"] },
  { table: "messages", label: "Messages", columns: ["body"] },
  { table: "folders", label: "Collaboration folders", columns: ["name"] },
  { table: "collaboration_files", label: "Collaboration files", columns: ["displayName", "description", "objectKey"] },
  { table: "official_documents", label: "Official documents", columns: ["number", "subject", "entity", "notes"] },
  { table: "approval_requests", label: "Approval requests", columns: ["title", "description", "note"] },
  { table: "attendance", label: "Attendance", columns: ["name", "note"] },
  { table: "shifts", label: "Shifts", columns: ["name", "note"] },
  { table: "leaves", label: "Leaves", columns: ["name", "reason"] },
  { table: "devices", label: "Devices", columns: ["name", "serial", "notes"] },
];

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function configureDatabaseUrl() {
  loadEnvFile();
  if (process.env.DATABASE_URL) {
    if (process.env.DATABASE_URL.includes("@postgres:")) {
      process.env.DATABASE_URL = process.env.DATABASE_URL.replace("@postgres:", "@127.0.0.1:");
    }
    return;
  }

  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const name = process.env.DB_NAME;
  if (user && password && name) {
    process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:5432/${encodeURIComponent(name)}`;
  }
}

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function markerWhere(spec: CleanupSpec) {
  const parts = spec.columns.map((column) => `${quoteIdent(column)}::text ~* $1`);
  const marker = `(${parts.join(" OR ")})`;
  return spec.extraWhere ? `(${marker}) AND (${spec.extraWhere})` : marker;
}

function idList(ids: string[]) {
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
}

async function tableExists(prisma: PrismaClient, table: string) {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS exists",
    table,
  );
  return rows[0]?.exists === true;
}

async function existingColumns(prisma: PrismaClient, table: string, columns: string[]) {
  const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    table,
  );
  const available = new Set(rows.map((row) => row.column_name));
  return columns.filter((column) => available.has(column));
}

async function inboundRefs(prisma: PrismaClient, table: string) {
  return prisma.$queryRawUnsafe<{ source_table: string; source_column: string }[]>(
    `
    SELECT source.relname AS source_table, source_col.attname AS source_column
    FROM pg_constraint c
    JOIN pg_class target ON target.oid = c.confrelid
    JOIN pg_class source ON source.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = target.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY AS source_key(attnum, ord) ON true
    JOIN pg_attribute source_col ON source_col.attrelid = source.oid AND source_col.attnum = source_key.attnum
    WHERE c.contype = 'f'
      AND ns.nspname = 'public'
      AND target.relname = $1
    `,
    table,
  );
}

async function referencedCount(prisma: PrismaClient, ref: { source_table: string; source_column: string }, ids: string[]) {
  if (ids.length === 0) return 0;
  const sql = `SELECT COUNT(*)::int AS count FROM ${quoteIdent(ref.source_table)} WHERE ${quoteIdent(ref.source_column)}::text = ANY(ARRAY[${idList(ids)}]::text[])`;
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(sql);
  return rows[0]?.count ?? 0;
}

async function countCandidates(prisma: PrismaClient, spec: CleanupSpec, columns: string[]) {
  const where = markerWhere({ ...spec, columns });
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count FROM ${quoteIdent(spec.table)} WHERE ${where}`,
    MARKER_PATTERN,
  );
  return rows[0]?.count ?? 0;
}

async function candidateIds(prisma: PrismaClient, spec: CleanupSpec, columns: string[]) {
  const where = markerWhere({ ...spec, columns });
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text AS id FROM ${quoteIdent(spec.table)} WHERE ${where} ORDER BY id::text LIMIT 1000`,
    MARKER_PATTERN,
  );
  return rows.map((row) => row.id);
}

async function deleteIds(prisma: PrismaClient, table: string, ids: string[]) {
  if (ids.length === 0) return 0;
  const sql = `DELETE FROM ${quoteIdent(table)} WHERE id::text = ANY(ARRAY[${idList(ids)}]::text[])`;
  return prisma.$executeRawUnsafe(sql);
}

async function main() {
  configureDatabaseUrl();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured. Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_NAME in .env.");
  }

  const prisma = new PrismaClient();
  const rows: {
    label: string;
    table: string;
    before: number;
    after: number;
    deleted: number;
    blocked: number;
    note: string;
  }[] = [];

  try {
    for (const spec of SPECS) {
      if (!(await tableExists(prisma, spec.table))) continue;
      const columns = await existingColumns(prisma, spec.table, spec.columns);
      if (columns.length === 0) continue;

      const before = await countCandidates(prisma, spec, columns);
      let deleted = 0;
      let blocked = 0;
      let note = before > 0 ? "dry-run only" : "no marked rows";

      if (before > 0) {
        const ids = await candidateIds(prisma, spec, columns);
        const refs = await inboundRefs(prisma, spec.table);
        const totalRefs = await refs.reduce<Promise<number>>(async (sumPromise, ref) => {
          const sum = await sumPromise;
          return sum + await referencedCount(prisma, ref, ids);
        }, Promise.resolve(0));
        blocked = totalRefs > 0 ? ids.length : 0;
        if (execute && blocked === 0) {
          deleted = await deleteIds(prisma, spec.table, ids);
          note = ids.length >= 1000 ? "deleted first 1000 candidates; rerun required" : "deleted unreferenced marked rows";
        } else if (execute && blocked > 0) {
          note = "blocked by related records; inspect manually before deleting";
        }
      }

      const after = execute ? await countCandidates(prisma, spec, columns) : before;
      rows.push({ label: spec.label, table: spec.table, before, after, deleted, blocked, note });
    }

    console.log(execute ? "QA cleanup execute mode" : "QA cleanup dry-run mode");
    console.log("Only rows with explicit QA/ACCEPTANCE/prod-qa/e2e markers are considered. Admin users are excluded.");
    console.table(rows.filter((row) => row.before > 0 || row.deleted > 0 || row.blocked > 0));
    if (!execute) {
      console.log("No data changed. To execute: npm exec tsx scripts/cleanup-qa-data.ts -- --execute");
    } else if (rows.some((row) => row.blocked > 0)) {
      console.log("Some marked records were blocked because related records exist. Do not force-delete without a reviewed plan.");
    }
    console.log("MinIO objects were not touched.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
