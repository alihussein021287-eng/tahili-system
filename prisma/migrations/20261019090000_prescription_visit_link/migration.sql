-- Explicit prescription -> visit association (owner decision 2026-10). Additive and nullable: existing prescriptions keep
-- visitId NULL (preserved, fail-closed for dispensing, no guessed backfill).
ALTER TABLE "visits" ADD CONSTRAINT "visits_id_patientId_key" UNIQUE ("id", "patientId");
ALTER TABLE "prescriptions" ADD COLUMN "visitId" TEXT;
CREATE INDEX "prescriptions_visitId_idx" ON "prescriptions"("visitId");
-- Composite FK: the visit must belong to the SAME patient as the prescription (MATCH SIMPLE: not enforced while visitId is NULL).
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_visitId_patientId_fkey" FOREIGN KEY ("visitId", "patientId") REFERENCES "visits"("id", "patientId") ON DELETE NO ACTION ON UPDATE CASCADE;
