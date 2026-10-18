-- Independent branch pharmacies (additive). Existing rows keep NULL = UNASSIGNED / requires reconciliation; nothing is
-- re-assigned, moved or re-counted here. A verified opening balance or an explicit reconciliation assigns an owner later.
ALTER TABLE "medication_batches" ADD COLUMN "branchId" INTEGER;
ALTER TABLE "stock_movements" ADD COLUMN "branchId" INTEGER, ADD COLUMN "actorId" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN "originBranchId" INTEGER, ADD COLUMN "dispensingBranchId" INTEGER;
ALTER TABLE "purchase_orders" ADD COLUMN "branchId" INTEGER;

CREATE INDEX "medication_batches_branchId_medicationId_idx" ON "medication_batches"("branchId", "medicationId");
CREATE INDEX "stock_movements_branchId_createdAt_idx" ON "stock_movements"("branchId", "createdAt");
CREATE INDEX "prescriptions_originBranchId_status_idx" ON "prescriptions"("originBranchId", "status");

ALTER TABLE "medication_batches" ADD CONSTRAINT "medication_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_originBranchId_fkey" FOREIGN KEY ("originBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_dispensingBranchId_fkey" FOREIGN KEY ("dispensingBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level invariant: a batch can never hold negative stock (conditional updates in the application rely on it too).
ALTER TABLE "medication_batches" ADD CONSTRAINT "medication_batches_quantity_non_negative" CHECK ("quantity" >= 0);
