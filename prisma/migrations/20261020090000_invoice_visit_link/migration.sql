-- Optional explicit invoice -> visit association (owner decision: cross-branch service is billed by the visit's receiving branch).
-- Additive and nullable: existing invoices keep visitId NULL and follow the patient's home branch (no guessed backfill).
ALTER TABLE "Invoice" ADD COLUMN "visitId" TEXT;
CREATE INDEX "Invoice_visitId_idx" ON "Invoice"("visitId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_visitId_patientId_fkey" FOREIGN KEY ("visitId", "patientId") REFERENCES "visits"("id", "patientId") ON DELETE NO ACTION ON UPDATE CASCADE;
