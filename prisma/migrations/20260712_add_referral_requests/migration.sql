-- CreateEnum
CREATE TYPE "ReferralRequestType" AS ENUM ('LAB', 'RADIOLOGY', 'IMAGING', 'SPECIALIST', 'TREATMENT_CENTER', 'HOSPITAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ReferralDestinationScope" AS ENUM ('INTERNAL_SPECIALIST', 'INTERNAL_CENTER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ReferralRequestStatus" AS ENUM ('DRAFT', 'PENDING_PRINT', 'READY', 'SENT', 'RESULT_RECEIVED', 'REVIEWED', 'ACCEPTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "referral_requests" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "residentReviewId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedReviewerId" TEXT,
    "destinationCenterId" INTEGER,
    "type" "ReferralRequestType" NOT NULL,
    "destinationScope" "ReferralDestinationScope" NOT NULL,
    "externalEntity" TEXT,
    "requestedService" TEXT NOT NULL,
    "clinicalReason" TEXT NOT NULL,
    "status" "ReferralRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedById" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "officialDocumentId" TEXT,
    "careStageId" TEXT,
    "resultSummary" TEXT,
    "resultAttachmentUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "resultReceivedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "cancellationReason" TEXT,
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_requests_officialDocumentId_key" ON "referral_requests"("officialDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_requests_careStageId_key" ON "referral_requests"("careStageId");

-- CreateIndex
CREATE INDEX "referral_requests_patientId_createdAt_idx" ON "referral_requests"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "referral_requests_status_createdAt_idx" ON "referral_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "referral_requests_destinationScope_status_idx" ON "referral_requests"("destinationScope", "status");

-- CreateIndex
CREATE INDEX "referral_requests_createdById_createdAt_idx" ON "referral_requests"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "referral_requests_assignedReviewerId_status_idx" ON "referral_requests"("assignedReviewerId", "status");

-- CreateIndex
CREATE INDEX "referral_requests_destinationCenterId_status_idx" ON "referral_requests"("destinationCenterId", "status");

-- CreateIndex
CREATE INDEX "referral_requests_residentReviewId_idx" ON "referral_requests"("residentReviewId");

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_residentReviewId_fkey" FOREIGN KEY ("residentReviewId") REFERENCES "resident_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_assignedReviewerId_fkey" FOREIGN KEY ("assignedReviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_destinationCenterId_fkey" FOREIGN KEY ("destinationCenterId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_officialDocumentId_fkey" FOREIGN KEY ("officialDocumentId") REFERENCES "OfficialDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_careStageId_fkey" FOREIGN KEY ("careStageId") REFERENCES "CareStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
