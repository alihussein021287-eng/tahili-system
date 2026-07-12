CREATE TYPE "TherapySessionStatus" AS ENUM ('SCHEDULED', 'ATTENDED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "TherapyProgramDecision" AS ENUM ('EXTEND', 'END');

ALTER TABLE "TreatmentPlan"
  ADD COLUMN "expectedEndDate" TIMESTAMP(3),
  ADD COLUMN "therapyType" "TherapyType",
  ADD COLUMN "weekdays" TEXT,
  ADD COLUMN "sessionTime" TEXT,
  ADD COLUMN "hallId" INTEGER,
  ADD COLUMN "therapistId" TEXT,
  ADD COLUMN "referralRequestId" TEXT,
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "beforeCondition" TEXT,
  ADD COLUMN "afterCondition" TEXT,
  ADD COLUMN "improvementLevel" TEXT,
  ADD COLUMN "achievedGoals" TEXT,
  ADD COLUMN "finalRecommendation" TEXT,
  ADD COLUMN "finalDecision" "TherapyProgramDecision",
  ADD COLUMN "evaluatedAt" TIMESTAMP(3),
  ADD COLUMN "evaluatedById" TEXT,
  ADD COLUMN "followUpAppointmentId" TEXT;

ALTER TABLE "therapy_sessions"
  ADD COLUMN "treatmentPlanId" TEXT,
  ADD COLUMN "therapistId" TEXT,
  ADD COLUMN "hallId" INTEGER;

ALTER TABLE "appointments" ADD COLUMN "assignedToId" TEXT;

ALTER TABLE "therapy_session_logs"
  ADD COLUMN "attended" BOOLEAN,
  ADD COLUMN "progress" TEXT,
  ADD COLUMN "status" "TherapySessionStatus",
  ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "TreatmentPlan_referralRequestId_key" ON "TreatmentPlan"("referralRequestId");
CREATE INDEX "TreatmentPlan_therapistId_status_idx" ON "TreatmentPlan"("therapistId", "status");
CREATE INDEX "TreatmentPlan_hallId_status_idx" ON "TreatmentPlan"("hallId", "status");
CREATE INDEX "therapy_sessions_treatmentPlanId_idx" ON "therapy_sessions"("treatmentPlanId");
CREATE INDEX "therapy_sessions_therapistId_idx" ON "therapy_sessions"("therapistId");
CREATE INDEX "appointments_assignedToId_scheduledAt_idx" ON "appointments"("assignedToId", "scheduledAt");

ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "therapy_halls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_referralRequestId_fkey" FOREIGN KEY ("referralRequestId") REFERENCES "referral_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_followUpAppointmentId_fkey" FOREIGN KEY ("followUpAppointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "therapy_halls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
