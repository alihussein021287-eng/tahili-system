-- Forward-only: preserve every legacy value and do not infer medical approval.
ALTER TABLE "CareStage"
  ADD COLUMN "requiresPhysicianConfirmation" BOOLEAN,
  ADD COLUMN "operationalCompletedById" TEXT,
  ADD COLUMN "operationalCompletedAt" TIMESTAMP(3),
  ADD COLUMN "operationalCompletionId" UUID;
ALTER TABLE "CareStage" ADD CONSTRAINT "CareStage_operationalCompletedById_fkey"
  FOREIGN KEY ("operationalCompletedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareStage" ADD CONSTRAINT "CareStage_operational_completion_pair"
  CHECK (("operationalCompletedById" IS NULL) = ("operationalCompletedAt" IS NULL)
    AND ("operationalCompletedById" IS NULL) = ("operationalCompletionId" IS NULL));
ALTER TABLE "CareStage" ADD CONSTRAINT "CareStage_center_physician_completion"
  CHECK ("requiresPhysicianConfirmation" IS DISTINCT FROM TRUE
    OR "responsibilityScope" IS DISTINCT FROM 'CENTER'
    OR "status" <> 'CONFIRMED'
    OR ("operationalCompletedById" IS NOT NULL AND "operationalCompletedAt" IS NOT NULL
      AND "confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL
      AND "confirmedById" <> "operationalCompletedById"));
