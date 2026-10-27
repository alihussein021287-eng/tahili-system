-- AlterTable
ALTER TABLE "center_programs" ADD COLUMN     "medicalClosedAt" TIMESTAMP(3),
ADD COLUMN     "medicalClosedById" TEXT,
ADD COLUMN     "operationalCompletedAt" TIMESTAMP(3),
ADD COLUMN     "operationalCompletedById" TEXT,
ADD COLUMN     "operationalCompletionId" UUID;

-- CreateTable
CREATE TABLE "clinical_review_assignments" (
    "id" UUID NOT NULL,
    "careStageId" TEXT,
    "programId" TEXT,
    "reviewerId" TEXT NOT NULL,
    "nominatedById" TEXT NOT NULL,
    "nominatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "clinical_review_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_review_assignments_reviewerId_revokedAt_idx" ON "clinical_review_assignments"("reviewerId", "revokedAt");

-- CreateIndex
CREATE INDEX "clinical_review_assignments_careStageId_idx" ON "clinical_review_assignments"("careStageId");

-- CreateIndex
CREATE INDEX "clinical_review_assignments_programId_idx" ON "clinical_review_assignments"("programId");

-- AddForeignKey
ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_operationalCompletedById_fkey" FOREIGN KEY ("operationalCompletedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_medicalClosedById_fkey" FOREIGN KEY ("medicalClosedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_assignments" ADD CONSTRAINT "clinical_review_assignments_careStageId_fkey" FOREIGN KEY ("careStageId") REFERENCES "CareStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_assignments" ADD CONSTRAINT "clinical_review_assignments_programId_fkey" FOREIGN KEY ("programId") REFERENCES "center_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_assignments" ADD CONSTRAINT "clinical_review_assignments_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_assignments" ADD CONSTRAINT "clinical_review_assignments_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_assignments" ADD CONSTRAINT "clinical_review_assignments_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No legacy status or medical attribution is changed.
ALTER TABLE clinical_review_assignments ADD CONSTRAINT clinical_review_target CHECK (("careStageId" IS NULL) <> ("programId" IS NULL));
ALTER TABLE clinical_review_assignments ADD CONSTRAINT clinical_review_acceptance CHECK (("acceptedAt" IS NULL) = ("acceptedById" IS NULL) AND ("acceptedById" IS NULL OR "acceptedById" = "reviewerId"));
CREATE UNIQUE INDEX clinical_review_active_stage ON clinical_review_assignments ("careStageId") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX clinical_review_active_program ON clinical_review_assignments ("programId") WHERE "revokedAt" IS NULL;
ALTER TABLE center_programs ADD CONSTRAINT program_work_pair CHECK (("operationalCompletedAt" IS NULL) = ("operationalCompletedById" IS NULL) AND ("operationalCompletedAt" IS NULL) = ("operationalCompletionId" IS NULL));
ALTER TABLE center_programs ADD CONSTRAINT program_medical_pair CHECK (("medicalClosedAt" IS NULL) = ("medicalClosedById" IS NULL));
ALTER TABLE center_programs ADD CONSTRAINT program_new_medical_closure CHECK ("medicalClosedAt" IS NULL OR (status = 'COMPLETED' AND "operationalCompletedAt" IS NOT NULL AND "closedAt" IS NOT NULL AND "medicalClosedById" <> "operationalCompletedById"));
