-- Explicit responsibility scope for care stages and a reliable stage link for work notifications.
-- Additive only. Existing rows stay unclassified (NULL) unless a stored relationship proves their scope.
CREATE TYPE "ResponsibilityScope" AS ENUM ('CENTER', 'SERVICE');

ALTER TABLE "CareStage"
  ADD COLUMN "responsibilityScope" "ResponsibilityScope",
  ADD COLUMN "responsibleCenterId" INTEGER;

ALTER TABLE "Notification"
  ADD COLUMN "careStageId" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- Stages created from an accepted internal-centre referral have a stored, reliable destination centre.
UPDATE "CareStage" AS stage
SET "responsibilityScope" = 'CENTER', "responsibleCenterId" = referral."destinationCenterId"
FROM "referral_requests" AS referral
WHERE referral."careStageId" = stage."id"
  AND referral."destinationScope" = 'INTERNAL_CENTER'
  AND referral."destinationCenterId" IS NOT NULL
  AND stage."responsibilityScope" IS NULL;

CREATE INDEX "CareStage_responsibleCenterId_idx" ON "CareStage"("responsibleCenterId");
CREATE INDEX "Notification_careStageId_resolvedAt_idx" ON "Notification"("careStageId", "resolvedAt");

ALTER TABLE "CareStage"
  ADD CONSTRAINT "CareStage_responsibleCenterId_fkey"
  FOREIGN KEY ("responsibleCenterId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_careStageId_fkey"
  FOREIGN KEY ("careStageId") REFERENCES "CareStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
