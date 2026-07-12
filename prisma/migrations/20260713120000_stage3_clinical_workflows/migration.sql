CREATE TYPE "PrescriptionType" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "EligibilityDecision" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'DOCTOR_REVIEW');
CREATE TYPE "MedicalReportType" AS ENUM ('PRELIMINARY', 'FINAL');
CREATE TYPE "MedicalReportStatus" AS ENUM ('DRAFT', 'READY_TO_PRINT', 'PRINTED_APPROVED', 'CANCELLED');

ALTER TABLE "medical_reports"
  ADD COLUMN "doctorId" TEXT,
  ADD COLUMN "reportType" "MedicalReportType",
  ADD COLUMN "status" "MedicalReportStatus",
  ADD COLUMN "readyAt" TIMESTAMP(3),
  ADD COLUMN "printedAt" TIMESTAMP(3);

ALTER TABLE "prescriptions"
  ADD COLUMN "prescriptionType" "PrescriptionType",
  ADD COLUMN "eligibilityDecision" "EligibilityDecision",
  ADD COLUMN "eligibilityReason" TEXT,
  ADD COLUMN "eligibilityRecordedAt" TIMESTAMP(3),
  ADD COLUMN "createdById" TEXT;

CREATE TABLE "beds" (
  "id" SERIAL NOT NULL,
  "roomId" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "occupied" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "beds_roomId_label_key" ON "beds"("roomId", "label");
CREATE INDEX "beds_roomId_occupied_idx" ON "beds"("roomId", "occupied");
ALTER TABLE "beds" ADD CONSTRAINT "beds_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admissions"
  ADD COLUMN "bedId" INTEGER,
  ADD COLUMN "expectedDischargeDate" TIMESTAMP(3),
  ADD COLUMN "recommendingDoctor" TEXT,
  ADD COLUMN "admissionReason" TEXT;

CREATE INDEX "admissions_bedId_admissionDate_dischargeDate_idx" ON "admissions"("bedId", "admissionDate", "dischargeDate");
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "beds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
