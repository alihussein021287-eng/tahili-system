-- Records the branch under which a queue entry was created. Used only when the patient has no branch.
-- Additive; no backfill (no stored relation proves the branch of historical entries).
ALTER TABLE "QueueEntry" ADD COLUMN "branchId" INTEGER;
CREATE INDEX "QueueEntry_branchId_createdAt_idx" ON "QueueEntry"("branchId", "createdAt");
ALTER TABLE "QueueEntry"
  ADD CONSTRAINT "QueueEntry_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
