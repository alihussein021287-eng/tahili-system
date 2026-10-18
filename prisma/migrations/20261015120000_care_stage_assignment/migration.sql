-- Individual stage assignment and an explicit stage reference on handoffs. Additive; no backfill
-- (no stored relationship proves historical assignment).
ALTER TABLE "CareStage"
  ADD COLUMN "assignedUserId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3);

ALTER TABLE "patient_handoffs" ADD COLUMN "careStageId" TEXT;

CREATE INDEX "CareStage_assignedUserId_status_idx" ON "CareStage"("assignedUserId", "status");
CREATE INDEX "patient_handoffs_careStageId_idx" ON "patient_handoffs"("careStageId");

ALTER TABLE "CareStage"
  ADD CONSTRAINT "CareStage_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "patient_handoffs"
  ADD CONSTRAINT "patient_handoffs_careStageId_fkey"
  FOREIGN KEY ("careStageId") REFERENCES "CareStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
