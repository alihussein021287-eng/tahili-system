ALTER TABLE "TreatmentPlan"
  ADD COLUMN "treatmentDays" INTEGER,
  ADD COLUMN "centerId" INTEGER,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "specialistDoctorId" TEXT,
  ADD COLUMN "reviewEverySessions" INTEGER,
  ADD COLUMN "reviewEveryDays" INTEGER,
  ADD COLUMN "finalRecoveryPercent" INTEGER;

ALTER TABLE "TreatmentPlan"
  ADD CONSTRAINT "TreatmentPlan_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TreatmentPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TreatmentPlan_specialistDoctorId_fkey" FOREIGN KEY ("specialistDoctorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TreatmentPlan_treatmentDays_check" CHECK ("treatmentDays" IS NULL OR "treatmentDays" > 0),
  ADD CONSTRAINT "TreatmentPlan_review_interval_check" CHECK (("reviewEverySessions" IS NULL OR "reviewEverySessions" > 0) AND ("reviewEveryDays" IS NULL OR "reviewEveryDays" > 0)),
  ADD CONSTRAINT "TreatmentPlan_final_recovery_check" CHECK ("finalRecoveryPercent" IS NULL OR ("finalRecoveryPercent" BETWEEN 0 AND 100));

CREATE INDEX "TreatmentPlan_centerId_status_idx" ON "TreatmentPlan"("centerId", "status");
CREATE INDEX "TreatmentPlan_specialistDoctorId_idx" ON "TreatmentPlan"("specialistDoctorId");

CREATE TABLE "therapy_periodic_evaluations" (
  "id" TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "currentCondition" TEXT NOT NULL,
  "achievedProgress" TEXT NOT NULL,
  "obstacles" TEXT,
  "recommendations" TEXT,
  "decision" TEXT NOT NULL,
  "recoveryPercent" INTEGER NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "therapy_periodic_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "therapy_periodic_evaluations_recovery_check" CHECK ("recoveryPercent" BETWEEN 0 AND 100),
  CONSTRAINT "therapy_periodic_evaluations_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "therapy_periodic_evaluations_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "therapy_periodic_evaluations_treatmentPlanId_evaluatedAt_idx" ON "therapy_periodic_evaluations"("treatmentPlanId", "evaluatedAt");
