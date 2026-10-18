-- Data Management Center (additive): operation history, row dispositions (no personal data), import provenance columns.
CREATE TYPE "DataOperationKind" AS ENUM ('IMPORT', 'EXPORT');
CREATE TYPE "DataOperationStatus" AS ENUM ('PREVIEWED', 'APPLYING', 'APPLIED', 'PARTIAL', 'FAILED', 'CANCELLED', 'COMPLETED', 'DENIED');

CREATE TABLE "data_operations" (
  "id" TEXT NOT NULL,
  "kind" "DataOperationKind" NOT NULL,
  "domain" TEXT NOT NULL,
  "status" "DataOperationStatus" NOT NULL,
  "branchId" INTEGER,
  "actorId" TEXT NOT NULL,
  "templateVersion" TEXT,
  "format" TEXT,
  "fileName" TEXT,
  "fileSha256" TEXT,
  "fileBytes" BYTEA,
  "planSha256" TEXT,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "counts" JSONB,
  "scope" JSONB,
  "error" TEXT,
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_operations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "data_operations_actorId_createdAt_idx" ON "data_operations"("actorId", "createdAt");
CREATE INDEX "data_operations_domain_branchId_fileSha256_idx" ON "data_operations"("domain", "branchId", "fileSha256");
CREATE INDEX "data_operations_kind_status_idx" ON "data_operations"("kind", "status");
ALTER TABLE "data_operations" ADD CONSTRAINT "data_operations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_operations" ADD CONSTRAINT "data_operations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "data_operation_rows" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "reasons" TEXT,
  "fieldErrors" JSONB,
  "resultRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_operation_rows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "data_operation_rows_operationId_rowNumber_idx" ON "data_operation_rows"("operationId", "rowNumber");
ALTER TABLE "data_operation_rows" ADD CONSTRAINT "data_operation_rows_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "data_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patients" ADD COLUMN "legacyFileNumber" TEXT, ADD COLUMN "importSourceKey" TEXT;
CREATE UNIQUE INDEX "patients_importSourceKey_key" ON "patients"("importSourceKey");

ALTER TABLE "Employee" ADD COLUMN "category" TEXT, ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
