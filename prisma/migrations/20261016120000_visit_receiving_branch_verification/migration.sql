-- Receiving branch and identity-verification metadata for visits. Additive; no backfill
-- (historical visits keep a NULL branch and are handled conservatively by the application).
ALTER TABLE "visits"
  ADD COLUMN "branchId" INTEGER,
  ADD COLUMN "verifiedById" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verificationMethod" TEXT;

CREATE INDEX "visits_branchId_visitDate_idx" ON "visits"("branchId", "visitDate");

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "visits_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
