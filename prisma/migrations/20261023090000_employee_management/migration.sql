-- Mission 09.3: personnel management. Additive only (nullable columns, one index, one FK).
ALTER TABLE "Employee" ADD COLUMN "branchId" INTEGER, ADD COLUMN "phone" TEXT, ADD COLUMN "notes" TEXT, ADD COLUMN "attendanceRequired" BOOLEAN;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_branchId_category_idx" ON "Employee"("branchId", "category");
-- Provenance backfill: employees created by a Data Center import carry sourceKey "<last 8 chars of operation id>:<row key>"; take that operation's branch (never guessed otherwise).
UPDATE "Employee" e SET "branchId" = o."branchId"
FROM "data_operations" o
WHERE e."branchId" IS NULL AND e."sourceKey" IS NOT NULL AND o."kind" = 'IMPORT' AND o."branchId" IS NOT NULL
  AND right(o."id", 8) = split_part(e."sourceKey", ':', 1)
  AND (SELECT count(*) FROM "data_operations" x WHERE right(x."id", 8) = split_part(e."sourceKey", ':', 1)) = 1;
