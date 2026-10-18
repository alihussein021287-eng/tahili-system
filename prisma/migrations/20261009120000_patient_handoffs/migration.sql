-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('SENT', 'ACCEPTED', 'DONE', 'RETURNED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SECRETARY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CenterMembershipRole" ADD VALUE 'SECRETARY';
ALTER TYPE "CenterMembershipRole" ADD VALUE 'RESIDENT';
ALTER TYPE "CenterMembershipRole" ADD VALUE 'SPECIALIST';

-- CreateTable
CREATE TABLE "patient_handoffs" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromRole" "UserRole" NOT NULL,
    "fromCenterId" INTEGER,
    "toCenterId" INTEGER,
    "toRole" "UserRole" NOT NULL,
    "toUserId" TEXT,
    "status" "HandoffStatus" NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "returnReason" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "doneAt" TIMESTAMP(3),
    "previousHandoffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_handoffs_toCenterId_status_idx" ON "patient_handoffs"("toCenterId", "status");

-- CreateIndex
CREATE INDEX "patient_handoffs_fromCenterId_idx" ON "patient_handoffs"("fromCenterId");

-- CreateIndex
CREATE INDEX "patient_handoffs_toUserId_status_idx" ON "patient_handoffs"("toUserId", "status");

-- CreateIndex
CREATE INDEX "patient_handoffs_patientId_sentAt_idx" ON "patient_handoffs"("patientId", "sentAt");

-- CreateIndex
CREATE INDEX "patient_handoffs_fromUserId_idx" ON "patient_handoffs"("fromUserId");

-- CreateIndex
CREATE INDEX "patient_handoffs_acceptedById_idx" ON "patient_handoffs"("acceptedById");

-- CreateIndex
CREATE INDEX "patient_handoffs_previousHandoffId_idx" ON "patient_handoffs"("previousHandoffId");

-- AddForeignKey
ALTER TABLE "patient_handoffs" ADD CONSTRAINT "patient_handoffs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_handoffs" ADD CONSTRAINT "patient_handoffs_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_handoffs" ADD CONSTRAINT "patient_handoffs_fromCenterId_fkey" FOREIGN KEY ("fromCenterId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_handoffs" ADD CONSTRAINT "patient_handoffs_toCenterId_fkey" FOREIGN KEY ("toCenterId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_handoffs" ADD CONSTRAINT "patient_handoffs_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_handoffs" ADD CONSTRAINT "patient_handoffs_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_handoffs" ADD CONSTRAINT "patient_handoffs_previousHandoffId_fkey" FOREIGN KEY ("previousHandoffId") REFERENCES "patient_handoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
